import { assert, test } from 'orca/testing'
import { bowArc, circumcircle, ellipticalArc, formulaArgs, geometryPath, sampleNurbs } from './visio-geom.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('circumcircle and collinear points', () => {
  const c = circumcircle({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 })!
  assert.ok(near(c.x, 0) && near(c.y, 0) && near(c.r, 1))
  assert.equal(circumcircle({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null)
})

test('ArcTo: positive bow bulges right of the travel direction (counter-clockwise sweep)', () => {
  const a = bowArc({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)
  // a half circle of radius 1 below the chord (y-up space), drawn counter-clockwise
  assert.equal(a.cmd, 'A1 1 0 0 1 2 0')
  assert.ok(a.pts.some((p) => near(p.y, -1, 1e-3)))
  assert.equal(bowArc({ x: 0, y: 0 }, { x: 2, y: 0 }, 0).cmd, 'L2 0')
})

test('EllipticalArcTo: ratio and large-arc flag', () => {
  // Through the top of an ellipse twice as wide as high: from (-2,0) via (0,1) to (2,0), clockwise in y-up.
  const a = ellipticalArc({ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, 0, 2)
  assert.equal(a.cmd, 'A2 1 0 0 0 2 0')
  // Control point on the far side: three quarters of the circle, clockwise (0° → -90° → -180° → 90°).
  const b = ellipticalArc({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, 0, 1)
  assert.equal(b.cmd, 'A1 1 0 1 0 0 1')
})

test('NURBS with clamped knots is a Bézier: ends on its control polygon ends', () => {
  const pts = sampleNurbs([{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 0 }], [0, 0, 0, 0, 1], [1, 1, 1, 1], 3)
  const last = pts[pts.length - 1]
  assert.ok(near(last.x, 3) && near(last.y, 0))
  const mid = pts[Math.floor(pts.length / 2) - 1]
  assert.ok(mid.y > 1 && mid.y <= 1.5 + 1e-9)
})

test('formula arguments', () => {
  assert.deepEqual(formulaArgs('NURBS(1, 3, 0, 0, 0.5, 0.5, 0, 1)', 'NURBS'), [1, 3, 0, 0, 0.5, 0.5, 0, 1])
  assert.deepEqual(formulaArgs('POLYLINE(0, 1, 0.5, 2)', 'polyline'), [0, 1, 0.5, 2])
  assert.equal(formulaArgs('foo', 'NURBS'), null)
})

test('geometry rows: closed rectangle, relative rows, polyline, ellipse', () => {
  const rect = geometryPath(
    [
      { t: 'MoveTo', v: { X: '0', Y: '0' } },
      { t: 'LineTo', v: { X: '2', Y: '0' } },
      { t: 'LineTo', v: { X: '2', Y: '1' } },
      { t: 'LineTo', v: { X: '0', Y: '1' } },
      { t: 'LineTo', v: { X: '0', Y: '0' } }
    ],
    2,
    1
  )
  assert.equal(rect.d, 'M0 0L2 0L2 1L0 1L0 0')
  assert.equal(rect.subpaths[0].closed, true)
  const rel = geometryPath([{ t: 'RelMoveTo', v: { X: '0', Y: '0' } }, { t: 'RelLineTo', v: { X: '1', Y: '0.5' } }], 4, 2)
  assert.equal(rel.d, 'M0 0L4 1')
  assert.equal(rel.subpaths[0].closed, false)
  const poly = geometryPath([{ t: 'MoveTo', v: { X: '0', Y: '0' } }, { t: 'PolylineTo', v: { X: '1', Y: '1', A: 'POLYLINE(0, 0, 0.5, 0, 0.5, 0.5)' } }], 2, 2)
  assert.equal(poly.d, 'M0 0L1 0L1 1L1 1')
  const el = geometryPath([{ t: 'Ellipse', v: { X: '1', Y: '1', A: '2', B: '1', C: '1', D: '1.5' } }], 2, 2)
  assert.ok(el.d.startsWith('M2 1A1 0.5 0 1 1 0 1'))
  assert.equal(el.subpaths[0].closed, true)
})
