import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename, dirname, resolve, relative } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildSnapshot, snapshotFileName } from './archive.mjs'

const execFileAsync = promisify(execFile)

/** List every profile directory under $DSH_HOME/profiles that has a package.json. */
export async function detectProfiles(dshHome) {
  const root = join(dshHome, 'profiles')
  let names = []
  try {
    names = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of names) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) continue
    let pkg = null
    try {
      pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    } catch {
      continue
    }
    out.push({
      name: entry.name,
      dir,
      packageName: pkg?.name || entry.name,
      deps: pkg?.dependencies || {},
      bundles: pkg?.dsh?.profile?.bundles || [],
    })
  }
  return out
}

/**
 * Classify every dependency of a profile:
 *   tgz  – file:*.tgz (a local tarball we can copy)
 *   dir  – link:<path> (a local directory we can zip)
 *   npm  – a registry version we can either record (lite) or pack to tgz (full)
 *   other – anything unexpected; reported but not packed
 */
export function classifyPlugins(profile) {
  const items = []
  for (const [name, spec] of Object.entries(profile.deps || {})) {
    const value = String(spec)
    if (value.startsWith('file:')) {
      const p = value.slice(5).replace(/^\/+/, '')
      items.push({ name, kind: 'tgz', spec: value, path: resolve(p) })
    } else if (value.startsWith('link:')) {
      const p = value.slice(5).replace(/^\/+/, '')
      items.push({ name, kind: 'dir', spec: value, path: resolve(p) })
    } else if (/^\d+\.\d+\.\d+/.test(value) || value.startsWith('^') || value.startsWith('~')) {
      items.push({ name, kind: 'npm', spec: value, path: '' })
    } else {
      items.push({ name, kind: 'other', spec: value, path: '' })
    }
  }
  return items
}

function safeName(value) {
  return String(value || '').replace(/[^a-z0-9_.-]+/gi, '-')
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(src, entry.name)
    const to = join(dst, entry.name)
    if (entry.isDirectory()) {
      await copyDir(from, to)
    } else if (entry.isFile()) {
      await fs.copyFile(from, to)
    } else if (entry.isSymbolicLink()) {
      // Follow the link once: pnpm block stores real files behind symlinks.
      try {
        const real = await fs.realpath(from)
        const stat = await fs.stat(real)
        if (stat.isDirectory()) await copyDir(real, to)
        else await fs.copyFile(real, to)
      } catch {
        // broken link, skip
      }
    }
  }
}

/** Download an exact registry version as a tarball (full mode). */
async function packFromRegistry(name, version, outDir, onLog) {
  const dir = join(outDir, 'plugins')
  await fs.mkdir(dir, { recursive: true })
  const target = `${name}@${version}`
  try {
    await execFileAsync('npm.cmd', ['pack', target, '--pack-destination', dir], {
      timeout: 300000,
      windowsHide: true,
    })
    onLog?.('info', `packed ${target}`)
    return { ok: true, file: target }
  } catch (error) {
    onLog?.('warn', `npm pack ${target} failed: ${error?.message || error}`)
    return { ok: false, error: String(error?.message || error) }
  }
}

/**
 * Build a migration pack directory:
 *   manifest.json, plugins/, npm-plugins.json, install.ps1, README.md, memory.json.gz
 */
export async function packMigration({
  dshHome,
  profileName = '',
  mode = 'lite',
  outDir = '',
  snapshot = true,
  onLog = null,
} = {}) {
  const profiles = await detectProfiles(dshHome)
  if (profiles.length === 0) throw new Error(`no DSH profile found under ${join(dshHome, 'profiles')}`)
  const profile = profileName
    ? profiles.find((p) => p.name === profileName)
    : profiles[0]
  if (!profile) throw new Error(`profile not found: ${profileName}`)

  const plugins = classifyPlugins(profile)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const root = outDir
    ? resolve(outDir)
    : join(dshHome, 'memory-sync', 'packs', `dsh-migrate-${stamp}`)
  const pluginDir = join(root, 'plugins')
  await fs.mkdir(pluginDir, { recursive: true })

  const packed = []
  const npmList = []
  const skipped = []

  for (const item of plugins) {
    if (item.kind === 'tgz') {
      const file = join(pluginDir, basename(item.path))
      if (!existsSync(item.path)) {
        skipped.push({ name: item.name, reason: `missing ${item.path}` })
        continue
      }
      await fs.copyFile(item.path, file)
      packed.push({ name: item.name, version: '', kind: 'tgz', file: basename(file) })
      onLog?.('info', `copied ${item.name}`)
    } else if (item.kind === 'dir') {
      if (!existsSync(item.path)) {
        skipped.push({ name: item.name, reason: `missing ${item.path}` })
        continue
      }
      const dirName = safeName(item.name)
      await copyDir(item.path, join(pluginDir, dirName))
      packed.push({ name: item.name, version: '', kind: 'dir', file: `${dirName}/` })
      onLog?.('info', `bundled directory ${item.name}`)
    } else if (item.kind === 'npm') {
      const version = String(item.spec).replace(/^[\^~]/, '')
      if (mode === 'full') {
        const result = await packFromRegistry(item.name, version, root, onLog)
        if (result.ok) {
          packed.push({ name: item.name, version, kind: 'npm', file: `${item.name}-${version}.tgz` })
        } else {
          npmList.push({ name: item.name, version })
          skipped.push({ name: item.name, reason: 'npm pack failed, will install online' })
        }
      } else {
        npmList.push({ name: item.name, version })
      }
    } else {
      skipped.push({ name: item.name, reason: `unsupported spec ${item.spec}` })
    }
  }

  // Memory snapshot next to the plugins.
  let memory = null
  if (snapshot) {
    const memoriesDir = join(dshHome, 'memories')
    if (existsSync(memoriesDir)) {
      const snap = await buildSnapshot(memoriesDir, { machine: 'pack', maxBytes: 256 * 1024 * 1024 })
      const file = join(root, 'memory.json.gz')
      await fs.writeFile(file, snap.body)
      memory = { file: 'memory.json.gz', bytes: snap.body.length, files: snap.meta.fileCount, digest: snap.digest }
      onLog?.('info', `memory snapshot ${snap.body.length} bytes / ${snap.meta.fileCount} files`)
    } else {
      onLog?.('warn', `memory dir not found: ${memoriesDir}`)
    }
  }

  const dshVersion = await readDshVersion(dshHome)
  const manifest = {
    kind: 'dsh-migrate',
    format: 1,
    createdAt: new Date().toISOString(),
    mode,
    source: {
      profile: profile.name,
      packageName: profile.packageName,
      dshVersion,
      machine: process.env.COMPUTERNAME || '',
    },
    plugins: {
      bundles: profile.bundles,
      packed,
      npm: npmList,
      skipped,
    },
    memory,
    installer: 'install.ps1',
  }
  await fs.writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await fs.writeFile(join(root, 'npm-plugins.json'), JSON.stringify(npmList, null, 2), 'utf8')

  const installer = renderInstaller(manifest)
  await fs.writeFile(join(root, 'install.ps1'), installer, 'utf8')
  await fs.writeFile(join(root, 'README.md'), renderReadme(manifest), 'utf8')

  return { ok: true, root, mode, manifest }
}

async function readDshVersion(dshHome) {
  const candidates = [
    join(dirname(dshHome), 'Program Files', 'DSH', 'resources', 'app.asar', 'package.json'),
    join(dshHome, '..', 'DSH', 'package.json'),
    'D:\\Program Files\\DSH\\resources\\app.asar\\package.json',
    'C:\\Program Files\\DSH\\resources\\app.asar\\package.json',
    join(process.env.LOCALAPPDATA || '', 'Programs\\DSH\\resources\\app.asar\\package.json'),
  ]
  for (const p of candidates) {
    try {
      const doc = JSON.parse(readFileSync(p, 'utf8'))
      if (doc.version) return doc.version
    } catch {
      // next
    }
  }
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*DeepSeek Harness*' } | Select-Object -First 1).DisplayVersion",
    ], { timeout: 15000, windowsHide: true })
    const value = String(stdout || '').trim()
    if (value) return value
  } catch {
    // ignore
  }
  return ''
}

/** Compress a finished pack directory into a single .zip next to it (Windows). */
export async function zipPack(root) {
  const zip = `${root}.zip`
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path '${root}\\*' -DestinationPath '${zip}' -Force`,
  ], { timeout: 600000, windowsHide: true })
  const stat = await fs.stat(zip)
  return { ok: true, path: zip, bytes: stat.size }
}

// ---------- templates ----------

function renderInstaller(manifest) {
  const json = JSON.stringify(manifest, null, 2)
  return `# dsh-migrate installer (generated)
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 [-DryRun] [-Yes]
param(
  [switch]$DryRun,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$Manifest = '${escapePs(json)}'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = $Manifest | ConvertFrom-Json

function Write-Step($text) { Write-Host ("[dsh-migrate] " + $text) -ForegroundColor Cyan }
function Fail($text) { Write-Host ("[dsh-migrate] FAILED: " + $text) -ForegroundColor Red; exit 1 }

# --- 1. locate DSH ---
function Find-Dsh {
  $candidates = @()
  foreach ($key in @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  )) {
    try {
      Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -like '*DeepSeek Harness*' -or $_.DisplayName -like '*DSH*'
      } | ForEach-Object {
        if ($_.InstallLocation) { $candidates += $_.InstallLocation }
      }
    } catch {}
  }
  $candidates += @(
    (Join-Path $env:LOCALAPPDATA 'Programs\\DSH'),
    'D:\\Program Files\\DSH',
    'C:\\Program Files\\DSH',
    (Join-Path $env:ProgramFiles 'DSH')
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path (Join-Path $c 'resources\\app.asar'))) { return $c }
  }
  return ''
}

$dshHome = Join-Path $env:USERPROFILE '.dsh'
if (-not (Test-Path $dshHome)) {
  New-Item -ItemType Directory -Force -Path $dshHome | Out-Null
}

$dshDir = Find-Dsh
if (-not $dshDir) {
  Fail 'DSH (DeepSeek Harness) not found. Install DSH first, then run this script again.'
}
Write-Step ("DSH found: " + $dshDir)

# --- 2. locate pnpm / node ---
$pnpm = Join-Path $dshDir 'resources\\runtime\\primary-runtime\\dependencies\\pnpm\\bin\\pnpm.cjs'
if (-not (Test-Path $pnpm)) {
  $pnpm = Join-Path $dshDir 'resources\\runtime\\x64\\primary-runtime\\dependencies\\pnpm\\bin\\pnpm.cjs'
}
if (-not (Test-Path $pnpm)) { Fail 'DSH bundled pnpm not found in ' + $dshDir }
$node = 'node'
try { & $node --version | Out-Null } catch { Fail 'Node.js not found on PATH' }
Write-Step ("node: " + (& $node --version) + "  pnpm: " + $pnpm)

# --- 3. choose profile ---
$profilesRoot = Join-Path $dshHome 'profiles'
$profiles = @()
if (Test-Path $profilesRoot) {
  $profiles = Get-ChildItem $profilesRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'package.json') }
}
if ($profiles.Count -eq 0) { Fail 'No DSH profile found under ' + $profilesRoot }
$targetProfile = $null
if ($profiles.Count -eq 1) {
  $targetProfile = $profiles[0]
} else {
  Write-Step 'Multiple profiles found:'
  for ($i = 0; $i -lt $profiles.Count; $i++) { Write-Step ("  [" + $i + "] " + $profiles[$i].Name) }
  $sel = Read-Host 'Choose profile index'
  $targetProfile = $profiles[[int]$sel]
}
Write-Step ("Target profile: " + $targetProfile.FullName)

if ($DryRun) { Write-Step 'DRY RUN: no changes will be made.' }

# --- 4. backup profile ---
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $DryRun) {
  Copy-Item (Join-Path $targetProfile.FullName 'package.json') (Join-Path $targetProfile.FullName ("package.json.bak-migrate-" + $stamp)) -Force
  Copy-Item (Join-Path $targetProfile.FullName 'cordis.patch.yml') (Join-Path $targetProfile.FullName ("cordis.patch.yml.bak-migrate-" + $stamp)) -Force -ErrorAction SilentlyContinue
  Write-Step 'profile backed up'
}

# --- 5. install plugins ---
$pluginDir = Join-Path $Root 'plugins'
foreach ($p in $manifest.plugins.packed) {
  $src = Join-Path $pluginDir $p.file
  if ($p.kind -eq 'tgz' -or $p.kind -eq 'npm') {
    Write-Step ("installing " + $p.name + " from " + $p.file)
    if ($DryRun) { continue }
    Push-Location $targetProfile.FullName
    try { & $node $pnpm add $src 2>&1 | ForEach-Object { Write-Host $_ } } finally { Pop-Location }
  } elseif ($p.kind -eq 'dir') {
    $dest = Join-Path $dshHome ('plugins\\' + $p.name)
    Write-Step ("linking " + $p.name + " from bundled directory")
    if ($DryRun) { continue }
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Copy-Item $src $dest -Recurse -Force
    Push-Location $targetProfile.FullName
    try { & $node $pnpm add ('link:' + $dest) 2>&1 | ForEach-Object { Write-Host $_ } } finally { Pop-Location }
  }
}
foreach ($p in $manifest.plugins.npm) {
  Write-Step ("installing " + $p.name + '@' + $p.version + ' from registry')
  if ($DryRun) { continue }
  Push-Location $targetProfile.FullName
  try { & $node $pnpm add ($p.name + '@' + $p.version) 2>&1 | ForEach-Object { Write-Host $_ } } finally { Pop-Location }
}

# --- 6. rewrite bundles ---
if (-not $DryRun) {
  $pkgFile = Join-Path $targetProfile.FullName 'package.json'
  $pkg = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $bundles = @($manifest.plugins.bundles)
  $existing = @($pkg.dsh.profile.bundles)
  foreach ($b in $bundles) { if ($existing -notcontains $b) { $existing += $b } }
  $pkg.dsh.profile.bundles = $existing
  $json = $pkg | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($pkgFile, $json + "\`n", [System.Text.UTF8Encoding]::new($false))
  Write-Step 'bundles updated'
}

# --- 7. merge memory ---
if ($manifest.memory) {
  $memFile = Join-Path $Root $manifest.memory.file
  if (Test-Path $memFile) {
    $memories = Join-Path $dshHome 'memories'
    if (-not (Test-Path $memories)) { New-Item -ItemType Directory -Force -Path $memories | Out-Null }
    Write-Step ("merging memory: " + $manifest.memory.file)
    if (-not $DryRun) {
      $bytes = [System.IO.File]::ReadAllBytes($memFile)
      $ms = New-Object System.IO.MemoryStream(,$bytes)
      $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
      $reader = New-Object System.IO.StreamReader($gz, [System.Text.Encoding]::UTF8)
      $jsonText = $reader.ReadToEnd()
      $reader.Close(); $gz.Close(); $ms.Close()
      $doc = $jsonText | ConvertFrom-Json
      $written = 0; $skipped = 0
      foreach ($f in $doc.files) {
        if (-not $f.content) { continue }
        $rel = [string]$f.path
        if ($rel.Contains('..')) { continue }
        $abs = Join-Path $memories ($rel -replace '/', '\\')
        $dir = Split-Path -Parent $abs
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        if (Test-Path $abs) {
          $local = [System.IO.File]::ReadAllText($abs, [System.Text.Encoding]::UTF8)
          if ($local -eq $f.content) { $skipped++; continue }
          Copy-Item $abs ($abs + '.bak-migrate') -Force
        }
        [System.IO.File]::WriteAllText($abs, [string]$f.content, [System.Text.UTF8Encoding]::new($false))
        $written++
      }
      Write-Step ("memory merged: " + $written + " written, " + $skipped + " identical")
    }
  }
}

if ($DryRun) { Write-Step 'DRY RUN finished. Re-run without -DryRun to apply.'; exit 0 }
Write-Step 'Plugins installed and memory merged.'

# --- 8. restart with confirmation ---
if ($Yes) { $confirm = $true } else {
  $confirm = $false
  $shell = New-Object -ComObject WScript.Shell
  $ans = $shell.Popup("dsh-migrate finished. Restart DSH now?", 0, 'dsh-migrate', 4 + 32)
  if ($ans -eq 6) { $confirm = $true }
}
if (-not $confirm) { Write-Step 'DSH not restarted. Start it yourself when ready.'; exit 0 }

# busy check: 3 s CPU delta across DSH processes
$procs = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
$busy = $false
if ($procs) {
  $before = @{}
  foreach ($p in $procs) { $before[$p.Id] = $p.CPU }
  Start-Sleep -Seconds 3
  $delta = 0
  foreach ($p in $procs) {
    $cur = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if ($cur -and $before.ContainsKey($p.Id)) { $delta += ($cur.CPU - $before[$p.Id]) }
  }
  if (($delta / 3.0) -gt 0.10) { $busy = $true }
}
$shell = New-Object -ComObject WScript.Shell
if ($busy) {
  $a1 = $shell.Popup("DSH has an active session. Restarting will interrupt it. Continue?", 0, 'dsh-migrate', 4 + 48)
  if ($a1 -ne 6) { Write-Step 'Cancelled at step 1 of 3.'; exit 0 }
  $a2 = $shell.Popup("The session may be producing output. Unsaved text will be lost. Really continue?", 0, 'dsh-migrate', 4 + 48)
  if ($a2 -ne 6) { Write-Step 'Cancelled at step 2 of 3.'; exit 0 }
  $a3 = $shell.Popup("Final confirmation: restart DSH NOW?", 0, 'dsh-migrate', 4 + 16)
  if ($a3 -ne 6) { Write-Step 'Cancelled at step 3 of 3.'; exit 0 }
} else {
  $a1 = $shell.Popup("DSH looks idle. Restart it now?", 0, 'dsh-migrate', 4 + 32)
  if ($a1 -ne 6) { Write-Step 'Cancelled.'; exit 0 }
}

$exe = Join-Path $dshDir 'DeepSeek Harness.exe'
Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if (Test-Path $exe) { Start-Process -FilePath $exe | Out-Null }
Write-Step 'DSH restarted.'
`
}

function escapePs(text) {
  return String(text).replace(/'/g, "''")
}

function renderReadme(manifest) {
  const lines = [
    '# dsh-migrate pack',
    '',
    `生成时间：${manifest.createdAt}`,
    `来源机器：${manifest.source.machine || 'unknown'}`,
    `来源 profile：${manifest.source.profile}`,
    `模式：${manifest.mode}（${manifest.mode === 'full' ? '完整包，离线可用' : '轻量包，npm 插件需联网'}）`,
    `插件：${manifest.plugins.packed.length} 个本地 + ${manifest.plugins.npm.length} 个 npm`,
    manifest.memory ? `记忆：${manifest.memory.file}（${manifest.memory.files} 个文件）` : '记忆：无',
    '',
    '## 用法',
    '',
    '```powershell',
    'powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun   # 先预演',
    'powershell -ExecutionPolicy Bypass -File install.ps1          # 正式安装',
    '```',
    '',
    '脚本会：找 DSH → 选 profile → 备份 → 装插件 → 改 bundles → 合并记忆 → 确认后重启。',
    '',
    '## 注意',
    '',
    '- 这是社区工具，不是 DSH 官方发布。',
    '- 杀毒软件可能拦截（脚本会改配置并结束进程），请确认来源后手动放行。',
    '- 重启前的确认：检测到有会话在跑时会连续问三次。',
  ]
  return lines.join('\n')
}
