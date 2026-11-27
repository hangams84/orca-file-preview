/** NumPy .npy (one array) and .npz (a ZIP of .npy files, stored or deflated). Tensors only.
 *  The header is a Python dict literal, parsed here by a tiny literal reader (never evaluated).
 *  Deflated .npz members are inflated only as far as their header until a tensor is read. */
import { inflateSync } from '../../../../vendor/zip.js'
import { openZip, type ZipEntry } from '../zip.ts'
import type { ByteSource, ModelIR, TensorInfo, Value } from '../ir.ts'
import { bad, dv, guarded, memReader, note, product, Src, text, warn, yieldEvery } from './common.ts'

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59] // \x93NUMPY
/** Largest .npz member inflated in memory. */
const MAX_INFLATE = 1 << 30

export function detect(head: Uint8Array): boolean {
  if (MAGIC.every((b, i) => head[i] === b)) return true
  // .npz: a ZIP whose first member is an .npy
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4 && head.length >= 30) {
    const n = dv(head).getUint16(26, true)
    const name = text(head.subarray(30, Math.min(head.length, 30 + n)))
    return name.endsWith('.npy')
  }
  return false
}

// ---- Python literal (dict/tuple/list/str/int/float/True/False/None) ----

type Py = string | number | boolean | null | Py[] | { [k: string]: Py }

export function pyLiteral(s: string): Py {
  let i = 0
  let depth = 0
  const fail = (): never => {
    throw bad('npy-header', 'The NumPy header is not a valid dictionary.')
  }
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++
  }
  const value = (): Py => {
    ws()
    if (++depth > 32) fail()
    try {
      const c = s[i]
      if (c === '{') {
        i++
        const o: { [k: string]: Py } = {}
        for (;;) {
          ws()
          if (s[i] === '}') return i++, o
          const k = value()
          ws()
          if (s[i++] !== ':') fail()
          o[String(k)] = value()
          ws()
          if (s[i] === ',') i++
          else if (s[i] !== '}') fail()
        }
      }
      if (c === '(' || c === '[') {
        const close = c === '(' ? ')' : ']'
        i++
        const a: Py[] = []
        for (;;) {
          ws()
          if (s[i] === close) return i++, a
          a.push(value())
          ws()
          if (s[i] === ',') i++
          else if (s[i] !== close) fail()
        }
      }
      if (c === "'" || c === '"') {
        i++
        let out = ''
        while (i < s.length && s[i] !== c) {
          if (s[i] === '\\' && i + 1 < s.length) i++
          out += s[i++]
        }
        if (s[i++] !== c) fail()
        return out
      }
      const m = /^(True|False|None|[-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?L?)/.exec(s.slice(i, i + 40))
      if (!m) fail()
      i += m![0].length
      if (m![0] === 'True') return true
      if (m![0] === 'False') return false
      if (m![0] === 'None') return null
      return Number(m![0].replace(/L$/, ''))
    } finally {
      depth--
    }
  }
  const v = value()
  return v
}

// ---- dtypes ----

export interface NpyType {
  /** Canonical dtype or a NumPy descriptor (`U8`, `S4`, `V12`, `datetime64[ns]`, `struct`). */
  dtype: string
  itemsize: number
  bigEndian: boolean
  /** Field layout of a structured dtype. */
  fields?: { name: string; dtype: string; shape: number[] }[]
  object?: boolean
}

const SIMPLE: Record<string, string> = {
  f8: 'f64', f4: 'f32', f2: 'f16', i8: 'i64', i4: 'i32', i2: 'i16', i1: 'i8',
  u8: 'u64', u4: 'u32', u2: 'u16', u1: 'u8', b1: 'bool', c8: 'c64', c16: 'c128'
}

export function npyType(descr: Py, depth = 0): NpyType {
  if (depth > 8) throw bad('npy-dtype', 'The NumPy dtype is nested too deeply.')
  if (typeof descr === 'string') {
    const m = /^([<>|=]?)([a-zA-Z])(\d*)(\[\w+\])?$/.exec(descr)
    if (!m) throw bad('npy-dtype', `Unsupported NumPy dtype ${descr}.`)
    const [, order, kind, n, unit] = m
    const size = n ? Number(n) : 0
    const bigEndian = order === '>'
    const simple = SIMPLE[kind + n]
    if (simple) return { dtype: simple, itemsize: size, bigEndian }
    switch (kind) {
      case 'U':
        return { dtype: `U${size}`, itemsize: size * 4, bigEndian }
      case 'S':
      case 'a':
        return { dtype: `S${size}`, itemsize: size, bigEndian }
      case 'V':
        return { dtype: `V${size}`, itemsize: size, bigEndian }
      case 'O':
        return { dtype: 'object', itemsize: size || 8, bigEndian, object: true }
      case 'M':
        return { dtype: `datetime64${unit ?? ''}`, itemsize: size, bigEndian }
      case 'm':
        return { dtype: `timedelta64${unit ?? ''}`, itemsize: size, bigEndian }
    }
    throw bad('npy-dtype', `Unsupported NumPy dtype ${descr}.`)
  }
  if (Array.isArray(descr)) {
    const fields: NonNullable<NpyType['fields']> = []
    let itemsize = 0
    let object = false
    for (const f of descr) {
      if (!Array.isArray(f) || f.length < 2) throw bad('npy-dtype', 'Bad structured dtype field.')
      const name = Array.isArray(f[0]) ? String(f[0][1]) : String(f[0])
      const t = npyType(f[1], depth + 1)
      const shape = Array.isArray(f[2]) ? f[2].map(Number) : typeof f[2] === 'number' ? [f[2]] : []
      object ||= !!t.object
      fields.push({ name, dtype: t.fields ? 'struct' : t.dtype, shape })
      itemsize += t.itemsize * product(shape)
    }
    const desc = fields.map((f) => `${f.name}:${f.dtype}${f.shape.length ? `[${f.shape.join(',')}]` : ''}`).join(', ')
    return { dtype: `struct{${desc}}`, itemsize, bigEndian: false, fields, object }
  }
  throw bad('npy-dtype', 'Unsupported NumPy dtype.')
}

export interface NpyHeader {
  version: string
  type: NpyType
  shape: number[]
  fortran: boolean
  dataOffset: number
}

/** Parses the header at the start of `b` (which must hold the whole header). */
export function parseNpyHeader(b: Uint8Array): NpyHeader {
  if (!MAGIC.every((x, i) => b[i] === x)) throw bad('npy-not-numpy', 'This is not a NumPy .npy array.')
  if (b.length < 10) throw bad('npy-truncated', 'The NumPy file is truncated.')
  const major = b[6]
  const minor = b[7]
  if (major < 1 || major > 3) throw bad('npy-version', `NumPy format version ${major}.${minor} is not supported.`)
  const v = dv(b)
  const long = major >= 2
  const hlen = long ? (b.length >= 12 ? v.getUint32(8, true) : -1) : v.getUint16(8, true)
  const start = long ? 12 : 10
  if (hlen < 0 || start + hlen > b.length || hlen > 1 << 20) throw bad('npy-truncated', 'The NumPy header is truncated.')
  const s = major === 3 ? text(b.subarray(start, start + hlen)) : String.fromCharCode(...b.subarray(start, start + hlen))
  const h = pyLiteral(s)
  if (!h || typeof h !== 'object' || Array.isArray(h) || !('descr' in h) || !Array.isArray(h.shape))
    throw bad('npy-header', 'The NumPy header is missing descr or shape.')
  const shape = h.shape.map((d) => {
    if (typeof d !== 'number' || !Number.isSafeInteger(d) || d < 0) throw bad('npy-header', 'The NumPy shape is invalid.')
    return d
  })
  return { version: `${major}.${minor}`, type: npyType(h.descr), shape, fortran: h.fortran_order === true, dataOffset: start + hlen }
}

/** Fortran (column-major) → C order, element-wise. */
export function fortranToC(b: Uint8Array, shape: number[], itemsize: number): Uint8Array {
  const n = product(shape)
  const out = new Uint8Array(n * itemsize)
  const nd = shape.length
  const fStride: number[] = []
  let s = 1
  for (let k = 0; k < nd; k++) (fStride[k] = s), (s *= shape[k])
  const idx = new Array(nd).fill(0)
  for (let c = 0; c < n; c++) {
    let f = 0
    for (let k = 0; k < nd; k++) f += idx[k] * fStride[k]
    out.set(b.subarray(f * itemsize, f * itemsize + itemsize), c * itemsize)
    for (let k = nd - 1; k >= 0; k--) {
      if (++idx[k] < shape[k]) break
      idx[k] = 0
    }
  }
  return out
}

function tensorOf(name: string, h: NpyHeader, total: number, read: (off: number, len: number) => Promise<Uint8Array>): TensorInfo {
  const count = product(h.shape)
  const byteLength = count * h.type.itemsize
  if (h.dataOffset + byteLength > total)
    throw bad('npy-truncated', `The data of ${name} is truncated (${byteLength} bytes expected, ${Math.max(0, total - h.dataOffset)} present).`)
  const attrs: Record<string, Value> = { npyVersion: h.version, itemsize: h.type.itemsize }
  if (h.fortran) attrs.fortranOrder = true
  if (h.type.fields) attrs.fields = h.type.fields.map((f) => ({ name: f.name, dtype: f.dtype, shape: f.shape }))
  const t: TensorInfo = { name, shape: h.shape, dtype: h.type.dtype, byteLength, kind: 'array', attrs }
  if (h.type.bigEndian && h.type.itemsize > 1) t.byteOrder = 'big'
  if (h.type.object) {
    attrs.note = 'object array: elements are pickled Python objects and are not read'
    return t
  }
  if (h.fortran && h.shape.length > 1) {
    let c: Uint8Array | null = null
    const all = async () => (c ??= fortranToC(await read(h.dataOffset, byteLength), h.shape, h.type.itemsize))
    t.read = async (range) => {
      const b = await all()
      return range ? b.subarray(Math.max(0, range.offset), Math.max(0, range.offset) + Math.max(0, range.length)) : b
    }
  } else {
    t.read = async (range) => {
      if (!range) return read(h.dataOffset, byteLength)
      const s = Math.max(0, Math.min(byteLength, range.offset))
      return read(h.dataOffset + s, Math.max(0, Math.min(byteLength - s, range.length)))
    }
  }
  return t
}

async function headerBytes(src: Src): Promise<Uint8Array> {
  const first = await src.upTo(0, 12)
  if (first.length < 10 || !MAGIC.every((x, i) => first[i] === x)) throw bad('npy-not-numpy', 'This is not a NumPy .npy array.')
  const v = dv(first)
  const total = first[6] >= 2 ? 12 + (first.length >= 12 ? v.getUint32(8, true) : 0) : 10 + v.getUint16(8, true)
  if (total > src.size) throw bad('npy-truncated', 'The NumPy header is truncated.')
  return src.bytes(0, Math.min(total, (1 << 20) + 12))
}

async function readNpy(source: ByteSource): Promise<ModelIR> {
  const src = new Src(source, 'npy')
  const h = parseNpyHeader(await headerBytes(src))
  const name = (source.name ?? 'array').replace(/^.*[\\/]/, '').replace(/\.npy$/i, '') || 'array'
  const t = tensorOf(name, h, src.size, (o, n) => src.raw(o, n))
  const notes = [note(`NumPy ${h.version} array: ${h.type.dtype}${h.fortran ? ', Fortran order (shown in C order)' : ''}.`)]
  if (h.type.object) notes.push(warn('Object arrays hold pickled Python objects; their values are not read.', '객체 배열은 피클된 파이썬 객체라 값을 읽지 않습니다.'))
  return {
    format: 'npy',
    formatLabel: `NumPy .npy · v${h.version}`,
    framework: 'numpy',
    metadata: { dtype: h.type.dtype, shape: h.shape, fortran_order: h.fortran, version: h.version },
    tensors: [t],
    notes
  }
}

// ---- .npz ----

/** Inflates the first `want` bytes of a raw-deflate stream from `chunk` (which may be cut short). */
async function inflatePrefix(chunk: Uint8Array, want: number, wholeIfNeeded: () => Promise<Uint8Array>): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'function') {
    try {
      const ds = new DecompressionStream('deflate-raw')
      const w = ds.writable.getWriter()
      const r = ds.readable.getReader()
      w.write(chunk as BufferSource).catch(() => {})
      w.close().catch(() => {})
      const parts: Uint8Array[] = []
      let got = 0
      while (got < want) {
        const step = await r.read().catch(() => ({ done: true, value: undefined }))
        if (step.done || !step.value) break
        parts.push(step.value)
        got += step.value.length
      }
      r.cancel().catch(() => {})
      const out = new Uint8Array(got)
      let p = 0
      for (const x of parts) out.set(x, p), (p += x.length)
      if (got > 0) return out
    } catch {
      /* fall through to a whole inflate */
    }
  }
  return wholeIfNeeded()
}

async function readNpz(source: ByteSource): Promise<ModelIR> {
  const src = new Src(source, 'npz')
  let zip
  try {
    zip = await openZip(source)
  } catch (e) {
    throw bad('npz-damaged', `The .npz archive is damaged (${(e as Error).message}).`)
  }
  const tensors: TensorInfo[] = []
  const notes = [] as ModelIR['notes']
  let deflated = 0
  let i = 0
  for (const e of zip.entries) {
    await yieldEvery(++i, 200)
    if (!e.name.endsWith('.npy')) {
      notes.push(warn(`Skipped ${e.name}: not an .npy member.`))
      continue
    }
    const name = e.name.replace(/\.npy$/, '')
    const off = await dataOffset(src, e)
    if (e.method === 0) {
      const sub = new Src({ size: e.size, read: (o, n) => source.read(off + o, Math.min(n, e.size - o)) }, 'npy')
      src.check(off, e.size, e.name)
      const h = parseNpyHeader(await headerBytes(sub))
      tensors.push(tensorOf(name, h, e.size, (o, n) => sub.raw(o, n)))
    } else if (e.method === 8) {
      deflated++
      src.check(off, e.compressedSize, e.name)
      if (e.size > MAX_INFLATE || e.size > e.compressedSize * 1100 + 4096) {
        // larger than deflate can produce from these bytes, or too big to inflate in memory
        notes.push(warn(`Skipped ${e.name}: it claims ${e.size} bytes uncompressed.`, `${e.name} 건너뜀: 압축 해제 크기가 ${e.size}바이트라고 주장합니다.`))
        continue
      }
      let whole: Uint8Array | null = null
      const inflateAll = async () => (whole ??= inflateSync(await src.raw(off, e.compressedSize), { out: new Uint8Array(e.size) }))
      const head = await inflatePrefix(await src.raw(off, Math.min(e.compressedSize, 65536)), 4096, inflateAll)
      let h: NpyHeader
      try {
        h = parseNpyHeader(head)
      } catch {
        h = parseNpyHeader(await inflateAll())
      }
      // Values come from a whole inflate on first read; the bytes are not kept between reads.
      tensors.push(
        tensorOf(name, h, e.size, async (o, n) => {
          const b = whole ?? inflateSync(await src.raw(off, e.compressedSize), { out: new Uint8Array(e.size) })
          return b.subarray(o, o + n)
        })
      )
      whole = null
    } else {
      notes.push(warn(`Skipped ${e.name}: ZIP method ${e.method} is not supported.`))
    }
  }
  if (deflated) notes.push(note(`${deflated} compressed member(s) (np.savez_compressed): values are inflated when read.`))
  const total = tensors.reduce((s, t) => s + product(t.shape), 0)
  return {
    format: 'npz',
    formatLabel: `NumPy .npz · ${tensors.length} array${tensors.length === 1 ? '' : 's'}${deflated ? ' · compressed' : ''}`,
    framework: 'numpy',
    metadata: { arrays: tensors.length, elements: total },
    tensors,
    notes
  }
}

async function dataOffset(src: Src, e: ZipEntry): Promise<number> {
  const lh = dv(await src.bytes(e.headerOffset, 30, 'ZIP local header'))
  if (lh.getUint32(0, true) !== 0x04034b50) throw src.fail(`bad local header for ${e.name}`)
  return e.headerOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true)
}

export function read(source: ByteSource): Promise<ModelIR> {
  return guarded('numpy', () => readModel(source))
}

async function readModel(source: ByteSource): Promise<ModelIR> {
  const head = await source.read(0, 8)
  if (head[0] === 0x50 && head[1] === 0x4b) return readNpz(source)
  return readNpy(source)
}


