/** Reading tensor values for the inspector without loading whole tensors: evenly spaced chunk
 *  samples for statistics, row samples for heatmaps, leading kernels for conv grids. */
import { decodable, decode, elementBytes, numel } from './dtype.ts'
import type { TensorInfo } from './ir.ts'

export interface Sample {
  values: Float32Array | Float64Array
  /** True when only part of the tensor was read. */
  sampled: boolean
  /** Bytes read. */
  bytes: number
}

/** Values for statistics/histograms: all of the tensor up to `budget` bytes, else `chunks` evenly
 *  spaced chunks totalling about `budget`. */
export async function sampleValues(t: TensorInfo, budget = 4 * 1024 * 1024, chunks = 64): Promise<Sample> {
  if (t.read && !decodable(t.dtype) && t.decode) {
    // Block formats (GGUF quants): the whole tensor up to the budget, else its leading blocks.
    const { blockBytes, blockElems, fn } = t.decode
    const blocks = Math.max(1, Math.floor(Math.min(t.byteLength, budget) / blockBytes))
    const b = await t.read({ offset: 0, length: blocks * blockBytes })
    const v = fn(b, Math.min(numel(t.shape), blocks * blockElems)) ?? new Float32Array(0)
    return { values: v, sampled: blocks * blockBytes < t.byteLength, bytes: b.byteLength }
  }
  if (!t.read || !decodable(t.dtype)) return { values: new Float32Array(0), sampled: false, bytes: 0 }
  const es = elementBytes(t.dtype)
  const total = Math.min(t.byteLength, numel(t.shape) * es)
  if (total <= budget) {
    const b = await t.read()
    return { values: dequant(t, decode(b, t.dtype, t.byteOrder)), sampled: false, bytes: b.byteLength }
  }
  const chunk = Math.max(es, Math.floor(budget / chunks / es) * es)
  const parts: Uint8Array[] = []
  let size = 0
  for (let i = 0; i < chunks; i++) {
    const off = Math.floor(((total - chunk) * i) / Math.max(1, chunks - 1) / es) * es
    const b = await t.read({ offset: off, length: chunk })
    parts.push(b)
    size += b.byteLength
  }
  const all = new Uint8Array(size)
  let p = 0
  for (const b of parts) {
    all.set(b, p)
    p += b.byteLength
  }
  return { values: dequant(t, decode(all, t.dtype, t.byteOrder)), sampled: true, bytes: size }
}

/** Per-tensor affine dequantization when scale/zero point are known (one value each). */
function dequant(t: TensorInfo, v: Float32Array | Float64Array): Float32Array | Float64Array {
  const s = t.quant?.scale
  const z = t.quant?.zeroPoint
  if (!s || s.length !== 1 || t.quant?.axis !== undefined) return v
  const zp = z?.[0] ?? 0
  for (let i = 0; i < v.length; i++) v[i] = (v[i] - zp) * s[0]
  return v
}

export interface Grid {
  rows: number
  cols: number
  values: Float32Array
  /** Source rows/cols the grid covers (for labels). */
  srcRows: number
  srcCols: number
  note?: string
}

/** A rows×cols view of a tensor (2-D as is; N-D as shape[0] × rest; 1-D as a single row) downsampled
 *  to at most maxRows×maxCols by picking evenly spaced rows and columns. */
export async function heatmapGrid(t: TensorInfo, maxRows = 256, maxCols = 512, fullBudget = 16 * 1024 * 1024): Promise<Grid | null> {
  if (t.read && t.decode && !decodable(t.dtype) && t.shape.length) {
    // Block formats: rows of the leading blocks we can afford to decode.
    const s = await sampleValues(t, fullBudget / 4)
    const srcCols = t.shape.length === 1 ? Math.max(1, s.values.length) : Math.max(1, numel(t.shape) / t.shape[0])
    const srcRows = Math.max(1, Math.floor(s.values.length / srcCols))
    const rows = Math.min(maxRows, srcRows)
    const cols = Math.min(maxCols, srcCols)
    const out = new Float32Array(rows * cols)
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[i * cols + j] = s.values[Math.floor((i * srcRows) / rows) * srcCols + Math.floor((j * srcCols) / cols)] ?? NaN
    return { rows, cols, values: out, srcRows, srcCols, note: s.sampled ? 'leading-rows' : undefined }
  }
  if (!t.read || !decodable(t.dtype) || !t.shape.length) return null
  const es = elementBytes(t.dtype)
  const srcRows = t.shape.length === 1 ? 1 : t.shape[0]
  const srcCols = Math.max(1, numel(t.shape) / Math.max(1, srcRows))
  const rows = Math.min(maxRows, srcRows)
  const cols = Math.min(maxCols, srcCols)
  const rowIdx = Array.from({ length: rows }, (_, i) => Math.floor((i * srcRows) / rows))
  const colIdx = Array.from({ length: cols }, (_, i) => Math.floor((i * srcCols) / cols))
  const out = new Float32Array(rows * cols)
  let note: string | undefined
  if (t.byteLength <= fullBudget) {
    const v = dequant(t, decode(await t.read(), t.dtype, t.byteOrder))
    rowIdx.forEach((r, i) => colIdx.forEach((c, j) => (out[i * cols + j] = v[r * srcCols + c] ?? NaN)))
  } else {
    const rowBytes = srcCols * es
    for (let i = 0; i < rows; i++) {
      const base = rowIdx[i] * rowBytes
      if (rowBytes <= 256 * 1024) {
        const v = dequant(t, decode(await t.read({ offset: base, length: rowBytes }), t.dtype, t.byteOrder))
        colIdx.forEach((c, j) => (out[i * cols + j] = v[c] ?? NaN))
      } else {
        // Very long rows: read the leading columns only.
        const v = dequant(t, decode(await t.read({ offset: base, length: cols * es }), t.dtype, t.byteOrder))
        for (let j = 0; j < cols; j++) out[i * cols + j] = v[j] ?? NaN
        note = 'leading-columns'
      }
    }
  }
  return { rows, cols, values: out, srcRows, srcCols, note }
}

export interface Kernels {
  outs: number
  ins: number
  kh: number
  kw: number
  /** outs × ins × kh × kw values. */
  values: Float32Array
}

/** The first `maxOut` × `maxIn` kernels of a 4-D conv weight [out, in, kh, kw]. */
export async function convKernels(t: TensorInfo, maxOut = 64, maxIn = 16): Promise<Kernels | null> {
  if (!t.read || !decodable(t.dtype) || t.shape.length !== 4) return null
  const [O, I, kh, kw] = t.shape
  if (kh * kw > 15 * 15) return null
  const es = elementBytes(t.dtype)
  const outs = Math.min(O, maxOut)
  const ins = Math.min(I, maxIn)
  const k = kh * kw
  const values = new Float32Array(outs * ins * k)
  for (let o = 0; o < outs; o++) {
    const b = await t.read({ offset: o * I * k * es, length: ins * k * es })
    const v = dequant(t, decode(b, t.dtype, t.byteOrder))
    values.set(v.subarray(0, ins * k), o * ins * k)
  }
  return { outs, ins, kh, kw, values }
}
