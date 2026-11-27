/** ByteSource helpers shared by the AI-model readers: sources over bytes or a File, and a small
 *  little-endian cursor. */
import type { ByteSource } from './ir.ts'

/** A source over bytes already in memory (the editor path). */
export function bytesSource(bytes: Uint8Array, name?: string): ByteSource {
  return {
    size: bytes.byteLength,
    name,
    read: async (offset, length) => bytes.subarray(Math.max(0, offset), Math.min(bytes.byteLength, offset + Math.max(0, length)))
  }
}

/** A source over a File/Blob read with `slice()` (the panel path: files of any size). */
export function fileSource(file: Blob & { name?: string }): ByteSource {
  return {
    size: file.size,
    name: file.name,
    read: async (offset, length) => {
      const end = Math.min(file.size, offset + Math.max(0, length))
      if (end <= offset) return new Uint8Array(0)
      return new Uint8Array(await file.slice(offset, end).arrayBuffer())
    }
  }
}

/** A window [offset, offset + size) of another source, as a source. */
export function subSource(src: ByteSource, offset: number, size: number): ByteSource {
  return {
    size,
    name: src.name,
    read: (o, n) => src.read(offset + Math.max(0, o), Math.max(0, Math.min(n, size - o)))
  }
}

/** Reads all of a (small) source. */
export function readAll(src: ByteSource): Promise<Uint8Array> {
  return src.read(0, src.size)
}

const latin1 = new TextDecoder('latin1')
const utf8 = new TextDecoder()

export function asciiOf(b: Uint8Array): string {
  return latin1.decode(b)
}

export function utf8Of(b: Uint8Array): string {
  return utf8.decode(b)
}

/** Little-endian cursor over a byte array; throws RangeError past the end. */
export class Cursor {
  pos = 0
  readonly view: DataView
  constructor(readonly bytes: Uint8Array, pos = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.pos = pos
  }
  get left(): number {
    return this.bytes.byteLength - this.pos
  }
  need(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.byteLength) throw new RangeError('truncated')
  }
  u8(): number {
    this.need(1)
    return this.bytes[this.pos++]
  }
  u16(): number {
    this.need(2)
    const v = this.view.getUint16(this.pos, true)
    this.pos += 2
    return v
  }
  u32(): number {
    this.need(4)
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  i32(): number {
    this.need(4)
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  /** Unsigned 64-bit as a number (exact up to 2^53). */
  u64(): number {
    const lo = this.u32()
    const hi = this.u32()
    return hi * 4294967296 + lo
  }
  i64(): number {
    this.need(8)
    const v = this.view.getBigInt64(this.pos, true)
    this.pos += 8
    return Number(v)
  }
  f32(): number {
    this.need(4)
    const v = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }
  f64(): number {
    this.need(8)
    const v = this.view.getFloat64(this.pos, true)
    this.pos += 8
    return v
  }
  take(n: number): Uint8Array {
    this.need(n)
    const v = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return v
  }
}
