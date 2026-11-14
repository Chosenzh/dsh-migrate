import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateRawSync, createDeflateRaw, crc32 } from 'node:zlib'
import { join, dirname } from 'node:path'

/**
 * A small, dependency-free ZIP writer that streams file contents.
 *
 * Why not `Compress-Archive`:
 *   - it shells out to PowerShell (slow, and the plugin process may not be allowed to spawn)
 *   - it buffers the whole archive, so a multi-GB folder runs out of memory
 * Why not `bsdtar`:
 *   - it stores file names in the local code page and does not set the UTF-8 flag,
 *     so archives built on a Chinese Windows unpack as mojibake elsewhere
 *
 * This writer:
 *   - sets the UTF-8 flag (0x0800) on every entry
 *   - reads large files in chunks, so memory stays flat
 *   - splits into multiple volumes when the archive would exceed `maxPartBytes`
 */

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const BIG_FILE_BYTES = 64 * 1024 * 1024
const CHUNK = 1024 * 1024

function dosDateTime(date = new Date()) {
  const year = date.getFullYear()
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1f)
  const dateBits =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f)
  return { time, date: dateBits }
}

function localHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8')
  const buf = Buffer.alloc(30 + name.length)
  buf.writeUInt32LE(SIG_LOCAL, 0)
  buf.writeUInt16LE(20, 4) // version needed
  buf.writeUInt16LE(FLAG_UTF8, 6)
  buf.writeUInt16LE(entry.method, 8)
  buf.writeUInt16LE(entry.time, 10)
  buf.writeUInt16LE(entry.date, 12)
  buf.writeUInt32LE(entry.crc >>> 0, 14)
  buf.writeUInt32LE(entry.compressedSize >>> 0, 18)
  buf.writeUInt32LE(entry.size >>> 0, 22)
  buf.writeUInt16LE(name.length, 26)
  buf.writeUInt16LE(0, 28) // extra length
  name.copy(buf, 30)
  return buf
}

function centralHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8')
  const buf = Buffer.alloc(46 + name.length)
  buf.writeUInt32LE(SIG_CENTRAL, 0)
  buf.writeUInt16LE(20, 4) // version made by
  buf.writeUInt16LE(20, 6) // version needed
  buf.writeUInt16LE(FLAG_UTF8, 8)
  buf.writeUInt16LE(entry.method, 10)
  buf.writeUInt16LE(entry.time, 12)
  buf.writeUInt16LE(entry.date, 14)
  buf.writeUInt32LE(entry.crc >>> 0, 16)
  buf.writeUInt32LE(entry.compressedSize >>> 0, 20)
  buf.writeUInt32LE(entry.size >>> 0, 24)
  buf.writeUInt16LE(name.length, 28)
  buf.writeUInt16LE(0, 30) // extra
  buf.writeUInt16LE(0, 32) // comment
  buf.writeUInt16LE(0, 34) // disk start
  buf.writeUInt16LE(0, 36) // internal attrs
  buf.writeUInt32LE(0, 38) // external attrs
  buf.writeUInt32LE(entry.offset >>> 0, 42)
  name.copy(buf, 46)
  return buf
}

function eocd(entryCount, cdSize, cdOffset) {
  const buf = Buffer.alloc(22)
  buf.writeUInt32LE(SIG_EOCD, 0)
  buf.writeUInt16LE(0, 4)
  buf.writeUInt16LE(0, 6)
  buf.writeUInt16LE(entryCount, 8)
  buf.writeUInt16LE(entryCount, 10)
  buf.writeUInt32LE(cdSize >>> 0, 12)
  buf.writeUInt32LE(cdOffset >>> 0, 16)
  buf.writeUInt16LE(0, 20)
  return buf
}

/** Read a whole file and return { crc, size, data } (small files only). */
async function readFileFully(abs) {
  const data = await fs.readFile(abs)
  return { crc: crc32(data), size: data.length, data }
}

/** Stream a large file once to compute its CRC and size without loading it. */
async function scanFile(abs) {
  let crc = 0
  let size = 0
  await new Promise((resolve, reject) => {
    const stream = createReadStream(abs, { highWaterMark: CHUNK })
    stream.on('data', (chunk) => {
      crc = crc32(chunk, crc)
      size += chunk.length
    })
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return { crc, size }
}

class Volume {
  constructor(file) {
    this.file = file
    this.handle = null
    this.offset = 0
    this.entries = []
    this.bytes = 0
  }

  async open() {
    await fs.mkdir(dirname(this.file), { recursive: true })
    this.handle = await fs.open(this.file, 'w')
  }

  async write(buffer) {
    await this.handle.write(buffer)
    this.offset += buffer.length
    this.bytes += buffer.length
  }

  async addFile({ abs, name }) {
    const entry = { name: name.replace(/\\/g, '/'), offset: this.offset }
    const stamp = dosDateTime()
    entry.time = stamp.time
    entry.date = stamp.date
    entry.method = METHOD_DEFLATE

    const stat = await fs.stat(abs)
    if (stat.size <= BIG_FILE_BYTES) {
      const { crc, size, data } = await readFileFully(abs)
      const compressed = deflateRawSync(data, { level: 6 })
      entry.crc = crc
      entry.size = size
      entry.compressedSize = compressed.length
      await this.write(localHeader(entry))
      await this.write(compressed)
    } else {
      // two passes: scan for crc/size, then compress in one continuous deflate stream
      const { crc, size } = await scanFile(abs)
      entry.crc = crc
      entry.size = size
      const headerOffset = this.offset
      await this.write(localHeader({ ...entry, compressedSize: 0, crc: 0 }))
      let compressedSize = 0
      await new Promise((resolve, reject) => {
        const input = createReadStream(abs, { highWaterMark: CHUNK })
        const deflate = createDeflateRaw({ level: 6 })
        input.on('error', reject)
        deflate.on('error', reject)
        deflate.on('data', async (chunk) => {
          compressedSize += chunk.length
          try {
            await this.handle.write(chunk)
          } catch (error) {
            reject(error)
          }
          this.offset += chunk.length
          this.bytes += chunk.length
        })
        deflate.on('end', async () => {
          try {
            entry.compressedSize = compressedSize
            const header = localHeader(entry)
            await this.handle.write(header, 0, header.length, headerOffset)
            resolve()
          } catch (error) {
            reject(error)
          }
        })
        input.pipe(deflate)
      })
    }
    this.entries.push(entry)
    return entry
  }

  async close() {
    const cdStart = this.offset
    let cdSize = 0
    for (const entry of this.entries) {
      const buf = centralHeader(entry)
      await this.write(buf)
      cdSize += buf.length
    }
    await this.write(eocd(this.entries.length, cdSize, cdStart))
    await this.handle.close()
    this.handle = null
    return { file: this.file, bytes: this.bytes, files: this.entries.length }
  }
}

/**
 * Write `files` into one or more zip volumes.
 *
 * @param {object} opts
 * @param {string} opts.outBase  base path without extension, e.g. ".../pack"
 * @param {Array<{abs:string, rel:string}>} opts.files
 * @param {number} [opts.maxPartBytes]  split when a volume would exceed this (default 1.8GB)
 * @param {(level:string,msg:string)=>void} [opts.onLog]
 */
export async function writeZipVolumes({ outBase, files, maxPartBytes = 1800 * 1024 * 1024, onLog = null } = {}) {
  const volumes = []
  let index = 1
  let current = new Volume(`${outBase}${index === 1 ? '' : '-part' + index}.zip`)
  await current.open()

  for (const file of files) {
    const stat = await fs.stat(file.abs).catch(() => null)
    if (!stat) continue
    // leave room for headers; if this file would overflow the volume, roll over
    if (current.offset > 0 && current.offset + stat.size > maxPartBytes) {
      volumes.push(await current.close())
      index += 1
      current = new Volume(`${outBase}-part${index}.zip`)
      await current.open()
      onLog?.('info', `zip volume ${index} started`)
    }
    await current.addFile({ abs: file.abs, name: file.rel })
  }
  volumes.push(await current.close())

  return {
    ok: true,
    volumes,
    totalBytes: volumes.reduce((sum, v) => sum + v.bytes, 0),
    totalFiles: volumes.reduce((sum, v) => sum + v.files, 0),
  }
}

/** sha256 of a file, streamed. */
export async function sha256Of(file) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}
