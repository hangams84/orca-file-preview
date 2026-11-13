import { assert, test } from 'orca/testing'
import { parseOFF } from './parse.js'

test('OFF: polygons become triangle fans, indices kept', () => {
  const p = parseOFF('OFF\n# square + triangle\n5 2 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n2 2 0\n4 0 1 2 3\n3 1 4 2\n')
  assert.equal(p.type, 'mesh')
  assert.equal(p.position.length, 15)
  assert.deepEqual(Array.from(p.index ?? []), [0, 1, 2, 0, 2, 3, 1, 4, 2])
  assert.equal(p.color, undefined)
})

test('OFF: face colours (0-255) unshare vertices; COFF vertex colours (0-1) stay indexed', () => {
  const p = parseOFF('OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 255 0 0\n')
  assert.equal(p.index, undefined)
  assert.equal(p.position.length, 9)
  assert.deepEqual(Array.from(p.color ?? []).slice(0, 3), [1, 0, 0])
  const c = parseOFF('COFF\n3 1 0\n0 0 0 0 1 0 1\n1 0 0 0 1 0 1\n0 1 0 0 1 0 1\n3 0 1 2\n')
  assert.deepEqual(Array.from(c.index ?? []), [0, 1, 2])
  assert.deepEqual(Array.from(c.color ?? []).slice(0, 3), [0, 1, 0])
})

test('OFF: no faces is a point cloud; damage throws', () => {
  assert.equal(parseOFF('OFF\n2 0 0\n0 0 0\n1 1 1\n').type, 'points')
  assert.throws(() => parseOFF('OFF\n3 1 0\n0 0 0\n1 0 0\n'))
  assert.throws(() => parseOFF('OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 7\n'))
  assert.throws(() => parseOFF('NOPE 1 2 3'))
})
