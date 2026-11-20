/** A small EMF (Enhanced Metafile) player drawing to a canvas.
 *
 *  Office writes pictures, pasted shapes and clip art as "EMF+ dual" files: EMF+ records inside
 *  comments plus equivalent GDI records. This plays the GDI records, which is what every EMF has:
 *  world/page transforms, save/restore, clipping by rectangle and path, pens (incl. EXTCREATEPEN),
 *  solid brushes, polygons/polylines/beziers (16- and 32-bit), rectangles, ellipses, round rects,
 *  paths (fill/stroke), text (EXTTEXTOUTW with per-glyph advances, escapement, alignment) and
 *  bitmaps (STRETCHDIBITS, BITBLT, STRETCHBLT, DIB 1/4/8/16/24/32 bpp, bitfields, and embedded
 *  JPEG/PNG). Hatch and pattern brushes draw as their foreground colour; unknown records are skipped.
 *  Coordinates follow GDI: device = viewportMapping(world(logical)). */

type Matrix = DOMMatrix

interface Pen {
  kind: 'pen'
  color: string
  width: number
  none: boolean
  dash: number[]
}
interface Brush {
  kind: 'brush'
  color: string
  none: boolean
}
interface Font {
  kind: 'font'
  height: number
  weight: number
  italic: boolean
  underline: boolean
  escapement: number
  face: string
}
type Obj = Pen | Brush | Font

interface DcState {
  world: Matrix
  winOrg: [number, number]
  winExt: [number, number]
  vpOrg: [number, number]
  vpExt: [number, number]
  mapMode: number
  pen: Pen
  brush: Brush
  font: Font
  textColor: string
  bkColor: string
  bkMode: number
  textAlign: number
  fillRule: CanvasFillRule
  cur: [number, number]
}

const STOCK: Record<number, Obj> = {
  0: { kind: 'brush', color: '#fff', none: false },
  1: { kind: 'brush', color: '#c0c0c0', none: false },
  2: { kind: 'brush', color: '#808080', none: false },
  3: { kind: 'brush', color: '#404040', none: false },
  4: { kind: 'brush', color: '#000', none: false },
  5: { kind: 'brush', color: '#000', none: true },
  6: { kind: 'pen', color: '#fff', width: 0, none: false, dash: [] },
  7: { kind: 'pen', color: '#000', width: 0, none: false, dash: [] },
  8: { kind: 'pen', color: '#000', width: 0, none: true, dash: [] },
  10: { kind: 'font', height: 12, weight: 400, italic: false, underline: false, escapement: 0, face: 'sans-serif' },
  13: { kind: 'font', height: 12, weight: 400, italic: false, underline: false, escapement: 0, face: 'sans-serif' }
}

export interface EmfInfo {
  /** Picture size in CSS px (from the header's frame, 96 dpi). */
  width: number
  height: number
}

function colorRef(dv: DataView, o: number): string {
  return `rgb(${dv.getUint8(o)},${dv.getUint8(o + 1)},${dv.getUint8(o + 2)})`
}

export function emfInfo(bytes: Uint8Array): EmfInfo & { frameDev: [number, number, number, number] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464d4520) throw new Error('not an EMF')
  const frame = [dv.getInt32(24, true), dv.getInt32(28, true), dv.getInt32(32, true), dv.getInt32(36, true)]
  const devW = dv.getInt32(72, true)
  const devH = dv.getInt32(76, true)
  const mmW = dv.getInt32(80, true)
  const mmH = dv.getInt32(84, true)
  // frame is in 0.01 mm; device units per mm from the reference device.
  const kx = mmW > 0 ? devW / mmW : 96 / 25.4
  const ky = mmH > 0 ? devH / mmH : 96 / 25.4
  let frameDev: [number, number, number, number] = [(frame[0] / 100) * kx, (frame[1] / 100) * ky, (frame[2] / 100) * kx, (frame[3] / 100) * ky]
  if (!(frameDev[2] > frameDev[0] && frameDev[3] > frameDev[1])) {
    frameDev = [dv.getInt32(8, true), dv.getInt32(12, true), dv.getInt32(16, true) + 1, dv.getInt32(20, true) + 1]
  }
  const wmm = (frame[2] - frame[0]) / 100
  const hmm = (frame[3] - frame[1]) / 100
  const width = wmm > 0 ? (wmm / 25.4) * 96 : frameDev[2] - frameDev[0]
  const height = hmm > 0 ? (hmm / 25.4) * 96 : frameDev[3] - frameDev[1]
  return { width: Math.max(1, width), height: Math.max(1, height), frameDev }
}

/** Plays an EMF onto a new canvas of about `scale` × its natural size (longest edge ≤ maxEdge). */
export async function renderEmf(bytes: Uint8Array, scale = 2, maxEdge = 4096): Promise<{ canvas: HTMLCanvasElement } & EmfInfo> {
  const info = emfInfo(bytes)
  const k = Math.min(scale, maxEdge / Math.max(info.width, info.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(info.width * k))
  canvas.height = Math.max(1, Math.round(info.height * k))
  const ctx = canvas.getContext('2d')!
  const [fx0, fy0, fx1, fy1] = info.frameDev
  const base = new DOMMatrix().scale(canvas.width / (fx1 - fx0), canvas.height / (fy1 - fy0)).translate(-fx0, -fy0)
  await play(bytes, ctx, base)
  return { canvas, width: info.width, height: info.height }
}

async function play(bytes: Uint8Array, ctx: CanvasRenderingContext2D, base: Matrix): Promise<void> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const objects: (Obj | undefined)[] = []
  const stack: DcState[] = []
  let dc: DcState = {
    world: new DOMMatrix(),
    winOrg: [0, 0],
    winExt: [1, 1],
    vpOrg: [0, 0],
    vpExt: [1, 1],
    mapMode: 1,
    pen: STOCK[7] as Pen,
    brush: STOCK[0] as Brush,
    font: STOCK[13] as Font,
    textColor: '#000',
    bkColor: '#fff',
    bkMode: 2,
    textAlign: 0,
    fillRule: 'evenodd',
    cur: [0, 0]
  }
  let path: Path2D | null = null
  const cloneDc = (s: DcState): DcState => ({ ...s, world: DOMMatrix.fromMatrix(s.world), cur: [...s.cur] as [number, number] })

  /** logical → device (page mapping applied after the world transform). */
  const pageMatrix = () => {
    if (dc.mapMode === 1) return new DOMMatrix()
    const sx = dc.vpExt[0] / (dc.winExt[0] || 1)
    const sy = dc.vpExt[1] / (dc.winExt[1] || 1)
    return new DOMMatrix().translate(dc.vpOrg[0], dc.vpOrg[1]).scale(sx, sy).translate(-dc.winOrg[0], -dc.winOrg[1])
  }
  const applyTransform = () => {
    const m = base.multiply(pageMatrix()).multiply(dc.world)
    ctx.setTransform(m)
  }
  const pxScale = () => {
    const m = ctx.getTransform()
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1
  }
  const strokeIt = (p: Path2D) => {
    if (dc.pen.none) return
    applyTransform()
    ctx.strokeStyle = dc.pen.color
    // Cosmetic pens (width 0/1) are one device pixel wide.
    ctx.lineWidth = dc.pen.width > 1 ? dc.pen.width : 1 / pxScale()
    ctx.setLineDash(dc.pen.dash.map((d) => d * ctx.lineWidth))
    ctx.stroke(p)
  }
  const fillIt = (p: Path2D) => {
    if (dc.brush.none) return
    applyTransform()
    ctx.fillStyle = dc.brush.color
    ctx.fill(p, dc.fillRule)
  }
  const points = (o: number, n: number, small: boolean): [number, number][] => {
    const out: [number, number][] = []
    for (let i = 0; i < n; i++) {
      out.push(small ? [dv.getInt16(o + i * 4, true), dv.getInt16(o + i * 4 + 2, true)] : [dv.getInt32(o + i * 8, true), dv.getInt32(o + i * 8 + 4, true)])
    }
    return out
  }
  const target = () => path ?? new Path2D()
  const polyRecord = (o: number, small: boolean, kind: 'polygon' | 'polyline' | 'bezier' | 'lineto' | 'bezierto') => {
    const n = dv.getUint32(o + 24, true)
    const pts = points(o + 28, n, small)
    if (!pts.length) return
    const p = target()
    if (kind === 'lineto' || kind === 'bezierto') p.moveTo(dc.cur[0], dc.cur[1])
    else p.moveTo(pts[0][0], pts[0][1])
    const start = kind === 'lineto' || kind === 'bezierto' ? 0 : 1
    if (kind === 'bezier' || kind === 'bezierto') {
      for (let i = start; i + 2 < pts.length + (start ? 0 : 0); i += 3) p.bezierCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1])
    } else for (let i = start; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1])
    if (kind === 'polygon') p.closePath()
    dc.cur = pts[pts.length - 1]
    if (!path) {
      if (kind === 'polygon') fillIt(p)
      strokeIt(p)
    }
  }
  const polyPoly = (o: number, small: boolean, closed: boolean) => {
    const nPolys = dv.getUint32(o + 24, true)
    let q = o + 32 + nPolys * 4
    const p = target()
    for (let i = 0; i < nPolys; i++) {
      const n = dv.getUint32(o + 32 + i * 4, true)
      const pts = points(q, n, small)
      q += n * (small ? 4 : 8)
      if (!pts.length) continue
      p.moveTo(pts[0][0], pts[0][1])
      for (let j = 1; j < pts.length; j++) p.lineTo(pts[j][0], pts[j][1])
      if (closed) p.closePath()
    }
    if (!path) {
      if (closed) fillIt(p)
      strokeIt(p)
    }
  }
  const rectOf = (o: number) => [dv.getInt32(o, true), dv.getInt32(o + 4, true), dv.getInt32(o + 8, true), dv.getInt32(o + 12, true)]
  const drawDib = async (o: number, offBmi: number, cbBmi: number, offBits: number, cbBits: number, src: number[], dst: number[]) => {
    if (!cbBmi) return
    const img = await decodeDib(bytes.subarray(o + offBmi, o + offBmi + cbBmi), bytes.subarray(o + offBits, o + offBits + cbBits))
    if (!img) return
    applyTransform()
    const [sx, sy, sw, sh] = src
    const [dx, dy, dw, dh] = dst
    ctx.save()
    ctx.translate(dx + (dw < 0 ? dw : 0), dy + (dh < 0 ? dh : 0))
    if (dw < 0 || dh < 0) ctx.scale(dw < 0 ? -1 : 1, dh < 0 ? -1 : 1)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sw || img.width, sh || img.height, 0, 0, Math.abs(dw), Math.abs(dh))
    ctx.restore()
    if ('close' in img) (img as ImageBitmap).close()
  }

  let o = 0
  while (o + 8 <= bytes.length) {
    const type = dv.getUint32(o, true)
    const size = dv.getUint32(o + 4, true)
    if (size < 8 || o + size > bytes.length) break
    try {
      switch (type) {
        case 14: // EOF
          return
        case 9: // SETWINDOWEXTEX
          dc.winExt = [dv.getInt32(o + 8, true), dv.getInt32(o + 12, true)]
          break
        case 10: // SETWINDOWORGEX
          dc.winOrg = [dv.getInt32(o + 8, true), dv.getInt32(o + 12, true)]
          break
        case 11: // SETVIEWPORTEXTEX
          dc.vpExt = [dv.getInt32(o + 8, true), dv.getInt32(o + 12, true)]
          break
        case 12: // SETVIEWPORTORGEX
          dc.vpOrg = [dv.getInt32(o + 8, true), dv.getInt32(o + 12, true)]
          break
        case 17: // SETMAPMODE
          dc.mapMode = dv.getUint32(o + 8, true)
          break
        case 18: // SETBKMODE
          dc.bkMode = dv.getUint32(o + 8, true)
          break
        case 19: // SETPOLYFILLMODE
          dc.fillRule = dv.getUint32(o + 8, true) === 2 ? 'nonzero' : 'evenodd'
          break
        case 22: // SETTEXTALIGN
          dc.textAlign = dv.getUint32(o + 8, true)
          break
        case 24: // SETTEXTCOLOR
          dc.textColor = colorRef(dv, o + 8)
          break
        case 25: // SETBKCOLOR
          dc.bkColor = colorRef(dv, o + 8)
          break
        case 27: // MOVETOEX
          dc.cur = [dv.getInt32(o + 8, true), dv.getInt32(o + 12, true)]
          if (path) path.moveTo(dc.cur[0], dc.cur[1])
          break
        case 54: {
          // LINETO
          const x = dv.getInt32(o + 8, true)
          const y = dv.getInt32(o + 12, true)
          if (path) path.lineTo(x, y)
          else {
            const p = new Path2D()
            p.moveTo(dc.cur[0], dc.cur[1])
            p.lineTo(x, y)
            strokeIt(p)
          }
          dc.cur = [x, y]
          break
        }
        case 33: // SAVEDC
          stack.push(cloneDc(dc))
          ctx.save()
          break
        case 34: {
          // RESTOREDC (relative, negative)
          let n = dv.getInt32(o + 8, true)
          n = n < 0 ? -n : Math.max(1, stack.length - n + 1)
          for (let i = 0; i < n && stack.length; i++) {
            dc = stack.pop()!
            ctx.restore()
          }
          break
        }
        case 35: // SETWORLDTRANSFORM
          dc.world = xform(dv, o + 8)
          break
        case 36: {
          // MODIFYWORLDTRANSFORM
          const m = xform(dv, o + 8)
          const mode = dv.getUint32(o + 32, true)
          if (mode === 1) dc.world = new DOMMatrix()
          else if (mode === 2) dc.world = dc.world.multiply(m) // left multiply: xform applies first
          else if (mode === 3) dc.world = m.multiply(dc.world)
          else if (mode === 4) dc.world = m
          break
        }
        case 37: {
          // SELECTOBJECT
          const h = dv.getUint32(o + 8, true)
          const obj = h & 0x80000000 ? STOCK[h & 0x7fffffff] : objects[h]
          if (obj?.kind === 'pen') dc.pen = obj
          else if (obj?.kind === 'brush') dc.brush = obj
          else if (obj?.kind === 'font') dc.font = obj
          break
        }
        case 38: {
          // CREATEPEN
          const style = dv.getUint32(o + 12, true)
          objects[dv.getUint32(o + 8, true)] = { kind: 'pen', none: (style & 0xf) === 5, width: dv.getInt32(o + 16, true), color: colorRef(dv, o + 24), dash: dashOf(style) }
          break
        }
        case 95: {
          // EXTCREATEPEN: ihPen, offBmi, cbBmi, offBits, cbBits, then LOGPENEX at +28
          const style = dv.getUint32(o + 28, true)
          objects[dv.getUint32(o + 8, true)] = {
            kind: 'pen',
            none: (style & 0xf) === 5 || dv.getUint32(o + 36, true) === 1,
            width: dv.getUint32(o + 32, true),
            color: colorRef(dv, o + 40),
            dash: dashOf(style)
          }
          break
        }
        case 39: {
          // CREATEBRUSHINDIRECT
          const style = dv.getUint32(o + 12, true)
          objects[dv.getUint32(o + 8, true)] = { kind: 'brush', none: style === 1, color: colorRef(dv, o + 16) }
          break
        }
        case 93: // CREATEMONOBRUSH
        case 94: // CREATEDIBPATTERNBRUSHPT
          objects[dv.getUint32(o + 8, true)] = { kind: 'brush', none: false, color: '#808080' }
          break
        case 82: {
          // EXTCREATEFONTINDIRECTW
          const lf = o + 12
          let face = ''
          for (let i = 0; i < 32; i++) {
            const c = dv.getUint16(lf + 28 + i * 2, true)
            if (!c) break
            face += String.fromCharCode(c)
          }
          objects[dv.getUint32(o + 8, true)] = {
            kind: 'font',
            height: dv.getInt32(lf, true),
            escapement: dv.getInt32(lf + 8, true),
            weight: dv.getInt32(lf + 16, true) || 400,
            italic: dv.getUint8(lf + 20) !== 0,
            underline: dv.getUint8(lf + 21) !== 0,
            face: face || 'sans-serif'
          }
          break
        }
        case 40: // DELETEOBJECT
          objects[dv.getUint32(o + 8, true)] = undefined
          break
        case 59: // BEGINPATH
          path = new Path2D()
          break
        case 60: // ENDPATH
          break
        case 61: // CLOSEFIGURE
          path?.closePath()
          break
        case 62: // FILLPATH
          if (path) fillIt(path)
          path = null
          break
        case 63: // STROKEANDFILLPATH
          if (path) {
            fillIt(path)
            strokeIt(path)
          }
          path = null
          break
        case 64: // STROKEPATH
          if (path) strokeIt(path)
          path = null
          break
        case 66: // ABORTPATH
          path = null
          break
        case 67: // SELECTCLIPPATH
          if (path) {
            applyTransform()
            ctx.clip(path, dc.fillRule)
          }
          path = null
          break
        case 30: {
          // INTERSECTCLIPRECT
          const [l, t, r, b] = rectOf(o + 8)
          applyTransform()
          const p = new Path2D()
          p.rect(l, t, r - l, b - t)
          ctx.clip(p)
          break
        }
        case 75: {
          // EXTSELECTCLIPRGN: rectangles in device units; RGN_COPY with no data = no clipping.
          const cb = dv.getUint32(o + 8, true)
          const mode = dv.getUint32(o + 12, true)
          if (cb >= 32 && (mode === 1 || mode === 5)) {
            const n = dv.getUint32(o + 16 + 8, true)
            const p = new Path2D()
            for (let i = 0; i < n; i++) {
              const [l, t, r, b] = rectOf(o + 16 + 32 + i * 16)
              p.rect(l, t, r - l, b - t)
            }
            ctx.setTransform(base)
            if (n) ctx.clip(p)
          }
          break
        }
        case 86: // POLYGON16
          polyRecord(o, true, 'polygon')
          break
        case 3: // POLYGON
          polyRecord(o, false, 'polygon')
          break
        case 87: // POLYLINE16
          polyRecord(o, true, 'polyline')
          break
        case 4: // POLYLINE
          polyRecord(o, false, 'polyline')
          break
        case 85: // POLYBEZIER16
          polyRecord(o, true, 'bezier')
          break
        case 2: // POLYBEZIER
          polyRecord(o, false, 'bezier')
          break
        case 88: // POLYBEZIERTO16
          polyRecord(o, true, 'bezierto')
          break
        case 5: // POLYBEZIERTO
          polyRecord(o, false, 'bezierto')
          break
        case 89: // POLYLINETO16
          polyRecord(o, true, 'lineto')
          break
        case 6: // POLYLINETO
          polyRecord(o, false, 'lineto')
          break
        case 91: // POLYPOLYGON16
          polyPoly(o, true, true)
          break
        case 8: // POLYPOLYGON
          polyPoly(o, false, true)
          break
        case 90: // POLYPOLYLINE16
          polyPoly(o, true, false)
          break
        case 43: {
          // RECTANGLE
          const [l, t, r, b] = rectOf(o + 8)
          const p = target()
          p.rect(l, t, r - l, b - t)
          if (!path) {
            fillIt(p)
            strokeIt(p)
          }
          break
        }
        case 44: {
          // ROUNDRECT
          const [l, t, r, b] = rectOf(o + 8)
          const cw = dv.getInt32(o + 24, true) / 2
          const ch = dv.getInt32(o + 28, true) / 2
          const p = target()
          p.roundRect(l, t, r - l, b - t, Math.min(cw, ch))
          if (!path) {
            fillIt(p)
            strokeIt(p)
          }
          break
        }
        case 42: {
          // ELLIPSE
          const [l, t, r, b] = rectOf(o + 8)
          const p = target()
          p.ellipse((l + r) / 2, (t + b) / 2, Math.abs(r - l) / 2, Math.abs(b - t) / 2, 0, 0, Math.PI * 2)
          if (!path) {
            fillIt(p)
            strokeIt(p)
          }
          break
        }
        case 84: // EXTTEXTOUTW
          text(o)
          break
        case 81: {
          // STRETCHDIBITS
          const xd = dv.getInt32(o + 24, true)
          const yd = dv.getInt32(o + 28, true)
          const xs = dv.getInt32(o + 32, true)
          const ys = dv.getInt32(o + 36, true)
          const cxs = dv.getInt32(o + 40, true)
          const cys = dv.getInt32(o + 44, true)
          const offBmi = dv.getUint32(o + 48, true)
          const cbBmi = dv.getUint32(o + 52, true)
          const offBits = dv.getUint32(o + 56, true)
          const cbBits = dv.getUint32(o + 60, true)
          const cxd = dv.getInt32(o + 72, true)
          const cyd = dv.getInt32(o + 76, true)
          await drawDib(o, offBmi, cbBmi, offBits, cbBits, [xs, ys, cxs, cys], [xd, yd, cxd, cyd])
          break
        }
        case 76: // BITBLT
        case 77: {
          // STRETCHBLT
          const xd = dv.getInt32(o + 24, true)
          const yd = dv.getInt32(o + 28, true)
          const cxd = dv.getInt32(o + 32, true)
          const cyd = dv.getInt32(o + 36, true)
          const rop = dv.getUint32(o + 40, true)
          const xs = dv.getInt32(o + 44, true)
          const ys = dv.getInt32(o + 48, true)
          const offBmi = dv.getUint32(o + 84, true)
          const cbBmi = dv.getUint32(o + 88, true)
          const offBits = dv.getUint32(o + 92, true)
          const cbBits = dv.getUint32(o + 96, true)
          const cxs = type === 77 ? dv.getInt32(o + 100, true) : cxd
          const cys = type === 77 ? dv.getInt32(o + 104, true) : cyd
          if (cbBmi) await drawDib(o, offBmi, cbBmi, offBits, cbBits, [xs, ys, cxs, cys], [xd, yd, cxd, cyd])
          else if (rop === 0x00f00021 || rop === 0x00ff0062 || rop === 0x00000042) {
            // PATCOPY with the brush, WHITENESS, BLACKNESS
            applyTransform()
            ctx.fillStyle = rop === 0x00ff0062 ? '#fff' : rop === 0x00000042 ? '#000' : dc.brush.color
            if (rop !== 0x00f00021 || !dc.brush.none) ctx.fillRect(xd, yd, cxd, cyd)
          }
          break
        }
      }
    } catch (err) {
      console.warn('emf: record skipped', type, err)
    }
    o += size
  }

  function text(o: number) {
    const ref = [dv.getInt32(o + 36, true), dv.getInt32(o + 40, true)]
    const n = dv.getUint32(o + 44, true)
    const offString = dv.getUint32(o + 48, true)
    const options = dv.getUint32(o + 52, true)
    const offDx = dv.getUint32(o + 72, true)
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint16(o + offString + i * 2, true))
    if (!s.trim()) return
    const f = dc.font
    applyTransform()
    ctx.save()
    const size = Math.abs(f.height) || 12
    ctx.font = `${f.italic ? 'italic ' : ''}${f.weight} ${size}px "${f.face.replace(/"/g, '')}", sans-serif`
    ctx.fillStyle = dc.textColor
    const align = dc.textAlign
    ctx.textBaseline = (align & 24) === 24 ? 'alphabetic' : align & 8 ? 'bottom' : 'top'
    const x0 = (align & 1) !== 0 ? dc.cur[0] : ref[0]
    const y0 = (align & 1) !== 0 ? dc.cur[1] : ref[1]
    ctx.translate(x0, y0)
    if (f.escapement) ctx.rotate((-f.escapement / 10) * (Math.PI / 180))
    // Per-glyph advances when present (ETO_PDY doubles them).
    const dx: number[] = []
    if (offDx) {
      const step = options & 0x2000 ? 2 : 1
      for (let i = 0; i < n; i++) dx.push(dv.getInt32(o + offDx + i * 4 * step, true))
    }
    const total = dx.length ? dx.reduce((a, b) => a + b, 0) : ctx.measureText(s).width
    let x = (align & 6) === 6 ? -total / 2 : align & 2 ? -total : 0
    if (dx.length) {
      for (let i = 0; i < s.length; i++) {
        ctx.fillText(s[i], x, 0)
        x += dx[i]
      }
    } else ctx.fillText(s, x, 0)
    ctx.restore()
  }
}

function xform(dv: DataView, o: number): DOMMatrix {
  return new DOMMatrix([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true), dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)])
}

function dashOf(style: number): number[] {
  switch (style & 0xf) {
    case 1:
      return [6, 2]
    case 2:
      return [1, 2]
    case 3:
      return [6, 2, 1, 2]
    case 4:
      return [6, 2, 1, 2, 1, 2]
  }
  return []
}

/** A device-independent bitmap (BITMAPINFO + bits) → something drawImage accepts. */
export async function decodeDib(bmi: Uint8Array, bits: Uint8Array): Promise<ImageBitmap | HTMLCanvasElement | null> {
  const dv = new DataView(bmi.buffer, bmi.byteOffset, bmi.byteLength)
  const hdr = dv.getUint32(0, true)
  let w: number
  let h: number
  let bpp: number
  let comp = 0
  let clrUsed = 0
  if (hdr === 12) {
    w = dv.getUint16(4, true)
    h = dv.getInt16(6, true)
    bpp = dv.getUint16(10, true)
  } else {
    w = dv.getInt32(4, true)
    h = dv.getInt32(8, true)
    bpp = dv.getUint16(14, true)
    comp = dv.getUint32(16, true)
    clrUsed = dv.getUint32(32, true)
  }
  if (comp === 4 || comp === 5) {
    // BI_JPEG / BI_PNG: the bits are a whole JPEG or PNG file.
    return createImageBitmap(new Blob([bits as BlobPart], { type: comp === 4 ? 'image/jpeg' : 'image/png' }))
  }
  if (comp === 1 || comp === 2) return null // RLE: not supported
  const topDown = h < 0
  h = Math.abs(h)
  if (!w || !h || w * h > 64_000_000) return null
  const palette: number[][] = []
  const entry = hdr === 12 ? 3 : 4
  const nPal = bpp <= 8 ? clrUsed || 1 << bpp : 0
  for (let i = 0; i < nPal; i++) {
    const q = hdr + i * entry
    if (q + 2 >= bmi.length) break
    palette.push([bmi[q + 2], bmi[q + 1], bmi[q]])
  }
  let masks: [number, number, number] | null = null
  if (comp === 3 || comp === 6) {
    const mo = hdr === 40 ? 40 : 40
    masks = [dv.getUint32(mo, true), dv.getUint32(mo + 4, true), dv.getUint32(mo + 8, true)]
  } else if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f]
  const stride = ((w * bpp + 31) >> 5) * 4
  const out = new ImageData(w, h)
  const px = out.data
  const bv = new DataView(bits.buffer, bits.byteOffset, bits.byteLength)
  let anyAlpha = false
  const chan = (v: number, m: number) => {
    if (!m) return 0
    let shift = 0
    while (!((m >> shift) & 1)) shift++
    const max = m >>> shift
    return Math.round((((v & m) >>> shift) * 255) / max)
  }
  for (let y = 0; y < h; y++) {
    const row = (topDown ? y : h - 1 - y) * stride
    if (row + stride > bits.length + 3) break
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r = 0
      let g = 0
      let b = 0
      let a = 255
      if (bpp === 24) {
        const q = row + x * 3
        b = bits[q]
        g = bits[q + 1]
        r = bits[q + 2]
      } else if (bpp === 32) {
        const q = row + x * 4
        if (masks) {
          const v = bv.getUint32(q, true)
          r = chan(v, masks[0])
          g = chan(v, masks[1])
          b = chan(v, masks[2])
        } else {
          b = bits[q]
          g = bits[q + 1]
          r = bits[q + 2]
          a = bits[q + 3]
          if (a) anyAlpha = true
        }
      } else if (bpp === 16) {
        const v = bv.getUint16(row + x * 2, true)
        r = chan(v, masks![0])
        g = chan(v, masks![1])
        b = chan(v, masks![2])
      } else {
        const per = 8 / bpp
        const byte = bits[row + Math.floor(x / per)]
        const idx = (byte >> (8 - bpp * ((x % per) + 1))) & ((1 << bpp) - 1)
        const c = palette[idx] ?? [0, 0, 0]
        r = c[0]
        g = c[1]
        b = c[2]
      }
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = a
    }
  }
  // 32-bit BI_RGB usually leaves alpha at 0 (= unused): treat as opaque unless some pixel uses it.
  if (bpp === 32 && !masks && !anyAlpha) for (let i = 3; i < px.length; i += 4) px[i] = 255
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.putImageData(out, 0, 0)
  return c
}
