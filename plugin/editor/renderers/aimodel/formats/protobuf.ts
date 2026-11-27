/** Protocol-buffers wire format, read forward through a Stream so that big `bytes` fields (ONNX
 *  raw_data) are skipped, not loaded: callers get their absolute offset and read them later.
 *  Every length is bounded by the enclosing message and the file size. */
import { big, Src, Stream, text } from './common.ts'

export const VARINT = 0
export const I64 = 1
export const LEN = 2
export const I32 = 5

export class Pb {
  readonly s: Stream
  constructor(readonly src: Src, pos = 0) {
    this.s = new Stream(src, pos)
  }
  get pos(): number {
    return this.s.pos
  }

  /** Next field tag: [field number, wire type]. */
  async tag(end: number): Promise<[number, number]> {
    const t = await this.varnum(end)
    const field = Math.floor(t / 8)
    const wire = t & 7
    if (field === 0 || wire === 3 || wire === 4 || wire > 5) throw this.src.fail(`bad protobuf tag ${t} at ${this.pos}`)
    return [field, wire]
  }

  /** A varint as a bigint (exact, unsigned 64-bit). */
  async varbig(end: number): Promise<bigint> {
    await this.s.need(Math.min(10, end - this.s.pos), 'varint')
    let v = 0n
    let shift = 0n
    for (let i = 0; i < 10; i++) {
      if (this.s.pos >= end) throw this.src.fail('truncated varint')
      const b = this.s.u8()
      v |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) return v & 0xffffffffffffffffn
      shift += 7n
    }
    throw this.src.fail('varint too long')
  }

  /** A small unsigned varint as a number (lengths, tags, enums). */
  async varnum(end: number): Promise<number> {
    await this.s.need(Math.min(10, end - this.s.pos), 'varint')
    let v = 0
    let mul = 1
    for (let i = 0; i < 10; i++) {
      if (this.s.pos >= end) throw this.src.fail('truncated varint')
      const b = this.s.u8()
      v += (b & 0x7f) * mul
      if (!(b & 0x80)) {
        if (!Number.isSafeInteger(v)) throw this.src.fail('varint out of range')
        return v
      }
      mul *= 128
    }
    throw this.src.fail('varint too long')
  }

  /** int64 (two's complement) as number when exact, else bigint. */
  async int64(end: number): Promise<number | bigint> {
    const u = await this.varbig(end)
    return big(u >= 1n << 63n ? u - (1n << 64n) : u)
  }
  async int32(end: number): Promise<number> {
    const v = await this.int64(end)
    return Number(v) | 0
  }

  /** Length of a LEN field, checked against the enclosing end. Returns [start, end]. */
  async len(end: number): Promise<[number, number]> {
    const n = await this.varnum(end)
    const start = this.s.pos
    if (start + n > end) throw this.src.fail(`field of ${n} bytes overruns its message at ${start}`)
    return [start, start + n]
  }

  async bytes(end: number): Promise<Uint8Array> {
    const [s, e] = await this.len(end)
    await this.s.need(e - s)
    return this.s.take(e - s).slice()
  }
  async string(end: number): Promise<string> {
    return text(await this.bytes(end))
  }
  async f32(): Promise<number> {
    await this.s.need(4)
    return this.s.f32()
  }
  async f64(): Promise<number> {
    await this.s.need(8)
    return this.s.f64()
  }

  /** Moves to `pos` (after a skipped or sub-parsed field). */
  seek(pos: number): void {
    this.src.check(pos, 0)
    this.s.pos = pos
  }

  async skip(wire: number, end: number): Promise<void> {
    switch (wire) {
      case VARINT:
        await this.varbig(end)
        return
      case I64:
        this.need(8, end)
        this.s.skip(8)
        return
      case I32:
        this.need(4, end)
        this.s.skip(4)
        return
      case LEN: {
        const [, e] = await this.len(end)
        this.seek(e)
        return
      }
    }
    throw this.src.fail(`wire type ${wire}`)
  }

  private need(n: number, end: number): void {
    if (this.s.pos + n > end) throw this.src.fail('truncated field')
  }

  /** Repeated scalar values: packed (one LEN field) or one value per field. */
  async packed<T>(wire: number, end: number, one: (end: number) => Promise<T>): Promise<T[]> {
    if (wire !== LEN) return [await one(end)]
    const [, e] = await this.len(end)
    const out: T[] = []
    while (this.s.pos < e) out.push(await one(e))
    if (this.s.pos !== e) throw this.src.fail('packed field overruns its length')
    return out
  }
}
