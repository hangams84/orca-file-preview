/** GGUF (llama.cpp / ggml): header, every key-value type (arrays included, nested), tensor infos,
 *  alignment and the ggml type table. Values: `read` returns the stored blocks; `dequantize` decodes
 *  F32/F16/BF16/F64/ints, Q4_0/Q4_1/Q5_0/Q5_1/Q8_0, the K-quants (Q2_K…Q8_K) and IQ4_NL/IQ4_XS; the
 *  other IQ/TQ/MXFP types are reported but not decoded. The module tree groups blk.N into attn/ffn. */
import type { ByteSource, ModelIR, Note, TensorInfo, Value } from '../ir.ts'
import { bad, big, clip, f16, moduleTree, note, Src, Stream, text, warn, yieldEvery } from './common.ts'

export function detect(head: Uint8Array): boolean {
  return head[0] === 0x47 && head[1] === 0x47 && head[2] === 0x55 && head[3] === 0x46 // GGUF
}

/** ggml type id → [name, block size (elements), type size (bytes per block), canonical dtype]. */
export const GGML_TYPES: Record<number, [string, number, number, string?]> = {
  0: ['F32', 1, 4, 'f32'],
  1: ['F16', 1, 2, 'f16'],
  2: ['Q4_0', 32, 18],
  3: ['Q4_1', 32, 20],
  6: ['Q5_0', 32, 22],
  7: ['Q5_1', 32, 24],
  8: ['Q8_0', 32, 34],
  9: ['Q8_1', 32, 40],
  10: ['Q2_K', 256, 84],
  11: ['Q3_K', 256, 110],
  12: ['Q4_K', 256, 144],
  13: ['Q5_K', 256, 176],
  14: ['Q6_K', 256, 210],
  15: ['Q8_K', 256, 292],
  16: ['IQ2_XXS', 256, 66],
  17: ['IQ2_XS', 256, 74],
  18: ['IQ3_XXS', 256, 98],
  19: ['IQ1_S', 256, 50],
  20: ['IQ4_NL', 32, 18],
  21: ['IQ3_S', 256, 110],
  22: ['IQ2_S', 256, 82],
  23: ['IQ4_XS', 256, 136],
  24: ['I8', 1, 1, 'i8'],
  25: ['I16', 1, 2, 'i16'],
  26: ['I32', 1, 4, 'i32'],
  27: ['I64', 1, 8, 'i64'],
  28: ['F64', 1, 8, 'f64'],
  29: ['IQ1_M', 256, 56],
  30: ['BF16', 1, 2, 'bf16'],
  31: ['Q4_0_4_4', 32, 18],
  32: ['Q4_0_4_8', 32, 18],
  33: ['Q4_0_8_8', 32, 18],
  34: ['TQ1_0', 256, 54],
  35: ['TQ2_0', 256, 66],
  36: ['IQ4_NL_4_4', 32, 18],
  37: ['IQ4_NL_4_8', 32, 18],
  38: ['IQ4_NL_8_8', 32, 18],
  39: ['MXFP4', 32, 17],
  40: ['NVFP4', 64, 36],
  41: ['Q1_0', 128, 18]
}

/** llama.cpp `general.file_type` (LLAMA_FTYPE_*). */
const FILE_TYPES: Record<number, string> = {
  0: 'ALL_F32', 1: 'MOSTLY_F16', 2: 'MOSTLY_Q4_0', 3: 'MOSTLY_Q4_1', 7: 'MOSTLY_Q8_0', 8: 'MOSTLY_Q5_0', 9: 'MOSTLY_Q5_1',
  10: 'MOSTLY_Q2_K', 11: 'MOSTLY_Q3_K_S', 12: 'MOSTLY_Q3_K_M', 13: 'MOSTLY_Q3_K_L', 14: 'MOSTLY_Q4_K_S', 15: 'MOSTLY_Q4_K_M',
  16: 'MOSTLY_Q5_K_S', 17: 'MOSTLY_Q5_K_M', 18: 'MOSTLY_Q6_K', 19: 'MOSTLY_IQ2_XXS', 20: 'MOSTLY_IQ2_XS', 21: 'MOSTLY_Q2_K_S',
  22: 'MOSTLY_IQ3_XS', 23: 'MOSTLY_IQ3_XXS', 24: 'MOSTLY_IQ1_S', 25: 'MOSTLY_IQ4_NL', 26: 'MOSTLY_IQ3_S', 27: 'MOSTLY_IQ3_M',
  28: 'MOSTLY_IQ2_S', 29: 'MOSTLY_IQ2_M', 30: 'MOSTLY_IQ4_XS', 31: 'MOSTLY_IQ1_M', 32: 'MOSTLY_BF16', 36: 'MOSTLY_TQ1_0',
  37: 'MOSTLY_TQ2_0', 38: 'MOSTLY_MXFP4_MOE', 39: 'MOSTLY_NVFP4', 40: 'MOSTLY_Q1_0', 1024: 'GUESSED'
}

const KV_TYPES = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f32', 'bool', 'string', 'array', 'u64', 'i64', 'f64']
const FIXED: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }
const KEEP = 64

async function str(s: Stream, v1: boolean): Promise<string> {
  await s.need(v1 ? 4 : 8, 'string length')
  const n = v1 ? s.u32() : Number(s.u64())
  if (n > s.src.size) throw s.src.fail(`string of ${n} bytes`)
  await s.need(n, 'string')
  return text(s.take(n))
}

async function scalar(s: Stream, t: number, v1: boolean): Promise<Value> {
  if (t === 8) return str(s, v1)
  const size = FIXED[t]
  if (!size) throw bad('gguf-damaged', `Unknown GGUF value type ${t}.`)
  await s.need(size)
  switch (t) {
    case 0: return s.u8()
    case 1: return s.i8()
    case 2: return s.u16()
    case 3: return s.i16()
    case 4: return s.u32()
    case 5: return s.i32()
    case 6: return s.f32()
    case 7: return s.u8() !== 0
    case 10: return big(s.u64())
    case 11: return big(s.i64())
    default: return s.f64()
  }
}

/** One value; arrays keep their first KEEP items (and their length), the rest is skipped. */
async function value(s: Stream, t: number, v1: boolean, depth = 0): Promise<{ v: Value; type: string; len?: number }> {
  if (t !== 9) return { v: await scalar(s, t, v1), type: KV_TYPES[t] ?? String(t) }
  if (depth > 8) throw bad('gguf-damaged', 'GGUF arrays are nested too deeply.')
  await s.need(v1 ? 8 : 12, 'array header')
  const et = s.u32()
  const n = v1 ? s.u32() : Number(s.u64())
  if (n > s.src.size) throw s.src.fail(`array of ${n} items`)
  const items: Value[] = []
  let etName = KV_TYPES[et] ?? String(et)
  if (FIXED[et] && n > KEEP) {
    for (let i = 0; i < KEEP; i++) items.push(await scalar(s, et, v1))
    s.skip((n - KEEP) * FIXED[et])
  } else {
    for (let i = 0; i < n; i++) {
      await yieldEvery(i, 20000)
      const x = await value(s, et, v1, depth + 1)
      if (i < KEEP) items.push(x.v)
      if (i === 0) etName = x.type
    }
  }
  if (n > KEEP) items.push(`… (${n} items)`)
  return { v: items, type: `array<${etName}>`, len: n }
}

export interface GgufHeader {
  version: number
  bigEndian: boolean
  kv: Record<string, Value>
  kvTypes: Record<string, string>
  tensors: { name: string; dims: number[]; type: number; offset: number }[]
  alignment: number
  dataOffset: number
}

export async function readHeader(src: Src): Promise<GgufHeader> {
  const s = new Stream(src, 0)
  await s.need(8, 'header')
  const magic = s.u32()
  if (magic !== 0x46554747) throw bad('gguf-not-gguf', 'This is not a GGUF file.')
  let version = s.u32()
  let bigEndian = false
  if (version > 0xffff) {
    // a big-endian GGUF (s390x builds): the version reads byte-swapped
    bigEndian = true
    s.le = false
    s.pos = 4
    version = s.u32()
  }
  if (version < 1 || version > 3) throw bad('gguf-version', `GGUF version ${version} is not supported.`)
  const v1 = version === 1
  await s.need(v1 ? 8 : 16, 'header counts')
  const nTensors = v1 ? s.u32() : Number(s.u64())
  const nKv = v1 ? s.u32() : Number(s.u64())
  if (nTensors > 1e7 || nKv > 1e7 || nTensors * 24 > src.size) throw src.fail(`header counts ${nTensors}/${nKv}`)
  const kv: Record<string, Value> = {}
  const kvTypes: Record<string, string> = {}
  for (let i = 0; i < nKv; i++) {
    await yieldEvery(i, 500)
    const key = await str(s, v1)
    await s.need(4)
    const x = await value(s, s.u32(), v1)
    kv[key] = x.v
    kvTypes[key] = x.len !== undefined ? `${x.type}[${x.len}]` : x.type
  }
  const tensors: GgufHeader['tensors'] = []
  for (let i = 0; i < nTensors; i++) {
    await yieldEvery(i, 2000)
    const name = await str(s, v1)
    await s.need(4)
    const nd = s.u32()
    if (nd > 8) throw src.fail(`tensor ${name} has ${nd} dimensions`)
    await s.need(nd * (v1 ? 4 : 8) + 12)
    const dims: number[] = []
    for (let k = 0; k < nd; k++) dims.push(v1 ? s.u32() : Number(s.u64()))
    const type = s.u32()
    const offset = Number(s.u64())
    tensors.push({ name, dims, type, offset })
  }
  const al = kv['general.alignment']
  const alignment = typeof al === 'number' && al > 0 && al <= 1 << 20 ? al : 32
  const dataOffset = Math.ceil(s.pos / alignment) * alignment
  return { version, bigEndian, kv, kvTypes, tensors, alignment, dataOffset }
}

function groupSegment(seg: string, depth: number, parts: string[]): string[] {
  // blk.N.attn_q.weight → blk / N / attn / attn_q ; blk.N.ffn_up_exps.weight → … / ffn / ffn_up_exps
  if (depth === 2 && parts[0] === 'blk') {
    const m = /^(attn|ffn|ssm|time_mix|channel_mix|conv|post|layer_output)_/.exec(seg)
    if (m) return [m[1], seg]
  }
  return [seg]
}

export async function read(source: ByteSource): Promise<ModelIR> {
  const src = new Src(source, 'gguf')
  const h = await readHeader(src)
  const notes: Note[] = []
  const tensors: TensorInfo[] = []
  const counts: Record<string, number> = {}
  let outside = 0
  let undecoded = new Set<string>()
  for (const t of h.tensors) {
    const info = GGML_TYPES[t.type]
    const shape = [...t.dims].reverse() // ggml ne[0] is the innermost dimension
    const n = t.dims.reduce((a, b) => a * b, 1)
    const name = info?.[0] ?? `type${t.type}`
    counts[name] = (counts[name] ?? 0) + 1
    const byteLength = info ? Math.ceil(n / info[1]) * info[2] : 0
    const abs = h.dataOffset + t.offset
    const attrs: Record<string, Value> = { ggmlType: name, ggmlTypeId: t.type, offset: abs }
    if (info && info[1] > 1) attrs.block = `${info[1]} values / ${info[2]} bytes`
    const x: TensorInfo = { name: t.name, shape, dtype: info?.[3] ?? name, byteLength, kind: 'parameter', attrs }
    if (h.bigEndian) x.byteOrder = 'big'
    if (info && !info[3]) {
      x.quant = { scheme: `ggml ${name}` }
      if (!DEQUANT[name]) undecoded.add(name)
    }
    if (t.offset % h.alignment) attrs.misaligned = true
    if (!info) notes.push(warn(`${t.name}: unknown ggml type ${t.type}; its size is unknown.`))
    else if (abs + byteLength > src.size || !Number.isSafeInteger(abs)) outside++
    else x.read = src.reader(abs, byteLength, t.name)
    tensors.push(x)
  }
  if (outside) notes.push(warn(`${outside} tensor(s) lie past the end of the file (truncated download?): their values are not available.`, `텐서 ${outside}개가 파일 끝을 넘어갑니다(잘린 파일?).`))
  if (undecoded.size) notes.push(note(`Quantized, not decoded: ${[...undecoded].join(', ')} (shown with their block layout).`, `양자화 형식 ${[...undecoded].join(', ')}은 값을 디코딩하지 않습니다.`))
  if (h.bigEndian) notes.push(note('Big-endian GGUF.'))

  const arch = typeof h.kv['general.architecture'] === 'string' ? (h.kv['general.architecture'] as string) : undefined
  const blocks = new Set(h.tensors.map((t) => /^blk\.(\d+)\./.exec(t.name)?.[1]).filter(Boolean)).size
  const ft = h.kv['general.file_type']
  const params = h.tensors.reduce((s, t) => s + t.dims.reduce((a, b) => a * b, 1), 0)
  const metadata: Record<string, Value> = {}
  for (const [k, v] of Object.entries(h.kv)) metadata[k] = Array.isArray(v) ? clip(v, KEEP + 1) : v
  const modules = moduleTree(tensors, { rootName: (h.kv['general.name'] as string) || arch || 'model', rootType: arch, group: groupSegment })
  const summary: Record<string, Value> = {
    'gguf.version': h.version,
    'gguf.alignment': h.alignment,
    'gguf.data_offset': h.dataOffset,
    'gguf.tensor_types': counts,
    'gguf.kv_types': h.kvTypes
  }
  if (typeof ft === 'number') summary['gguf.file_type_name'] = FILE_TYPES[ft] ?? String(ft)
  if (blocks) summary['gguf.blocks'] = blocks
  return {
    format: 'gguf',
    formatLabel: `GGUF v${h.version}${arch ? ` · ${arch}` : ''}${typeof ft === 'number' && FILE_TYPES[ft] ? ` · ${FILE_TYPES[ft].replace('MOSTLY_', '')}` : ''}`,
    framework: 'llama.cpp',
    producer: typeof h.kv['general.quantized_by'] === 'string' ? (h.kv['general.quantized_by'] as string) : undefined,
    metadata: { ...metadata, ...summary, 'gguf.parameters': params },
    tensors,
    modules,
    notes
  }
}

// ---- dequantization ----

const KV_IQ4NL = [-127, -104, -83, -65, -49, -35, -22, -10, 1, 13, 25, 38, 53, 69, 89, 113]

function h16(b: Uint8Array, o: number): number {
  return f16(b[o] | (b[o + 1] << 8))
}
function scaleMinK4(j: number, q: Uint8Array, o: number): [number, number] {
  if (j < 4) return [q[o + j] & 63, q[o + j + 4] & 63]
  return [(q[o + j + 4] & 0xf) | ((q[o + j - 4] >> 6) << 4), (q[o + j + 4] >> 4) | ((q[o + j] >> 6) << 4)]
}

type Deq = (b: Uint8Array, o: number, y: Float32Array, p: number) => void
const DEQUANT: Record<string, Deq> = {
  Q4_0(b, o, y, p) {
    const d = h16(b, o)
    for (let j = 0; j < 16; j++) {
      y[p + j] = ((b[o + 2 + j] & 0xf) - 8) * d
      y[p + j + 16] = ((b[o + 2 + j] >> 4) - 8) * d
    }
  },
  Q4_1(b, o, y, p) {
    const d = h16(b, o)
    const m = h16(b, o + 2)
    for (let j = 0; j < 16; j++) {
      y[p + j] = (b[o + 4 + j] & 0xf) * d + m
      y[p + j + 16] = (b[o + 4 + j] >> 4) * d + m
    }
  },
  Q5_0(b, o, y, p) {
    const d = h16(b, o)
    const qh = (b[o + 2] | (b[o + 3] << 8) | (b[o + 4] << 16) | (b[o + 5] << 24)) >>> 0
    for (let j = 0; j < 16; j++) {
      const h0 = ((qh >>> j) << 4) & 0x10
      const h1 = (qh >>> (j + 12)) & 0x10
      y[p + j] = (((b[o + 6 + j] & 0xf) | h0) - 16) * d
      y[p + j + 16] = (((b[o + 6 + j] >> 4) | h1) - 16) * d
    }
  },
  Q5_1(b, o, y, p) {
    const d = h16(b, o)
    const m = h16(b, o + 2)
    const qh = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0
    for (let j = 0; j < 16; j++) {
      const h0 = ((qh >>> j) << 4) & 0x10
      const h1 = (qh >>> (j + 12)) & 0x10
      y[p + j] = ((b[o + 8 + j] & 0xf) | h0) * d + m
      y[p + j + 16] = ((b[o + 8 + j] >> 4) | h1) * d + m
    }
  },
  Q8_0(b, o, y, p) {
    const d = h16(b, o)
    for (let j = 0; j < 32; j++) y[p + j] = ((b[o + 2 + j] << 24) >> 24) * d
  },
  Q2_K(b, o, y, p) {
    const d = h16(b, o + 80)
    const min = h16(b, o + 82)
    let q = o + 16
    let is = 0
    for (let n = 0; n < 256; n += 128) {
      let shift = 0
      for (let j = 0; j < 4; j++) {
        let sc = b[o + is++]
        let dl = d * (sc & 0xf)
        let ml = min * (sc >> 4)
        for (let l = 0; l < 16; l++) y[p++] = dl * ((b[q + l] >> shift) & 3) - ml
        sc = b[o + is++]
        dl = d * (sc & 0xf)
        ml = min * (sc >> 4)
        for (let l = 0; l < 16; l++) y[p++] = dl * ((b[q + l + 16] >> shift) & 3) - ml
        shift += 2
      }
      q += 32
    }
  },
  Q3_K(b, o, y, p) {
    const d = h16(b, o + 108)
    const sv = new DataView(b.buffer, b.byteOffset + o + 96, 12)
    const a0 = sv.getUint32(0, true)
    const a1 = sv.getUint32(4, true)
    const tmp = sv.getUint32(8, true)
    const k1 = 0x03030303
    const k2 = 0x0f0f0f0f
    const aux = new Uint32Array([
      (a0 & k2) | (((tmp >>> 0) & k1) << 4),
      (a1 & k2) | (((tmp >>> 2) & k1) << 4),
      ((a0 >>> 4) & k2) | (((tmp >>> 4) & k1) << 4),
      ((a1 >>> 4) & k2) | (((tmp >>> 6) & k1) << 4)
    ])
    const scales = new Int8Array(aux.buffer)
    let q = o + 32
    const hm = o
    let is = 0
    let m = 1
    for (let n = 0; n < 256; n += 128) {
      let shift = 0
      for (let j = 0; j < 4; j++) {
        let dl = d * (scales[is++] - 32)
        for (let l = 0; l < 16; l++) y[p++] = dl * (((b[q + l] >> shift) & 3) - (b[hm + l] & m ? 0 : 4))
        dl = d * (scales[is++] - 32)
        for (let l = 0; l < 16; l++) y[p++] = dl * (((b[q + l + 16] >> shift) & 3) - (b[hm + l + 16] & m ? 0 : 4))
        shift += 2
        m <<= 1
      }
      q += 32
    }
  },
  Q4_K(b, o, y, p) {
    const d = h16(b, o)
    const min = h16(b, o + 2)
    let q = o + 16
    let is = 0
    for (let j = 0; j < 256; j += 64) {
      const [s1, m1] = scaleMinK4(is, b, o + 4)
      const [s2, m2] = scaleMinK4(is + 1, b, o + 4)
      for (let l = 0; l < 32; l++) y[p++] = d * s1 * (b[q + l] & 0xf) - min * m1
      for (let l = 0; l < 32; l++) y[p++] = d * s2 * (b[q + l] >> 4) - min * m2
      q += 32
      is += 2
    }
  },
  Q5_K(b, o, y, p) {
    const d = h16(b, o)
    const min = h16(b, o + 2)
    const qh = o + 16
    let ql = o + 48
    let is = 0
    let u1 = 1
    let u2 = 2
    for (let j = 0; j < 256; j += 64) {
      const [s1, m1] = scaleMinK4(is, b, o + 4)
      const [s2, m2] = scaleMinK4(is + 1, b, o + 4)
      for (let l = 0; l < 32; l++) y[p++] = d * s1 * ((b[ql + l] & 0xf) + (b[qh + l] & u1 ? 16 : 0)) - min * m1
      for (let l = 0; l < 32; l++) y[p++] = d * s2 * ((b[ql + l] >> 4) + (b[qh + l] & u2 ? 16 : 0)) - min * m2
      ql += 32
      is += 2
      u1 <<= 2
      u2 <<= 2
    }
  },
  Q6_K(b, o, y, p) {
    const d = h16(b, o + 208)
    let ql = o
    let qh = o + 128
    let sc = o + 192
    for (let n = 0; n < 256; n += 128) {
      for (let l = 0; l < 32; l++) {
        const is = l >> 4
        const s = (k: number) => (b[sc + is + k] << 24) >> 24
        const q1 = ((b[ql + l] & 0xf) | (((b[qh + l] >> 0) & 3) << 4)) - 32
        const q2 = ((b[ql + l + 32] & 0xf) | (((b[qh + l] >> 2) & 3) << 4)) - 32
        const q3 = ((b[ql + l] >> 4) | (((b[qh + l] >> 4) & 3) << 4)) - 32
        const q4 = ((b[ql + l + 32] >> 4) | (((b[qh + l] >> 6) & 3) << 4)) - 32
        y[p + l] = d * s(0) * q1
        y[p + l + 32] = d * s(2) * q2
        y[p + l + 64] = d * s(4) * q3
        y[p + l + 96] = d * s(6) * q4
      }
      p += 128
      ql += 64
      qh += 32
      sc += 8
    }
  },
  Q8_K(b, o, y, p) {
    const d = new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true)
    for (let j = 0; j < 256; j++) y[p + j] = ((b[o + 4 + j] << 24) >> 24) * d
  },
  IQ4_NL(b, o, y, p) {
    const d = h16(b, o)
    for (let j = 0; j < 16; j++) {
      y[p + j] = d * KV_IQ4NL[b[o + 2 + j] & 0xf]
      y[p + j + 16] = d * KV_IQ4NL[b[o + 2 + j] >> 4]
    }
  },
  IQ4_XS(b, o, y, p) {
    const d = h16(b, o)
    const sh = b[o + 2] | (b[o + 3] << 8)
    let qs = o + 8
    for (let ib = 0; ib < 8; ib++) {
      const ls = ((b[o + 4 + (ib >> 1)] >> (4 * (ib & 1))) & 0xf) | (((sh >> (2 * ib)) & 3) << 4)
      const dl = d * (ls - 32)
      for (let j = 0; j < 16; j++) {
        y[p + j] = dl * KV_IQ4NL[b[qs + j] & 0xf]
        y[p + j + 16] = dl * KV_IQ4NL[b[qs + j] >> 4]
      }
      p += 32
      qs += 16
    }
  }
}

/** Names of the ggml types `dequantize` decodes. */
export const DECODED_TYPES = ['F32', 'F16', 'BF16', 'F64', 'I8', 'I16', 'I32', 'I64', ...Object.keys(DEQUANT)]

/** Decodes whole blocks of a ggml type to float32 (`bytes` holds `count` values, rounded up to whole
 *  blocks). Returns null for a type that is reported but not decoded. */
export function dequantize(type: string, bytes: Uint8Array, count: number): Float32Array | null {
  const id = Number(Object.keys(GGML_TYPES).find((k) => GGML_TYPES[Number(k)][0] === type))
  const info = GGML_TYPES[id]
  if (!info) return null
  const [, bs, ts, plain] = info
  const nBlocks = Math.min(Math.ceil(count / bs), Math.floor(bytes.length / ts))
  const n = Math.min(count, nBlocks * bs)
  if (plain) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const y = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const o = i * ts
      y[i] =
        plain === 'f32' ? v.getFloat32(o, true)
        : plain === 'f16' ? f16(v.getUint16(o, true))
        : plain === 'bf16' ? new Float32Array(new Uint32Array([v.getUint16(o, true) << 16]).buffer)[0]
        : plain === 'f64' ? v.getFloat64(o, true)
        : plain === 'i8' ? v.getInt8(o)
        : plain === 'i16' ? v.getInt16(o, true)
        : plain === 'i32' ? v.getInt32(o, true)
        : Number(v.getBigInt64(o, true))
    }
    return y
  }
  const fn = DEQUANT[type]
  if (!fn) return null
  const y = new Float32Array(nBlocks * bs)
  for (let k = 0; k < nBlocks; k++) fn(bytes, k * ts, y, k * bs)
  return n === y.length ? y : y.subarray(0, n)
}
