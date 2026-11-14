import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Offline boot check for a DSH profile.
 *
 * DSH (>= 0.1.2-rc.1) refuses to start when a bundle in `dsh.profile.bundles`:
 *   - has no package.json / cannot be found
 *   - has no `dsh.bundle.patch`
 *   - points at a patch file that is missing
 *   - points at a patch file that is not valid YAML
 * It also crashes when the profile patch declares the same loader entry id twice
 * (`duplicate loader entry id`), which is exactly what bit us once.
 *
 * We deliberately replicate those rules instead of importing
 * `@deepseek-ai/dsh-app-boot`: that package lives inside app.asar on desktop
 * builds and cannot always be resolved from a plugin process.
 */

function readJson(file) {
  const raw = readFileSync(file, 'utf8')
  const withBom = raw.charCodeAt(0) === 0xfeff
  return { doc: JSON.parse(raw.replace(/^\uFEFF/, '')), withBom }
}

/** Find a package directory for a bundle name, searching the usual roots. */
function findPackageDir(name, roots) {
  for (const root of roots) {
    if (!root) continue
    const direct = join(root, name)
    if (existsSync(join(direct, 'package.json'))) return direct
    // scoped names: @scope/name -> root/@scope/name
    if (name.startsWith('@')) {
      const candidate = join(root, ...name.split('/'))
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  // pnpm layout: node_modules/.pnpm/<name>@<version>/node_modules/<name>
  for (const root of roots) {
    if (!root) continue
    const pnpmDir = join(root, '.pnpm')
    if (!existsSync(pnpmDir)) continue
    try {
      for (const entry of readdirSync(pnpmDir)) {
        const base = entry.split('@')[0]
        if (base !== name && entry.indexOf(name.replace('/', '+') + '@') !== 0) continue
        const candidate = join(pnpmDir, entry, 'node_modules', name)
        if (existsSync(join(candidate, 'package.json'))) return candidate
      }
    } catch {
      // ignore
    }
  }
  return ''
}

/**
 * Very small YAML helper: enough to find duplicate `id:` entries and detect
 * obviously broken files. We only look at top-level list entries.
 */
function scanPatchIds(text) {
  const ids = []
  const lines = String(text || '').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^-\s*id\s*:\s*['"]?([^'"\s#]+)['"]?$/)
    if (match) ids.push(match[1])
  }
  return ids
}

function looksLikeBrokenYaml(text) {
  const lines = String(text || '').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // a line that starts with "key:" must be followed by something or be empty mapping
    if (/^[^\s:#-][^:]*:\s*$/.test(trimmed) && !/^-\s/.test(trimmed)) {
      // allow "key:" forms used as mapping headers
      continue
    }
    if (/^\t/.test(line)) return '使用 Tab 缩进（YAML 不允许）'
  }
  return ''
}

export async function checkBoot({ dshHome, profileName, userLayer = true } = {}) {
  const lines = []
  const problems = []
  const ok = (s) => lines.push('  ✔ ' + s)
  const bad = (s) => {
    lines.push('  ✗ ' + s)
    problems.push(s)
  }

  const profileDir = join(dshHome, 'profiles', profileName)
  const manifestPath = join(profileDir, 'package.json')
  lines.push(`profile: ${profileDir}`)

  if (!existsSync(manifestPath)) {
    bad(`profile 清单不存在：${manifestPath}`)
    return { ok: false, lines, problems, profile: profileName }
  }

  let manifest
  try {
    const parsed = readJson(manifestPath)
    manifest = parsed.doc
    if (parsed.withBom) lines.push('  ! 清单带 BOM（能读，但建议去掉）')
    ok('profile 清单 JSON 合法')
  } catch (error) {
    bad(`profile 清单 JSON 解析失败：${error?.message || error}`)
    return { ok: false, lines, problems, profile: profileName }
  }

  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.length === 0) {
    bad('dsh.profile.bundles 缺失或为空')
    return { ok: false, lines, problems, profile: profileName }
  }
  lines.push(`bundles: ${bundles.length} 个`)

  const roots = [
    join(profileDir, 'node_modules'),
    join(dshHome, '..', 'node_modules'),
    join(dshHome, 'node_modules'),
  ]

  for (const name of bundles) {
    const dir = findPackageDir(name, roots)
    if (!dir) {
      // builtin bundles live inside the app bundle; not fatal
      lines.push(`  · ${name}：本地找不到（可能是内置包，跳过）`)
      continue
    }
    let pkg
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
    } catch (error) {
      bad(`${name}：package.json 读不了（${error?.message || error}）`)
      continue
    }
    const patchRel = pkg?.dsh?.bundle?.patch
    if (!patchRel) {
      bad(`${name}：package.json 缺 dsh.bundle —— 启动会报 "declares no dsh.bundle"`)
      continue
    }
    const patchPath = join(dir, patchRel)
    if (!existsSync(patchPath)) {
      bad(`${name}：dsh.bundle.patch=${patchRel} 但文件不存在`)
      continue
    }
    const text = readFileSync(patchPath, 'utf8')
    const broken = looksLikeBrokenYaml(text)
    if (broken) {
      bad(`${name}：patch 文件 ${broken}`)
      continue
    }
    const ids = scanPatchIds(text)
    ok(`${name}：patch ${patchRel}（${ids.length} 条 id）`)
  }

  if (userLayer) {
    const userPatch = join(profileDir, 'cordis.patch.yml')
    if (existsSync(userPatch)) {
      const text = readFileSync(userPatch, 'utf8')
      const broken = looksLikeBrokenYaml(text)
      if (broken) bad(`profile cordis.patch.yml ${broken}`)
      else {
        const ids = scanPatchIds(text)
        const dupes = ids.filter((id, index) => ids.indexOf(id) !== index)
        if (dupes.length) {
          bad(`profile cordis.patch.yml 有重复 id：${[...new Set(dupes)].join(', ')} —— 启动会报 duplicate loader entry id`)
        } else {
          ok(`profile cordis.patch.yml 合法（${ids.length} 条 id，无重复）`)
        }
      }
    } else {
      lines.push('  · 没有 profile cordis.patch.yml（可以不建）')
    }
  }

  return { ok: problems.length === 0, lines, problems, profile: profileName }
}

/** Detect duplicate ids in a patch text (exported for reuse before writing). */
export function duplicateIdsInPatch(text) {
  const ids = scanPatchIds(text)
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
}
