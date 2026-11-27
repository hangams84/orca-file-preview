/** Element types: sizes, labels and decoding of raw bytes to numbers. */
import type { DType } from './ir.ts'

/** Bytes per element; 0 when unknown or packed (GGUF quant blocks, int4). */
export const ELEMENT_BYTES: Record<string, number> = {
  f64: 8, f32: 4, f16: 2, bf16: 2, f8e4m3: 1, f8e5m2: 1, f8e4m3fnuz: 1, f8e5m2fnuz: 1,
  i64: 8, i32: 4, i16: 2, i8: 1, u64: 8, u32: 4, u16: 2, u8: 1, bool: 1,
  c32: 4, c64: 8, c128: 16, qint8: 1, quint8: 1, qint32: 4, quint4x2: 1, quint2x4: 1
}

export function elementBytes(dtype: DType): number {
  return ELEMENT_BYTES[dtype] ?? 0
}

/** True when `decode` can turn the dtype into numbers. */
export function decodable(dtype: DType): boolean {
  return dtype in ELEMENT_BYTES && dtype !== 'quint4x2' && dtype !== 'quint2x4' && dtype !== 'c32'
}

export function numel(shape: readonly number[]): number {
  let n = 1
  for (const d of shape) n *= d
  return n
}

const f16Table = (() => {
  const t = new Float32Array(65536)
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1
    const e = (h >> 10) & 0x1f
    const m = h & 0x3ff
    t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15)
  }
  return t
})()

export function f16ToNumber(h: number): number {
  return f16Table[h & 0xffff]
}

function f8e4m3(b: number): number {
  const s = b & 0x80 ? -1 : 1
  const e = (b >> 3) & 0xf
  const m = b & 7
  if (e === 15 && m === 7) return NaN
  return e === 0 ? s * m * 2 ** -9 : s * (1 + m / 8) * 2 ** (e - 7)
}

function f8e5m2(b: number): number {
  return f16ToNumber(b << 8)
}

/** Decodes raw bytes (whole elements) to numbers. Complex types yield the magnitude. Quantized types
 *  yield the stored integers (apply scale/zero point separately). */
export function decode(bytes: Uint8Array, dtype: DType, byteOrder: 'little' | 'big' = 'little'): Float64Array | Float32Array {
  const size = elementBytes(dtype) || 1
  const n = Math.floor(bytes.byteLength / size)
  const le = byteOrder === 'little'
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * size)
  const out = dtype === 'f64' || dtype === 'i64' || dtype === 'u64' || dtype === 'c128' ? new Float64Array(n) : new Float32Array(n)
  switch (dtype) {
    case 'f32':
      if (le && bytes.byteOffset % 4 === 0) out.set(new Float32Array(bytes.buffer, bytes.byteOffset, n))
      else for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, le)
      break
    case 'f64':
      for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, le)
      break
    case 'f16':
      for (let i = 0; i < n; i++) out[i] = f16Table[dv.getUint16(i * 2, le)]
      break
    case 'bf16': {
      const f = new Float32Array(1)
      const u = new Uint32Array(f.buffer)
      for (let i = 0; i < n; i++) {
        u[0] = dv.getUint16(i * 2, le) << 16
        out[i] = f[0]
      }
      break
    }
    case 'f8e4m3':
    case 'f8e4m3fnuz':
      for (let i = 0; i < n; i++) out[i] = f8e4m3(bytes[i])
      break
    case 'f8e5m2':
    case 'f8e5m2fnuz':
      for (let i = 0; i < n; i++) out[i] = f8e5m2(bytes[i])
      break
    case 'i64':
      for (let i = 0; i < n; i++) out[i] = Number(dv.getBigInt64(i * 8, le))
      break
    case 'u64':
      for (let i = 0; i < n; i++) out[i] = Number(dv.getBigUint64(i * 8, le))
      break
    case 'i32':
    case 'qint32':
      for (let i = 0; i < n; i++) out[i] = dv.getInt32(i * 4, le)
      break
    case 'u32':
      for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, le)
      break
    case 'i16':
      for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, le)
      break
    case 'u16':
      for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, le)
      break
    case 'i8':
    case 'qint8':
      for (let i = 0; i < n; i++) out[i] = (bytes[i] << 24) >> 24
      break
    case 'u8':
    case 'quint8':
      for (let i = 0; i < n; i++) out[i] = bytes[i]
      break
    case 'bool':
      for (let i = 0; i < n; i++) out[i] = bytes[i] ? 1 : 0
      break
    case 'c64':
      for (let i = 0; i < n; i++) out[i] = Math.hypot(dv.getFloat32(i * 8, le), dv.getFloat32(i * 8 + 4, le))
      break
    case 'c128':
      for (let i = 0; i < n; i++) out[i] = Math.hypot(dv.getFloat64(i * 16, le), dv.getFloat64(i * 16 + 8, le))
      break
    default:
      return new Float32Array(0)
  }
  return out
}

export interface TensorStats {
  count: number
  min: number
  max: number
  mean: number
  std: number
  zeros: number
  nan: number
  inf: number
}

export function stats(v: ArrayLike<number>): TensorStats {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sq = 0
  let zeros = 0
  let nan = 0
  let inf = 0
  let n = 0
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (x !== x) {
      nan++
      continue
    }
    if (x === Infinity || x === -Infinity) {
      inf++
      continue
    }
    if (x === 0) zeros++
    if (x < min) min = x
    if (x > max) max = x
    sum += x
    sq += x * x
    n++
  }
  const mean = n ? sum / n : 0
  return { count: v.length, min: n ? min : NaN, max: n ? max : NaN, mean, std: n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0, zeros, nan, inf }
}

export function histogram(v: ArrayLike<number>, bins: number, min: number, max: number): number[] {
  const h = new Array<number>(bins).fill(0)
  const span = max - min || 1
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (!Number.isFinite(x)) continue
    let b = Math.floor(((x - min) / span) * bins)
    if (b >= bins) b = bins - 1
    if (b < 0) b = 0
    h[b]++
  }
  return h
}

/** Short label for a dtype chip. */
export function dtypeLabel(dtype: DType): string {
  return dtype
}
