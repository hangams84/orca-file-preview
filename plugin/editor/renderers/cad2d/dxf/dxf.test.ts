import { assert, test } from 'orca/testing'
import { C, P, type HatchItem, type PathItem, type RefItem, type TextItem, type ViewportItem } from '../scene.ts'
import { ACI } from './aci.ts'
import { buildScene, nurbs, ocsMatrix, styleFamily } from './build.ts'
import { readDxf } from './index.ts'
import { parseMText, plainText } from './mtext.ts'
import { isBinaryDxf, parseDoc, pickEncoding, readTags, unescapeDxf } from './reader.ts'

/** DXF text from (code, value) pairs. */
const dxf = (...pairs: (string | number)[]) => {
  let s = ''
  for (let i = 0; i < pairs.length; i += 2) s += `${pairs[i]}\n${pairs[i + 1]}\n`
  return s
}
const enc = (s: string) => new TextEncoder().encode(s)
const section = (name: string, ...body: (string | number)[]) => dxf(0, 'SECTION', 2, name, ...body, 0, 'ENDSEC')
const file = (...sections: string[]) => enc(sections.join('') + dxf(0, 'EOF'))

test('ACI table: basic colours, hue ramp and greys', () => {
  assert.equal(ACI[1], 0xff0000)
  assert.equal(ACI[5], 0x0000ff)
  assert.equal(ACI[10], 0xff0000)
  assert.equal(ACI[11], 0xff7f7f)
  assert.equal(ACI[12], 0xa50000)
  assert.equal(ACI[20], 0xff3f00)
  assert.equal(ACI[23], 0xa56752)
  assert.equal(ACI[250], 0x333333)
  assert.equal(ACI[255], 0xffffff)
})

test('reads ASCII tags with typed values and stops at EOF', () => {
  const t = readTags(file(section('ENTITIES', 0, 'LINE', 8, 'A', 10, 1.5, 20, '2', 62, 3)))
  assert.equal(t.binary, false)
  const i = Array.from(t.codes).indexOf(10)
  assert.equal(t.vals[i], 1.5)
  assert.equal(t.vals[Array.from(t.codes).indexOf(62)], 3)
  assert.equal(t.vals[t.n - 1], 'EOF')
})

test('decodes pre-2007 text with $DWGCODEPAGE and 2007+ as UTF-8', () => {
  assert.equal(pickEncoding('AC1015', 'ANSI_949'), 'euc-kr')
  assert.equal(pickEncoding('AC1032', 'ANSI_949'), 'utf-8')
  assert.equal(pickEncoding('AC1009', 'ANSI_1252'), 'windows-1252')
  const head = enc(section('HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$DWGCODEPAGE', 3, 'ANSI_949'))
  const body = enc('0\nSECTION\n2\nENTITIES\n0\nTEXT\n1\n')
  const korean = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]) // 한글 in CP949
  const tail = enc('\n0\nENDSEC\n0\nEOF\n')
  const bytes = new Uint8Array([...head, ...body, ...korean, ...tail])
  const t = readTags(bytes)
  assert.equal(t.encoding, 'euc-kr')
  assert.ok(t.vals.includes('한글'))
})

test('unescapes \\U+ and \\M+ codes', () => {
  assert.equal(unescapeDxf('\\U+D55C\\U+AE00'), '한글')
  assert.equal(unescapeDxf('\\M+3C7D1'), '한')
  assert.equal(unescapeDxf('a^Jb'), 'a\nb')
})

test('reads binary DXF (R13+ two-byte group codes)', () => {
  const parts: number[] = [...enc('AutoCAD Binary DXF\r\n\x1a\x00')]
  const code = (c: number) => parts.push(c & 255, c >> 8)
  const str = (s: string) => parts.push(...enc(s), 0)
  const dbl = (v: number) => {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v, true)
    parts.push(...b)
  }
  code(0); str('SECTION'); code(2); str('ENTITIES')
  code(0); str('LINE'); code(8); str('0')
  code(10); dbl(1); code(20); dbl(2); code(11); dbl(3); code(21); dbl(4)
  code(62); parts.push(1, 0)
  code(0); str('ENDSEC'); code(0); str('EOF')
  const bytes = new Uint8Array(parts)
  assert.ok(isBinaryDxf(bytes))
  const s = readDxf(bytes)
  const line = s.views[0].items[0] as PathItem
  assert.deepEqual(line.d, [P.M, 1, 2, P.L, 3, 4])
  assert.equal(line.color, 0xff0000)
})

test('rejects DWG and empty input with a DxfError', () => {
  assert.throws(() => readDxf(enc('AC1032\x00\x00\x00')), /DWG/)
  assert.throws(() => readDxf(enc('0\nSECTION\n2\nENTITIES\nNOT A CODE\n')), /group code|no DXF|bad/)
})

test('MTEXT formatting: paragraphs, colour, height, font, stacking, specials', () => {
  const p = parseMText('{\\fArial|b1;Bold}\\Pline {\\C1;red} \\H2x;big \\S1/2; %%d', { h: 2 })
  assert.equal(p.length, 2)
  assert.equal(p[0][0].text, 'Bold')
  assert.equal(p[0][0].bold, true)
  assert.equal(p[0][0].family, 'Arial')
  const red = p[1].find((r) => r.text === 'red')!
  assert.equal(red.color, 0xff0000)
  const big = p[1].find((r) => r.text.includes('big'))!
  assert.equal(big.h, 4)
  assert.ok(p[1].map((r) => r.text).join('').includes('1/2 °'))
  assert.equal(parseMText('a\\~b', { h: 1 })[0][0].text, 'a\u00a0b')
  assert.equal(parseMText('{\\c255;x}', { h: 1 })[0][0].color, 0xff0000) // BGR
})

test('TEXT specials and under/overline toggles', () => {
  assert.deepEqual(plainText('%%uØ%%c10%%p1'), { text: 'Ø⌀10±1', underline: true, overline: false })
})

test('OCS with extrusion (0,0,-1) mirrors x; +Z is identity', () => {
  assert.equal(ocsMatrix(0, 0, 1), undefined)
  const m = ocsMatrix(0, 0, -1)!
  assert.deepEqual(m.slice(0, 4).map((v) => Math.round(v * 1e9) / 1e9 + 0), [-1, 0, 0, 1])
})

test('B-spline evaluation passes through clamped end points', () => {
  const pts = nurbs(3, [0, 0, 0, 0, 1, 1, 1, 1], [[0, 0], [1, 2], [3, 2], [4, 0]], [])
  assert.deepEqual(pts[0].map((v) => Math.round(v * 1e6) / 1e6), [0, 0])
  const last = pts[pts.length - 1]
  assert.ok(Math.abs(last[0] - 4) < 1e-6 && Math.abs(last[1]) < 1e-6)
})

test('style fonts: TrueType names map to families, SHX to the default stack', () => {
  const st = (font: string, family = '') => ({ name: 'S', font, bigFont: '', family, height: 0, width: 1, oblique: 0, flags: 0 })
  assert.equal(styleFamily(st('malgun.ttf')), 'Malgun Gothic')
  assert.equal(styleFamily(st('romans.shx')), undefined)
  assert.equal(styleFamily(st('arial.ttf', 'Arial Black')), 'Arial Black')
})

const LAYERS = section(
  'TABLES',
  0, 'TABLE', 2, 'LAYER',
  0, 'LAYER', 2, '0', 5, '10', 62, 7, 70, 0, 6, 'CONTINUOUS',
  0, 'LAYER', 2, 'RED', 5, '11', 62, 1, 70, 0, 6, 'DASHED', 370, 50,
  0, 'LAYER', 2, 'OFF', 5, '12', 62, -3, 70, 0, 6, 'CONTINUOUS',
  0, 'LAYER', 2, 'FROZEN', 5, '13', 62, 4, 70, 1, 6, 'CONTINUOUS',
  0, 'ENDTAB',
  0, 'TABLE', 2, 'LTYPE',
  0, 'LTYPE', 2, 'DASHED', 73, 2, 49, 0.5, 49, -0.25,
  0, 'ENDTAB'
)

test('layers: colours, off/frozen visibility, linetypes and lineweights', () => {
  const s = readDxf(
    file(
      LAYERS,
      section('ENTITIES', 0, 'LINE', 8, 'RED', 10, 0, 20, 0, 11, 1, 21, 0, 0, 'LINE', 8, 'OFF', 10, 0, 20, 0, 11, 1, 21, 1, 0, 'CIRCLE', 8, 'NEW', 62, 7, 10, 0, 20, 0, 40, 1)
    )
  )
  const names = s.layers.map((l) => l.name)
  assert.deepEqual(names, ['0', 'RED', 'OFF', 'FROZEN', 'NEW'])
  assert.deepEqual(s.layers.map((l) => l.visible), [true, true, false, false, true])
  const red = s.views[0].items[0] as PathItem
  assert.equal(red.color, 0xff0000)
  assert.deepEqual(red.dash, [0.5, 0.25])
  assert.equal(red.lw, 0.5)
  const circle = s.views[0].items.find((i) => i.layer === 4) as PathItem
  assert.equal(circle.color, C.FG)
  assert.equal(circle.d[0], P.M)
  assert.ok(circle.d.includes(P.E))
})

test('LWPOLYLINE bulges become arcs; width is kept', () => {
  const s = readDxf(file(section('ENTITIES', 0, 'LWPOLYLINE', 8, '0', 90, 2, 70, 0, 43, 0.5, 10, 0, 20, 0, 42, 1, 10, 2, 20, 0)))
  const p = s.views[0].items[0] as PathItem
  assert.equal(p.width, 0.5)
  const e = p.d.indexOf(P.E)
  assert.ok(e > 0)
  // semicircle centred at (1, 0) with radius 1, counter-clockwise
  assert.deepEqual(p.d.slice(e + 1, e + 5).map((v) => Math.round(v * 1e9) / 1e9), [1, 0, 1, 1])
  assert.equal(p.d[e + 8], 1)
})

test('blocks: references carry insert point, scale, rotation and base point; arrays repeat', () => {
  const s = readDxf(
    file(
      section('BLOCKS', 0, 'BLOCK', 2, 'B', 70, 0, 10, 5, 20, 5, 0, 'LINE', 8, '0', 10, 5, 20, 5, 11, 6, 21, 5, 0, 'ENDBLK'),
      section('ENTITIES', 0, 'INSERT', 8, '0', 2, 'B', 10, 10, 20, 0, 41, 2, 42, 2, 50, 90, 0, 'INSERT', 8, '0', 2, 'B', 10, 0, 20, 0, 70, 3, 71, 2, 44, 10, 45, 20)
    )
  )
  const refs = s.views[0].items.filter((i) => i.k === 'ref') as RefItem[]
  assert.equal(refs.length, 1 + 6)
  const m = refs[0].m
  // block base (5,5) → insert (10,0): (6,5) maps to (10,2) after scale 2 and 90° rotation
  const x = m[0] * 6 + m[2] * 5 + m[4]
  const y = m[1] * 6 + m[3] * 5 + m[5]
  assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(y - 2) < 1e-9)
  const blk = s.blocks.get('B')!
  assert.equal(blk.items[0].layer, -1) // layer 0 inside a block inherits the reference's layer
  assert.equal(blk.items[0].color, C.BYLAYER_INHERIT)
})

test('HATCH: solid fill and pattern lines from the pattern definition', () => {
  const box = [10, 0, 20, 0, 10, 10, 20, 0, 10, 10, 20, 10, 10, 0, 20, 10]
  const s = readDxf(
    file(
      section(
        'ENTITIES',
        0, 'HATCH', 8, '0', 62, 1, 2, 'SOLID', 70, 1, 71, 0, 91, 1, 92, 2, 72, 0, 73, 1, 93, 4, ...box, 97, 0, 75, 0, 76, 1, 98, 0,
        0, 'HATCH', 8, '0', 2, 'ANSI31', 70, 0, 71, 0, 91, 1, 92, 2, 72, 0, 73, 1, 93, 4, ...box, 97, 0, 75, 0, 76, 1, 52, 0, 41, 1, 77, 0, 78, 1, 53, 45, 43, 0, 44, 0, 45, -1, 46, 1, 79, 0, 98, 0
      )
    )
  )
  const [solid, pat] = s.views[0].items as HatchItem[]
  assert.equal(solid.solid, true)
  assert.equal(solid.color, 0xff0000)
  assert.equal(pat.solid, false)
  assert.ok(pat.lines && pat.lines.length >= 4 * 10, `pattern lines: ${pat.lines?.length}`)
})

test('TEXT alignment uses the second point; MTEXT keeps paragraphs and attachment', () => {
  const s = readDxf(
    file(
      section(
        'ENTITIES',
        0, 'TEXT', 8, '0', 10, 0, 20, 0, 11, 50, 21, 5, 40, 2.5, 1, '가운데', 72, 1, 73, 2,
        0, 'MTEXT', 8, '0', 10, 1, 20, 2, 40, 3, 41, 40, 71, 5, 3, 'first part ', 1, 'end\\Pnext'
      )
    )
  )
  const [t, mt] = s.views[0].items as TextItem[]
  assert.equal(t.x, 50)
  assert.equal(t.ha, 1)
  assert.equal(t.va, 2)
  assert.equal(t.text, '가운데')
  assert.equal(mt.attach, 5)
  assert.equal(mt.paras!.length, 2)
  assert.equal(mt.paras![0].map((r) => r.text).join(''), 'first part end')
})

test('layouts: paper-space blocks become views with viewports onto model space', () => {
  const s = buildScene(
    parseDoc(
      readTags(
        file(
          section('HEADER', 9, '$ACADVER', 1, 'AC1032'),
          section(
            'TABLES',
            0, 'TABLE', 2, 'BLOCK_RECORD',
            0, 'BLOCK_RECORD', 5, '1F', 2, '*Model_Space', 340, '22',
            0, 'BLOCK_RECORD', 5, '1B', 2, '*Paper_Space', 340, '1E',
            0, 'ENDTAB'
          ),
          section('BLOCKS', 0, 'BLOCK', 2, '*Paper_Space', 70, 0, 10, 0, 20, 0, 0, 'ENDBLK'),
          section(
            'ENTITIES',
            0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 100, 21, 100,
            0, 'VIEWPORT', 8, '0', 67, 1, 10, 50, 20, 40, 40, 80, 41, 60, 68, 1, 69, 2, 12, 50, 22, 50, 45, 120,
            0, 'LINE', 8, '0', 67, 1, 10, 0, 20, 0, 11, 10, 21, 0
          ),
          section('OBJECTS', 0, 'LAYOUT', 5, '1E', 100, 'AcDbPlotSettings', 1, '', 100, 'AcDbLayout', 1, 'Sheet A', 71, 1, 10, 0, 20, 0, 11, 100, 21, 80, 330, '1B')
        )
      )
    )
  )
  assert.equal(s.views.length, 2)
  assert.equal(s.views[1].name, 'Sheet A')
  assert.deepEqual(s.views[1].paper, { x0: 0, y0: 0, x1: 100, y1: 80 })
  const vp = s.views[1].items.find((i) => i.k === 'viewport') as ViewportItem
  assert.equal(vp.view, 0)
  // model (50, 50) → viewport centre (50, 40); scale 60/120
  assert.ok(Math.abs(vp.m[0] - 0.5) < 1e-9 && Math.abs(vp.m[4] - 25) < 1e-9 && Math.abs(vp.m[5] - 15) < 1e-9)
})
