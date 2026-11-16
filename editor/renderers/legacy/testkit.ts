/** Test helpers: builds tiny synthetic OLE compound files and binary records. Used by *.test.ts only. */
import type { Cfb } from './cfb.ts'

const END = 0xfffffffe
const FREE = 0xffffffff
const FATSECT = 0xfffffffd

export interface BuiltCfb {
  bytes: Uint8Array
  /** Sector index of each big stream's first sector, for corrupting chains. */
  bigStart: Record<string, number>
  /** Byte offset of the FAT sector, to patch entries. */
  fatOffset: number
}

/** A version-3 compound file (512-byte sectors) with the given root streams. Streams under 4096
 *  bytes go to the mini stream, larger ones to regular sectors. At most three streams. */
export function buildCfb(streams: { name: string; data: Uint8Array }[]): BuiltCfb {
  const ss = 512
  const small = streams.filter((s) => s.data.length < 4096)
  const big = streams.filter((s) => s.data.length >= 4096)
  // mini stream
  const miniChunks: { name: string; start: number }[] = []
  let miniLen = 0
  for (const s of small) {
    miniChunks.push({ name: s.name, start: miniLen / 64 })
    miniLen += Math.ceil(Math.max(1, s.data.length) / 64) * 64
  }
  const mini = new Uint8Array(miniLen)
  small.forEach((s, k) => mini.set(s.data, miniChunks[k].start * 64))
  const miniFat = new Uint32Array(128).fill(FREE)
  small.forEach((s, k) => {
    const n = Math.ceil(Math.max(1, s.data.length) / 64)
    const st = miniChunks[k].start
    for (let j = 0; j < n; j++) miniFat[st + j] = j === n - 1 ? END : st + j + 1
  })
  // sectors: 0 FAT, 1 directory, 2 mini FAT, then mini stream, then big streams
  const fat = new Uint32Array(128).fill(FREE)
  fat[0] = FATSECT
  fat[1] = END
  fat[2] = END
  let next = 3
  const chainOf = (count: number): number => {
    const start = next
    for (let j = 0; j < count; j++) fat[next + j] = j === count - 1 ? END : next + j + 1
    next += count
    return start
  }
  const miniSectors = Math.ceil(miniLen / ss)
  const miniStart = miniSectors ? chainOf(miniSectors) : END
  const bigStart: Record<string, number> = {}
  for (const s of big) bigStart[s.name] = chainOf(Math.ceil(s.data.length / ss))
  const total = next
  const out = new Uint8Array(ss * (total + 1))
  const dv = new DataView(out.buffer)
  ;[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((v, i) => (out[i] = v))
  dv.setUint16(0x18, 0x3e, true)
  dv.setUint16(0x1a, 3, true)
  dv.setUint16(0x1c, 0xfffe, true)
  dv.setUint16(0x1e, 9, true)
  dv.setUint16(0x20, 6, true)
  dv.setUint32(0x2c, 1, true)
  dv.setUint32(0x30, 1, true)
  dv.setUint32(0x38, 4096, true)
  dv.setUint32(0x3c, 2, true)
  dv.setUint32(0x40, 1, true)
  dv.setUint32(0x44, END, true)
  dv.setUint32(0x48, 0, true)
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, i === 0 ? 0 : FREE, true)
  const sec = (n: number) => (n + 1) * ss
  for (let i = 0; i < 128; i++) dv.setUint32(sec(0) + i * 4, fat[i], true)
  for (let i = 0; i < 128; i++) dv.setUint32(sec(2) + i * 4, miniFat[i], true)
  // directory: root + up to 3 streams (siblings chained through `right`)
  const entry = (k: number, name: string, type: number, start: number, size: number, child: number, right: number) => {
    const o = sec(1) + k * 128
    for (let i = 0; i < name.length; i++) dv.setUint16(o + i * 2, name.charCodeAt(i), true)
    dv.setUint16(o + 0x40, (name.length + 1) * 2, true)
    out[o + 0x42] = type
    out[o + 0x43] = 1
    dv.setUint32(o + 0x44, FREE, true)
    dv.setUint32(o + 0x48, right, true)
    dv.setUint32(o + 0x4c, child, true)
    dv.setUint32(o + 0x74, start, true)
    dv.setUint32(o + 0x78, size, true)
  }
  entry(0, 'Root Entry', 5, miniStart, miniLen, streams.length ? 1 : FREE, FREE)
  streams.forEach((s, k) => {
    const isSmall = s.data.length < 4096
    const start = isSmall ? miniChunks[small.indexOf(s)].start : bigStart[s.name]
    entry(k + 1, s.name, 2, start, s.data.length, FREE, k + 1 < streams.length ? k + 2 : FREE)
  })
  for (let k = streams.length + 1; k < 4; k++) {
    const o = sec(1) + k * 128
    dv.setUint32(o + 0x44, FREE, true)
    dv.setUint32(o + 0x48, FREE, true)
    dv.setUint32(o + 0x4c, FREE, true)
  }
  if (miniSectors) out.set(mini, sec(miniStart))
  for (const s of big) out.set(s.data, sec(bigStart[s.name]))
  return { bytes: out, bigStart, fatOffset: sec(0) }
}

/** A Cfb stand-in over named streams, for parser tests that do not need the container. */
export function fakeCfb(streams: Record<string, Uint8Array>): Cfb {
  return {
    entries: [],
    rootNames: () => Object.keys(streams),
    stream: (name) => streams[name] ?? null
  }
}

/** One binary record: 8-byte header (recVer/recInstance, recType, recLen) and its body. */
export function record(type: number, body: Uint8Array | Uint8Array[], inst = 0, ver?: number): Uint8Array {
  const parts = Array.isArray(body) ? body : [body]
  const container = Array.isArray(body)
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(8 + len)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, ((ver ?? (container ? 0xf : 0)) & 0xf) | (inst << 4), true)
  dv.setUint16(2, type, true)
  dv.setUint32(4, len, true)
  let o = 8
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function u32le(...vals: number[]): Uint8Array {
  const out = new Uint8Array(vals.length * 4)
  const dv = new DataView(out.buffer)
  vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true))
  return out
}

export function i16le(...vals: number[]): Uint8Array {
  const out = new Uint8Array(vals.length * 2)
  const dv = new DataView(out.buffer)
  vals.forEach((v, i) => dv.setInt16(i * 2, v, true))
  return out
}

export function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff
    out[i * 2 + 1] = s.charCodeAt(i) >> 8
  }
  return out
}

export function latin1(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
}
