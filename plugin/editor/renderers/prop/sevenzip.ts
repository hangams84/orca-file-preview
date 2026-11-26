/** Read-only 7z reader: the signature header, plain or LZMA-encoded headers, folders with Copy,
 *  LZMA, LZMA2 or Deflate coders, sub-streams and file names. Encrypted (AES) archives are listed
 *  when their header is plain and refused when the header itself is encrypted. Enough for EPLAN
 *  .edz part packages and .zw1 project backups, which are ordinary 7z archives. */
import { inflateSync } from '../../../vendor/zip.js'
import { decodeLzma, decodeLzma2 } from './lzma.ts'

export type SevenZipErrorCode = 'not-7z' | 'damaged' | 'encrypted' | 'unsupported' | 'too-large'

export class SevenZipError extends Error {
  readonly code: SevenZipErrorCode
  constructor(message: string, code: SevenZipErrorCode = 'damaged') {
    super(message)
    this.code = code
  }
}

export const SEVENZIP_SIG = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]

export function is7z(b: Uint8Array): boolean {
  return b.length >= 32 && SEVENZIP_SIG.every((v, i) => b[i] === v)
}

interface Coder {
  id: string
  numIn: number
  numOut: number
  props: Uint8Array
}

interface Folder {
  coders: Coder[]
  bindPairs: { inIndex: number; outIndex: number }[]
  packedStreams: number[]
  unpackSizes: number[]
  /** First pack stream of this folder (index into packSizes). */
  firstPack: number
}

export interface SevenZipEntry {
  path: string
  size: number
  dir: boolean
  mtime?: Date
  /** Folder index, -1 for empty files and directories. */
  folder: number
  /** Offset of this file in the folder's unpacked output. */
  offset: number
}

export interface SevenZip {
  entries: SevenZipEntry[]
  /** Coder names in use (e.g. `LZMA2`), for the info line. */
  methods: string[]
  solid: boolean
  encrypted: boolean
  read(e: SevenZipEntry): Uint8Array
}

const CODER_NAMES: Record<string, string> = {
  '00': 'Copy',
  '030101': 'LZMA',
  '21': 'LZMA2',
  '040108': 'Deflate',
  '040109': 'Deflate64',
  '040202': 'BZip2',
  '030401': 'PPMD',
  '03030103': 'BCJ',
  '0303011b': 'BCJ2',
  '06f10701': 'AES-256'
}

/** Upper bound for one decoded folder (solid block); bigger ones are refused, not attempted. */
export const MAX_FOLDER_BYTES = 512 * 1024 * 1024

class Reader {
  p = 0
  readonly b: Uint8Array
  constructor(b: Uint8Array) {
    this.b = b
  }
  byte(): number {
    if (this.p >= this.b.length) throw new SevenZipError('7z: header truncated')
    return this.b[this.p++]
  }
  num(): number {
    const first = this.byte()
    let mask = 0x80
    let value = 0
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) {
        const high = first & (mask - 1)
        return value + high * 2 ** (8 * i)
      }
      value += this.byte() * 2 ** (8 * i)
      mask >>>= 1
    }
    return value
  }
  u32(): number {
    const b = this.b
    if (this.p + 4 > b.length) throw new SevenZipError('7z: header truncated')
    const v = (b[this.p] | (b[this.p + 1] << 8) | (b[this.p + 2] << 16) | (b[this.p + 3] << 24)) >>> 0
    this.p += 4
    return v
  }
  u64(): number {
    const lo = this.u32()
    const hi = this.u32()
    return hi * 2 ** 32 + lo
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.p + n > this.b.length) throw new SevenZipError('7z: header truncated')
    const v = this.b.subarray(this.p, this.p + n)
    this.p += n
    return v
  }
  bits(n: number): boolean[] {
    const out: boolean[] = []
    let mask = 0
    let cur = 0
    for (let i = 0; i < n; i++) {
      if (mask === 0) {
        cur = this.byte()
        mask = 0x80
      }
      out.push((cur & mask) !== 0)
      mask >>>= 1
    }
    return out
  }
  /** "All defined" byte, then a bit vector when not all are defined. */
  defined(n: number): boolean[] {
    const all = this.byte()
    return all ? new Array<boolean>(n).fill(true) : this.bits(n)
  }
}

interface StreamsInfo {
  packPos: number
  packSizes: number[]
  folders: Folder[]
  /** Files per folder and their sizes. */
  subSizes: number[][]
}

function readStreamsInfo(r: Reader): StreamsInfo {
  const info: StreamsInfo = { packPos: 0, packSizes: [], folders: [], subSizes: [] }
  let id = r.byte()
  if (id === 0x06) {
    info.packPos = r.num()
    const n = r.num()
    if (n > 1e7) throw new SevenZipError('7z: too many pack streams')
    for (let t = r.byte(); t !== 0; t = r.byte()) {
      if (t === 0x09) for (let i = 0; i < n; i++) info.packSizes.push(r.num())
      else if (t === 0x0a) {
        const d = r.defined(n)
        for (const x of d) if (x) r.u32()
      } else skipProperty(r)
    }
    id = r.byte()
  }
  if (id === 0x07) {
    if (r.byte() !== 0x0b) throw new SevenZipError('7z: folder list expected')
    const n = r.num()
    if (n > 1e7) throw new SevenZipError('7z: too many folders')
    if (r.byte() !== 0) throw new SevenZipError('7z: external folders', 'unsupported')
    let firstPack = 0
    for (let i = 0; i < n; i++) {
      const f = readFolder(r)
      f.firstPack = firstPack
      firstPack += f.packedStreams.length
      info.folders.push(f)
    }
    if (r.byte() !== 0x0c) throw new SevenZipError('7z: unpack sizes expected')
    for (const f of info.folders) {
      const outs = f.coders.reduce((a, c) => a + c.numOut, 0)
      for (let i = 0; i < outs; i++) f.unpackSizes.push(r.num())
    }
    for (let t = r.byte(); t !== 0; t = r.byte()) {
      if (t === 0x0a) {
        const d = r.defined(info.folders.length)
        for (const x of d) if (x) r.u32()
      } else skipProperty(r)
    }
    id = r.byte()
  }
  // Default: one file per folder, of the folder's size.
  const counts = info.folders.map(() => 1)
  info.subSizes = info.folders.map((f) => [folderSize(f)])
  if (id === 0x08) {
    let t = r.byte()
    if (t === 0x0d) {
      for (let i = 0; i < counts.length; i++) counts[i] = r.num()
      t = r.byte()
    }
    if (t === 0x09) {
      info.subSizes = info.folders.map((f, i) => {
        const sizes: number[] = []
        if (counts[i] === 0) return sizes
        let sum = 0
        for (let k = 1; k < counts[i]; k++) {
          const s = r.num()
          sizes.push(s)
          sum += s
        }
        sizes.push(folderSize(f) - sum)
        return sizes
      })
      t = r.byte()
    } else {
      info.subSizes = info.folders.map((f, i) => (counts[i] === 0 ? [] : counts[i] === 1 ? [folderSize(f)] : []))
      if (counts.some((c) => c > 1)) throw new SevenZipError('7z: sizes of sub-streams missing')
    }
    while (t !== 0) {
      if (t === 0x0a) {
        let n = 0
        for (let i = 0; i < counts.length; i++) n += counts[i]
        const d = r.defined(n)
        for (const x of d) if (x) r.u32()
      } else skipProperty(r)
      t = r.byte()
    }
    id = r.byte()
  }
  if (id !== 0) throw new SevenZipError('7z: unexpected property in streams info')
  return info
}

function skipProperty(r: Reader): void {
  const size = r.num()
  r.bytes(size)
}

function readFolder(r: Reader): Folder {
  const numCoders = r.num()
  if (numCoders < 1 || numCoders > 32) throw new SevenZipError('7z: bad coder count')
  const coders: Coder[] = []
  let totalIn = 0
  let totalOut = 0
  for (let i = 0; i < numCoders; i++) {
    const flags = r.byte()
    const idSize = flags & 0x0f
    const id = Array.from(r.bytes(idSize), (x) => x.toString(16).padStart(2, '0')).join('')
    let numIn = 1
    let numOut = 1
    if (flags & 0x10) {
      numIn = r.num()
      numOut = r.num()
    }
    let props: Uint8Array = new Uint8Array(0)
    if (flags & 0x20) props = r.bytes(r.num())
    if (flags & 0x80) throw new SevenZipError('7z: alternative coders', 'unsupported')
    coders.push({ id, numIn, numOut, props })
    totalIn += numIn
    totalOut += numOut
  }
  const bindPairs: { inIndex: number; outIndex: number }[] = []
  for (let i = 0; i < totalOut - 1; i++) bindPairs.push({ inIndex: r.num(), outIndex: r.num() })
  const numPacked = totalIn - bindPairs.length
  const packedStreams: number[] = []
  if (numPacked === 1) {
    for (let i = 0; i < totalIn; i++) if (!bindPairs.some((b) => b.inIndex === i)) packedStreams.push(i)
  } else for (let i = 0; i < numPacked; i++) packedStreams.push(r.num())
  return { coders, bindPairs, packedStreams, unpackSizes: [], firstPack: 0 }
}

/** The folder's final output: the out stream no bind pair consumes. */
function folderSize(f: Folder): number {
  for (let i = f.unpackSizes.length - 1; i >= 0; i--) if (!f.bindPairs.some((b) => b.outIndex === i)) return f.unpackSizes[i]
  return 0
}

function decodeFolder(b: Uint8Array, packBase: number, packSizes: number[], f: Folder): Uint8Array {
  if (f.coders.some((c) => c.id === '06f10701')) throw new SevenZipError('7z: encrypted', 'encrypted')
  // Supported: a linear chain where each coder has one input and one output.
  if (f.coders.some((c) => c.numIn !== 1 || c.numOut !== 1) || f.packedStreams.length !== 1) {
    throw new SevenZipError(`7z: coder chain ${f.coders.map((c) => CODER_NAMES[c.id] ?? c.id).join('+')}`, 'unsupported')
  }
  let start = packBase
  for (let i = 0; i < f.firstPack; i++) start += packSizes[i]
  const size = packSizes[f.firstPack]
  if (size == null || start + size > b.length) throw new SevenZipError('7z: packed data beyond the end of the file')
  // Coder whose input is the packed stream decodes first, then follow the bind pairs outwards.
  let coderIndex = f.packedStreams[0]
  let data = b.subarray(start, start + size)
  for (let guard = 0; guard < f.coders.length; guard++) {
    const c = f.coders[coderIndex]
    const outSize = f.unpackSizes[coderIndex]
    if (outSize > MAX_FOLDER_BYTES) throw new SevenZipError('7z: block too large', 'too-large')
    data = runCoder(c, data, outSize)
    const bound = f.bindPairs.find((bp) => bp.outIndex === coderIndex)
    if (!bound) return data
    coderIndex = bound.inIndex
  }
  throw new SevenZipError('7z: coder chain loops')
}

function runCoder(c: Coder, data: Uint8Array, outSize: number): Uint8Array {
  switch (c.id) {
    case '00':
      if (data.length < outSize) throw new SevenZipError('7z: stored data truncated')
      return data.subarray(0, outSize)
    case '030101':
      return decodeLzma(data, c.props, outSize)
    case '21':
      return decodeLzma2(data, outSize)
    case '040108': {
      const out = inflateSync(data, { out: new Uint8Array(outSize) })
      if (out.length !== outSize) throw new SevenZipError('7z: deflate size mismatch')
      return out
    }
    default:
      throw new SevenZipError(`7z: coder ${CODER_NAMES[c.id] ?? c.id}`, 'unsupported')
  }
}

function filetime(lo: number, hi: number): Date | undefined {
  const ms = (hi * 2 ** 32 + lo) / 10000 - 11644473600000
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : undefined
}

export function readSevenZip(b: Uint8Array): SevenZip {
  if (!is7z(b)) throw new SevenZipError('not a 7z archive', 'not-7z')
  const sr = new Reader(b)
  sr.p = 12
  const nextOffset = sr.u64()
  const nextSize = sr.u64()
  const headerStart = 32 + nextOffset
  if (nextSize === 0) return { entries: [], methods: [], solid: false, encrypted: false, read: () => new Uint8Array(0) }
  if (headerStart + nextSize > b.length) throw new SevenZipError('7z: header beyond the end of the file (truncated archive)')
  let header = b.subarray(headerStart, headerStart + nextSize)
  let r = new Reader(header)
  let id = r.byte()
  const methods = new Set<string>()
  let encrypted = false
  for (let guard = 0; id === 0x17 && guard < 4; guard++) {
    const si = readStreamsInfo(r)
    for (const f of si.folders) for (const c of f.coders) methods.add(CODER_NAMES[c.id] ?? c.id)
    if (!si.folders.length) throw new SevenZipError('7z: empty encoded header')
    try {
      header = decodeFolder(b, 32 + si.packPos, si.packSizes, si.folders[0])
    } catch (e) {
      if (e instanceof SevenZipError && e.code === 'encrypted') throw new SevenZipError('7z: the file list is encrypted', 'encrypted')
      throw e
    }
    r = new Reader(header)
    id = r.byte()
  }
  if (id !== 0x01) throw new SevenZipError('7z: header expected')
  let si: StreamsInfo = { packPos: 0, packSizes: [], folders: [], subSizes: [] }
  let t = r.byte()
  if (t === 0x02) {
    // archive properties: (type, size, data)* 0
    for (let p = r.byte(); p !== 0; p = r.byte()) skipProperty(r)
    t = r.byte()
  }
  if (t === 0x03) {
    readStreamsInfo(r)
    t = r.byte()
  }
  if (t === 0x04) {
    si = readStreamsInfo(r)
    t = r.byte()
  }
  for (const f of si.folders) for (const c of f.coders) {
    methods.add(CODER_NAMES[c.id] ?? c.id)
    if (c.id === '06f10701') encrypted = true
  }
  const entries: SevenZipEntry[] = []
  if (t === 0x05) {
    const n = r.num()
    if (n > 1e7) throw new SevenZipError('7z: too many files')
    let emptyStream: boolean[] = new Array<boolean>(n).fill(false)
    let emptyFile: boolean[] = []
    let names: string[] = []
    let mtimes: (Date | undefined)[] = []
    let attrs: (number | undefined)[] = []
    for (let p = r.byte(); p !== 0; p = r.byte()) {
      const size = r.num()
      const end = r.p + size
      if (end > header.length) throw new SevenZipError('7z: file property beyond the header')
      if (p === 0x0e) emptyStream = r.bits(n)
      else if (p === 0x0f) emptyFile = r.bits(emptyStream.filter(Boolean).length)
      else if (p === 0x11) {
        if (r.byte() !== 0) throw new SevenZipError('7z: external names', 'unsupported')
        const raw = header.subarray(r.p, end)
        const text = new TextDecoder('utf-16le').decode(raw)
        names = text.split('\u0000').slice(0, n)
      } else if (p === 0x14) {
        const def = r.defined(n)
        if (r.byte() !== 0) throw new SevenZipError('7z: external times', 'unsupported')
        mtimes = def.map((d) => (d ? filetime(r.u32(), r.u32()) : undefined))
      } else if (p === 0x15) {
        const def = r.defined(n)
        if (r.byte() !== 0) throw new SevenZipError('7z: external attributes', 'unsupported')
        attrs = def.map((d) => (d ? r.u32() : undefined))
      }
      r.p = end
    }
    let folder = 0
    let inFolder = 0
    let offset = 0
    let emptyIndex = 0
    for (let i = 0; i < n; i++) {
      const path = (names[i] ?? `file${i + 1}`).replace(/\\/g, '/')
      if (emptyStream[i]) {
        const isFile = emptyFile[emptyIndex++] ?? false
        const attrDir = attrs[i] != null && (attrs[i]! & 0x10) !== 0
        entries.push({ path, size: 0, dir: !isFile || attrDir, mtime: mtimes[i], folder: -1, offset: 0 })
        continue
      }
      while (folder < si.folders.length && inFolder >= (si.subSizes[folder]?.length ?? 0)) {
        folder++
        inFolder = 0
        offset = 0
      }
      if (folder >= si.folders.length) throw new SevenZipError('7z: more files than streams')
      const size = si.subSizes[folder][inFolder]
      entries.push({ path, size, dir: false, mtime: mtimes[i], folder, offset })
      offset += size
      inFolder++
    }
  }
  const packBase = 32 + si.packPos
  let cache: { folder: number; data: Uint8Array } | null = null
  const solid = si.subSizes.some((s) => s.length > 1)
  return {
    entries,
    methods: [...methods],
    solid,
    encrypted,
    read(e) {
      if (e.folder < 0 || e.size === 0) return new Uint8Array(0)
      if (!cache || cache.folder !== e.folder) {
        cache = { folder: e.folder, data: decodeFolder(b, packBase, si.packSizes, si.folders[e.folder]) }
      }
      if (e.offset + e.size > cache.data.length) throw new SevenZipError('7z: file beyond its block')
      return cache.data.subarray(e.offset, e.offset + e.size)
    }
  }
}
