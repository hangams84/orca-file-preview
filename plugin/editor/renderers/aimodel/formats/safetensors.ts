/** safetensors reader: an 8-byte little-endian header length N, a JSON header of N bytes
 *  (`{name: {dtype, shape, data_offsets: [begin, end]}, "__metadata__": {…}}`), then the raw data.
 *  Only the header is read up front; tensor values are ranged reads. */
import { PreviewError } from '../../../core/types.ts'
import { utf8Of } from '../bytes.ts'
import { elementBytes, numel } from '../dtype.ts'
import type { ByteSource, ModelIR, TensorInfo, Value } from '../ir.ts'

const DTYPES: Record<string, string> = {
  F64: 'f64', F32: 'f32', F16: 'f16', BF16: 'bf16', F8_E4M3: 'f8e4m3', F8_E5M2: 'f8e5m2',
  I64: 'i64', I32: 'i32', I16: 'i16', I8: 'i8', U64: 'u64', U32: 'u32', U16: 'u16', U8: 'u8', BOOL: 'bool', C64: 'c64'
}

/** Most header bytes accepted (the format itself caps it at 100 MB). */
const MAX_HEADER = 100 * 1024 * 1024

export async function read(src: ByteSource): Promise<ModelIR> {
  if (src.size < 10) throw new PreviewError('st-short', 'The file is too short to be a safetensors file.')
  const lenBytes = await src.read(0, 8)
  const n = Number(new DataView(lenBytes.buffer, lenBytes.byteOffset, 8).getBigUint64(0, true))
  if (n < 2 || n > MAX_HEADER || 8 + n > src.size) throw new PreviewError('st-bad-header', 'The safetensors header length is invalid: the file is truncated or not safetensors.')
  let header: Record<string, unknown>
  try {
    header = JSON.parse(utf8Of(await src.read(8, n)))
  } catch {
    throw new PreviewError('st-bad-json', 'The safetensors header is not valid JSON.')
  }
  const dataStart = 8 + n
  const metadata: Record<string, Value> = {}
  const tensors: TensorInfo[] = []
  const notes: ModelIR['notes'] = []
  for (const [name, v] of Object.entries(header)) {
    if (name === '__metadata__') {
      for (const [k, x] of Object.entries((v ?? {}) as Record<string, unknown>)) metadata[k] = String(x)
      continue
    }
    const e = v as { dtype?: string; shape?: number[]; data_offsets?: [number, number] }
    const dtype = DTYPES[e.dtype ?? ''] ?? String(e.dtype ?? '?').toLowerCase()
    const shape = Array.isArray(e.shape) ? e.shape.map(Number) : []
    const [b, end] = Array.isArray(e.data_offsets) ? e.data_offsets.map(Number) : [0, 0]
    const byteLength = end - b
    const t: TensorInfo = { name, shape, dtype, byteLength, attrs: { data_offsets: [b, end] } }
    if (elementBytes(dtype) && byteLength !== numel(shape) * elementBytes(dtype)) t.attrs!['warning'] = 'size does not match shape'
    if (dataStart + end > src.size) t.attrs!['warning'] = 'data beyond end of file'
    else
      t.read = (r) => {
        const off = r?.offset ?? 0
        return src.read(dataStart + b + off, Math.min(r?.length ?? byteLength, byteLength - off))
      }
    tensors.push(t)
  }
  // Header order is alphabetical; show tensors in file order.
  tensors.sort((a, b) => (a.attrs!['data_offsets'] as number[])[0] - (b.attrs!['data_offsets'] as number[])[0])
  if (tensors.some((t) => t.attrs?.['warning'] === 'data beyond end of file')) notes.push({ level: 'warn', en: 'The file is truncated: some tensors have no data.', ko: '파일이 잘려 일부 텐서에 데이터가 없습니다.' })
  notes.push({ level: 'info', en: 'safetensors stores tensors and string metadata only: the module tree is inferred from the names and there is no graph.', ko: 'safetensors에는 텐서와 문자열 메타데이터만 있어 모듈 트리는 이름에서 추론하며 그래프는 없습니다.' })
  return { format: 'safetensors', formatLabel: 'safetensors', framework: metadata['format'] === 'pt' ? 'pytorch' : metadata['format'] ? String(metadata['format']) : undefined, metadata, tensors, notes }
}
