/** Test helpers for the Hangul readers: HWP 5 records and WCHAR text. Used by *.test.ts only. */
import { ctrlId } from './records.ts'

/** One HWP record: header (tag 10 bits, level 10 bits, size 12 bits, 0xFFF → 32-bit size). */
export function rec(tag: number, level: number, body: Uint8Array, forceLong = false): Uint8Array {
  const long = forceLong || body.length >= 0xfff
  const out = new Uint8Array(4 + (long ? 4 : 0) + body.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, (tag | (level << 10) | ((long ? 0xfff : body.length) << 20)) >>> 0, true)
  if (long) dv.setUint32(4, body.length, true)
  out.set(body, long ? 8 : 4)
  return out
}

export function wchars(...codes: (number | string)[]): Uint8Array {
  const units: number[] = []
  for (const c of codes) {
    if (typeof c === 'number') units.push(c)
    else for (const ch of c) units.push(ch.charCodeAt(0))
  }
  const out = new Uint8Array(units.length * 2)
  const dv = new DataView(out.buffer)
  units.forEach((u, i) => dv.setUint16(i * 2, u, true))
  return out
}

/** An 8-WCHAR control: code, 6 WCHARs of data (here a control id), code. */
export function ctrl8(code: number, id = '    '): number[] {
  const v = ctrlId(id)
  return [code, v & 0xffff, v >>> 16, 0, 0, 0, 0, code]
}

export const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
