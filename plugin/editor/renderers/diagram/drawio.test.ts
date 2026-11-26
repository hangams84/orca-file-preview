import { assert, test } from 'orca/testing'
import { color, inflateDiagram, parseStyle } from './drawio.ts'
import { labelMargins, perimeterPoint, shapeGeometry } from './drawio-shapes.ts'
import { orthRoute, routeEdge, type Terminal } from './edges.ts'

test('compressed diagrams inflate (base64 → raw deflate → URI decoding)', () => {
  assert.equal(inflateDiagram('UzV2zq1wL0osyPDNT0nNUTV2VTV2LsrPL4GwciucU3NyVI0MMlNUjV1UjYwMgFjVyA0iC2QglAI5aCYBAA=='), '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>')
  // Older files: deflated UTF-8 without URI encoding.
  assert.equal(inflateDiagram('s0m0ezt1jo1+oh0A'), '<a>한</a>')
})

test('styles: named styles, defaults, image data URLs', () => {
  const st = parseStyle('ellipse;whiteSpace=wrap;fillColor=#dae8fc;', false)
  assert.equal(st.shape, 'ellipse')
  assert.equal(st.fillColor, '#dae8fc')
  assert.equal(st.fontSize, '12')
  assert.equal(parseStyle('text;html=1;', false).strokeColor, 'none')
  assert.equal(parseStyle('swimlane;', false).startSize, '23')
  assert.equal(parseStyle('', true).endArrow, 'classic')
  assert.equal(parseStyle('shape=image;image=data:image/png,iVBORw0KGgo=;', false).image, 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(parseStyle('triangle;direction=south', false).shape, 'triangle')
})

test('colours: none/default/light-dark and junk', () => {
  assert.equal(color('none', '#fff'), null)
  assert.equal(color('default', '#fff'), '#fff')
  assert.equal(color('light-dark(#123456, #abcdef)', null), '#123456')
  assert.equal(color('url(javascript:alert(1))', '#000'), '#000')
  assert.equal(color('#ABC', null), '#ABC')
})

test('shapes: every built-in outline yields path data; boundedLbl margins', () => {
  for (const name of ['rect', 'ellipse', 'rhombus', 'triangle', 'hexagon', 'cylinder3', 'cloud', 'document', 'process', 'parallelogram', 'swimlane', 'note', 'cube', 'callout', 'actor', 'umlActor']) {
    const g = shapeGeometry(name, 100, 60, {})
    assert.ok(g.fill || g.band || g.lines, name)
  }
  assert.deepEqual(labelMargins('document', 100, 70, { boundedLbl: '1' }), { l: 0, t: 0, r: 0, b: 21 })
  assert.equal(labelMargins('document', 100, 70, {}), null)
})

const T = (x: number, y: number, w: number, h: number, shape = 'rect'): Terminal => ({ rect: { x, y, w, h }, shape, rotation: 0 })
const per = (t: Terminal, p: { x: number; y: number }) => perimeterPoint(t, p)
const base = { points: [], style: '', elbow: 'horizontal' as const, exit: null, entry: null, segment: 30, jetty: 20, perimeter: per }

test('perimeter points on rectangles, ellipses and rhombi', () => {
  assert.deepEqual(perimeterPoint(T(0, 0, 100, 50), { x: 200, y: 25 }), { x: 100, y: 25 })
  const e = perimeterPoint(T(0, 0, 100, 100, 'ellipse'), { x: 50, y: -100 })
  assert.ok(Math.abs(e.y) < 1e-9 && Math.abs(e.x - 50) < 1e-9)
  const r = perimeterPoint(T(0, 0, 100, 100, 'rhombus'), { x: 150, y: 150 })
  assert.ok(Math.abs(r.x - 75) < 1e-9 && Math.abs(r.y - 75) < 1e-9)
})

test('straight and orthogonal routes', () => {
  assert.deepEqual(routeEdge({ ...base, src: T(0, 0, 100, 50), tgt: T(200, 0, 100, 50) }), [{ x: 100, y: 25 }, { x: 200, y: 25 }])
  // Overlapping columns: one vertical segment through the overlap.
  assert.deepEqual(routeEdge({ ...base, style: 'orthogonalEdgeStyle', src: T(0, 0, 100, 50), tgt: T(20, 150, 100, 50) }), [{ x: 60, y: 50 }, { x: 60, y: 150 }])
  // Fixed exit right / entry top: an L.
  const r = routeEdge({ ...base, style: 'orthogonalEdgeStyle', src: T(0, 0, 100, 50), tgt: T(250, 150, 100, 80), exit: { x: 1, y: 0.5, dx: 0, dy: 0, perimeter: true }, entry: { x: 0.5, y: 0, dx: 0, dy: 0, perimeter: true } })
  assert.deepEqual(r, [{ x: 100, y: 25 }, { x: 300, y: 25 }, { x: 300, y: 150 }])
  // Facing ports: a Z through the middle.
  assert.deepEqual(orthRoute({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 40 }, { x: -1, y: 0 }, 20), [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 40 }])
})

test('elbow connector follows mxGraph: waypoint above both shapes → top-to-bottom', () => {
  const r = routeEdge({ ...base, style: 'elbowEdgeStyle', points: [{ x: 200, y: 300 }], src: T(40, 330, 100, 50), tgt: T(300, 330, 100, 50) })
  assert.deepEqual(r, [{ x: 90, y: 330 }, { x: 90, y: 300 }, { x: 350, y: 300 }, { x: 350, y: 330 }])
})
