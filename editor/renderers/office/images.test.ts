import { assert, test } from 'orca/testing'
import { applyEffects, rasterSize, sniff } from './images.ts'

const bytes = (...v: (number | string)[]) => {
  const out: number[] = []
  for (const x of v) typeof x === 'string' ? out.push(...[...x].map((c) => c.charCodeAt(0))) : out.push(x)
  while (out.length < 64) out.push(0)
  return new Uint8Array(out)
}

test('sniffs picture formats from magic bytes, not names', () => {
  assert.equal(sniff(bytes(0x89, 'PNG\r\n', 0x1a, '\n')), 'png')
  assert.equal(sniff(bytes(0xff, 0xd8, 0xff, 0xe0)), 'jpeg')
  assert.equal(sniff(bytes('GIF89a')), 'gif')
  assert.equal(sniff(bytes('BM')), 'bmp')
  assert.equal(sniff(bytes('RIFF', 0, 0, 0, 0, 'WEBP')), 'webp')
  assert.equal(sniff(bytes('II*', 0)), 'tiff')
  assert.equal(sniff(bytes('MM', 0, '*')), 'tiff')
  assert.equal(sniff(bytes(0, 0, 1, 0, 1, 0)), 'ico')
  assert.equal(sniff(bytes(0xd7, 0xcd, 0xc6, 0x9a)), 'wmf')
  const emf = bytes(1, 0, 0, 0)
  emf.set([0x20, 0x45, 0x4d, 0x46], 40)
  assert.equal(sniff(emf), 'emf')
  assert.equal(sniff(bytes(0, 0, 0, 0x1c, 'ftypavif')), 'avif')
  assert.equal(sniff(bytes(0, 0, 0, 0x18, 'ftypheic')), 'heic')
  assert.equal(sniff(bytes(0x49, 0x49, 0xbc, 1)), 'wdp')
  assert.equal(sniff(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>      ')), 'svg')
  assert.equal(sniff(bytes('hello world')), 'unknown')
})

test('reads raster sizes from headers', () => {
  const png = bytes(0x89, 'PNG\r\n', 0x1a, '\n', 0, 0, 0, 13, 'IHDR', 0, 0, 0x1f, 0x40, 0, 0, 0x17, 0x70)
  assert.deepEqual(rasterSize(png, 'png'), { w: 8000, h: 6000 })
  const gif = bytes('GIF89a', 0x58, 0x02, 0x90, 0x01)
  assert.deepEqual(rasterSize(gif, 'gif'), { w: 600, h: 400 })
  // JPEG: SOI, APP0 (len 16), SOF0 with height 400 / width 600
  const jpg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x01, 0x90, 0x02, 0x58)
  assert.deepEqual(rasterSize(jpg, 'jpeg'), { w: 600, h: 400 })
})

const px = (...rgb: number[]) => new Uint8ClampedArray(rgb.flatMap((v, i) => (i % 3 === 2 ? [v, 255] : [v])))

test('black & white and grayscale use Rec. 709 luma like PowerPoint', () => {
  const p = px(40, 170, 70, 220, 40, 40)
  applyEffects(p, { biLevel: 0.5 })
  assert.deepEqual([...p.slice(0, 3)], [255, 255, 255], 'green turns white')
  assert.deepEqual([...p.slice(4, 7)], [0, 0, 0], 'red turns black')
  const g = px(240, 200, 30)
  applyEffects(g, { grayscale: true })
  assert.ok(Math.abs(g[0] - 196) <= 2 && g[0] === g[1] && g[1] === g[2])
})

test('brightness/contrast match PowerPoint washout and ±40 % presets', () => {
  const w = px(40, 70, 90)
  applyEffects(w, { bright: 0.7, contrast: -0.7 })
  assert.ok(Math.abs(w[0] - 217) <= 2 && Math.abs(w[1] - 226) <= 2 && Math.abs(w[2] - 232) <= 2, `washout ${[...w.slice(0, 3)]}`)
  const b = px(40, 90, 170)
  applyEffects(b, { bright: 0.4, contrast: -0.4 })
  assert.ok(Math.abs(b[0] - 156) <= 2 && Math.abs(b[1] - 186) <= 2 && Math.abs(b[2] - 234) <= 2, `bc ${[...b.slice(0, 3)]}`)
})

test('duotone, alpha and transparent colour', () => {
  const d = px(255, 255, 255, 0, 0, 0)
  applyEffects(d, { duotone: [[0, 0, 0], [100, 150, 200]] })
  assert.deepEqual([...d.slice(0, 3)], [100, 150, 200])
  assert.deepEqual([...d.slice(4, 7)], [0, 0, 0])
  const a = px(10, 20, 30)
  applyEffects(a, { alpha: 0.5 })
  assert.ok(Math.abs(a[3] - 128) <= 1)
  const t = px(220, 40, 40, 40, 170, 70)
  applyEffects(t, { clrFrom: [220, 40, 40], clrTo: [220, 40, 40, 0] })
  assert.equal(t[3], 0)
  assert.equal(t[7], 255)
})
