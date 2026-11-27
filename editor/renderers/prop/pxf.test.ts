import { assert, test } from 'orca/testing'
import { edbArchive, findEdb, scanArticles } from './edb.ts'
import { isPxf, parsePxf, pxfBounds, pxfSvg, variantLabel } from './pxf.ts'

const tr = (_ko: string, en: string) => en

// Shaped like the public Bachmann macros (EPLAN 2.8, PXF 1.23): numbered objects, "x/y" points in mm.
const PXF = `<?xml version="1.0" encoding="utf-8" ?>
<EplanPxfRoot Name="AI204_1" Type="WindowMacro" Version="2.8.12830" PxfVersion="1.23">
 <EplPxfDir><EplPxfDirEntry MacroFuncType="1" VariantId="0"/><EplPxfDirEntry MacroFuncType="4" VariantId="4"/></EplPxfDir>
 <MacroVariant MacroFuncType="1" VariantId="0" ReferencePoint="112/228/0" Description="" SelectionArea="112/232/152/132">
  <O31 Build="7352" A1="31/1" A414="0.13" A531="130/220" A532="112/220"/>
  <O31 Build="7352" A1="31/2" A414="L" A531="112/220" A532="112/226"/>
  <O32 Build="7352" A1="32/3" A414="0.13" A553="0" A554="1.5707963267949" A555="132/223" A556="3/0" A557="1"/>
  <O34 Build="7352" A1="34/4" A621="113/204;112.9/205;113/205.1;113.1/205.1" A622="0;0;0;0" A623="1" A624="1"/>
  <O30 Build="7352" A1="30/5" A501="113.2/222.4" A511="??_??@AI204/1;">
   <S54x505 A961="2.4" A966="10"/>
  </O30>
  <O30 Build="7352" A1="30/6" A501="139/135" A511="de_DE@Bereich &amp; Wert;en_US@range &amp; value;"/>
  <O89 Build="7352" A1="89/7" A1651="36/152" A1652="76/184"/>
  <O17 Build="8366" A1="17/8" A190="0/-95" A191="40/0">
   <S40x1201 A762="112/228"><S39x761 A751="1"/></S40x1201>
   <S89x5 A1651="0/-95" A1652="40/0"/>
  </O17>
  <O17 Build="7352" A1="17/9" A190="1.79769313486232e+52/1.79769313486232e+52"/>
 </MacroVariant>
 <MacroVariant MacroFuncType="4" VariantId="4" Description="Panel">
  <O31 A1="31/10" A531="0/0" A532="10/0"/>
 </MacroVariant>
</EplanPxfRoot>`

test('pxf: lines, arcs, curves, texts, rectangles and black boxes per variant', () => {
  assert.ok(isPxf(PXF.slice(0, 200)))
  const m = parsePxf(PXF)
  assert.equal(m.name, 'AI204_1')
  assert.equal(m.type, 'WindowMacro')
  assert.equal(m.variants.length, 2)
  const v = m.variants[0]
  assert.deepEqual(
    v.prims.map((p) => p.k),
    ['line', 'line', 'arc', 'bez', 'text', 'text', 'rect', 'rect']
  )
  const [l1, l2, arc, bez, t1, t2, rect, box] = v.prims as any[]
  assert.deepEqual([l1.a, l1.b, l1.w], [[130, 220], [112, 220], 0.13])
  assert.equal(l2.w, 0.25, '"L" (from layer) falls back to 0.25 mm')
  assert.deepEqual([arc.c, arc.rx, arc.ry, arc.a0], [[132, 223], 3, 3, 0])
  assert.equal(bez.p.length, 4)
  assert.deepEqual([t1.text, t1.h], ['AI204/1', 2.4])
  assert.equal(t2.text, 'range & value', 'English picked from the multilingual text')
  assert.deepEqual([rect.a, rect.b], [[36, 152], [76, 184]])
  assert.deepEqual([box.a, box.b, box.dashed], [[112, 133], [152, 228], true])
  assert.equal(v.symbols, 2)
  assert.equal(parsePxf(PXF, true).variants[0].prims.filter((p) => p.k === 'text').length, 2)
  assert.equal(variantLabel(m.variants[1], tr), 'Representation 4 · variant E · Panel')
})

test('pxf: SVG flips y and draws a quarter arc counter-clockwise', () => {
  const v = parsePxf(PXF).variants[0]
  const svg = pxfSvg(v)
  assert.ok(svg.includes('M130 -220L112 -220'), svg.slice(0, 200))
  // From angle 0 (135, 223) to π/2 (132, 226): y flipped, small arc, sweep flag 0.
  assert.ok(/M135 -223A3 3 0 0 0 132 -226/.test(svg), svg)
  assert.ok(svg.includes('C112.9 -205 113 -205.1 113.1 -205.1'))
  assert.ok(svg.includes('font-size="2.4">AI204/1</text>'))
  assert.ok(svg.includes('stroke-dasharray'))
  const b = pxfBounds(v)!
  assert.ok(b.x0 === 36 && b.y0 === 133 && b.x1 >= 152 && b.y1 === 228, JSON.stringify(b))
  assert.throws(() => parsePxf('<root/>'))
})

const f = (path: string, body = 'x') => ({ path, file: new File([body], path.split('/').pop()!) })

test('edb: the project folder among the companions, by link name or ProjectInfo.xml', () => {
  const files = [f('proj/Plant.edb/ProjectInfo.xml'), f('proj/Plant.edb/Page.eod'), f('proj/Plant.edb/Images/a.png'), f('proj/Other.edb/Page.eod'), f('proj/readme.txt')]
  assert.equal(findEdb(files, 'Plant.edb').prefix, 'proj/Plant.edb/')
  assert.equal(findEdb(files, '$(MD_PROJECTS)Plant.edb').prefix, 'proj/Plant.edb/')
  // The link names another folder: the only one with ProjectInfo.xml is used.
  assert.equal(findEdb(files, 'EPLAN_Sample.edb').prefix, 'proj/Plant.edb/')
  assert.equal(findEdb([f('a.edb/Page.eod'), f('b.edb/Page.eod')], 'c.edb').prefix, null)
  const a = edbArchive(files, 'proj/Plant.edb/')
  assert.deepEqual(
    a.entries.map((e) => e.path),
    ['ProjectInfo.xml', 'Page.eod', 'Images/a.png']
  )
  assert.deepEqual(a.methods, [])
})

function zlibStored(data: Uint8Array): Uint8Array {
  let a = 1
  let b = 0
  for (const x of data) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }
  const out = new Uint8Array(2 + 5 + data.length + 4)
  out.set([0x78, 0x01, 1, data.length & 255, data.length >> 8, ~data.length & 255, (~data.length >> 8) & 255])
  out.set(data, 7)
  new DataView(out.buffer).setUint32(7 + data.length, ((b << 16) | a) >>> 0, false)
  return out
}

test('edb: part records of Article.eod, plain and zlib-compressed', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const rec = (id: number, pn: string, desc: string) =>
    Uint8Array.from([0x33, 0xe8, 0x75, 0x00, id & 255, id >> 8, 0, 0, 0x32, 0xf3, ...enc(pn), 0, 0x73, 0xe9, 0x0f, 0x56, 0, 0, ...enc('0'), 0, 0x8f, 0x56, 0, 0, ...enc(desc), 0])
  const plain = rec(3621, '10 20 206', 'de_DE@Winkelstahl L;en_US@Angular steel L;')
  const packed = zlibStored(rec(3622, 'SIE.3RV2901-1E', 'en_US@Transverse aux. switch;'))
  const eod = new Uint8Array(16 + plain.length + 8 + packed.length)
  eod.set(plain, 16)
  eod.set(packed, 16 + plain.length + 8)
  const parts = scanArticles(eod)
  assert.deepEqual(
    parts.map((p) => [p.record, p.partNumber, p.texts[0]]),
    [
      [3621, '10 20 206', 'de_DE@Winkelstahl L;en_US@Angular steel L;'],
      [3622, 'SIE.3RV2901-1E', 'en_US@Transverse aux. switch;']
    ]
  )
  assert.deepEqual(scanArticles(new Uint8Array(100)), [])
})
