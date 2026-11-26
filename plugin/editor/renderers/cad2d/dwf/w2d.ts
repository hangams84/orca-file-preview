/** WHIP! 2D (W2D) graphics stream reader: the vector content of DWF sheets. Implements the common
 *  opcodes (binary and ASCII forms): lines, polylines/polygons, contour sets, polytriangles,
 *  circles, arcs, ellipses, markers, text with fonts, RGBA and indexed colours with colour maps,
 *  line weights, fill and visibility, layers, origin, units, viewports (parsed), images (PNG, JPEG,
 *  raw RGB/RGBA, mapped, bitonal) and zlib-compressed sections. Byte layouts follow the published
 *  WHIP!/DWF format description; coordinates are logical (31-bit) and y-up.
 *
 *  An opcode that cannot be skipped stops the stream: what was read so far is kept and the caller
 *  decides whether to show it or the package's thumbnail. */
import { unzlibSync } from '../../../../vendor/zip.js'
import { C, invert, P, type ImageItem, type Item, type Mat, type PathItem } from '../scene.ts'

export interface W2dImage {
  item: ImageItem
  /** Encoded image (PNG/JPEG) or raw RGBA pixels. */
  mime?: string
  data?: Uint8Array
  rgba?: Uint8ClampedArray
  width: number
  height: number
}

export interface W2dResult {
  items: Item[]
  images: W2dImage[]
  /** Set when reading stopped at an opcode this reader cannot skip. */
  stopped?: string
  /** Opcodes read but not drawn (bezier, gouraud colours, group 4 images…), by name. */
  ignored: Map<string, number>
  units?: string
  /** Logical → drawing units (from the Units opcode), when present. */
  toUnits?: Mat
  background?: number
  version?: string
  opcodes: number
}

/** Maps a W2D layer number (and name, when defined) to a scene layer index. */
export type LayerMap = (num: number, name?: string) => number

/** The default 256-colour map: 10 system colours, a 6×6×6 colour cube, a grey ramp, 10 more. */
export const DEFAULT_MAP: number[] = (() => {
  const head = [0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0xc0dcc0, 0xa6caf0]
  const tail = [0xfffbf0, 0xa0a0a4, 0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff]
  const out = [...head]
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) out.push(((r * 51) << 16) | ((g * 51) << 8) | (b * 51))
  for (let i = 0; i < 20; i++) {
    const v = Math.round((i * 255) / 19)
    out.push((v << 16) | (v << 8) | v)
  }
  out.push(...tail)
  return out
})()

export class W2dError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}

const TAU = Math.PI * 2
/** Informational or state opcodes that change nothing on screen here. */
const INFO_OPCODES = /^(Bounds|View|NamedView|DrawingInfo|Author|Comments?|Copyright|Creator|Created|Modified|Source\w*|Description|Keywords|Title|Subject|PlotInfo|Plot_Info|Projection|Merge\w*|Opaque|Transparent|OptimizedForPlotting|Group\w*|Group|URL|AttributeURL|InkedArea|Embed\w*|Header|CodePage|FileTime|Guid\w*|GUID\w*|Directory|BlockRef|BlockMeaning|Delineate|Overpost|Alignment|Orientation|ObjectNode|TrustedFontList|ContrastColor|Password|Encryption|SignData|UserData|PenPatOptions|MacroDefinition|Origin)$/

interface Font {
  name: string
  height: number
  rot: number
  wscale: number
  oblique: number
  bold: boolean
  italic: boolean
}

export function readW2d(bytes: Uint8Array, layerOf: LayerMap): W2dResult {
  const r = new Reader(bytes, layerOf)
  r.run()
  return r.result
}

class Reader {
  result: W2dResult = { items: [], images: [], ignored: new Map(), opcodes: 0 }
  private pos = 0
  private dv: DataView
  private cx = 0
  private cy = 0
  private rgb = 0xffffff
  private alpha = 1
  private map = DEFAULT_MAP.slice()
  private fill = false
  private visible = true
  private weight = 0
  private layer = -1
  private font: Font = { name: '', height: 0, rot: 0, wscale: 1, oblique: 0, bold: false, italic: false }

  constructor(
    private b: Uint8Array,
    private layerOf: LayerMap
  ) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  }

  // ---- primitive reads --------------------------------------------------------------------
  private need(n: number): void {
    if (this.pos + n > this.b.length) throw new W2dError('stream ends inside an opcode')
  }
  private u8(): number {
    this.need(1)
    return this.b[this.pos++]
  }
  private u16(): number {
    this.need(2)
    const v = this.dv.getUint16(this.pos, true)
    this.pos += 2
    return v
  }
  private i16(): number {
    this.need(2)
    const v = this.dv.getInt16(this.pos, true)
    this.pos += 2
    return v
  }
  private i32(): number {
    this.need(4)
    const v = this.dv.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  private u32(): number {
    this.need(4)
    const v = this.dv.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  /** Count: one byte, or 0 then a 16-bit value + 256. */
  private count(): number {
    const c = this.u8()
    return c !== 0 ? c : 256 + this.u16()
  }
  private rel32(): [number, number] {
    this.cx += this.i32()
    this.cy += this.i32()
    return [this.cx, this.cy]
  }
  private rel16(): [number, number] {
    this.cx += this.i16()
    this.cy += this.i16()
    return [this.cx, this.cy]
  }
  private points(n: number, wide: boolean): number[] {
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(...(wide ? this.rel32() : this.rel16()))
    return out
  }

  private ws(): void {
    while (this.pos < this.b.length) {
      const c = this.b[this.pos]
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++
      else break
    }
  }

  /** ASCII integer (optional sign). */
  private aint(): number {
    this.ws()
    let s = ''
    while (this.pos < this.b.length) {
      const c = this.b[this.pos]
      if ((c >= 0x30 && c <= 0x39) || ((c === 0x2d || c === 0x2b) && !s)) {
        s += String.fromCharCode(c)
        this.pos++
      } else break
    }
    if (!s || s === '-' || s === '+') throw new W2dError('number expected')
    return parseInt(s, 10)
  }

  /** ASCII float. */
  private afloat(): number {
    this.ws()
    let s = ''
    while (this.pos < this.b.length) {
      const c = String.fromCharCode(this.b[this.pos])
      if (/[0-9eE+\-.]/.test(c)) {
        s += c
        this.pos++
      } else break
    }
    const v = parseFloat(s)
    if (!Number.isFinite(v)) throw new W2dError('number expected')
    return v
  }

  /** ASCII point "x,y". */
  private apoint(): [number, number] {
    const x = this.aint()
    this.ws()
    if (this.b[this.pos] === 0x2c) this.pos++
    const y = this.aint()
    return [x, y]
  }

  /** WT_String: binary {len UTF-16LE}, quoted 'text', hex "XXXX…" or a bare token. */
  private string(): string {
    this.ws()
    const c = this.b[this.pos]
    if (c === 0x7b) {
      this.pos++
      const n = this.i32()
      if (n < 0 || n > 1 << 20) throw new W2dError('bad string length')
      this.need(n * 2)
      let s = ''
      for (let i = 0; i < n; i++) s += String.fromCharCode(this.dv.getUint16(this.pos + i * 2, true))
      this.pos += n * 2
      if (this.u8() !== 0x7d) throw new W2dError('string not closed')
      return s.replace(/\u0000+$/, '')
    }
    if (c === 0x22) {
      this.pos++
      let s = ''
      while (this.pos + 4 <= this.b.length && this.b[this.pos] !== 0x22) {
        s += String.fromCharCode(parseInt(String.fromCharCode(...this.b.subarray(this.pos, this.pos + 4)), 16))
        this.pos += 4
      }
      this.pos++
      return s
    }
    if (c === 0x27) {
      this.pos++
      const out: number[] = []
      while (this.pos < this.b.length) {
        const d = this.b[this.pos++]
        if (d === 0x5c && this.pos < this.b.length) out.push(this.b[this.pos++])
        else if (d === 0x27) break
        else out.push(d)
      }
      return new TextDecoder('utf-8').decode(new Uint8Array(out))
    }
    let s = ''
    while (this.pos < this.b.length) {
      const d = this.b[this.pos]
      if (d === 0x20 || d === 0x29 || d === 0x28 || d === 0x0a || d === 0x0d || d === 0x09) break
      s += String.fromCharCode(d)
      this.pos++
    }
    return s
  }

  /** Skips to the parenthesis closing the current extended ASCII opcode (depth 1 at entry). */
  private skipParen(depth = 1): void {
    let quoted = false
    while (this.pos < this.b.length) {
      const c = this.b[this.pos++]
      if (c === 0x5c) {
        this.pos++
        continue
      }
      if (c === 0x27) quoted = !quoted
      else if (quoted) continue
      else if (c === 0x28) depth++
      else if (c === 0x29) {
        if (--depth <= 0) return
      } else if (c === 0x7b) {
        const n = this.i32()
        if (n <= 0) throw new W2dError('unknown-length binary block inside an ASCII opcode')
        this.pos += n
      }
    }
  }

  // ---- output -----------------------------------------------------------------------------
  private ignore(name: string): void {
    this.result.ignored.set(name, (this.result.ignored.get(name) ?? 0) + 1)
  }

  private push(d: number[], filled: boolean): void {
    if (!this.visible || d.length < 3) return
    const it: PathItem = {
      k: 'path',
      layer: this.layer,
      color: this.rgb,
      lw: 0,
      d,
      stroke: !filled,
      fill: filled,
      evenOdd: filled || undefined,
      width: this.weight > 0 && !filled ? this.weight : undefined,
      alpha: this.alpha < 1 ? this.alpha : undefined
    }
    this.result.items.push(it)
  }

  private poly(pts: number[], close: boolean, filled = false): void {
    if (pts.length < 2) return
    const d: number[] = [P.M, pts[0], pts[1]]
    for (let i = 2; i < pts.length; i += 2) d.push(P.L, pts[i], pts[i + 1])
    if (pts.length === 2) d.push(P.L, pts[0], pts[1])
    if (close) d.push(P.Z)
    this.push(d, filled)
  }

  private ellipse(x: number, y: number, major: number, minor: number, start: number, end: number, tilt: number): void {
    let e = end
    if (e <= start) e += 65536
    const a0 = (start / 65536) * TAU
    const a1 = (e / 65536) * TAU
    const rot = (tilt / 65536) * TAU
    const full = e - start >= 65536
    const sx = x + major * Math.cos(a0) * Math.cos(rot) - minor * Math.sin(a0) * Math.sin(rot)
    const sy = y + major * Math.cos(a0) * Math.sin(rot) + minor * Math.sin(a0) * Math.cos(rot)
    const d = [P.M, sx, sy, P.E, x, y, Math.max(major, 1e-9), Math.max(minor, 1e-9), rot, a0, a1, 1]
    if (full || this.fill) d.push(P.Z)
    this.push(d, this.fill && full)
  }

  private text(x: number, y: number, s: string): void {
    if (!this.visible || !s) return
    const f = this.font
    this.result.items.push({
      k: 'text',
      layer: this.layer,
      color: this.rgb,
      lw: 0,
      x,
      y,
      h: f.height > 0 ? f.height : 1,
      emScale: 1,
      rot: f.rot,
      wf: f.wscale !== 1 ? f.wscale : undefined,
      obl: f.oblique || undefined,
      family: f.name || undefined,
      bold: f.bold || undefined,
      italic: f.italic || undefined,
      text: s
    })
  }

  private setIndex(i: number): void {
    this.rgb = this.map[i] ?? 0
    this.alpha = 1
  }

  private colorMap(n: number, binary: boolean): void {
    const m: number[] = []
    for (let i = 0; i < n; i++) {
      if (binary) {
        const r = this.u8()
        const g = this.u8()
        const b = this.u8()
        this.u8()
        m.push((r << 16) | (g << 8) | b)
      } else {
        const r = this.aint()
        this.expectComma()
        const g = this.aint()
        this.expectComma()
        const b = this.aint()
        this.expectComma()
        this.aint()
        m.push((r << 16) | (g << 8) | b)
      }
    }
    if (m.length) this.map = m
  }

  private expectComma(): void {
    this.ws()
    if (this.b[this.pos] === 0x2c) this.pos++
  }

  // ---- main loop ----------------------------------------------------------------------------
  run(): void {
    const b = this.b
    // Header: "(DWF V06.00)" / "(W2D V06.00)" etc.
    const head = new TextDecoder('latin1').decode(b.subarray(0, 12))
    const m = /^\((?:DWF|W2D) V(\d\d\.\d\d)\)/.exec(head)
    if (m) {
      this.result.version = m[1]
      this.pos = 12
    }
    try {
      while (this.pos < b.length) {
        if (this.op() === false) break
      }
    } catch (err) {
      this.result.stopped = (err as Error).message
    }
  }

  /** One opcode; false at the end of the stream. */
  private op(): boolean | void {
    const b = this.b
    const at = this.pos
    const c = b[this.pos++]
    this.result.opcodes++
    switch (c) {
      case 0x20:
      case 0x09:
      case 0x0a:
      case 0x0d:
      case 0x00:
        return
      case 0x28: // (
        return this.extAscii()
      case 0x7b: // {
        return this.extBinary()
      case 0x03: {
        const r = this.u8()
        const g = this.u8()
        const bb = this.u8()
        const a = this.u8()
        this.rgb = (r << 16) | (g << 8) | bb
        this.alpha = a / 255
        return
      }
      case 0x63: // c
        return this.setIndex(this.u8())
      case 0x43: // C
        return this.setIndex(this.aint())
      case 0x46: // F
        this.fill = true
        return
      case 0x66: // f
        this.fill = false
        return
      case 0x56: // V
        this.visible = true
        return
      case 0x76: // v
        this.visible = false
        return
      case 0x17:
        this.weight = Math.max(0, this.i32())
        return
      case 0xac:
        this.layer = this.layerOf(this.count())
        return
      case 0xcc:
        this.count() // line pattern id (drawn solid)
        return
      case 0x4f: // O: set origin (current point)
        this.cx = this.i32()
        this.cy = this.i32()
        return
      case 0x4e: // N object node
        this.i32()
        return
      case 0x6e: // n
        this.i16()
        return
      case 0x0e:
        return
      case 0x06:
        return this.fontBinary()
      case 0x0c: {
        const p = this.points(2, false)
        return this.poly(p, false)
      }
      case 0x6c: {
        const p = this.points(2, true)
        return this.poly(p, false)
      }
      case 0x4c: {
        const p0 = this.apoint()
        const p1 = this.apoint()
        return this.poly([...p0, ...p1], false)
      }
      case 0x8c: {
        // multiple 16-bit lines
        const n = this.u8()
        for (let i = 0; i < n; i++) this.poly(this.points(2, false), false)
        return
      }
      case 0x10:
      case 0x70: {
        const n = this.count()
        const p = this.points(n, c === 0x70)
        return this.poly(p, this.fill, this.fill)
      }
      case 0x50: {
        const n = this.aint()
        const p: number[] = []
        for (let i = 0; i < n; i++) p.push(...this.apoint())
        return this.poly(p, this.fill, this.fill)
      }
      case 0x0b:
      case 0x6b:
        return this.contour(c === 0x6b, true)
      case 0x14:
      case 0x74: {
        const n = this.count()
        return this.strip(this.points(n, c === 0x74))
      }
      case 0x54: {
        const n = this.aint()
        const p: number[] = []
        for (let i = 0; i < n; i++) p.push(...this.apoint())
        return this.strip(p)
      }
      case 0x07:
      case 0x67:
      case 0x11:
      case 0x71: {
        // Gouraud polytriangle / polyline: points with per-vertex colours (first colour used).
        const n = this.count()
        const p: number[] = []
        let first = -1
        for (let i = 0; i < n; i++) {
          p.push(...(c === 0x67 || c === 0x71 ? this.rel32() : this.rel16()))
          const rgba = this.u32()
          if (first < 0) first = ((rgba & 255) << 16) | (rgba & 0xff00) | ((rgba >>> 16) & 255)
        }
        const keep = this.rgb
        if (first >= 0) this.rgb = first
        if (c === 0x07 || c === 0x67) this.strip(p)
        else this.poly(p, false)
        this.rgb = keep
        this.ignore('gouraud shading (flat colour)')
        return
      }
      case 0x12: {
        const [x, y] = this.rel16()
        const r = this.u16()
        return this.ellipse(x, y, r, r, 0, 0, 0)
      }
      case 0x72: {
        const [x, y] = this.rel32()
        const r = this.u32()
        return this.ellipse(x, y, r, r, 0, 0, 0)
      }
      case 0x52: {
        const [x, y] = this.apoint()
        const r = this.aint()
        return this.ellipse(x, y, r, r, 0, 0, 0)
      }
      case 0x92: {
        const [x, y] = this.rel32()
        const r = this.u32()
        const s = this.u16()
        const e = this.u16()
        return this.ellipse(x, y, r, r, s, e, 0)
      }
      case 0x65: {
        const [x, y] = this.rel32()
        const major = this.u32()
        const minor = this.u32()
        const s = this.u16()
        const e = this.u16()
        const t = this.u16()
        return this.ellipse(x, y, major, minor, s, e, t)
      }
      case 0x45: {
        const [x, y] = this.apoint()
        const [ma, mi] = this.apoint()
        return this.ellipse(x, y, ma, mi, 0, 0, 0)
      }
      case 0x78: {
        // Draw text (basic): position, string; attributes come from the font.
        const [x, y] = this.rel32()
        return this.text(x, y, this.string())
      }
      case 0x18: {
        const [x, y] = this.rel32()
        const s = this.string()
        // overscore, underscore positions
        for (let k = 0; k < 2; k++) {
          const n = this.count() - 1
          for (let i = 0; i < n; i++) this.count()
        }
        // bounds: four relative points
        this.points(4, true)
        // reserved values (package-format revisions)
        if (Number(this.result.version ?? '6') >= 6) {
          const n = this.count() - 1
          for (let i = 0; i < n; i++) this.count()
        }
        return this.text(x, y, s)
      }
      case 0x47: // G macro index / marker symbol (ASCII)
      case 0x53: // S macro scale / marker size (ASCII)
        this.aint()
        return
      case 0x73: // s macro scale (binary)
        this.i32()
        return
      case 0x4d:
      case 0x6d:
      case 0x8d: {
        // markers / macro draws: a point set
        let pts: number[]
        if (c === 0x4d) {
          const n = this.aint()
          pts = []
          for (let i = 0; i < n; i++) pts.push(...this.apoint())
        } else {
          const n = this.count()
          pts = this.points(n, c === 0x6d)
        }
        if (this.visible) for (let i = 0; i < pts.length; i += 2) this.result.items.push({ k: 'point', layer: this.layer, color: this.rgb, lw: 0, x: pts[i], y: pts[i + 1] })
        return
      }
      default:
        throw new W2dError(`unsupported opcode 0x${c.toString(16).padStart(2, '0')} at byte ${at}`)
    }
  }

  private strip(p: number[]): void {
    // Triangle strip: each new point forms a triangle with the previous two.
    for (let i = 4; i < p.length; i += 2) this.poly([p[i - 4], p[i - 3], p[i - 2], p[i - 1], p[i], p[i + 1]], true, true)
  }

  private contour(wide: boolean, draw: boolean): void {
    const n = this.count()
    const counts: number[] = []
    for (let i = 0; i < n; i++) counts.push(this.count())
    const d: number[] = []
    for (const k of counts) {
      const p = this.points(k, wide)
      if (!p.length) continue
      d.push(P.M, p[0], p[1])
      for (let i = 2; i < p.length; i += 2) d.push(P.L, p[i], p[i + 1])
      d.push(P.Z)
    }
    if (draw) this.push(d, true)
  }

  private fontBinary(): void {
    const fields = this.u16()
    const f = this.font
    if (fields & 0x0001) f.name = this.string()
    if (fields & 0x0002) this.u8() // charset
    if (fields & 0x0004) this.u8() // pitch
    if (fields & 0x0008) this.u8() // family
    if (fields & 0x0010) {
      const st = this.u8()
      f.bold = (st & 1) !== 0
      f.italic = (st & 2) !== 0
    }
    if (fields & 0x0020) f.height = this.i32()
    if (fields & 0x0040) f.rot = (this.u16() / 65536) * TAU
    if (fields & 0x0080) f.wscale = this.u16() / 1024 || 1
    if (fields & 0x0100) this.u16() // spacing
    if (fields & 0x0200) f.oblique = (this.u16() / 65536) * TAU
    if (fields & 0x0400) this.i32() // flags
  }

  // ---- extended opcodes -------------------------------------------------------------------
  private extAscii(): void {
    // Name runs to whitespace or a parenthesis.
    let name = ''
    while (this.pos < this.b.length) {
      const c = this.b[this.pos]
      if (c === 0x20 || c === 0x28 || c === 0x29 || c === 0x0a || c === 0x0d || c === 0x09) break
      name += String.fromCharCode(c)
      this.pos++
    }
    switch (name) {
      case 'EndOfDWF':
        this.skipParen()
        this.pos = this.b.length
        return
      case 'Layer': {
        const num = this.aint()
        this.ws()
        const nm = this.b[this.pos] !== 0x29 ? this.string() : undefined
        this.layer = this.layerOf(num, nm)
        return this.skipParen()
      }
      case 'Color': {
        const r = this.aint()
        this.expectComma()
        const g = this.aint()
        this.expectComma()
        const bb = this.aint()
        this.expectComma()
        const a = this.aint()
        this.rgb = (r << 16) | (g << 8) | bb
        this.alpha = a / 255
        return this.skipParen()
      }
      case 'ColorMap': {
        const n = this.aint()
        this.colorMap(n, false)
        return this.skipParen()
      }
      case 'LineWeight':
        this.weight = Math.max(0, this.aint())
        return this.skipParen()
      case 'Background': {
        try {
          this.ws()
          if (this.b[this.pos] >= 0x30 && this.b[this.pos] <= 0x39) {
            const r = this.aint()
            this.expectComma()
            const g = this.aint()
            this.expectComma()
            const bb = this.aint()
            this.result.background = (r << 16) | (g << 8) | bb
          }
        } catch {
          // keep default
        }
        return this.skipParen()
      }
      case 'Units': {
        const u = this.string()
        this.result.units = u
        // ((m00 m01 m02 m03)(m10 ...)(m20 ...)(m30 ...)): application → DWF transform.
        try {
          const vals: number[] = []
          this.ws()
          if (this.b[this.pos] === 0x28) {
            this.pos++
            for (let row = 0; row < 4; row++) {
              this.ws()
              if (this.b[this.pos] !== 0x28) break
              this.pos++
              for (let k = 0; k < 4; k++) vals.push(this.afloat())
              this.ws()
              if (this.b[this.pos] === 0x29) this.pos++
            }
            this.ws()
            if (this.b[this.pos] === 0x29) this.pos++
          }
          if (vals.length === 16) {
            const tx = vals[12] || vals[3]
            const ty = vals[13] || vals[7]
            const inv = invert([vals[0], vals[1], vals[4], vals[5], tx, ty])
            if (inv) this.result.toUnits = inv
          }
        } catch {
          // units text only
        }
        return this.skipParen()
      }
      case 'Viewport': {
        // name, then an optional boundary contour (keeps relative coordinates in step).
        this.string()
        this.ws()
        if (this.b[this.pos] === 0x6b || this.b[this.pos] === 0x0b) {
          const c = this.b[this.pos++]
          this.contour(c === 0x6b, false)
        }
        return this.skipParen()
      }
      case 'Circle': {
        const [x, y] = this.apoint()
        const r = this.aint()
        this.ws()
        let s = 0
        let e = 0
        if (this.b[this.pos] !== 0x29) [s, e] = this.apoint()
        this.ellipse(x, y, r, r, s, e, 0)
        return this.skipParen()
      }
      case 'Ellipse': {
        const [x, y] = this.apoint()
        const [ma, mi] = this.apoint()
        this.ws()
        let s = 0
        let e = 0
        let t = 0
        if (this.b[this.pos] !== 0x29) {
          ;[s, e] = this.apoint()
          this.ws()
          if (this.b[this.pos] !== 0x29) t = this.aint()
        }
        this.ellipse(x, y, ma, mi, s, e, t)
        return this.skipParen()
      }
      case 'Contour':
      case 'ContourSet': {
        const n = this.aint()
        const counts: number[] = []
        for (let i = 0; i < n; i++) counts.push(this.aint())
        const d: number[] = []
        for (const k of counts) {
          for (let i = 0; i < k; i++) {
            const [x, y] = this.apoint()
            d.push(i ? P.L : P.M, x, y)
          }
          d.push(P.Z)
        }
        this.push(d, true)
        return this.skipParen()
      }
      case 'Text': {
        const [x, y] = this.apoint()
        const s = this.string()
        this.text(x, y, s)
        return this.skipParen()
      }
      case 'Font':
        this.fontAscii()
        return
      default:
        if (/^(Line(Cap|Join|Pattern|Style)|DashPattern|FillPattern|UserFillPattern|UserHatchPattern|PenPattern|TextHAlign|TextVAlign|TextBackground)$/.test(name)) this.ignore('line/fill styles (drawn solid)')
        else if (!INFO_OPCODES.test(name)) this.ignore(name || '(')
        return this.skipParen()
    }
  }

  /** (Font (Name 'Arial') (Height 100) (Rotation 0) (WidthScale 1024) (Oblique 0) (Style bold) ...) */
  private fontAscii(): void {
    const f = this.font
    for (;;) {
      this.ws()
      const c = this.b[this.pos]
      if (c === undefined) return
      if (c === 0x29) {
        this.pos++
        return
      }
      if (c !== 0x28) {
        this.pos++
        continue
      }
      this.pos++
      let name = ''
      while (this.pos < this.b.length && /[A-Za-z_]/.test(String.fromCharCode(this.b[this.pos]))) name += String.fromCharCode(this.b[this.pos++])
      try {
        if (name === 'Name') f.name = this.string()
        else if (name === 'Height') f.height = this.aint()
        else if (name === 'Rotation') f.rot = (this.aint() / 65536) * TAU
        else if (name === 'WidthScale') f.wscale = this.aint() / 1024 || 1
        else if (name === 'Oblique') f.oblique = (this.aint() / 65536) * TAU
        else if (name === 'Style') {
          const s = this.string().toLowerCase()
          f.bold = s.includes('bold')
          f.italic = s.includes('italic')
        }
      } catch {
        // tolerate odd values
      }
      this.skipParen()
    }
  }

  private extBinary(): void {
    const start = this.pos
    const size = this.i32()
    const op = this.u16()
    const end = start + 4 + size // position after the closing brace
    if (op === 0x0011 || op === 0x0010) {
      if (op === 0x0010) throw new W2dError('LZ-compressed stream (not supported)')
      // zlib: the rest of the stream (until a closing brace) is compressed.
      const rest = this.b.subarray(this.pos)
      let inflated: Uint8Array
      try {
        inflated = unzlibSync(rest)
      } catch {
        throw new W2dError('damaged compressed section')
      }
      const sub = new Reader(inflated, this.layerOf)
      // continue with this reader's state
      Object.assign(sub, { cx: this.cx, cy: this.cy, rgb: this.rgb, alpha: this.alpha, map: this.map, fill: this.fill, visible: this.visible, weight: this.weight, layer: this.layer, font: this.font })
      sub.result = this.result
      while (sub.pos < inflated.length) if (sub.op() === false) break
      this.pos = this.b.length
      return
    }
    if (!(size > 2) || end > this.b.length) throw new W2dError(`bad extended binary block (opcode 0x${op.toString(16)})`)
    try {
      switch (op) {
        case 0x0001:
          this.colorMap(this.count(), true)
          break
        case 0x0002:
        case 0x0003:
        case 0x0004:
        case 0x0005:
        case 0x0006:
        case 0x0007:
        case 0x0008:
        case 0x0009:
        case 0x000c:
        case 0x000d:
          this.image(op, end - 1)
          break
        default:
          this.ignore(`binary 0x${op.toString(16).padStart(4, '0')}`)
      }
    } finally {
      this.pos = end
    }
  }

  private image(op: number, dataEnd: number): void {
    const cols = this.u16()
    const rows = this.u16()
    const [x0, y0] = this.rel32()
    const [x1, y1] = this.rel32()
    this.i32() // identifier
    let palette: number[] | null = null
    if (op === 0x0002 || op === 0x0003 || op === 0x0005 || op === 0x000d) {
      const n = this.count()
      palette = []
      for (let i = 0; i < n; i++) {
        const r = this.u8()
        const g = this.u8()
        const b = this.u8()
        const a = this.u8()
        palette.push(((r << 24) | (g << 16) | (b << 8) | a) >>> 0)
      }
    }
    const size = this.i32()
    const start = this.pos
    const data = this.b.subarray(start, Math.min(dataEnd, start + Math.max(0, size)))
    const item: ImageItem = { k: 'image', layer: this.layer, color: C.FG, lw: 0, src: null, m: [x1 - x0, 0, 0, y1 - y0, x0, y0], pw: cols, ph: rows }
    if (!this.visible) return
    this.result.items.push(item)
    if (op === 0x000c) this.result.images.push({ item, mime: 'image/png', data, width: cols, height: rows })
    else if (op === 0x0008) this.result.images.push({ item, mime: 'image/jpeg', data, width: cols, height: rows })
    else if (op === 0x0006 || op === 0x0007 || op === 0x0004 || op === 0x0005 || op === 0x0002) {
      const px = new Uint8ClampedArray(cols * rows * 4)
      const stride = op === 0x0002 ? Math.ceil(cols / 8) : 0
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const o = (y * cols + x) * 4
          let rgba: number
          if (op === 0x0006) {
            const i = (y * cols + x) * 3
            rgba = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | 255) >>> 0
          } else if (op === 0x0007) {
            const i = (y * cols + x) * 4
            rgba = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0
          } else if (op === 0x0002) {
            const bit = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1
            rgba = palette?.[bit] ?? (bit ? 0x000000ff : 0xffffffff)
          } else {
            const idx = data[y * cols + x] ?? 0
            if (palette) rgba = palette[idx] ?? 0
            else {
              const c = this.map[idx] ?? 0
              rgba = ((c << 8) | 255) >>> 0
            }
          }
          px[o] = rgba >>> 24
          px[o + 1] = (rgba >>> 16) & 255
          px[o + 2] = (rgba >>> 8) & 255
          px[o + 3] = rgba & 255
        }
      this.result.images.push({ item, rgba: px, width: cols, height: rows })
    } else this.ignore(op === 0x0009 || op === 0x000d ? 'Group 4 image (frame only)' : 'Group 3X image (frame only)')
  }
}
