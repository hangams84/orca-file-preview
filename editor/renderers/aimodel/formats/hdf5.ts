/** A minimal read-only HDF5 reader for model files: superblock v0–v3, object headers v1/v2 (with
 *  continuations), groups (symbol tables over B-tree v1 + local heap, compact link messages, dense
 *  links over fractal heap + B-tree v2), datasets (compact, contiguous, chunked over B-tree v1, single
 *  chunk, implicit, fixed array, B-tree v2 and small extensible arrays), datatypes (ints, floats incl.
 *  f16/bf16, strings, enums/bool, compound, array, vlen), attributes (compact and dense, vlen strings
 *  from the global heap) and the deflate, shuffle, fletcher32 and LZF filters.
 *
 *  Why our own reader: jsfive (BSD-3) and h5wasm (MIT, ~3.5 MB of WASM) both need the whole file in
 *  memory; this one reads only the metadata it walks and each dataset on demand through a ByteSource.
 *  Every address and length is bounded by the file size; walks are depth- and count-limited. */
import { unzlibSync } from '../../../../vendor/zip.js'
import type { ByteSource, DType, Value } from '../ir.ts'
import { bad, dv, f16, MAX_DEPTH, product, Src, text } from './common.ts'

export const HDF5_MAGIC = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]

export function isHdf5(head: Uint8Array, at = 0): boolean {
  return HDF5_MAGIC.every((b, i) => head[at + i] === b)
}

const UNDEF = -1

// ---- types ----

export interface H5Type {
  cls: number
  size: number
  /** Canonical dtype or a descriptive string (S10, str, struct{…}, enum, ref, opaque, f32[3]). */
  dtype: DType
  big?: boolean
  signed?: boolean
  members?: { name: string; offset: number; type: H5Type }[]
  base?: H5Type
  dims?: number[]
  vlen?: 'string' | 'sequence'
  enumNames?: string[]
  enumValues?: number[]
}

export interface H5Space {
  shape: number[]
  maxShape?: number[]
  scalar: boolean
  null: boolean
}

export interface H5Filter {
  id: number
  name?: string
  flags: number
  values: number[]
}

export interface H5Layout {
  kind: 'compact' | 'contiguous' | 'chunked' | 'virtual'
  address: number
  size: number
  compact?: Uint8Array
  chunk?: number[]
  /** v4 chunk index: 1 single, 2 implicit, 3 fixed array, 4 extensible array, 5 B-tree v2; 0 = B-tree v1 */
  index?: number
  singleFiltered?: { size: number; mask: number }
  flags?: number
}

export interface H5Dataset {
  type: H5Type
  space: H5Space
  layout: H5Layout
  filters: H5Filter[]
}

export interface H5Object {
  path: string
  address: number
  kind: 'group' | 'dataset' | 'datatype'
  attrs: Record<string, Value>
  dataset?: H5Dataset
}

interface Msg {
  type: number
  flags: number
  data: Uint8Array
}

/** Little-endian cursor over a message body with the file's offset (O) and length (L) sizes. */
class R {
  pos = 0
  readonly v: DataView
  constructor(
    readonly b: Uint8Array,
    readonly O: number,
    readonly L: number,
    readonly fail: (what: string) => Error
  ) {
    this.v = dv(b)
  }
  need(n: number) {
    if (n < 0 || this.pos + n > this.b.length) throw this.fail('truncated message')
  }
  u8() {
    this.need(1)
    return this.b[this.pos++]
  }
  u16() {
    this.need(2)
    const x = this.v.getUint16(this.pos, true)
    this.pos += 2
    return x
  }
  u32() {
    this.need(4)
    const x = this.v.getUint32(this.pos, true)
    this.pos += 4
    return x
  }
  /** Unsigned little-endian of n bytes; all-ones → UNDEF. */
  un(n: number): number {
    this.need(n)
    let x = 0
    let ones = true
    for (let i = n - 1; i >= 0; i--) {
      const c = this.b[this.pos + i]
      if (c !== 0xff) ones = false
      x = x * 256 + c
    }
    this.pos += n
    if (ones && n >= 4) return UNDEF
    return x
  }
  addr() {
    return this.un(this.O)
  }
  len() {
    return this.un(this.L)
  }
  bytes(n: number) {
    this.need(n)
    const x = this.b.subarray(this.pos, this.pos + n)
    this.pos += n
    return x
  }
  skip(n: number) {
    this.need(n)
    this.pos += n
  }
  cstr(): string {
    let e = this.pos
    while (e < this.b.length && this.b[e] !== 0) e++
    const s = text(this.b.subarray(this.pos, e))
    this.pos = Math.min(this.b.length, e + 1)
    return s
  }
  pad8(from: number) {
    const k = (this.pos - from) % 8
    if (k) this.skip(Math.min(8 - k, this.b.length - this.pos))
  }
}

export class H5 {
  O = 8
  L = 8
  base = 0
  version = 0
  rootAddr = 0
  private headers = new Map<number, Msg[]>()
  private gheaps = new Map<number, Map<number, Uint8Array>>()
  /** Things the walk could not read (shown as notes). */
  readonly issues: string[] = []

  constructor(readonly src: Src) {}

  fail = (what: string): Error => this.src.fail(what)

  private r(b: Uint8Array): R {
    return new R(b, this.O, this.L, this.fail)
  }

  static async open(source: ByteSource, format = 'hdf5'): Promise<H5> {
    const src = new Src(source, format)
    const h = new H5(src)
    // the superblock sits at 0, 512, 1024, 2048, …
    let at = -1
    for (let p = 0; p < src.size && p <= 1 << 20; p = p ? p * 2 : 512) {
      const head = await src.upTo(p, 8)
      if (isHdf5(head)) {
        at = p
        break
      }
    }
    if (at < 0) throw bad('hdf5-not-hdf5', 'This is not an HDF5 file.')
    const sb = await src.upTo(at, 128)
    if (sb.length < 24) throw bad('hdf5-damaged', 'The HDF5 superblock is truncated.')
    h.version = sb[8]
    if (h.version <= 1) {
      h.O = sb[13]
      h.L = sb[14]
      if (![2, 4, 8].includes(h.O) || ![2, 4, 8].includes(h.L)) throw src.fail('superblock sizes')
      const r = h.r(sb)
      r.pos = h.version === 1 ? 28 : 24
      h.base = r.addr()
      r.addr() // free space
      r.addr() // end of file
      r.addr() // driver info
      r.addr() // root link name offset
      h.rootAddr = r.addr()
    } else if (h.version <= 3) {
      h.O = sb[9]
      h.L = sb[10]
      if (![2, 4, 8].includes(h.O) || ![2, 4, 8].includes(h.L)) throw src.fail('superblock sizes')
      const r = h.r(sb)
      r.pos = 12
      h.base = r.addr()
      r.addr() // superblock extension
      r.addr() // end of file
      h.rootAddr = r.addr()
    } else throw bad('hdf5-version', `HDF5 superblock version ${h.version} is not supported.`)
    if (h.base === UNDEF) h.base = 0
    if (h.base === 0 && at > 0) h.base = at
    return h
  }

  /** Absolute file position of an address. */
  abs(a: number): number {
    return a === UNDEF ? UNDEF : a + this.base
  }

  async at(a: number, n: number, what: string): Promise<Uint8Array> {
    if (a === UNDEF) throw this.fail(`undefined address for ${what}`)
    return this.src.bytes(this.abs(a), n, what)
  }

  // ---- object headers ----

  async messages(addr: number): Promise<Msg[]> {
    const hit = this.headers.get(addr)
    if (hit) return hit
    const out: Msg[] = []
    const first = await this.src.upTo(this.abs(addr), 16)
    if (first.length < 16) throw this.fail(`object header at ${addr}`)
    const blocks: [number, number, boolean][] = []
    const seen = new Set<number>()
    let v2 = false
    let flags = 0
    if (first[0] === 0x4f && first[1] === 0x48 && first[2] === 0x44 && first[3] === 0x52) {
      // OHDR
      v2 = true
      flags = first[5]
      let p = 6
      if (flags & 0x20) p += 16
      if (flags & 0x10) p += 4
      const sz = 1 << (flags & 3)
      const head = await this.at(addr, p + sz, 'object header')
      const r = this.r(head)
      r.pos = p
      const size = r.un(sz)
      blocks.push([addr + p + sz, size, true])
    } else if (first[0] === 1) {
      const r = this.r(first)
      r.pos = 8
      const size = r.u32()
      blocks.push([addr + 16, size, false])
    } else throw this.fail(`unknown object header version ${first[0]} at ${addr}`)

    for (let k = 0; k < blocks.length; k++) {
      if (k > 1000 || out.length > 20000) throw this.fail('too many object header messages')
      const [start, size] = blocks[k]
      if (seen.has(start)) continue
      seen.add(start)
      let b = await this.at(start, size, 'object header block')
      if (v2 && k > 0) {
        if (!(b[0] === 0x4f && b[1] === 0x43 && b[2] === 0x48 && b[3] === 0x4b)) throw this.fail('bad continuation block')
        b = b.subarray(4)
      }
      const end = v2 ? b.length - 4 : b.length // v2 blocks end with a checksum
      const hsz = v2 ? (flags & 0x04 ? 6 : 4) : 8
      const r = this.r(b)
      while (r.pos + hsz <= end) {
        let type: number
        let len: number
        let mflags: number
        if (v2) {
          type = r.u8()
          len = r.u16()
          mflags = r.u8()
          if (flags & 0x04) r.u16()
        } else {
          type = r.u16()
          len = r.u16()
          mflags = r.u8()
          r.skip(3)
        }
        if (r.pos + len > b.length) throw this.fail('message overruns its header')
        const data = r.bytes(len)
        if (type === 0x10) {
          const c = this.r(data)
          const off = c.addr()
          const l = c.len()
          blocks.push([off, l, v2])
        } else if (type !== 0) out.push({ type, flags: mflags, data })
      }
    }
    this.headers.set(addr, out)
    return out
  }

  // ---- datatypes and dataspaces ----

  parseType(b: Uint8Array, depth = 0): H5Type {
    if (depth > MAX_DEPTH) throw this.fail('datatype nesting')
    const r = this.r(b)
    const cv = r.u8()
    const cls = cv & 15
    const ver = cv >> 4
    const bits = r.u8() | (r.u8() << 8) | (r.u8() << 16)
    const size = r.u32()
    const big = !!(bits & 1)
    const t: H5Type = { cls, size, dtype: 'opaque', big }
    switch (cls) {
      case 0: {
        // fixed-point
        t.signed = !!(bits & 8)
        r.skip(4) // bit offset, precision
        t.dtype = ({ 1: 'i8', 2: 'i16', 4: 'i32', 8: 'i64' } as Record<number, string>)[size] ?? `int${size * 8}`
        if (!t.signed) t.dtype = t.dtype.replace('i', 'u')
        break
      }
      case 1: {
        r.skip(4) // bit offset, precision
        r.u8() // exponent location
        const expSize = r.u8()
        r.skip(6) // mantissa location/size, exponent bias
        t.dtype = size === 2 ? (expSize === 8 ? 'bf16' : 'f16') : size === 4 ? 'f32' : size === 8 ? 'f64' : `float${size * 8}`
        t.big = !!(bits & 1) && !(bits & 0x40)
        break
      }
      case 2:
        r.skip(2)
        t.dtype = 'time'
        break
      case 3:
        t.dtype = `S${size}`
        break
      case 4:
        r.skip(4)
        t.dtype = `bitfield${size * 8}`
        break
      case 5:
        r.skip(Math.min(bits & 0xff, r.b.length - r.pos))
        t.dtype = 'opaque'
        break
      case 6: {
        const n = bits & 0xffff
        t.members = []
        for (let i = 0; i < n; i++) {
          const name0 = r.pos
          const name = r.cstr()
          let offset: number
          if (ver < 3) {
            // names are null-padded to a multiple of 8
            r.pos = name0 + Math.ceil((r.pos - name0) / 8) * 8
            offset = r.u32()
            if (ver === 1) {
              const rank = r.u8()
              r.skip(3 + 4 + 4)
              const dims: number[] = []
              for (let k = 0; k < 4; k++) dims.push(r.u32())
              const mt = this.parseTypeAt(r, depth)
              t.members.push({ name, offset, type: rank ? { ...mt, dtype: `${mt.dtype}[${dims.slice(0, rank).join(',')}]`, size: mt.size * product(dims.slice(0, rank)) } : mt })
            } else t.members.push({ name, offset, type: this.parseTypeAt(r, depth) })
          } else {
            const ob = size < 256 ? 1 : size < 65536 ? 2 : size < 1 << 24 ? 3 : 4
            offset = r.un(ob)
            t.members.push({ name, offset, type: this.parseTypeAt(r, depth) })
          }
        }
        t.dtype = `struct{${t.members.map((m) => `${m.name}:${m.type.dtype}`).join(', ')}}`
        break
      }
      case 7:
        t.dtype = 'ref'
        break
      case 8: {
        const base = this.parseTypeAt(r, depth)
        const n = bits & 0xffff
        const names: string[] = []
        for (let i = 0; i < n; i++) {
          const s0 = r.pos
          names.push(r.cstr())
          if (ver < 3) r.pos = s0 + Math.ceil((r.pos - s0) / 8) * 8
        }
        const vals: number[] = []
        const bd = dv(r.bytes(n * base.size))
        for (let i = 0; i < n; i++) vals.push(base.size === 1 ? bd.getInt8(i) : base.size === 2 ? bd.getInt16(i * 2, true) : base.size === 4 ? bd.getInt32(i * 4, true) : Number(bd.getBigInt64(i * 8, true)))
        t.base = base
        t.enumNames = names
        t.enumValues = vals
        t.dtype = names.length === 2 && names[0] === 'FALSE' && names[1] === 'TRUE' && base.size === 1 ? 'bool' : base.dtype
        t.big = base.big
        break
      }
      case 9: {
        const kind = bits & 15
        t.base = this.parseTypeAt(r, depth)
        t.vlen = kind === 1 ? 'string' : 'sequence'
        t.dtype = kind === 1 ? 'str' : `vlen<${t.base.dtype}>`
        break
      }
      case 10: {
        const rank = r.u8()
        if (ver < 3) r.skip(3)
        const dims: number[] = []
        for (let i = 0; i < rank; i++) dims.push(r.u32())
        if (ver < 3) r.skip(4 * rank)
        t.base = this.parseTypeAt(r, depth)
        t.dims = dims
        t.dtype = `${t.base.dtype}[${dims.join(',')}]`
        break
      }
    }
    ;(t as H5Type & { _len?: number })._len = r.pos
    return t
  }

  private parseTypeAt(r: R, depth: number): H5Type {
    const t = this.parseType(r.b.subarray(r.pos), depth + 1) as H5Type & { _len?: number }
    r.pos += t._len ?? 8
    delete t._len
    return t
  }

  parseSpace(b: Uint8Array): H5Space {
    const r = this.r(b)
    const ver = r.u8()
    const rank = r.u8()
    const flags = r.u8()
    let type = 1
    if (ver === 1) r.skip(5)
    else type = r.u8()
    if (rank > 32) throw this.fail('dataspace rank')
    const shape: number[] = []
    for (let i = 0; i < rank; i++) shape.push(r.len())
    let maxShape: number[] | undefined
    if (flags & 1) {
      maxShape = []
      for (let i = 0; i < rank; i++) maxShape.push(r.len())
    }
    return { shape, maxShape, scalar: ver === 1 ? rank === 0 : type === 0, null: ver >= 2 && type === 2 }
  }

  private async sharedType(m: Msg): Promise<H5Type> {
    if (!(m.flags & 2)) return this.parseType(m.data)
    // shared (committed) datatype: the message points at another object header
    const r = this.r(m.data)
    const ver = r.u8()
    r.u8()
    if (ver === 1) r.skip(6)
    const addr = r.addr()
    const msgs = await this.messages(addr)
    const dt = msgs.find((x) => x.type === 3)
    if (!dt) throw this.fail('committed datatype without a datatype message')
    return this.parseType(dt.data)
  }

  parseLayout(b: Uint8Array): H5Layout {
    const r = this.r(b)
    const ver = r.u8()
    if (ver < 3) {
      const rank = r.u8()
      const cls = r.u8()
      r.skip(5)
      const address = cls === 0 ? UNDEF : r.addr()
      const dims: number[] = []
      for (let i = 0; i < rank; i++) dims.push(r.u32())
      if (cls === 2) {
        r.u32()
        return { kind: 'chunked', address, size: 0, chunk: dims.slice(0, -1), index: 0 }
      }
      if (cls === 0) {
        const n = r.u32()
        return { kind: 'compact', address: UNDEF, size: n, compact: r.bytes(n) }
      }
      return { kind: 'contiguous', address, size: product(dims) }
    }
    const cls = r.u8()
    if (cls === 0) {
      const n = r.u16()
      return { kind: 'compact', address: UNDEF, size: n, compact: r.bytes(n) }
    }
    if (cls === 1) return { kind: 'contiguous', address: r.addr(), size: r.len() }
    if (cls === 3) return { kind: 'virtual', address: UNDEF, size: 0 }
    if (ver === 3) {
      const rank = r.u8()
      const address = r.addr()
      const dims: number[] = []
      for (let i = 0; i < rank; i++) dims.push(r.u32())
      return { kind: 'chunked', address, size: 0, chunk: dims.slice(0, -1), index: 0 }
    }
    // version 4
    const flags = r.u8()
    const rank = r.u8()
    const enc = r.u8()
    const dims: number[] = []
    for (let i = 0; i < rank; i++) dims.push(r.un(enc))
    const index = r.u8()
    const out: H5Layout = { kind: 'chunked', address: UNDEF, size: 0, chunk: dims.slice(0, -1), index, flags }
    if (index === 1 && flags & 2) out.singleFiltered = { size: r.len(), mask: r.u32() }
    else if (index === 3) r.skip(1)
    else if (index === 4) r.skip(5)
    else if (index === 5) r.skip(6)
    out.address = r.addr()
    return out
  }

  parseFilters(b: Uint8Array): H5Filter[] {
    const r = this.r(b)
    const ver = r.u8()
    const n = r.u8()
    if (ver === 1) r.skip(6)
    const out: H5Filter[] = []
    for (let i = 0; i < n; i++) {
      const id = r.u16()
      const nameLen = ver === 1 || id >= 256 ? r.u16() : 0
      const flags = r.u16()
      const nv = r.u16()
      let name: string | undefined
      if (nameLen) {
        const s = r.pos
        name = r.cstr()
        r.pos = s + (ver === 1 ? Math.ceil(nameLen / 8) * 8 : nameLen)
      }
      const values: number[] = []
      for (let k = 0; k < nv; k++) values.push(r.u32())
      if (ver === 1 && nv % 2) r.skip(4)
      out.push({ id, name, flags, values })
    }
    return out
  }

  // ---- attributes ----

  private async attrFromMessage(b: Uint8Array): Promise<[string, Value]> {
    const r = this.r(b)
    const ver = r.u8()
    const flags = r.u8()
    const nameSize = r.u16()
    const dtSize = r.u16()
    const dsSize = r.u16()
    if (ver === 3) r.u8()
    const pad = ver === 1 ? (n: number) => Math.ceil(n / 8) * 8 : (n: number) => n
    const nameStart = r.pos
    const name = text(r.b.subarray(nameStart, nameStart + Math.max(0, nameSize - 1)))
    r.pos = nameStart + pad(nameSize)
    if (flags & 3) {
      r.skip(pad(dtSize) + pad(dsSize))
      return [name, '(shared datatype/dataspace: not read)']
    }
    const type = this.parseType(r.bytes(pad(dtSize)).subarray(0, dtSize))
    const space = this.parseSpace(r.bytes(pad(dsSize)).subarray(0, dsSize))
    if (space.null) return [name, null]
    const count = space.scalar ? 1 : product(space.shape)
    const data = r.b.subarray(r.pos, r.pos + count * type.size)
    if (data.length < count * type.size) return [name, '(truncated)']
    const vals = await this.decode(data, type, Math.min(count, 256))
    let v: Value = space.scalar ? vals[0] : count > 256 ? [...vals, `… (${count} items)`] : vals
    if (Array.isArray(v) && space.shape.length > 1 && count <= 256) v = reshape(vals, space.shape)
    return [name, v]
  }

  async attributes(msgs: Msg[]): Promise<Record<string, Value>> {
    const out: Record<string, Value> = {}
    for (const m of msgs) {
      if (m.type === 0x0c) {
        try {
          const [k, v] = await this.attrFromMessage(m.data)
          out[k] = v
        } catch (e) {
          this.issues.push(`attribute: ${(e as Error).message}`)
        }
      } else if (m.type === 0x15) {
        // dense attributes: fractal heap + B-tree v2 name index
        const r = this.r(m.data)
        r.u8()
        const flags = r.u8()
        if (flags & 1) r.u16()
        const heap = r.addr()
        const index = r.addr()
        if (heap === UNDEF || index === UNDEF) continue
        try {
          const fh = await this.fractalHeap(heap)
          for (const rec of await this.btree2(index)) {
            const id = rec.subarray(0, fh.idLen)
            const obj = await this.heapObject(fh, id)
            if (!obj) continue
            const [k, v] = await this.attrFromMessage(obj)
            out[k] = v
          }
        } catch (e) {
          this.issues.push(`dense attributes: ${(e as Error).message}`)
        }
      }
    }
    return out
  }

  /** Decodes up to `count` elements to JSON values (strings, numbers, nested). */
  async decode(b: Uint8Array, t: H5Type, count: number): Promise<Value[]> {
    const out: Value[] = []
    const v = dv(b)
    const le = !t.big
    for (let i = 0; i < count; i++) {
      const o = i * t.size
      if (o + t.size > b.length) break
      out.push(await this.decodeOne(b, v, o, t, le))
    }
    return out
  }

  private async decodeOne(b: Uint8Array, v: DataView, o: number, t: H5Type, le: boolean): Promise<Value> {
    switch (t.cls) {
      case 0:
      case 8: {
        if (t.cls === 8 && t.enumNames && t.base) {
          const x = Number(await this.decodeOne(b, v, o, t.base, le))
          if (t.dtype === 'bool') return x !== 0
          const k = t.enumValues!.indexOf(x)
          return k >= 0 ? t.enumNames[k] : x
        }
        const s = t.signed
        switch (t.size) {
          case 1: return s ? v.getInt8(o) : v.getUint8(o)
          case 2: return s ? v.getInt16(o, le) : v.getUint16(o, le)
          case 4: return s ? v.getInt32(o, le) : v.getUint32(o, le)
          case 8: {
            const x = s ? v.getBigInt64(o, le) : v.getBigUint64(o, le)
            return x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x
          }
        }
        return null
      }
      case 1:
        if (t.size === 4) return v.getFloat32(o, le)
        if (t.size === 8) return v.getFloat64(o, le)
        if (t.size === 2) return t.dtype === 'bf16' ? new Float32Array(new Uint32Array([v.getUint16(o, le) << 16]).buffer)[0] : f16(v.getUint16(o, le))
        return null
      case 3: {
        let e = o
        while (e < o + t.size && b[e] !== 0) e++
        return text(b.subarray(o, e)).replace(/ +$/, '')
      }
      case 6: {
        const rec: Record<string, Value> = {}
        for (const m of t.members ?? []) rec[m.name] = await this.decodeOne(b, v, o + m.offset, m.type, !m.type.big)
        return rec
      }
      case 10: {
        const n = product(t.dims ?? [])
        const vals = await this.decode(b.subarray(o, o + t.size), t.base!, Math.min(n, 64))
        return vals
      }
      case 9: {
        // length (u32) + global heap id (collection address + index)
        const r = this.r(b.subarray(o, o + t.size))
        const len = r.u32()
        const coll = r.addr()
        const idx = r.u32()
        if (coll === UNDEF || coll === 0) return t.vlen === 'string' ? '' : []
        const data = await this.globalHeap(coll, idx)
        if (!data) return null
        if (t.vlen === 'string') return text(data.subarray(0, Math.min(data.length, len * (t.base?.size || 1))))
        return this.decode(data, t.base!, Math.min(len, 64))
      }
      default:
        return `(${t.dtype})`
    }
  }

  private async globalHeap(addr: number, index: number): Promise<Uint8Array | null> {
    let objs = this.gheaps.get(addr)
    if (!objs) {
      objs = new Map()
      const head = await this.at(addr, 8 + this.L, 'global heap')
      if (text(head.subarray(0, 4)) !== 'GCOL') throw this.fail('bad global heap')
      const size = this.r(head.subarray(8)).len()
      if (size > 1 << 28) throw this.fail('global heap too large')
      const b = await this.at(addr, Math.min(size, this.src.size - this.abs(addr)), 'global heap')
      const r = this.r(b)
      r.pos = 8 + this.L
      while (r.pos + 8 + this.L <= b.length) {
        const id = r.u16()
        r.skip(6)
        const n = r.len()
        if (id === 0) break
        if (r.pos + n > b.length) break
        objs.set(id, r.b.subarray(r.pos, r.pos + n))
        r.pos += Math.ceil(n / 8) * 8
      }
      this.gheaps.set(addr, objs)
    }
    return objs.get(index) ?? null
  }

  // ---- groups ----

  /** Links of a group: [name, object address] (hard links only; soft/external are reported). */
  async links(addr: number): Promise<[string, number][]> {
    const msgs = await this.messages(addr)
    const out: [string, number][] = []
    for (const m of msgs) {
      if (m.type === 0x11) {
        const r = this.r(m.data)
        const btree = r.addr()
        const heap = r.addr()
        out.push(...(await this.symbolTable(btree, heap)))
      } else if (m.type === 0x06) {
        const l = this.parseLink(m.data)
        if (l) out.push(l)
      } else if (m.type === 0x02) {
        const r = this.r(m.data)
        r.u8()
        const flags = r.u8()
        if (flags & 1) r.skip(8)
        const heap = r.addr()
        const index = r.addr()
        if (heap === UNDEF || index === UNDEF) continue
        const fh = await this.fractalHeap(heap)
        for (const rec of await this.btree2(index)) {
          const obj = await this.heapObject(fh, rec.subarray(4, 4 + fh.idLen))
          if (!obj) continue
          const l = this.parseLink(obj)
          if (l) out.push(l)
        }
      }
    }
    return out
  }

  private parseLink(b: Uint8Array): [string, number] | null {
    const r = this.r(b)
    r.u8()
    const flags = r.u8()
    const type = flags & 8 ? r.u8() : 0
    if (flags & 4) r.skip(8)
    if (flags & 0x10) r.u8()
    const nlen = r.un(1 << (flags & 3))
    const name = text(r.bytes(nlen))
    if (type !== 0) {
      this.issues.push(`${type === 1 ? 'soft' : 'external'} link ${name} not followed`)
      return null
    }
    return [name, r.addr()]
  }

  private async symbolTable(btree: number, heap: number): Promise<[string, number][]> {
    const h = await this.at(heap, 8 + 2 * this.L + this.O, 'local heap')
    if (text(h.subarray(0, 4)) !== 'HEAP') throw this.fail('bad local heap')
    const r = this.r(h)
    r.pos = 8
    const dataSize = r.len()
    r.len()
    const dataAddr = r.addr()
    const heapData = await this.at(dataAddr, dataSize, 'local heap data')
    const out: [string, number][] = []
    const nodes = await this.btree1(btree, 0)
    for (const { child } of nodes) {
      const sn = await this.at(child, 8, 'symbol node')
      if (text(sn.subarray(0, 4)) !== 'SNOD') throw this.fail('bad symbol table node')
      const n = sn[6] | (sn[7] << 8)
      const entry = 2 * this.O + 24
      const b = await this.at(child + 8, n * entry, 'symbol table entries')
      const er = this.r(b)
      for (let i = 0; i < n; i++) {
        er.pos = i * entry
        const nameOff = er.un(this.O)
        const obj = er.addr()
        let e = nameOff
        while (e < heapData.length && heapData[e] !== 0) e++
        out.push([text(heapData.subarray(nameOff, e)), obj])
      }
    }
    return out
  }

  /** Version 1 B-tree: leaf entries with their keys. `type` 0 = group, 1 = chunks (rank+1 dims). */
  async btree1(addr: number, type: number, rank = 0, depth = 0, seen = new Set<number>()): Promise<{ child: number; key: Uint8Array }[]> {
    if (depth > MAX_DEPTH || seen.has(addr)) throw this.fail('B-tree cycle or too deep')
    seen.add(addr)
    const head = await this.at(addr, 8 + 2 * this.O, 'B-tree node')
    if (text(head.subarray(0, 4)) !== 'TREE') throw this.fail('bad B-tree node')
    const level = head[5]
    const n = head[6] | (head[7] << 8)
    const keySize = type === 0 ? this.L : 8 + 8 * (rank + 1)
    const body = await this.at(addr + 8 + 2 * this.O, n * (keySize + this.O) + keySize, 'B-tree entries')
    const r = this.r(body)
    const out: { child: number; key: Uint8Array }[] = []
    for (let i = 0; i < n; i++) {
      const key = r.bytes(keySize)
      const child = r.addr()
      if (level > 0) out.push(...(await this.btree1(child, type, rank, depth + 1, seen)))
      else out.push({ child, key })
    }
    return out
  }

  // ---- B-tree v2 and fractal heaps ----

  async btree2(addr: number): Promise<Uint8Array[]> {
    const h = await this.at(addr, 16 + this.O + 2 + this.L, 'B-tree v2 header')
    if (text(h.subarray(0, 4)) !== 'BTHD') throw this.fail('bad B-tree v2 header')
    const r = this.r(h)
    r.pos = 6
    const nodeSize = r.u32()
    const recSize = r.u16()
    const depth = r.u16()
    r.skip(2)
    const root = r.addr()
    const rootN = r.u16()
    if (root === UNDEF || !rootN) return []
    if (depth > 16 || nodeSize > 1 << 24 || !recSize) throw this.fail('B-tree v2 parameters')
    // per-level sizes (H5B2__hdr_init)
    const encSize = (n: number) => Math.floor(Math.log2(Math.max(1, n)) / 8) + 1
    const maxNrec: number[] = [Math.floor((nodeSize - 10) / recSize)]
    const cumMax: number[] = [maxNrec[0]]
    const cumSize: number[] = [0]
    const nrecSize: number[] = [encSize(maxNrec[0])]
    for (let d = 1; d <= depth; d++) {
      const ptr = this.O + nrecSize[d - 1] + (d > 1 ? cumSize[d - 1] : 0)
      maxNrec[d] = Math.floor((nodeSize - 10 - ptr) / (recSize + ptr))
      cumMax[d] = (maxNrec[d] + 1) * cumMax[d - 1] + maxNrec[d]
      cumSize[d] = encSize(cumMax[d])
      nrecSize[d] = encSize(maxNrec[d])
    }
    const out: Uint8Array[] = []
    let visits = 0
    const walk = async (a: number, n: number, d: number): Promise<void> => {
      if (++visits > 100000) throw this.fail('B-tree v2 too large')
      const b = await this.at(a, Math.min(nodeSize, this.src.size - this.abs(a)), 'B-tree v2 node')
      const sig = text(b.subarray(0, 4))
      const nr = this.r(b)
      nr.pos = 6
      if (d === 0) {
        if (sig !== 'BTLF') throw this.fail('bad B-tree v2 leaf')
        for (let i = 0; i < n; i++) out.push(nr.bytes(recSize))
        return
      }
      if (sig !== 'BTIN') throw this.fail('bad B-tree v2 internal node')
      const recs: Uint8Array[] = []
      for (let i = 0; i < n; i++) recs.push(nr.bytes(recSize))
      const kids: [number, number][] = []
      for (let i = 0; i <= n; i++) {
        const ca = nr.addr()
        const cn = nr.un(nrecSize[d - 1])
        if (d > 1) nr.un(cumSize[d - 1])
        kids.push([ca, cn])
      }
      for (let i = 0; i <= n; i++) {
        await walk(kids[i][0], kids[i][1], d - 1)
        if (i < n) out.push(recs[i])
      }
    }
    await walk(root, rootN, depth)
    return out
  }

  async fractalHeap(addr: number): Promise<FHeap> {
    const O = this.O
    const L = this.L
    const b = await this.at(addr, 22 + 12 * L + 3 * O + 16, 'fractal heap header')
    if (text(b.subarray(0, 4)) !== 'FRHP') throw this.fail('bad fractal heap')
    const r = this.r(b)
    r.pos = 5
    const idLen = r.u16()
    const filterLen = r.u16()
    r.u8() // flags
    const maxMan = r.u32()
    r.len() // next huge id
    r.addr() // huge btree
    r.len() // free space
    r.addr() // free space manager
    r.len() // managed space
    r.len() // allocated
    r.len() // iterator
    r.len() // managed objects
    r.len()
    r.len()
    r.len()
    r.len()
    const width = r.u16()
    const startSize = r.len()
    const maxDirect = r.len()
    const maxHeapBits = r.u16()
    r.u16() // starting rows
    const root = r.addr()
    const rows = r.u16()
    if (filterLen) throw this.fail('filtered fractal heaps are not supported')
    if (!width || !startSize || width > 1 << 16) throw this.fail('fractal heap parameters')
    const offSize = Math.ceil(maxHeapBits / 8)
    // H5HF_SIZEOF_OFFSET_LEN: bytes for log2 of the (power-of-two) sizes
    const lenSize = Math.min(Math.ceil(Math.floor(Math.log2(maxDirect)) / 8), Math.ceil(Math.floor(Math.log2(maxMan)) / 8))
    const maxDirectRows = Math.log2(maxDirect) - Math.log2(startSize) + 2
    return { addr, idLen, width, startSize, maxDirect, offSize, lenSize, root, rows, maxDirectRows }
  }

  async heapObject(h: FHeap, id: Uint8Array): Promise<Uint8Array | null> {
    const type = (id[0] >> 4) & 3
    if (type === 2) {
      // tiny: the object is inside the id
      const len = (id[0] & 0x0f) + 1
      return id.subarray(1, 1 + len)
    }
    if (type !== 0) {
      this.issues.push('huge fractal heap objects are not read')
      return null
    }
    const r = this.r(id)
    r.pos = 1
    const off = r.un(h.offSize)
    const len = r.un(h.lenSize)
    const block = await this.heapBlock(h, off)
    if (!block) return null
    return this.at(block[0] + (off - block[1]), len, 'fractal heap object')
  }

  /** [address, heap offset] of the direct block that holds heap offset `off`. */
  private async heapBlock(h: FHeap, off: number): Promise<[number, number] | null> {
    if (h.rows === 0) return [h.root, 0]
    const rowSize = (r: number) => (r < 2 ? h.startSize : h.startSize * 2 ** (r - 1))
    let addr = h.root
    let nrows = h.rows
    let blockOff = 0
    for (let depth = 0; depth < 16; depth++) {
      // indirect block: entries row by row
      let rowStart = blockOff
      let entry = 0
      let found = -1
      let foundRow = 0
      for (let r = 0; r < nrows; r++) {
        const span = rowSize(r) * h.width
        if (off < rowStart + span) {
          const c = Math.floor((off - rowStart) / rowSize(r))
          found = entry + c
          foundRow = r
          blockOff = rowStart + c * rowSize(r)
          break
        }
        rowStart += span
        entry += h.width
      }
      if (found < 0) return null
      const headerLen = 5 + this.O + h.offSize
      const directEntries = Math.min(nrows, h.maxDirectRows) * h.width
      const pos = found < directEntries ? headerLen + found * this.O : headerLen + directEntries * this.O + (found - directEntries) * this.O
      const b = await this.at(addr + pos, this.O, 'fractal heap entry')
      const child = this.r(b).addr()
      if (child === UNDEF) return null
      if (foundRow < h.maxDirectRows) return [child, blockOff]
      addr = child
      nrows = Math.log2(rowSize(foundRow)) - Math.log2(h.startSize * h.width) + 1
    }
    return null
  }

  // ---- datasets ----

  async object(path: string, addr: number): Promise<H5Object> {
    const msgs = await this.messages(addr)
    const attrs = await this.attributes(msgs)
    const has = (t: number) => msgs.find((m) => m.type === t)
    const layout = has(0x08)
    if (layout) {
      const dt = has(0x03)
      const ds = has(0x01)
      if (!dt || !ds) throw this.fail(`dataset ${path} without datatype or dataspace`)
      const fl = has(0x0b)
      const dataset: H5Dataset = { type: await this.sharedType(dt), space: this.parseSpace(ds.data), layout: this.parseLayout(layout.data), filters: fl ? this.parseFilters(fl.data) : [] }
      return { path, address: addr, kind: 'dataset', attrs, dataset }
    }
    if (has(0x03) && !has(0x11) && !has(0x02) && !has(0x06)) return { path, address: addr, kind: 'datatype', attrs }
    return { path, address: addr, kind: 'group', attrs }
  }

  /** Every object below the root, depth-first, each address once. */
  async walk(visit?: (o: H5Object) => void, limit = 200000): Promise<H5Object[]> {
    const out: H5Object[] = []
    const seen = new Set<number>()
    const go = async (path: string, addr: number, depth: number) => {
      if (depth > MAX_DEPTH) {
        this.issues.push(`${path}: nested too deeply`)
        return
      }
      if (seen.has(addr)) return
      seen.add(addr)
      if (out.length >= limit) return
      let o: H5Object
      try {
        o = await this.object(path, addr)
      } catch (e) {
        if (!path) throw e
        this.issues.push(`${path}: ${(e as Error).message}`)
        return
      }
      out.push(o)
      visit?.(o)
      if (o.kind === 'group') {
        let links: [string, number][] = []
        try {
          links = await this.links(addr)
        } catch (e) {
          if (!path) throw e
          this.issues.push(`${path}: ${(e as Error).message}`)
        }
        links.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        for (const [name, a] of links) await go(path ? `${path}/${name}` : name, a, depth + 1)
      }
    }
    await go('', this.rootAddr, 0)
    return out
  }

  /** Byte length of a dataset's elements. */
  byteLength(d: H5Dataset): number {
    return d.space.null ? 0 : (d.space.scalar ? 1 : product(d.space.shape)) * d.type.size
  }

  /** Whether `readData` can produce the values (and if not, why). */
  readable(d: H5Dataset): string | null {
    if (d.space.null || this.byteLength(d) === 0) return 'empty'
    if (d.type.cls === 9) return 'variable-length elements are stored in the global heap'
    if (d.type.cls === 7) return 'references'
    const l = d.layout
    if (l.kind === 'virtual') return 'virtual dataset'
    if (l.kind === 'contiguous' && l.address === UNDEF) return 'never written (fill value only)'
    for (const f of d.filters) if (![1, 2, 3, 32000].includes(f.id)) return `filter ${f.name ?? f.id} is not supported`
    if (l.kind === 'chunked' && this.byteLength(d) > 1 << 30) return 'chunked dataset over 1 GiB'
    return null
  }

  /** Raw element bytes in C order (as stored: byte order per type.big). */
  async readData(d: H5Dataset): Promise<Uint8Array> {
    const n = this.byteLength(d)
    const l = d.layout
    if (l.kind === 'compact') return l.compact!.subarray(0, n)
    if (l.kind === 'contiguous') return this.src.raw(this.abs(l.address), n)
    if (l.kind !== 'chunked') throw this.fail('unsupported layout')
    return this.readChunked(d)
  }

  /** Contiguous datasets: [absolute offset, length] for ranged reads. */
  contiguous(d: H5Dataset): [number, number] | null {
    const l = d.layout
    if (l.kind !== 'contiguous' || l.address === UNDEF || d.filters.length) return null
    const n = this.byteLength(d)
    this.src.check(this.abs(l.address), n, 'dataset')
    return [this.abs(l.address), n]
  }

  private async chunks(d: H5Dataset): Promise<{ offset: number[]; addr: number; size: number; mask: number }[]> {
    const l = d.layout
    const rank = d.space.shape.length
    const cdims = l.chunk!
    const chunkBytes = product(cdims) * d.type.size
    const grid = d.space.shape.map((s, i) => Math.ceil(s / cdims[i]))
    const nChunks = product(grid)
    const fromIndex = (k: number) => {
      const off: number[] = new Array(rank)
      for (let i = rank - 1; i >= 0; i--) {
        off[i] = (k % grid[i]) * cdims[i]
        k = Math.floor(k / grid[i])
      }
      return off
    }
    const filtered = d.filters.length > 0
    const sizeLen = Math.min(8, 1 + Math.floor((Math.floor(Math.log2(Math.max(1, chunkBytes))) + 8) / 8))
    if (l.address === UNDEF) return []
    switch (l.index) {
      case 0: {
        const leaves = await this.btree1(l.address, 1, rank)
        return leaves.map(({ child, key }) => {
          const kv = dv(key)
          const off: number[] = []
          for (let i = 0; i < rank; i++) off.push(Number(kv.getBigUint64(8 + i * 8, true)))
          return { offset: off, addr: child, size: kv.getUint32(0, true), mask: kv.getUint32(4, true) }
        })
      }
      case 1:
        return [{ offset: new Array(rank).fill(0), addr: l.address, size: l.singleFiltered?.size ?? chunkBytes, mask: l.singleFiltered?.mask ?? 0 }]
      case 2:
        return Array.from({ length: nChunks }, (_, k) => ({ offset: fromIndex(k), addr: l.address + k * chunkBytes, size: chunkBytes, mask: 0 }))
      case 3: {
        const h = await this.at(l.address, 12 + this.L + this.O, 'fixed array header')
        if (text(h.subarray(0, 4)) !== 'FAHD') throw this.fail('bad fixed array header')
        const r = this.r(h)
        r.pos = 6
        const entry = r.u8()
        const pageBits = r.u8()
        const count = r.len()
        const dblk = r.addr()
        if (count > 1 << pageBits) throw this.fail('paged fixed arrays are not supported')
        const b = await this.at(dblk, 6 + this.O + count * entry, 'fixed array data block')
        return this.indexEntries(b.subarray(6 + this.O), count, entry, filtered, fromIndex)
      }
      case 4: {
        const h = await this.at(l.address, 12 + 6 * this.L + this.O, 'extensible array header')
        if (text(h.subarray(0, 4)) !== 'EAHD') throw this.fail('bad extensible array header')
        const r = this.r(h)
        r.pos = 6
        const entry = r.u8()
        r.u8()
        const idxElems = r.u8()
        r.skip(3)
        r.skip(6 * this.L)
        const iblk = r.addr()
        if (nChunks > idxElems) throw this.fail('extensible-array chunk indexes beyond the index block are not supported')
        const b = await this.at(iblk, 6 + this.O + idxElems * entry, 'extensible array index block')
        return this.indexEntries(b.subarray(6 + this.O), nChunks, entry, filtered, fromIndex)
      }
      case 5: {
        const recs = await this.btree2(l.address)
        return recs.map((rec) => {
          const r = this.r(rec)
          const addr = r.addr()
          const size = filtered ? r.un(sizeLen) : chunkBytes
          const mask = filtered ? r.u32() : 0
          const off: number[] = []
          for (let i = 0; i < rank; i++) off.push(r.un(8) * cdims[i])
          return { offset: off, addr, size, mask }
        })
      }
    }
    throw this.fail(`chunk index type ${l.index}`)
  }

  private indexEntries(b: Uint8Array, count: number, entry: number, filtered: boolean, fromIndex: (k: number) => number[]) {
    const r = this.r(b)
    const out: { offset: number[]; addr: number; size: number; mask: number }[] = []
    for (let k = 0; k < count; k++) {
      r.pos = k * entry
      const addr = r.addr()
      const size = filtered ? r.un(entry - this.O - 4) : 0
      const mask = filtered ? r.u32() : 0
      if (addr !== UNDEF) out.push({ offset: fromIndex(k), addr, size, mask })
    }
    return out
  }

  private async readChunked(d: H5Dataset): Promise<Uint8Array> {
    const es = d.type.size
    const shape = d.space.shape
    const cdims = d.layout.chunk!
    const rank = shape.length
    const out = new Uint8Array(this.byteLength(d))
    const chunkBytes = product(cdims) * es
    const list = await this.chunks(d)
    const unfiltered = !d.filters.length
    for (const c of list) {
      let b = await this.src.raw(this.abs(c.addr), unfiltered ? chunkBytes : c.size)
      if (!unfiltered) b = this.unfilter(b, d.filters, c.mask, es, chunkBytes)
      if (b.length < chunkBytes) throw this.fail('chunk shorter than expected')
      // copy rows of the last dimension
      const last = rank - 1
      const run = Math.min(cdims[last], shape[last] - c.offset[last]) * es
      if (run <= 0) continue
      const idx = new Array(rank).fill(0)
      const rows = product(cdims.slice(0, last))
      for (let k = 0; k < rows; k++) {
        let ok = true
        let dst = 0
        let srcPos = 0
        for (let i = 0; i < last; i++) {
          const g = c.offset[i] + idx[i]
          if (g >= shape[i]) ok = false
          dst = dst * shape[i] + g
          srcPos = srcPos * cdims[i] + idx[i]
        }
        if (ok) {
          dst = (dst * shape[last] + c.offset[last]) * es
          srcPos = srcPos * cdims[last] * es
          out.set(b.subarray(srcPos, srcPos + run), dst)
        }
        for (let i = last - 1; i >= 0; i--) {
          if (++idx[i] < cdims[i]) break
          idx[i] = 0
        }
      }
    }
    return out
  }

  private unfilter(b: Uint8Array, filters: H5Filter[], mask: number, es: number, chunkBytes: number): Uint8Array {
    for (let i = filters.length - 1; i >= 0; i--) {
      if (mask & (1 << i)) continue
      const f = filters[i]
      switch (f.id) {
        case 1:
          b = unzlibSync(b)
          break
        case 2:
          b = unshuffle(b, f.values[1] ?? es)
          break
        case 3:
          b = b.subarray(0, b.length - 4)
          break
        case 32000:
          b = lzf(b, chunkBytes)
          break
        default:
          throw this.fail(`filter ${f.id}`)
      }
    }
    return b
  }
}

export interface FHeap {
  addr: number
  idLen: number
  width: number
  startSize: number
  maxDirect: number
  offSize: number
  lenSize: number
  root: number
  rows: number
  maxDirectRows: number
}

export function unshuffle(b: Uint8Array, es: number): Uint8Array {
  if (es <= 1) return b
  const n = Math.floor(b.length / es)
  const out = new Uint8Array(b.length)
  for (let j = 0; j < es; j++) for (let i = 0; i < n; i++) out[i * es + j] = b[j * n + i]
  out.set(b.subarray(n * es), n * es)
  return out
}

/** LZF (h5py's lzf filter). */
export function lzf(input: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen)
  let ip = 0
  let op = 0
  while (ip < input.length) {
    let ctrl = input[ip++]
    if (ctrl < 32) {
      ctrl++
      if (op + ctrl > outLen || ip + ctrl > input.length) throw new RangeError('lzf: overrun')
      out.set(input.subarray(ip, ip + ctrl), op)
      ip += ctrl
      op += ctrl
    } else {
      let len = ctrl >> 5
      let ref = op - ((ctrl & 0x1f) << 8) - 1
      if (len === 7) len += input[ip++]
      ref -= input[ip++]
      len += 2
      if (ref < 0 || op + len > outLen) throw new RangeError('lzf: bad back reference')
      for (let k = 0; k < len; k++) out[op++] = out[ref++]
    }
  }
  return op === outLen ? out : out.subarray(0, op)
}

function reshape(vals: Value[], shape: number[]): Value[] {
  if (shape.length <= 1) return vals
  const step = product(shape.slice(1))
  const out: Value[] = []
  for (let i = 0; i < shape[0]; i++) out.push(reshape(vals.slice(i * step, (i + 1) * step), shape.slice(1)))
  return out
}
