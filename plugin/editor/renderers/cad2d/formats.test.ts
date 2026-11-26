import { assert, test } from 'orca/testing'
import { matrix4, xmlTags } from './dwf/package.ts'
import { DEFAULT_MAP, readW2d } from './dwf/w2d.ts'
import { advancesFrom, deobfuscateFont, parseColor, parsePathData } from './dwfx.ts'
import { invert, mergePaths, mul, P, pathBox, type Item, type Mat, type PathItem, type TextItem } from './scene.ts'

/** A little W2D writer (binary opcodes, 32-bit relative coordinates). */
class W {
  b: number[] = [...new TextEncoder().encode('(W2D V06.00)')]
  cx = 0
  cy = 0
  i32(v: number) {
    const a = new Uint8Array(4)
    new DataView(a.buffer).setInt32(0, v, true)
    this.b.push(...a)
  }
  u16(v: number) {
    this.b.push(v & 255, (v >> 8) & 255)
  }
  pt(x: number, y: number) {
    this.i32(x - this.cx)
    this.i32(y - this.cy)
    this.cx = x
    this.cy = y
  }
  ascii(s: string) {
    this.b.push(...new TextEncoder().encode(s))
  }
  bytes() {
    return new Uint8Array(this.b)
  }
}

const layers = () => {
  const names: string[] = []
  return {
    names,
    map: (num: number, name?: string) => {
      const n = name ?? `Layer ${num}`
      let i = names.indexOf(n)
      if (i < 0) i = names.push(n) - 1
      return i
    }
  }
}

test('W2D: lines, polylines, circles, colours, fill, layers and text', () => {
  const w = new W()
  w.ascii("(Layer 1 'Walls')")
  w.b.push(0x03, 200, 0, 0, 255) // RGBA colour
  w.b.push(0x6c) // line
  w.pt(0, 0)
  w.pt(100, 0)
  w.b.push(0x70, 3) // polyline, 3 points
  w.pt(0, 10)
  w.pt(50, 60)
  w.pt(100, 10)
  w.b.push(0x46) // fill on
  w.b.push(0x72) // circle
  w.pt(50, 50)
  w.i32(25)
  w.b.push(0x66) // fill off
  w.b.push(0x63, 1) // indexed colour 1
  w.b.push(0x17)
  w.i32(4) // line weight
  // font: name + height
  w.b.push(0x06)
  w.u16(0x0021)
  w.b.push(0x7b)
  w.i32(5)
  for (const ch of 'Arial') w.u16(ch.charCodeAt(0))
  w.b.push(0x7d)
  w.i32(12)
  w.b.push(0x78) // text
  w.pt(10, 20)
  w.b.push(0x7b)
  w.i32(2)
  w.u16('한'.charCodeAt(0))
  w.u16('글'.charCodeAt(0))
  w.b.push(0x7d)
  w.ascii('(EndOfDWF)')
  const L = layers()
  const r = readW2d(w.bytes(), L.map)
  assert.equal(r.stopped, undefined)
  assert.equal(r.version, '06.00')
  assert.deepEqual(L.names, ['Walls'])
  const [line, poly, disk, text] = r.items as [PathItem, PathItem, PathItem, TextItem]
  assert.deepEqual(line.d, [P.M, 0, 0, P.L, 100, 0])
  assert.equal(line.color, 0xc80000)
  assert.equal(line.layer, 0)
  assert.deepEqual(poly.d, [P.M, 0, 10, P.L, 50, 60, P.L, 100, 10])
  assert.equal(disk.fill, true)
  assert.ok(disk.d.includes(P.E))
  assert.equal(text.text, '한글')
  assert.equal(text.family, 'Arial')
  assert.equal(text.h, 12)
  assert.equal(text.color, DEFAULT_MAP[1])
  assert.deepEqual([text.x, text.y], [10, 20])
})

test('W2D: 16-bit relative coordinates and contour sets with holes', () => {
  const w = new W()
  w.b.push(0x4f) // origin
  w.i32(1000)
  w.i32(1000)
  w.cx = w.cy = 1000
  w.b.push(0x0c) // 16-bit line: two relative points
  w.u16(10)
  w.u16(0)
  w.u16(20)
  w.u16(0xffff) // -1
  w.cx = 1030
  w.cy = 999
  w.b.push(0x6b, 2, 4, 4) // contour set: 2 loops of 4 points
  for (const [x, y] of [[0, 0], [10, 0], [10, 10], [0, 10], [2, 2], [8, 2], [8, 8], [2, 8]]) w.pt(x, y)
  const r = readW2d(w.bytes(), layers().map)
  const [line, contour] = r.items as PathItem[]
  assert.deepEqual(line.d, [P.M, 1010, 1000, P.L, 1030, 999])
  assert.equal(contour.fill, true)
  assert.equal(contour.evenOdd, true)
  assert.equal(contour.d.filter((v) => v === P.Z).length, 2)
})

test('W2D: an unknown opcode stops the stream and keeps what was read', () => {
  const w = new W()
  w.b.push(0x6c)
  w.pt(0, 0)
  w.pt(5, 5)
  w.b.push(0x01)
  const r = readW2d(w.bytes(), layers().map)
  assert.equal(r.items.length, 1)
  assert.match(r.stopped ?? '', /unsupported opcode 0x01/)
})

test('W2D: extended ASCII colour map, line weight and skipped informational opcodes', () => {
  const w = new W()
  w.ascii("(ColorMap 2 0,0,0,255 0,0,255,255)(LineWeight 7)(DrawingInfo (Author 'x (y)'))")
  w.b.push(0x63, 1, 0x6c)
  w.pt(0, 0)
  w.pt(1, 1)
  const r = readW2d(w.bytes(), layers().map)
  const line = r.items[0] as PathItem
  assert.equal(line.color, 0x0000ff)
  assert.equal(line.width, 7)
  assert.equal(r.ignored.size, 0)
})

test('DWF manifest helpers: tags with attributes and 4×4 transforms', () => {
  const tags = xmlTags('<dwf:Section type="ePlot" title="A &amp; B"><dwf:Resource role=\'descriptor\' href="x/d.xml"/></dwf:Section>')
  assert.deepEqual(tags.map((t) => t.name), ['Section', 'Resource'])
  assert.equal(tags[0].attrs.title, 'A & B')
  assert.equal(tags[1].attrs.href, 'x/d.xml')
  assert.deepEqual(matrix4('0.001 0 0 0 0 0.001 0 0 0 0 1 0 5 6 0 1'), [0.001, 0, 0, 0.001, 5, 6])
  assert.equal(matrix4('1 2 3'), null)
})

test('XPS colours: #RRGGBB, #AARRGGBB and scRGB', () => {
  assert.deepEqual(parseColor('#FF0000'), { rgb: 0xff0000, a: 1 })
  assert.deepEqual(parseColor('#80112233'), { rgb: 0x112233, a: 128 / 255 })
  assert.deepEqual(parseColor('sc#1,1,0,0'), { rgb: 0xff0000, a: 1 })
  assert.equal(parseColor('red'), null)
})

test('XPS path data: absolute, relative, H/V, close, fill rule and arcs', () => {
  const a = parsePathData('F1 M 0,0 L 10,0 V 10 H 0 Z m 2,2 l 1,0')
  assert.equal(a.evenOdd, false)
  assert.deepEqual(a.d, [P.M, 0, 0, P.L, 10, 0, P.L, 10, 10, P.L, 0, 10, P.Z, P.M, 2, 2, P.L, 3, 2])
  assert.equal(parsePathData('M0 0 L1 1').evenOdd, true)
  const arc = parsePathData('M 0,0 A 10,10 0 0 1 20,0')
  const e = arc.d.indexOf(P.E)
  assert.ok(e > 0)
  assert.deepEqual(arc.d.slice(e + 1, e + 5).map((v) => Math.round(v * 1e6) / 1e6), [10, 0, 10, 10])
  // mapped through a y-flip, a counter-clockwise sweep in y-down becomes clockwise in y-up
  const flipped = parsePathData('M 0,0 A 10,10 0 0 1 20,0', [1, 0, 0, -1, 0, 0])
  const f = flipped.d.indexOf(P.E)
  assert.equal(flipped.d[f + 8], arc.d[e + 8] === 1 ? 0 : 1)
})

test('XPS embedded fonts: obfuscation round trip and glyph advances', () => {
  const font = new Uint8Array(64).map((_, i) => i)
  const guid = '1B2C3D4E-5F60-4718-8293-A4B5C6D7E8F9'
  const once = deobfuscateFont(font, `${guid}.odttf`)!
  assert.notDeepEqual(Array.from(once.subarray(0, 32)), Array.from(font.subarray(0, 32)))
  assert.deepEqual(Array.from(once.subarray(32)), Array.from(font.subarray(32)))
  assert.deepEqual(Array.from(deobfuscateFont(once, `${guid}.odttf`)!), Array.from(font))
  // first key byte used is the last GUID byte (0xF9)
  assert.equal(once[0], 0 ^ 0xf9)
  assert.deepEqual(advancesFrom('12,50;13,60;14,40', 3), [0, 0.5, 1.1])
  assert.equal(advancesFrom('12;13,60', 2), undefined)
})

test('scene matrices and extents', () => {
  const m: Mat = [2, 0, 0, 3, 5, 7]
  const inv = invert(m)!
  const id = mul(m, inv)
  assert.deepEqual(id.map((v) => Math.round(v * 1e12) / 1e12 + 0), [1, 0, 0, 1, 0, 0])
  const b = pathBox([P.M, 0, 0, P.E, 0, 0, 5, 5, 0, 0, Math.PI * 2, 1])
  assert.ok(Math.abs(b.x0 + 5) < 1e-6 && Math.abs(b.y1 - 5) < 1e-6)
})

test('mergePaths joins runs of same-style strokes only', () => {
  const base = { k: 'path', layer: 0, color: 1, lw: 0, stroke: true, fill: false } as const
  const items: Item[] = [
    { ...base, d: [P.M, 0, 0, P.L, 1, 0] },
    { ...base, d: [P.M, 0, 1, P.L, 1, 1] },
    { ...base, color: 2, d: [P.M, 0, 2, P.L, 1, 2] },
    { ...base, fill: true, d: [P.M, 0, 3, P.L, 1, 3] }
  ]
  const out = mergePaths(items) as PathItem[]
  assert.equal(out.length, 3)
  assert.equal(out[0].d.length, 12)
  assert.equal((items[0] as PathItem).d.length, 6) // inputs untouched
})
