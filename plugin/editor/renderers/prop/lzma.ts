/** LZMA and LZMA2 decoders for 7z archives (EPLAN .edz / .zw1 are 7z). Written from the LZMA
 *  specification in the public-domain LZMA SDK (lzma-specification.txt). The output size is always
 *  known in 7z, so the decoder writes straight into the output buffer and uses it as the window. */

export class LzmaError extends Error {}

const PROB_INIT = 1024
const NUM_STATES = 12
const POS_STATES_MAX = 16
const END_POS_MODEL_INDEX = 14
const NUM_FULL_DISTANCES = 128
const NUM_ALIGN_BITS = 4
const MATCH_MIN_LEN = 2

class RangeDecoder {
  range = 0
  code = 0
  pos = 0
  end = 0
  private readonly src: Uint8Array
  constructor(src: Uint8Array) {
    this.src = src
  }

  init(start: number, end: number): void {
    this.pos = start
    this.end = end
    if (this.src[this.pos++] !== 0) throw new LzmaError('lzma: bad range coder start')
    this.range = 0xffffffff
    this.code = 0
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.byte()) >>> 0
    if (this.code === this.range) throw new LzmaError('lzma: bad range coder code')
  }

  private byte(): number {
    // Past the end, feed zeros: a truncated stream then fails the size or end checks instead of
    // reading out of bounds.
    return this.pos < this.end ? this.src[this.pos++] : (this.pos++, 0)
  }

  bit(probs: Uint16Array, i: number): number {
    const p = probs[i]
    const bound = (this.range >>> 11) * p
    let bit: number
    if (this.code < bound) {
      this.range = bound
      probs[i] = p + ((2048 - p) >>> 5)
      bit = 0
    } else {
      this.code -= bound
      this.range -= bound
      probs[i] = p - (p >>> 5)
      bit = 1
    }
    if (this.range < 0x1000000) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.byte()) >>> 0
    }
    return bit
  }

  direct(numBits: number): number {
    let res = 0
    while (numBits-- > 0) {
      this.range >>>= 1
      let b = 0
      if (this.code >= this.range) {
        this.code -= this.range
        b = 1
      }
      res = ((res << 1) | b) >>> 0
      if (this.range < 0x1000000) {
        this.range = (this.range << 8) >>> 0
        this.code = ((this.code << 8) | this.byte()) >>> 0
      }
    }
    return res
  }

  tree(probs: Uint16Array, base: number, numBits: number): number {
    let m = 1
    for (let i = 0; i < numBits; i++) m = (m << 1) + this.bit(probs, base + m)
    return m - (1 << numBits)
  }

  reverse(probs: Uint16Array, base: number, numBits: number): number {
    let m = 1
    let sym = 0
    for (let i = 0; i < numBits; i++) {
      const b = this.bit(probs, base + m)
      m = (m << 1) + b
      sym |= b << i
    }
    return sym
  }

  get finishedOk(): boolean {
    return this.code === 0
  }
}

class LenDecoder {
  choice = new Uint16Array(2)
  low = new Uint16Array(POS_STATES_MAX << 3)
  mid = new Uint16Array(POS_STATES_MAX << 3)
  high = new Uint16Array(256)
  reset(): void {
    this.choice.fill(PROB_INIT)
    this.low.fill(PROB_INIT)
    this.mid.fill(PROB_INIT)
    this.high.fill(PROB_INIT)
  }
  decode(rc: RangeDecoder, posState: number): number {
    if (rc.bit(this.choice, 0) === 0) return rc.tree(this.low, posState << 3, 3)
    if (rc.bit(this.choice, 1) === 0) return 8 + rc.tree(this.mid, posState << 3, 3)
    return 16 + rc.tree(this.high, 0, 8)
  }
}

export interface LzmaProps {
  lc: number
  lp: number
  pb: number
}

export function parseLzmaPropsByte(d: number): LzmaProps {
  if (d >= 9 * 5 * 5) throw new LzmaError('lzma: bad properties')
  const lc = d % 9
  d = (d / 9) | 0
  return { lc, lp: d % 5, pb: (d / 5) | 0 }
}

/** One LZMA decoder state; the output buffer doubles as the dictionary. */
class LzmaDecoder {
  lc = 0
  lp = 0
  pb = 0
  literal = new Uint16Array(0x300)
  isMatch = new Uint16Array(NUM_STATES << 4)
  isRep = new Uint16Array(NUM_STATES)
  isRepG0 = new Uint16Array(NUM_STATES)
  isRepG1 = new Uint16Array(NUM_STATES)
  isRepG2 = new Uint16Array(NUM_STATES)
  isRep0Long = new Uint16Array(NUM_STATES << 4)
  posSlot = new Uint16Array(4 << 6)
  posSpecial = new Uint16Array(1 + NUM_FULL_DISTANCES - END_POS_MODEL_INDEX)
  align = new Uint16Array(1 << NUM_ALIGN_BITS)
  lenDec = new LenDecoder()
  repLenDec = new LenDecoder()
  state = 0
  rep0 = 0
  rep1 = 0
  rep2 = 0
  rep3 = 0
  /** Output position where the current dictionary starts (LZMA2 dictionary resets). */
  dictStart = 0

  readonly out: Uint8Array
  readonly rc: RangeDecoder
  constructor(out: Uint8Array, rc: RangeDecoder) {
    this.out = out
    this.rc = rc
  }

  setProps(p: LzmaProps): void {
    if (p.lc > 8 || p.lp > 4 || p.pb > 4) throw new LzmaError('lzma: bad properties')
    this.lc = p.lc
    this.lp = p.lp
    this.pb = p.pb
    const n = 0x300 << (p.lc + p.lp)
    if (this.literal.length !== n) this.literal = new Uint16Array(n)
  }

  resetState(): void {
    this.literal.fill(PROB_INIT)
    this.isMatch.fill(PROB_INIT)
    this.isRep.fill(PROB_INIT)
    this.isRepG0.fill(PROB_INIT)
    this.isRepG1.fill(PROB_INIT)
    this.isRepG2.fill(PROB_INIT)
    this.isRep0Long.fill(PROB_INIT)
    this.posSlot.fill(PROB_INIT)
    this.posSpecial.fill(PROB_INIT)
    this.align.fill(PROB_INIT)
    this.lenDec.reset()
    this.repLenDec.reset()
    this.state = 0
    this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0
  }

  /** Decodes from `pos` until `end` bytes are written (or an end marker). Returns the new position. */
  decode(pos: number, end: number, allowEndMarker: boolean): number {
    const { out, rc } = this
    const lcShift = 8 - this.lc
    const lpMask = (1 << this.lp) - 1
    const pbMask = (1 << this.pb) - 1
    const lc = this.lc
    let state = this.state
    let rep0 = this.rep0
    let rep1 = this.rep1
    let rep2 = this.rep2
    let rep3 = this.rep3
    const dictStart = this.dictStart
    while (pos < end) {
      const posState = pos & pbMask
      if (rc.bit(this.isMatch, (state << 4) + posState) === 0) {
        const prev = pos > dictStart ? out[pos - 1] : 0
        const base = 0x300 * (((pos & lpMask) << lc) + (prev >>> lcShift))
        let sym = 1
        if (state >= 7) {
          let matchByte = out[pos - rep0 - 1]
          while (sym < 0x100) {
            const matchBit = (matchByte >>> 7) & 1
            matchByte <<= 1
            const b = rc.bit(this.literal, base + ((1 + matchBit) << 8) + sym)
            sym = (sym << 1) | b
            if (matchBit !== b) break
          }
        }
        while (sym < 0x100) sym = (sym << 1) | rc.bit(this.literal, base + sym)
        out[pos++] = sym & 0xff
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
        continue
      }
      let len: number
      if (rc.bit(this.isRep, state) !== 0) {
        if (pos === dictStart) throw new LzmaError('lzma: repeat before any data')
        if (rc.bit(this.isRepG0, state) === 0) {
          if (rc.bit(this.isRep0Long, (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11
            out[pos] = out[pos - rep0 - 1]
            pos++
            continue
          }
        } else {
          let dist: number
          if (rc.bit(this.isRepG1, state) === 0) {
            dist = rep1
          } else {
            if (rc.bit(this.isRepG2, state) === 0) {
              dist = rep2
            } else {
              dist = rep3
              rep3 = rep2
            }
            rep2 = rep1
          }
          rep1 = rep0
          rep0 = dist
        }
        len = this.repLenDec.decode(rc, posState)
        state = state < 7 ? 8 : 11
      } else {
        rep3 = rep2
        rep2 = rep1
        rep1 = rep0
        len = this.lenDec.decode(rc, posState)
        state = state < 7 ? 7 : 10
        rep0 = this.decodeDistance(len)
        if (rep0 === 0xffffffff) {
          if (!allowEndMarker && pos < end) throw new LzmaError('lzma: early end marker')
          this.state = state
          return pos
        }
        if (rep0 >= pos - dictStart) throw new LzmaError('lzma: distance beyond the data')
      }
      len += MATCH_MIN_LEN
      if (len > end - pos) throw new LzmaError('lzma: data past the declared size')
      const from = pos - rep0 - 1
      for (let i = 0; i < len; i++) out[pos + i] = out[from + i]
      pos += len
    }
    this.state = state
    this.rep0 = rep0
    this.rep1 = rep1
    this.rep2 = rep2
    this.rep3 = rep3
    return pos
  }

  private decodeDistance(len: number): number {
    const rc = this.rc
    const lenState = len > 3 ? 3 : len
    const slot = rc.tree(this.posSlot, lenState << 6, 6)
    if (slot < 4) return slot
    const numDirect = (slot >>> 1) - 1
    let dist = ((2 | (slot & 1)) << numDirect) >>> 0
    if (slot < END_POS_MODEL_INDEX) {
      dist += rc.reverse(this.posSpecial, dist - slot, numDirect)
    } else {
      dist = (dist + ((rc.direct(numDirect - NUM_ALIGN_BITS) << NUM_ALIGN_BITS) >>> 0)) >>> 0
      dist = (dist + rc.reverse(this.align, 0, NUM_ALIGN_BITS)) >>> 0
    }
    return dist
  }
}

/** Raw LZMA (7z coder 03 01 01): `props` are the 5 coder property bytes. */
export function decodeLzma(src: Uint8Array, props: Uint8Array, outSize: number): Uint8Array {
  if (props.length < 5) throw new LzmaError('lzma: short properties')
  const out = new Uint8Array(outSize)
  const rc = new RangeDecoder(src)
  rc.init(0, src.length)
  const dec = new LzmaDecoder(out, rc)
  dec.setProps(parseLzmaPropsByte(props[0]))
  dec.resetState()
  const pos = dec.decode(0, outSize, true)
  if (pos !== outSize) throw new LzmaError('lzma: stream ended early')
  return out
}

/** LZMA2 (7z coder 21): a sequence of LZMA and stored chunks. */
export function decodeLzma2(src: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize)
  const rc = new RangeDecoder(src)
  const dec = new LzmaDecoder(out, rc)
  let p = 0
  let pos = 0
  let needProps = true
  let needDictReset = true
  while (true) {
    if (p >= src.length) throw new LzmaError('lzma2: truncated')
    const c = src[p++]
    if (c === 0) break
    if (c === 1 || c === 2) {
      if (c === 2 && needDictReset) throw new LzmaError('lzma2: missing dictionary reset')
      if (c === 1) {
        dec.dictStart = pos
        needDictReset = false
      }
      const size = ((src[p] << 8) | src[p + 1]) + 1
      p += 2
      if (p + size > src.length || pos + size > outSize) throw new LzmaError('lzma2: stored chunk overflows')
      out.set(src.subarray(p, p + size), pos)
      p += size
      pos += size
      continue
    }
    if (c < 0x80) throw new LzmaError('lzma2: bad control byte')
    const unpacked = ((c & 0x1f) << 16) + ((src[p] << 8) | src[p + 1]) + 1
    const packed = ((src[p + 2] << 8) | src[p + 3]) + 1
    p += 4
    const mode = (c >>> 5) & 3
    if (mode === 3) {
      dec.dictStart = pos
      needDictReset = false
    } else if (needDictReset) throw new LzmaError('lzma2: missing dictionary reset')
    if (mode >= 2) {
      dec.setProps(parseLzmaPropsByte(src[p++]))
      if (dec.lc + dec.lp > 4) throw new LzmaError('lzma2: lc + lp > 4')
      needProps = false
    } else if (needProps) throw new LzmaError('lzma2: missing properties')
    if (mode >= 1) dec.resetState()
    if (pos + unpacked > outSize || p + packed > src.length) throw new LzmaError('lzma2: chunk overflows')
    rc.init(p, p + packed)
    const end = dec.decode(pos, pos + unpacked, false)
    if (end !== pos + unpacked) throw new LzmaError('lzma2: chunk ended early')
    pos = end
    p += packed
  }
  if (pos !== outSize) throw new LzmaError('lzma2: size mismatch')
  return out
}
