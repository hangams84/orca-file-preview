/** Pictures inside Office documents → URLs a browser can show.
 *
 *  - The format comes from the bytes (magic numbers), not the part name: files named .jpg that are
 *    PNG, .jfif, .tmp etc. all work.
 *  - PNG/JPEG/GIF/BMP/WebP/ICO/AVIF/SVG load natively (blob URLs).
 *  - TIFF is decoded with UTIF.js (first page, MIT), WMF is played to SVG with rtf.js's WMFJS (MIT),
 *    both vendored and loaded on first use; EMF is played on a canvas by office/emf.ts.
 *  - Very large rasters (> MAX_PIXELS) are decoded with a size budget via createImageBitmap so a
 *    48 MP photo still shows without holding the full-size bitmap.
 *  - DrawingML blip effects (grayscale, black & white, duotone, brightness/contrast, alpha,
 *    transparent colour) are applied on a canvas, so they work for <img>, CSS backgrounds and SVG
 *    pattern fills alike.
 *  - Formats nothing here can decode (HEIC, JPEG XR / HD Photo, unknown) report a reason the
 *    renderer shows in a placeholder. */

import { renderEmf } from './emf.ts'

export type PictureKind = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'ico' | 'avif' | 'heic' | 'svg' | 'tiff' | 'emf' | 'wmf' | 'wdp' | 'unknown'

const NATIVE: Partial<Record<PictureKind, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml'
}

/** Pixel budget above which rasters are decoded downscaled (≈ 16 MP). */
export const MAX_PIXELS = 16_000_000
/** Office ignores EXIF orientation (it rotates the shape instead), so decoded bitmaps must too.
 *  'none' is the current spec value; older engines only know 'flipY' | 'from-image' (default 'none'). */
const NO_EXIF = 'none' as ImageOrientation
/** Longest edge of a downscaled bitmap. */
const MAX_EDGE = 4096

export function sniff(b: Uint8Array): PictureKind {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  const ascii = (i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0))
  if (b.length < 12) return 'unknown'
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg'
  if (ascii(0, 'GIF8')) return 'gif'
  if (ascii(0, 'BM')) return 'bmp'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp'
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'tiff'
  if (at(0, 0x49, 0x49, 0xbc)) return 'wdp' // JPEG XR / HD Photo
  if (at(0, 0x00, 0x00, 0x01, 0x00) || at(0, 0x00, 0x00, 0x02, 0x00)) return 'ico'
  if (at(0, 0x01, 0x00, 0x00, 0x00) && ascii(40, ' EMF')) return 'emf'
  if (at(0, 0xd7, 0xcd, 0xc6, 0x9a) || (at(0, 0x01, 0x00, 0x09, 0x00) || at(0, 0x02, 0x00, 0x09, 0x00))) return 'wmf'
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...b.subarray(8, 12))
    if (/avi[fs]/.test(brand)) return 'avif'
    if (/hei[cfmsx]|mif1|msf1|hev[cx]/.test(brand)) return 'heic'
  }
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 512))).trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg'
  return 'unknown'
}

/** Pixel size from the header of PNG/JPEG/GIF/BMP/WebP, without decoding. */
export function rasterSize(b: Uint8Array, kind: PictureKind): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  try {
    if (kind === 'png') return { w: dv.getUint32(16), h: dv.getUint32(20) }
    if (kind === 'gif') return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
    if (kind === 'bmp') return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) }
    if (kind === 'jpeg') {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const m = b[i + 1]
        const len = dv.getUint16(i + 2)
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) }
        i += 2 + len
      }
    }
    if (kind === 'webp' && String.fromCharCode(...b.subarray(12, 16)) === 'VP8X')
      return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  } catch {
    // truncated header
  }
  return null
}

// ---------------------------------------------------------------- effects

export interface PictureEffects {
  grayscale?: boolean
  /** Black & white threshold 0..1 (a:biLevel). */
  biLevel?: number
  /** Two colours [r,g,b] mapped along luminance (a:duotone). */
  duotone?: [[number, number, number], [number, number, number]]
  /** a:lum: brightness and contrast in -1..1. */
  bright?: number
  contrast?: number
  /** a:alphaModFix: 0..1. */
  alpha?: number
  /** a:clrChange: pixels of this colour become transparent (or `to`). */
  clrFrom?: [number, number, number]
  clrTo?: [number, number, number, number]
}

export function effectsKey(e: PictureEffects | undefined): string {
  return e ? JSON.stringify(e) : ''
}

function hasEffects(e: PictureEffects | undefined): e is PictureEffects {
  return !!e && Object.values(e).some((v) => v !== undefined && v !== false)
}

/** Applies effects to RGBA pixels in place (exported for tests). */
export function applyEffects(px: Uint8ClampedArray, e: PictureEffects): void {
  // Contrast: slope 1 + contrast (1 / (1 − contrast) when positive) around mid-grey. Grayscale and black & white use Rec. 709 luma (PowerPoint's thresholds match it, not Rec. 601).
  const k = e.contrast ?? 0
  const factor = k >= 0 ? 1 / Math.max(0.0001, 1 - k) : 1 + k
  const bright = e.bright ?? 0
  const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]
    let g = px[i + 1]
    let b = px[i + 2]
    if (e.clrFrom && Math.abs(r - e.clrFrom[0]) + Math.abs(g - e.clrFrom[1]) + Math.abs(b - e.clrFrom[2]) < 24) {
      const to = e.clrTo ?? [r, g, b, 0]
      px[i] = to[0]
      px[i + 1] = to[1]
      px[i + 2] = to[2]
      px[i + 3] = Math.round(px[i + 3] * to[3])
      continue
    }
    if (bright || k) {
      // Measured on PowerPoint's exports: the slope is exactly the contrast factor and brightness is
      // an additive offset around mid-grey, B(b) = 255·(0.9875·b − 0.4876·b·|b|) (exact for the
      // washout and ±40 % presets, odd-symmetric for darkening).
      const off = 255 * (0.9875 * bright - 0.4876 * bright * Math.abs(bright))
      const f = (v: number) => (v - 128) * factor + 128 + off
      r = f(r)
      g = f(g)
      b = f(b)
    }
    if (e.grayscale || e.biLevel !== undefined || e.duotone) {
      const y = lum(Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)))
      if (e.biLevel !== undefined) r = g = b = y >= e.biLevel ? 255 : 0
      else if (e.duotone) {
        const [c1, c2] = e.duotone
        r = c1[0] + (c2[0] - c1[0]) * y
        g = c1[1] + (c2[1] - c1[1]) * y
        b = c1[2] + (c2[2] - c1[2]) * y
      } else r = g = b = y * 255
    }
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    if (e.alpha !== undefined) px[i + 3] = px[i + 3] * e.alpha
  }
}

// ---------------------------------------------------------------- decoding

export type PictureResult = { url: string; width: number; height: number } | { error: string }

export interface PictureSource {
  bytes: Uint8Array
  /** Part name, for messages. */
  name: string
}

const canvasBlob = (c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> =>
  'convertToBlob' in c
    ? c.convertToBlob({ type: 'image/png' })
    : new Promise((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

let metafileLib: Promise<typeof import('../../../vendor/metafile.js')> | null = null
let tiffLib: Promise<typeof import('../../../vendor/tiff.js')> | null = null

/** WMF → SVG markup (rtf.js WMFJS), sized from the placeable header. */
export async function wmfToSvg(bytes: Uint8Array): Promise<{ svg: string; width: number; height: number }> {
  metafileLib ??= import('../../../vendor/metafile.js')
  const { WMFJS } = await metafileLib
  WMFJS.loggingEnabled(false)
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const dv = new DataView(buf)
  let w = 0
  let h = 0
  let inch = 1440
  if (dv.getUint32(0, true) === 0x9ac6cdd7) {
    w = dv.getInt16(10, true) - dv.getInt16(6, true)
    h = dv.getInt16(12, true) - dv.getInt16(8, true)
    inch = dv.getUint16(14, true) || 1440
  } else {
    // No placeable header (WMF blips in .doc/.ppt): use the first SETWINDOWEXT record.
    let o = dv.getUint16(2, true) * 2
    while (o + 6 <= bytes.length) {
      const size = dv.getUint32(o, true) * 2
      const fn = dv.getUint16(o + 4, true)
      if (fn === 0x020c) {
        h = dv.getInt16(o + 6, true)
        w = dv.getInt16(o + 8, true)
        break
      }
      if (size < 6 || fn === 0) break
      o += size
    }
    inch = 1440
  }
  const width = w ? Math.min(2000, (Math.abs(w) / inch) * 96) : 400
  const height = h ? Math.min(2000, (Math.abs(h) / inch) * 96) : 300
  const el = new WMFJS.Renderer(buf).render({ width: `${width}px`, height: `${height}px`, xExt: Math.abs(w) || 1000, yExt: Math.abs(h) || 750, mapMode: 8 })
  el.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  el.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  el.setAttribute('preserveAspectRatio', 'none')
  return { svg: new XMLSerializer().serializeToString(el), width, height }
}

/** TIFF → RGBA of the first page. */
export async function decodeTiff(bytes: Uint8Array): Promise<ImageData> {
  tiffLib ??= import('../../../vendor/tiff.js')
  const UTIF = await tiffLib
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const ifds = UTIF.decode(buf)
  const page = ifds.find((i) => i.t256 && i.t257) ?? ifds[0]
  if (!page) throw new Error('no TIFF image')
  UTIF.decodeImage(buf, page)
  const rgba = UTIF.toRGBA8(page)
  const w = page.width ?? 0
  const h = page.height ?? 0
  if (!w || !h) throw new Error('empty TIFF image')
  const px = new Uint8ClampedArray(w * h * 4)
  px.set(rgba.subarray(0, w * h * 4))
  return new ImageData(px, w, h)
}

async function bitmapOf(blob: Blob, size: { w: number; h: number } | null): Promise<ImageBitmap> {
  if (size && size.w * size.h > MAX_PIXELS) {
    const k = Math.min(1, MAX_EDGE / Math.max(size.w, size.h))
    return createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(size.w * k)), resizeHeight: Math.max(1, Math.round(size.h * k)), resizeQuality: 'high', imageOrientation: NO_EXIF })
  }
  return createImageBitmap(blob, { imageOrientation: NO_EXIF })
}

/** Loads one picture part. `own(url)` registers object URLs for revocation. */
export async function loadPicture(src: PictureSource, effects: PictureEffects | undefined, own: (url: string) => string): Promise<PictureResult> {
  const kind = sniff(src.bytes)
  const fx = hasEffects(effects) ? effects : undefined
  try {
    if (kind === 'heic') return { error: 'HEIC/HEIF' }
    if (kind === 'wdp') return { error: 'JPEG XR (HD Photo)' }
    if (kind === 'unknown') return { error: 'unknown format' }

    if (kind === 'emf') {
      const { canvas, width, height } = await renderEmf(src.bytes)
      if (fx) applyCanvas(canvas, fx)
      return { url: own(URL.createObjectURL(await canvasBlob(canvas))), width, height }
    }
    if (kind === 'wmf') {
      const m = await wmfToSvg(src.bytes)
      const blob = new Blob([m.svg], { type: 'image/svg+xml' })
      if (!fx) return { url: own(URL.createObjectURL(blob)), width: m.width, height: m.height }
      // Effects need pixels: rasterise the SVG at 2x.
      const img = await loadImg(own(URL.createObjectURL(blob)))
      return rasterise(img, m.width * 2, m.height * 2, fx, own)
    }
    if (kind === 'tiff') {
      const data = await decodeTiff(src.bytes)
      const c = newCanvas(data.width, data.height)
      c.getContext('2d')!.putImageData(data, 0, 0)
      if (fx) applyCanvas(c, fx)
      return { url: own(URL.createObjectURL(await canvasBlob(c))), width: data.width, height: data.height }
    }
    const type = NATIVE[kind]!
    const blob = new Blob([src.bytes as BlobPart], { type })
    const size = rasterSize(src.bytes, kind)
    const big = !!size && size.w * size.h > MAX_PIXELS
    if (!fx && !big) return { url: own(URL.createObjectURL(blob)), width: size?.w ?? 0, height: size?.h ?? 0 }
    if (kind === 'svg') {
      const img = await loadImg(own(URL.createObjectURL(blob)))
      return rasterise(img, img.naturalWidth || 800, img.naturalHeight || 600, fx!, own)
    }
    // Large or with effects: decode (downscaled when large), then draw.
    const bmp = await bitmapOf(blob, size)
    const c = newCanvas(bmp.width, bmp.height)
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    bmp.close()
    if (fx) applyCanvas(c, fx)
    return { url: own(URL.createObjectURL(await canvasBlob(c))), width: size?.w ?? c.width, height: size?.h ?? c.height }
  } catch (err) {
    console.warn('picture decode failed', src.name, err)
    return { error: `${kind.toUpperCase()} could not be decoded` }
  }
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('image failed to load'))
    img.src = url
  })
}

async function rasterise(img: HTMLImageElement, w: number, h: number, fx: PictureEffects, own: (u: string) => string): Promise<PictureResult> {
  const k = Math.min(1, MAX_EDGE / Math.max(w, h))
  const c = newCanvas(w * k, h * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  applyCanvas(c, fx)
  return { url: own(URL.createObjectURL(await canvasBlob(c))), width: w, height: h }
}

function applyCanvas(c: HTMLCanvasElement, fx: PictureEffects): void {
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, c.width, c.height)
  applyEffects(data.data, fx)
  ctx.putImageData(data, 0, 0)
}

/** Re-decodes <img> elements whose blob the browser cannot show (TIFF, EMF, WMF, …), e.g. in
 *  docx-preview output. Native formats are left alone. Resolves when all are done. */
export async function fixImages(container: ParentNode, own: (url: string) => string, limit = 200): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img')).filter((im) => im.src.startsWith('blob:')).slice(0, limit)
  await Promise.all(
    imgs.map(async (im) => {
      try {
        const bytes = new Uint8Array(await (await fetch(im.src)).arrayBuffer())
        const kind = sniff(bytes)
        if (NATIVE[kind] && kind !== 'svg') {
          // Native: still fix a wrong MIME type (e.g. .jfif/.tmp parts) by re-wrapping only if it failed.
          if (im.complete && im.naturalWidth > 0) return
          im.src = own(URL.createObjectURL(new Blob([bytes as BlobPart], { type: NATIVE[kind] })))
          return
        }
        if (kind === 'svg') return
        const r = await loadPicture({ bytes, name: im.alt || 'picture' }, undefined, own)
        if ('error' in r) {
          im.alt = `${im.alt ? im.alt + ': ' : ''}${r.error}`
          im.title = r.error
        } else im.src = r.url
      } catch {
        // leave the original
      }
    })
  )
}

/** A picture in bytes + MIME (legacy .doc/.ppt models): converts formats browsers cannot show into
 *  ones they can (EMF/TIFF → PNG, WMF → SVG). Native formats get their sniffed MIME type. */
export async function toBrowserPicture(p: { bytes: Uint8Array; mime: string }): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const kind = sniff(p.bytes)
  try {
    if (NATIVE[kind]) return { bytes: p.bytes, mime: NATIVE[kind]! }
    if (kind === 'wmf') {
      const m = await wmfToSvg(p.bytes)
      return { bytes: new TextEncoder().encode(m.svg), mime: 'image/svg+xml' }
    }
    if (kind === 'emf' || kind === 'tiff') {
      let c: HTMLCanvasElement
      if (kind === 'emf') c = (await renderEmf(p.bytes)).canvas
      else {
        const data = await decodeTiff(p.bytes)
        c = newCanvas(data.width, data.height)
        c.getContext('2d')!.putImageData(data, 0, 0)
      }
      return { bytes: new Uint8Array(await (await canvasBlob(c)).arrayBuffer()), mime: 'image/png' }
    }
  } catch (err) {
    console.warn('picture conversion failed', err)
  }
  return null
}

/** Walks a document model and converts every `{ bytes, mime }` picture in place (see
 *  toBrowserPicture). Pictures that cannot be converted keep their bytes (the renderer shows a
 *  broken image as before). */
export async function normalizePictures(model: unknown, limit = 500): Promise<void> {
  const seen = new WeakSet<object>()
  const found: { bytes: Uint8Array; mime: string }[] = []
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v) || found.length >= limit) return
    seen.add(v)
    if (v instanceof Uint8Array || ArrayBuffer.isView(v)) return
    const o = v as Record<string, unknown>
    if (o.bytes instanceof Uint8Array && typeof o.mime === 'string') {
      found.push(o as { bytes: Uint8Array; mime: string })
      return
    }
    for (const k in o) walk(o[k])
  }
  walk(model)
  await Promise.all(
    found.map(async (p) => {
      if (/^image\/(png|jpeg|gif|bmp|webp|svg\+xml)$/.test(p.mime) && NATIVE[sniff(p.bytes)] === p.mime) return
      const r = await toBrowserPicture(p)
      if (r) {
        p.bytes = r.bytes
        p.mime = r.mime
      }
    })
  )
}
