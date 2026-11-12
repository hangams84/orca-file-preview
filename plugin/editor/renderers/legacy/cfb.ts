/** Minimal reader for OLE compound files (MS-CFB), the container of .doc, .ppt and .xls.
 *  Read-only: resolves the FAT, mini FAT and directory tree and returns stream bytes. */

export interface CfbEntry {
  name: string
  /** 1 storage, 2 stream, 5 root. */
  type: number
  start: number
  size: number
  left: number
  right: number
  child: number
}

export interface Cfb {
  entries: CfbEntry[]
  /** Names of the root storage's direct children. */
  rootNames(): string[]
  /** A stream directly under the root storage, or null. */
  stream(name: string): Uint8Array | null
}

const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const END = 0xfffffffe
const FREE = 0xffffffff

export function isCfb(b: Uint8Array): boolean {
  return b.length >= 512 && SIG.every((v, i) => b[i] === v)
}

export class CfbError extends Error {}

export function readCfb(bytes: Uint8Array): Cfb {
  if (!isCfb(bytes)) throw new CfbError('not a compound file')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (o: number) => dv.getUint32(o, true)
  const sectorShift = dv.getUint16(0x1e, true)
  const miniShift = dv.getUint16(0x20, true)
  if (sectorShift !== 9 && sectorShift !== 12) throw new CfbError('bad sector size')
  const ss = 1 << sectorShift
  const mss = 1 << miniShift
  const numFat = u32(0x2c)
  const firstDir = u32(0x30)
  const cutoff = u32(0x38) || 4096
  const firstMiniFat = u32(0x3c)
  const numMiniFat = u32(0x40)
  let difatSector = u32(0x44)
  let numDifat = u32(0x48)
  const sectorCount = Math.ceil((bytes.length - ss) / ss)
  const sectorOff = (s: number) => (s + 1) * ss

  // DIFAT: 109 entries in the header, then a chain of DIFAT sectors.
  const fatSectors: number[] = []
  for (let i = 0; i < 109 && fatSectors.length < numFat; i++) {
    const s = u32(0x4c + i * 4)
    if (s !== FREE) fatSectors.push(s)
  }
  let guard = 0
  while (difatSector !== END && difatSector !== FREE && numDifat-- > 0 && guard++ < 1e5) {
    if (difatSector >= sectorCount) break
    const o = sectorOff(difatSector)
    const per = ss / 4 - 1
    for (let i = 0; i < per && fatSectors.length < numFat; i++) {
      const s = u32(o + i * 4)
      if (s !== FREE) fatSectors.push(s)
    }
    difatSector = u32(o + per * 4)
  }
  const fat = new Uint32Array(fatSectors.length * (ss / 4))
  fatSectors.forEach((s, k) => {
    if (s >= sectorCount) return
    const o = sectorOff(s)
    for (let i = 0; i < ss / 4; i++) fat[k * (ss / 4) + i] = u32(o + i * 4)
  })

  const chain = (start: number, table: Uint32Array, limit: number): number[] => {
    const out: number[] = []
    const seen = new Set<number>()
    let s = start
    while (s !== END && s !== FREE && s < table.length && !seen.has(s) && out.length < limit) {
      seen.add(s)
      out.push(s)
      s = table[s]
    }
    return out
  }
  const readChain = (start: number, size?: number): Uint8Array => {
    const secs = chain(start, fat, sectorCount + 1)
    const len = size ?? secs.length * ss
    const out = new Uint8Array(Math.min(len, secs.length * ss))
    let pos = 0
    for (const s of secs) {
      if (pos >= out.length) break
      const o = sectorOff(s)
      const n = Math.min(ss, out.length - pos, Math.max(0, bytes.length - o))
      out.set(bytes.subarray(o, o + n), pos)
      pos += ss
    }
    return out
  }

  const dir = readChain(firstDir)
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength)
  const entries: CfbEntry[] = []
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = Math.min(64, ddv.getUint16(o + 0x40, true))
    let name = ''
    for (let i = 0; i + 2 < nameLen; i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true))
    entries.push({
      name,
      type: dir[o + 0x42],
      left: ddv.getUint32(o + 0x44, true),
      right: ddv.getUint32(o + 0x48, true),
      child: ddv.getUint32(o + 0x4c, true),
      start: ddv.getUint32(o + 0x74, true),
      size: ddv.getUint32(o + 0x78, true)
    })
  }
  const root = entries[0]
  if (!root || root.type !== 5) throw new CfbError('no root entry')

  let mini: { fat: Uint32Array; data: Uint8Array } | null = null
  const miniStream = () => {
    if (mini) return mini
    const mf = numMiniFat > 0 ? readChain(firstMiniFat) : new Uint8Array(0)
    const mfat = new Uint32Array(Math.floor(mf.length / 4))
    const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength)
    for (let i = 0; i < mfat.length; i++) mfat[i] = mdv.getUint32(i * 4, true)
    mini = { fat: mfat, data: readChain(root.start, root.size) }
    return mini
  }

  const children = (storage: number): number[] => {
    const out: number[] = []
    const stack = [entries[storage]?.child ?? FREE]
    const seen = new Set<number>()
    while (stack.length) {
      const i = stack.pop()!
      if (i === FREE || i >= entries.length || seen.has(i)) continue
      seen.add(i)
      out.push(i)
      stack.push(entries[i].left, entries[i].right)
    }
    return out
  }
  const rootKids = children(0)

  const readEntry = (e: CfbEntry): Uint8Array => {
    if (e.size < cutoff) {
      const m = miniStream()
      const secs = chain(e.start, m.fat, m.fat.length + 1)
      const out = new Uint8Array(Math.min(e.size, secs.length * mss))
      let pos = 0
      for (const s of secs) {
        if (pos >= out.length) break
        const n = Math.min(mss, out.length - pos)
        out.set(m.data.subarray(s * mss, s * mss + n), pos)
        pos += mss
      }
      return out
    }
    return readChain(e.start, e.size)
  }

  return {
    entries,
    rootNames: () => rootKids.map((i) => entries[i].name),
    stream(name) {
      const lower = name.toLowerCase()
      const i = rootKids.find((k) => entries[k].type === 2 && entries[k].name.toLowerCase() === lower)
      return i == null ? null : readEntry(entries[i])
    }
  }
}
