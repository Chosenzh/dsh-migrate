import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'

/**
 * Extra payloads that make a migration "whole" instead of "just plugins":
 *   config       – profiles/<name>/package.json + cordis.patch.yml
 *   sessions     – conversation logs
 *   attachments  – uploaded files / images
 *   worlds       – the companion world (room, diary, persona)
 *
 * Everything is copied with a per-file sha256 recorded in the manifest so the
 * restore side can prove it got the same bytes.
 */

export const EXTRA_KINDS = ['config', 'sessions', 'attachments', 'worlds']

/**
 * Ready-made scopes for the "newcomer" flow: the user only picks a level.
 *   essential  – config + memory (smallest, enough to keep the setup)
 *   standard   – + sessions + worlds (daily driver)
 *   everything – + attachments (largest, byte-for-byte move)
 */
export const PRESETS = Object.freeze({
  essential: { config: true, sessions: false, attachments: false, worlds: false },
  standard: { config: true, sessions: true, attachments: false, worlds: true },
  everything: { config: true, sessions: true, attachments: true, worlds: true },
})

/** Turn a preset name (or an explicit include object) into an include map. */
export function resolveInclude({ preset = '', include = null } = {}) {
  if (include && typeof include === 'object') {
    return {
      config: include.config !== false,
      sessions: include.sessions === true,
      attachments: include.attachments === true,
      worlds: include.worlds === true,
    }
  }
  const key = String(preset || 'standard').toLowerCase()
  return { ...(PRESETS[key] || PRESETS.standard) }
}

/** Which extra dirs exist for this home/profile. */
export function availableExtras(dshHome, profileName) {
  const out = {}
  out.config = existsSync(join(dshHome, 'profiles', profileName, 'package.json'))
  out.sessions = existsSync(join(dshHome, 'sessions'))
  out.attachments = existsSync(join(dshHome, 'attachments'))
  out.worlds = existsSync(join(dshHome, 'worlds'))
  return out
}

async function walk(root, base, out) {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = join(root, entry.name)
    if (entry.isDirectory()) {
      await walk(abs, base, out)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const stat = await fs.stat(abs)
      out.push({ abs, rel: relative(base, abs).split(sep).join('/'), size: stat.size })
    } catch {
      // raced with a delete
    }
  }
}

async function sha256File(file) {
  const hash = createHash('sha256')
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

/**
 * Copy the selected extras into `<packRoot>/extras/<kind>/...` and return a
 * manifest section describing every file with its sha256.
 *
 * `maxBytes` caps the total; files that would exceed it are recorded as skipped
 * instead of silently dropped.
 */
export async function collectExtras({
  dshHome,
  profileName,
  packRoot,
  include = { config: true, sessions: true, attachments: true, worlds: true },
  maxBytes = 1024 * 1024 * 1024,
  onLog = null,
} = {}) {
  const result = { totalFiles: 0, totalBytes: 0, kinds: {}, skipped: [] }
  const extrasRoot = join(packRoot, 'extras')
  let budget = maxBytes

  const plan = []
  if (include.config) {
    const dir = join(dshHome, 'profiles', profileName)
    for (const name of ['package.json', 'cordis.patch.yml']) {
      const file = join(dir, name)
      if (existsSync(file)) plan.push({ kind: 'config', abs: file, rel: name })
    }
  }
  for (const kind of ['sessions', 'attachments', 'worlds']) {
    if (!include[kind]) continue
    const dir = join(dshHome, kind)
    if (!existsSync(dir)) continue
    const files = []
    await walk(dir, dir, files)
    for (const file of files) plan.push({ kind, abs: file.abs, rel: file.rel, size: file.size })
  }

  const files = []
  for (const item of plan) {
    let size = item.size
    if (size === undefined) {
      try {
        size = (await fs.stat(item.abs)).size
      } catch {
        continue
      }
    }
    if (size > budget) {
      result.skipped.push({ kind: item.kind, rel: item.rel, reason: 'over-budget', size })
      continue
    }
    budget -= size
    const target = join(extrasRoot, item.kind, ...item.rel.split('/'))
    await fs.mkdir(join(target, '..'), { recursive: true })
    await fs.copyFile(item.abs, target)
    const digest = await sha256File(target)
    files.push({ kind: item.kind, rel: item.rel, size, sha256: digest })
    result.totalFiles += 1
    result.totalBytes += size
    const bucket = (result.kinds[item.kind] = result.kinds[item.kind] || { files: 0, bytes: 0 })
    bucket.files += 1
    bucket.bytes += size
    onLog?.('info', `extra ${item.kind}/${item.rel} (${size} bytes)`)
  }

  result.files = files
  return result
}

/** Rewrite source-machine absolute paths inside a package.json / patch text. */
export function rewritePaths(text, { sourceHome, targetHome, sourceProfile, targetProfile }) {
  let out = String(text || '')
  const replacements = [
    [sourceHome, targetHome],
    [sourceHome.split('\\').join('/'), targetHome.split('\\').join('/')],
    [sourceHome.split('\\').join('\\\\'), targetHome.split('\\').join('\\\\')],
  ]
  if (sourceProfile && targetProfile && sourceProfile !== targetProfile) {
    for (const sep of ['\\', '/']) {
      replacements.push([
        `${sourceHome}${sep}profiles${sep}${sourceProfile}`,
        `${targetHome}${sep}profiles${sep}${targetProfile}`,
      ])
    }
  }
  for (const [from, to] of replacements) {
    if (!from || from === to) continue
    out = out.split(from).join(to)
  }
  return out
}
