import { assert, test } from 'orca/testing'
import { aciToRgb, apply, arcPoints, bulgePolyline, ellipsePoints, lineweight, LW_BYBLOCK, LW_BYLAYER, mul, nurbsPoints, ocsMatrix, rotate, translate } from './geom.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('ACI colours: fixed entries and the generated hue table', () => {
  assert.equal(aciToRgb(1), 0xff0000)
  assert.equal(aciToRgb(5), 0x0000ff)
  assert.equal(aciToRgb(10), 0xff0000)
  assert.equal(aciToRgb(11), 0xff7f7f) // pale red
  assert.equal(aciToRgb(12), 0xa50000) // darker red
  assert.equal(aciToRgb(30), 0xff7f00) // orange (hue 30°)
  assert.equal(aciToRgb(250), 0x333333)
})

test('line weights: DWG index, ByLayer, ByBlock', () => {
  assert.equal(lineweight(7), 25)
  assert.equal(lineweight(11), 50)
  assert.equal(lineweight(29), LW_BYLAYER)
  assert.equal(lineweight(30), LW_BYBLOCK)
  assert.equal(lineweight(undefined), LW_BYLAYER)
})

test('OCS with a -Z normal mirrors X', () => {
  const m = ocsMatrix({ x: 0, y: 0, z: -1 })
  const p = apply(m, 250, 150)
  assert.ok(near(p.x, -250) && near(p.y, 150))
  const id = ocsMatrix({ x: 0, y: 0, z: 0 })
  assert.deepEqual(apply(id, 3, 4), { x: 3, y: 4 })
})

test('transforms compose right to left', () => {
  const m = mul(translate(10, 0), rotate(Math.PI / 2))
  const p = apply(m, 1, 0)
  assert.ok(near(p.x, 10) && near(p.y, 1))
})

test('arc points run counter-clockwise from start to end', () => {
  const pts = arcPoints(0, 0, 1, 0, Math.PI / 2)
  assert.ok(near(pts[0], 1) && near(pts[1], 0))
  assert.ok(near(pts[pts.length - 2], 0) && near(pts[pts.length - 1], 1))
  // wraps through 0
  const w = arcPoints(0, 0, 1, (3 * Math.PI) / 2, Math.PI / 2)
  assert.ok(near(w[0], 0) && near(w[1], -1))
  assert.ok(near(w[w.length - 2], 0) && near(w[w.length - 1], 1))
  const mid = w.length / 2 - (w.length / 2) % 2
  assert.ok(w[mid] > 0.9, 'passes through (1, 0)')
})

test('bulge: positive turns counter-clockwise, negative clockwise', () => {
  const ccw = bulgePolyline([{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0 }], false)
  const maxY = Math.max(...ccw.filter((_, i) => i % 2 === 1))
  const minY = Math.min(...ccw.filter((_, i) => i % 2 === 1))
  // counter-clockwise from (0,0) to (2,0) around (1,0): goes below the chord
  assert.ok(near(minY, -1, 1e-3) && near(maxY, 0, 1e-9))
  const cw = bulgePolyline([{ x: 0, y: 0, bulge: -1 }, { x: 2, y: 0 }], false)
  assert.ok(near(Math.max(...cw.filter((_, i) => i % 2 === 1)), 1, 1e-3))
  assert.ok(near(cw[cw.length - 2], 2) && near(cw[cw.length - 1], 0))
})

test('closed bulged polyline does not repeat its first point', () => {
  const pts = bulgePolyline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], true)
  assert.equal(pts.length, 6)
})

test('ellipse: major axis, ratio and parameter range', () => {
  const pts = ellipsePoints(0, 0, 2, 0, 0.5, 0, Math.PI)
  assert.ok(near(pts[0], 2) && near(pts[1], 0))
  assert.ok(near(pts[pts.length - 2], -2) && near(pts[pts.length - 1], 0, 1e-9))
  const ys = pts.filter((_, i) => i % 2 === 1)
  assert.ok(near(Math.max(...ys), 1, 1e-3))
})

test('NURBS: clamped quadratic Bezier passes through its end points and the curve midpoint', () => {
  const pts = nurbsPoints(2, [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }], [0, 0, 0, 1, 1, 1], undefined, 10)
  assert.ok(near(pts[0], 0) && near(pts[1], 0))
  assert.ok(near(pts[pts.length - 2], 2) && near(pts[pts.length - 1], 0))
  assert.ok(near(pts[10], 1) && near(pts[11], 1)) // t = 0.5 → (1, 1)
})

test('NURBS with weights: a rational quarter circle stays on the circle', () => {
  const w = Math.SQRT1_2
  const pts = nurbsPoints(2, [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], [0, 0, 0, 1, 1, 1], [1, w, 1], 16)
  for (let i = 0; i < pts.length; i += 2) assert.ok(near(Math.hypot(pts[i], pts[i + 1]), 1, 1e-9))
})

test('bad knot vectors fall back to the control polygon', () => {
  const pts = nurbsPoints(3, [{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1])
  assert.deepEqual(pts, [0, 0, 1, 1])
})
