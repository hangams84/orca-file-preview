/** Shared helpers for the ONNX/TFLite/GGUF/Keras/NumPy readers: bounded, page-cached random access
 *  over a ByteSource, dtype decoding, module trees and graph values. Every offset and length a file
 *  supplies goes through Src.check(), which refuses anything outside the file with a PreviewError. */
import { PreviewError } from '../../../core/types.ts'
import type { ByteSource, DType, Graph, GraphNode, GraphValue, ModelIR, ModuleNode, Note, TensorInfo, Value } from '../ir.ts'

/** A friendly refusal: `code` is the machine message, the hint is what the user reads. */
export function bad(code: string, hint: string): PreviewError {
  return new PreviewError(code, hint)
}

export function note(en: string, ko?: string, level: Note['level'] = 'info'): Note {
  return ko ? { level, en, ko } : { level, en }
}
export function warn(en: string, ko?: string): Note {
  return note(en, ko, 'warn')
}

const PAGE = 1 << 16
const MAX_PAGES = 256

/** Bounded, page-cached reader over a ByteSource. */
export class Src {
  readonly size: number
  private pages = new Map<number, Uint8Array>()
  constructor(
    readonly source: ByteSource,
    /** Prefix of the error codes (`onnx`, `gguf`, …). */
    readonly format: string
  ) {
    this.size = source.size
  }

  fail(what: string, hint?: string): PreviewError {
    return bad(`${this.format}-damaged`, hint ?? `The ${this.format.toUpperCase()} file is damaged or truncated (${what}).`)
  }

  check(off: number, len: number, what = 'data'): void {
    if (!Number.isSafeInteger(off) || !Number.isSafeInteger(len) || off < 0 || len < 0 || off + len > this.size)
      throw this.fail(`${what} at ${off}+${len} is outside the ${this.size}-byte file`)
  }

  /** Exactly `len` bytes at `off`. Small reads go through a page cache. */
  async bytes(off: number, len: number, what?: string): Promise<Uint8Array> {
    this.check(off, len, what)
    if (len === 0) return new Uint8Array(0)
    const p0 = Math.floor(off / PAGE)
    const p1 = Math.floor((off + len - 1) / PAGE)
    if (p1 - p0 > 3) return this.raw(off, len)
    if (p0 === p1) {
      const page = await this.page(p0)
      return page.subarray(off - p0 * PAGE, off - p0 * PAGE + len)
    }
    const out = new Uint8Array(len)
    for (let p = p0; p <= p1; p++) {
      const page = await this.page(p)
      const s = Math.max(off, p * PAGE)
      const e = Math.min(off + len, p * PAGE + page.length)
      out.set(page.subarray(s - p * PAGE, e - p * PAGE), s - off)
    }
    return out
  }

  /** Up to `len` bytes at `off`, clipped to the end of the file. */
  async upTo(off: number, len: number): Promise<Uint8Array> {
    if (off >= this.size || off < 0) return new Uint8Array(0)
    return this.bytes(off, Math.min(len, this.size - off))
  }

  async raw(off: number, len: number): Promise<Uint8Array> {
    this.check(off, len)
    const b = await this.source.read(off, len)
    if (b.length < len) throw this.fail(`short read at ${off}`)
    return b.length === len ? b : b.subarray(0, len)
  }

  private async page(p: number): Promise<Uint8Array> {
    let b = this.pages.get(p)
    if (b) return b
    const off = p * PAGE
    b = await this.raw(off, Math.min(PAGE, this.size - off))
    if (this.pages.size >= MAX_PAGES) this.pages.delete(this.pages.keys().next().value as number)
    this.pages.set(p, b)
    return b
  }

  /** TensorInfo.read for the bytes [off, off+len) of this source: checked now, read when called. */
  reader(off: number, len: number, what?: string): NonNullable<TensorInfo['read']> {
    this.check(off, len, what)
    return (range) => {
      if (!range) return this.raw(off, len)
      const s = Math.max(0, Math.min(len, range.offset))
      const n = Math.max(0, Math.min(len - s, range.length))
      return this.raw(off + s, n)
    }
  }
}

/** TensorInfo.read over bytes already in memory. */
export function memReader(b: Uint8Array): NonNullable<TensorInfo['read']> {
  return async (range) => {
    if (!range) return b
    const s = Math.max(0, Math.min(b.length, range.offset))
    return b.subarray(s, Math.min(b.length, s + Math.max(0, range.length)))
  }
}

export function dv(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength)
}

const utf8 = new TextDecoder('utf-8')
export function text(b: Uint8Array): string {
  return utf8.decode(b)
}

export function product(shape: readonly number[]): number {
  let n = 1
  for (const d of shape) n *= d
  return n
}

/** Keeps metadata arrays short for the views (≤ 64 items, then '…'). */
export function clip(values: Value[], limit = 64): Value[] {
  return values.length > limit ? [...values.slice(0, limit), `… (${values.length} items)`] : values
}

/** Element size in bytes of the canonical plain dtypes. */
export const DTYPE_SIZE: Record<string, number> = {
  f64: 8, f32: 4, f16: 2, bf16: 2, f8e4m3: 1, f8e5m2: 1,
  i64: 8, i32: 4, i16: 2, i8: 1, u64: 8, u32: 4, u16: 2, u8: 1,
  bool: 1, c64: 8, c128: 16
}

export function byteLen(shape: readonly number[], dtype: DType): number {
  const s = DTYPE_SIZE[dtype]
  return s ? product(shape) * s : 0
}

// ---- half floats (used by the readers' own decoders and tests) ----
export function f16(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const m = h & 0x3ff
  if (e === 0) return s * m * 2 ** -24
  if (e === 31) return m ? NaN : s * Infinity
  return s * (1 + m / 1024) * 2 ** (e - 15)
}

/** Module tree from separated tensor names. `group` may split a segment further (GGUF attn_q → attn). */
export function moduleTree(
  tensors: readonly { name: string }[],
  opts: { sep?: string | RegExp; rootName?: string; rootType?: string; inferred?: boolean; group?: (seg: string, depth: number, parts: string[]) => string[] } = {}
): ModuleNode {
  const sep = opts.sep ?? '.'
  const root: ModuleNode = { path: '', name: opts.rootName ?? 'model', type: opts.rootType, children: [], tensors: [], inferred: opts.inferred ?? true }
  const index = new Map<string, ModuleNode>([['', root]])
  for (const t of tensors) {
    let parts = t.name.split(sep).filter((p) => p !== '')
    if (opts.group) parts = parts.flatMap((p, i) => (i < parts.length - 1 ? opts.group!(p, i, parts) : [p]))
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('.')
      let child = index.get(path)
      if (!child) {
        child = { path, name: parts[i], children: [], tensors: [], inferred: opts.inferred ?? true }
        index.set(path, child)
        node.children.push(child)
      }
      node = child
    }
    node.tensors.push(t.name)
  }
  return root
}

/** Collects every value id a graph mentions, keeping the richer facts first seen in `known`. */
export function graphValues(nodes: readonly GraphNode[], inputs: readonly string[], outputs: readonly string[], known: Map<string, GraphValue>): GraphValue[] {
  const out = new Map<string, GraphValue>()
  const add = (id: string) => {
    if (!id || out.has(id)) return
    out.set(id, known.get(id) ?? { id })
  }
  inputs.forEach(add)
  for (const n of nodes) {
    n.inputs.forEach(add)
    n.outputs.forEach(add)
  }
  outputs.forEach(add)
  return [...out.values()]
}

export function emptyGraph(name?: string): Graph {
  return { name, nodes: [], values: [], inputs: [], outputs: [] }
}

/** Bounded recursion depth for nested structures (subgraphs, HDF5 groups, nested dtypes). */
export const MAX_DEPTH = 32

/** Counts work units and gives the event loop a turn now and then, so huge files stay responsive. */
export async function yieldEvery(i: number, every = 2000): Promise<void> {
  if (i > 0 && i % every === 0) await new Promise((r) => setTimeout(r, 0))
}

/** Forward reader over a Src for long variable-length headers (GGUF key-values): `need(n)` makes
 *  the next n bytes available (loading ahead in 1 MiB windows), then the getters read synchronously. */
export class Stream {
  pos: number
  private buf: Uint8Array = new Uint8Array(0)
  private bufAt = 0
  private view: DataView = new DataView(this.buf.buffer)
  le = true
  constructor(
    readonly src: Src,
    pos = 0,
    /** Read-ahead size: large for dense headers (GGUF), small where big fields are skipped (ONNX). */
    readonly window = 1 << 20
  ) {
    this.pos = pos
  }
  async need(n: number, what?: string): Promise<void> {
    this.src.check(this.pos, n, what)
    if (this.pos >= this.bufAt && this.pos + n <= this.bufAt + this.buf.length) return
    const len = Math.min(this.src.size - this.pos, Math.max(n, this.window))
    this.buf = await this.src.raw(this.pos, len)
    this.bufAt = this.pos
    this.view = dv(this.buf)
  }
  private at(n: number): number {
    const o = this.pos - this.bufAt
    if (o < 0 || o + n > this.buf.length) throw this.src.fail(`read past the loaded window at ${this.pos}`)
    this.pos += n
    return o
  }
  u8(): number {
    return this.buf[this.at(1)]
  }
  i8(): number {
    return (this.u8() << 24) >> 24
  }
  u16(): number {
    return this.view.getUint16(this.at(2), this.le)
  }
  i16(): number {
    return this.view.getInt16(this.at(2), this.le)
  }
  u32(): number {
    return this.view.getUint32(this.at(4), this.le)
  }
  i32(): number {
    return this.view.getInt32(this.at(4), this.le)
  }
  u64(): bigint {
    return this.view.getBigUint64(this.at(8), this.le)
  }
  i64(): bigint {
    return this.view.getBigInt64(this.at(8), this.le)
  }
  f32(): number {
    return this.view.getFloat32(this.at(4), this.le)
  }
  f64(): number {
    return this.view.getFloat64(this.at(8), this.le)
  }
  take(n: number): Uint8Array {
    const o = this.at(n)
    return this.buf.subarray(o, o + n)
  }
  skip(n: number): void {
    this.src.check(this.pos, n)
    this.pos += n
  }
}

/** A bigint as a number when exact, else kept as bigint (Value allows both). */
export function big(v: bigint): number | bigint {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v
}

/** A PreviewError for anything a damaged file made a reader throw. */
export function asPreview(format: string, e: unknown): PreviewError {
  if (e instanceof PreviewError) return e
  const why = e instanceof Error ? e.message : String(e)
  return bad(`${format}-damaged`, `The ${format.toUpperCase()} file is damaged or truncated (${why}).`)
}

/** Runs a reader so that every failure, now or in a later TensorInfo.read, is a PreviewError. */
export async function guarded(format: string, run: () => Promise<ModelIR>): Promise<ModelIR> {
  let ir: ModelIR
  try {
    ir = await run()
  } catch (e) {
    throw asPreview(format, e)
  }
  for (const t of ir.tensors) {
    const r = t.read
    if (!r) continue
    t.read = async (range) => {
      try {
        return await r(range)
      } catch (e) {
        throw asPreview(format, e)
      }
    }
  }
  return ir
}
