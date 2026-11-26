import { assert, test } from 'orca/testing'
import { buildScene, decodeColor, FOREGROUND, type Ent } from './scene.ts'

const MODEL = '1F'
const PAPER = '50'

function db(entities: Ent[], extra: { blocks?: Ent[]; layers?: Ent[]; layouts?: Ent[]; paper?: Ent[] } = {}): Ent {
  return {
    header: { LTSCALE: 1, INSUNITS: 4, TEXTSIZE: 2.5 },
    tables: {
      LAYER: {
        entries: [
          { name: '0', colorIndex: 7, color: 0xffffff, off: false, frozen: false, lineweight: 31, lineType: 'Continuous' },
          { name: 'Red', colorIndex: 1, color: 0xffffff, off: false, frozen: false, lineweight: 11, lineType: 'Continuous' },
          { name: 'Off', colorIndex: 3, color: 0xffffff, off: true, frozen: false, lineweight: 31, lineType: 'DASHED' },
          ...(extra.layers ?? [])
        ]
      },
      LTYPE: { entries: [{ name: 'DASHED', pattern: [{ elementLength: 5 }, { elementLength: -2.5 }] }, { name: 'Continuous', pattern: [] }] },
      STYLE: { entries: [{ name: 'Standard', font: 'txt', widthFactor: 1 }] },
      DIMSTYLE: { entries: [] },
      BLOCK_RECORD: {
        entries: [
          { name: '*Model_Space', handle: MODEL, basePoint: { x: 0, y: 0 }, entities: [] },
          { name: '*Paper_Space', handle: PAPER, basePoint: { x: 0, y: 0 }, entities: extra.paper ?? [] },
          ...(extra.blocks ?? [])
        ]
      },
      VPORT: { entries: [] },
      APPID: { entries: [] }
    },
    objects: { LAYOUT: extra.layouts ?? [{ layoutName: 'Model', paperSpaceTableId: MODEL, tabOrder: 0 }] },
    entities: entities.map((e, i) => ({ handle: `E${i}`, ownerBlockRecordSoftId: MODEL, isVisible: true, colorIndex: 256, lineweight: 29, ...e }))
  }
}

const line = (layer: string, extra: Ent = {}): Ent => ({ type: 'LINE', layer, startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 }, ...extra })

test('ByLayer colour, line weight and line type come from the layer', () => {
  const s = buildScene(db([line('Red'), line('Off')]))
  const [red, off] = s.spaces[0].prims
  assert.equal(red.color, 0xff0000)
  assert.equal(red.lw, 50)
  assert.equal(red.dash, null)
  assert.deepEqual(off.dash, [5, 2.5])
  const offLayer = s.layers.find((l) => l.name === 'Off')!
  assert.equal(offLayer.visible, false)
  assert.equal(s.layers.find((l) => l.name === '0')!.color, FOREGROUND)
})

test('entity colour index and true colour override the layer', () => {
  const s = buildScene(db([line('Red', { colorIndex: 5 }), line('Red', { colorIndex: 5, color: 0x123456 })]))
  assert.equal(s.spaces[0].prims[0].color, 0x0000ff)
  assert.equal(s.spaces[0].prims[1].color, 0x123456)
})

test('block reference: transform, ByBlock colour and layer 0 inheritance', () => {
  const blk = {
    name: 'B',
    handle: 'B1',
    basePoint: { x: 1, y: 0 },
    entities: [
      { type: 'LINE', layer: '0', colorIndex: 0, startPoint: { x: 1, y: 0 }, endPoint: { x: 2, y: 0 } },
      { type: 'LINE', layer: 'Red', colorIndex: 256, startPoint: { x: 1, y: 0 }, endPoint: { x: 1, y: 1 } }
    ]
  }
  const ins = { type: 'INSERT', name: 'B', layer: 'Off', colorIndex: 4, insertionPoint: { x: 100, y: 50 }, xScale: 2, yScale: 2, rotation: Math.PI / 2, columnCount: 1, rowCount: 1 }
  const s = buildScene(db([ins], { blocks: [blk] }))
  const [a, b] = s.spaces[0].prims
  // (1,0)→(2,0) relative to base (1,0): (0,0)→(1,0), ×2, rotated 90°, moved to (100,50)
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-9
  assert.ok(near(a.pts![0], 100) && near(a.pts![1], 50) && near(a.pts![2], 100) && near(a.pts![3], 52))
  assert.equal(a.color, 0x00ffff, 'ByBlock takes the reference colour')
  assert.equal(s.layers[a.layer].name, 'Off', 'layer 0 takes the reference layer')
  assert.equal(s.layers[b.layer].name, 'Red')
  assert.equal(b.color, 0xff0000)
})

test('arrayed reference (MINSERT) repeats the block', () => {
  const blk = { name: 'B', handle: 'B1', basePoint: { x: 0, y: 0 }, entities: [line('0')] }
  const s = buildScene(db([{ type: 'INSERT', name: 'B', layer: '0', insertionPoint: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: 0, columnCount: 3, rowCount: 2, columnSpacing: 20, rowSpacing: 5 }], { blocks: [blk] }))
  assert.equal(s.spaces[0].prims.length, 6)
  assert.equal(s.spaces[0].box.maxX, 50)
  assert.equal(s.spaces[0].box.maxY, 5)
})

test('dimensions draw their geometry block', () => {
  const blk = { name: '*D1', handle: 'D1', basePoint: { x: 0, y: 0 }, entities: [line('0'), { type: 'MTEXT', layer: '0', text: '10', textHeight: 2.5, insertionPoint: { x: 5, y: 1 }, attachmentPoint: 8, rectWidth: 0 }] }
  const s = buildScene(db([{ type: 'DIMENSION', name: '*D1', layer: 'Red', insertionPoint: { x: 0, y: 0 } }], { blocks: [blk] }))
  const kinds = s.spaces[0].prims.map((p) => p.kind)
  assert.deepEqual(kinds, ['line', 'text'])
  assert.equal(s.spaces[0].prims[1].text!.s, '10')
  assert.equal(s.spaces[0].prims[1].text!.ha, 1)
})

test('TEXT alignment point, and the insertion point when it is unset', () => {
  const t = (end: Ent) => ({ type: 'TEXT', layer: '0', text: 'A', textHeight: 2, startPoint: { x: 5, y: 5 }, endPoint: end, halign: 1, valign: 2, rotation: 0, xScale: 1 })
  const s = buildScene(db([t({ x: 7, y: 9 }), t({ x: 0, y: 0 })]))
  const [a, b] = s.spaces[0].prims.map((p) => p.text!)
  assert.deepEqual([a.x, a.y, a.ha, a.va], [7, 9, 1, 2])
  assert.deepEqual([b.x, b.y], [5, 5])
})

test('MTEXT: Korean lines, attachment and wrapping', () => {
  const s = buildScene(
    db([{ type: 'MTEXT', layer: '0', text: '첫 줄\\P둘째 줄', textHeight: 2, insertionPoint: { x: 0, y: 10 }, attachmentPoint: 1, rectWidth: 100, lineSpacing: 1 }])
  )
  const ts = s.spaces[0].prims.map((p) => p.text!)
  assert.deepEqual(ts.map((t) => t.s), ['첫 줄', '둘째 줄'])
  assert.equal(ts[0].y, 8) // top attachment: first baseline one text height below
  assert.ok(ts[1].y < ts[0].y)
})

test('hatch: solid fill with a hole ring, pattern lines with dashes', () => {
  const square = { boundaryPathTypeFlag: 3, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], isClosed: 1 }
  const hole = { boundaryPathTypeFlag: 16, edges: [{ type: 2, center: { x: 5, y: 5 }, radius: 2, startAngle: 0, endAngle: Math.PI * 2, isCCW: 1 }] }
  const solid = { type: 'HATCH', layer: 'Red', solidFill: 1, patternName: 'SOLID', boundaryPaths: [square, hole] }
  const pattern = { type: 'HATCH', layer: 'Red', solidFill: 0, patternName: 'X', boundaryPaths: [square], definitionLines: [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 1 }, dashLengths: [2, -1] }] }
  const s = buildScene(db([solid, pattern]))
  const [f, p] = s.spaces[0].prims
  assert.equal(f.kind, 'fill')
  assert.equal(f.rings!.length, 2)
  assert.equal(p.kind, 'pattern')
  // 11 horizontal lines (y = 0..10), each 10 long split into dashes of 2 with gaps of 1
  const segs = p.segs!
  for (let i = 0; i < segs.length; i += 4) assert.ok(segs[i + 2] - segs[i] <= 2 + 1e-9)
  assert.ok(segs.length / 4 >= 11 * 3)
})

test('wide polyline keeps its width; spline and ellipse are tessellated', () => {
  const s = buildScene(
    db([
      { type: 'LWPOLYLINE', layer: '0', flag: 0, constantWidth: 2, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }] },
      { type: 'SPLINE', layer: '0', degree: 2, controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }], knots: [0, 0, 0, 1, 1, 1], fitPoints: [] },
      { type: 'ELLIPSE', layer: '0', center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 4, y: 0 }, axisRatio: 0.5, startAngle: 0, endAngle: Math.PI * 2 }
    ])
  )
  const [pl, sp, el] = s.spaces[0].prims
  assert.equal(pl.ww, 2)
  assert.ok(sp.pts!.length > 20)
  assert.equal(el.closed, true)
})

test('paper-space layout: sheet, viewport transform, model space separate', () => {
  const vp = { type: 'VIEWPORT', handle: 'V2', ownerBlockRecordSoftId: PAPER, layer: '0', viewportId: 2, viewportCenter: { x: 100, y: 50 }, width: 80, height: 40, viewHeight: 20, displayCenter: { x: 5, y: 0 }, targetPoint: { x: 0, y: 0 }, statusBitFlags: 0 }
  const overall = { ...vp, handle: 'V1', viewportId: 1 }
  const title = { type: 'TEXT', handle: 'T', ownerBlockRecordSoftId: PAPER, layer: '0', text: '표제란', textHeight: 5, startPoint: { x: 10, y: 10 }, endPoint: { x: 0, y: 0 }, rotation: 0, xScale: 1 }
  const layouts = [
    { layoutName: 'Model', paperSpaceTableId: MODEL, tabOrder: 0 },
    { layoutName: '배치1', paperSpaceTableId: PAPER, tabOrder: 1, minLimit: { x: 0, y: 0 }, maxLimit: { x: 297, y: 210 }, viewportId: 'V1' }
  ]
  const s = buildScene(db([line('0')], { layouts, paper: [overall, vp, title] }))
  assert.equal(s.spaces.length, 2)
  const paper = s.spaces[1]
  assert.equal(paper.name, '배치1')
  assert.deepEqual(paper.sheet, { x0: 0, y0: 0, x1: 297, y1: 210 })
  assert.equal(paper.viewports.length, 1)
  const m = paper.viewports[0].m
  // model (5, 0) (the view centre) lands on the viewport centre; scale 40 / 20 = 2
  assert.ok(Math.abs(m[0] * 5 + m[4] - 100) < 1e-9 && Math.abs(m[5] - 50) < 1e-9 && m[0] === 2)
  assert.equal(paper.prims.length, 1)
  assert.equal(s.spaces[0].prims.length, 1)
})

test('several *Model_Space records all count as model space', () => {
  const d = db([line('0')])
  d.tables.BLOCK_RECORD.entries.push({ name: '*Model_Space', handle: '99', basePoint: { x: 0, y: 0 }, entities: [{ ...line('0'), handle: 'X1', ownerBlockRecordSoftId: '99' }] })
  assert.equal(buildScene(d).spaces[0].prims.length, 2)
})

test('raw layer colours: index, AutoCAD 2004+ index in rgb, true colour', () => {
  assert.deepEqual(decodeColor({ index: 4, rgb: 0xc300ffff, method: 0xc3 }), { aci: 4 })
  assert.deepEqual(decodeColor({ index: 256, rgb: 0xc3000002, method: 0xc3 }), { aci: 2 })
  assert.deepEqual(decodeColor({ index: 256, rgb: 0xc2e67814, method: 0xc2 }), { rgb: 0xe67814 })
  assert.equal(decodeColor({ index: 0, rgb: 0, method: 0 }), null)
  const s = buildScene(db([line('Red')]), { layerColors: { Red: { index: 256, rgb: 0xc3000005, method: 0xc3 } } })
  assert.equal(s.spaces[0].prims[0].color, 0x0000ff)
})

test('unsupported entities are counted, not drawn; nothing throws on junk', () => {
  const s = buildScene(db([{ type: '3DSOLID', layer: '0' }, { type: 'LINE', layer: '0' }, null as unknown as Ent, { type: 'INSERT', name: 'missing', layer: '0' }]))
  assert.equal(s.stats.skipped['3DSOLID'], 1)
  assert.equal(s.stats.skipped['INSERT (block missing)'], 1)
})
