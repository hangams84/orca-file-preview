import { assert, test } from 'orca/testing'
import {
  defaultZUp,
  detectModel,
  estimateSize,
  formatBox,
  formatCount,
  formatLength,
  gltfFacts,
  glbJson,
  offHeaderCounts,
  triangleLimit
} from './format.ts'

const enc = (s: string) => new TextEncoder().encode(s)

function binaryStl(n: number, header = 'binary stl', extra = 0): Uint8Array {
  const b = new Uint8Array(84 + n * 50 + extra)
  b.set(enc(header.padEnd(80, ' ')))
  new DataView(b.buffer).setUint32(80, n, true)
  return b
}

function glb(json: object): Uint8Array {
  let j = enc(JSON.stringify(json))
  const pad = (4 - (j.length % 4)) % 4
  const jj = new Uint8Array(j.length + pad).fill(0x20)
  jj.set(j)
  j = jj
  const b = new Uint8Array(20 + j.length)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, b.length, true)
  dv.setUint32(12, j.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  b.set(j, 20)
  return b
}

test('binary STL: exact size wins even when the header starts with "solid"', () => {
  assert.equal(detectModel(binaryStl(3), 'stl'), 'stl-binary')
  assert.equal(detectModel(binaryStl(3, 'solid exported by CAD'), 'stl'), 'stl-binary')
  // trailing bytes after the triangles are tolerated
  assert.equal(detectModel(binaryStl(3, 'x', 10), 'stl'), 'stl-binary')
})

test('binary STL cut short is refused (not misread as ASCII)', () => {
  const b = binaryStl(100).subarray(0, 84 + 50 * 7)
  assert.equal(detectModel(b, 'stl'), null)
})

test('ASCII STL', () => {
  const s = 'solid cube\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid cube\n'
  assert.equal(detectModel(enc(s), 'stl'), 'stl-ascii')
  assert.equal(detectModel(enc('﻿  ' + s), 'stl'), 'stl-ascii')
})

test('signatures: GLB, 3MF (zip), FBX binary, PLY, OFF, COLLADA, glTF JSON, ASCII FBX, OBJ', () => {
  assert.equal(detectModel(glb({ asset: { version: '2.0' } }), 'glb'), 'glb')
  assert.equal(detectModel(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), '3mf'), '3mf')
  assert.equal(detectModel(enc('Kaydara FBX Binary  \0\x1a\0'), 'fbx'), 'fbx-binary')
  assert.equal(detectModel(enc('ply\nformat ascii 1.0\n'), 'ply'), 'ply')
  assert.equal(detectModel(enc('ply\r\nformat binary_little_endian 1.0\r\n'), 'ply'), 'ply')
  assert.equal(detectModel(enc('OFF\n3 1 0\n'), 'off'), 'off')
  assert.equal(detectModel(enc('COFF 3 1 0\n'), 'off'), 'off')
  assert.equal(detectModel(enc('<?xml version="1.0"?>\n<COLLADA xmlns="x" version="1.4.1">'), 'dae'), 'dae')
  assert.equal(detectModel(enc('{"asset":{"version":"2.0"}}'), 'gltf'), 'gltf')
  assert.equal(detectModel(enc('; FBX 7.4.0 project file\nFBXHeaderExtension:  {'), 'fbx'), 'fbx-ascii')
  assert.equal(detectModel(enc('# comment\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'), 'obj'), 'obj')
})

test('non-models are refused', () => {
  assert.equal(detectModel(enc('hello world, not a model'), 'obj'), null)
  assert.equal(detectModel(enc('{"name": "package"}'), 'stl'), null)
  assert.equal(detectModel(new Uint8Array([1, 2]), 'stl'), null)
  assert.equal(detectModel(new Uint8Array(4096).fill(7), 'ply'), null)
})

test('header estimates', () => {
  assert.deepEqual(estimateSize('stl-binary', binaryStl(12)), { triangles: 12, vertices: 36 })
  const ply = enc('ply\nformat ascii 1.0\nelement vertex 8\nproperty float x\nelement face 6\nproperty list uchar int vertex_indices\nend_header\n')
  assert.deepEqual(estimateSize('ply', ply), { triangles: 6, vertices: 8 })
  assert.deepEqual(estimateSize('off', enc('OFF\n# a cube\n8 6 12\n')), { triangles: 6, vertices: 8 })
  assert.deepEqual(estimateSize('glb', glb({})), { triangles: null, vertices: null })
})

test('OFF header counts on the keyword line, after comments', () => {
  assert.deepEqual(offHeaderCounts('OFF 4 2 0'), { vertices: 4, faces: 2 })
  assert.deepEqual(offHeaderCounts('# c\nCNOFF\n\n# c\n10 3 0'), { vertices: 10, faces: 3 })
  assert.equal(offHeaderCounts('OFF\nx y z'), null)
  assert.equal(offHeaderCounts('PLY 1 2'), null)
})

test('length formatting: about four significant digits, no exponent for ordinary sizes', () => {
  assert.equal(formatLength(0), '0')
  assert.equal(formatLength(100), '100')
  assert.equal(formatLength(131.25), '131.3')
  assert.equal(formatLength(63.987), '63.99')
  assert.equal(formatLength(2.5), '2.5')
  assert.equal(formatLength(0.012345), '0.01235')
  assert.equal(formatLength(12345.6), '12,346')
  assert.equal(formatLength(-3), '-3')
  assert.equal(formatLength(2e-6), '2.00e-6')
  assert.equal(formatLength(Number.NaN), '?')
  assert.equal(formatBox({ x: 70, y: 70, z: 100 }), '70 × 70 × 100')
})

test('counts', () => {
  assert.equal(formatCount(1234567), '1,234,567')
  assert.equal(formatCount(12_300_000), '12.3M')
  assert.ok(triangleLimit(true) < triangleLimit(false))
})

test('Z-up default for CAD and printing formats only', () => {
  assert.equal(defaultZUp('stl-binary'), true)
  assert.equal(defaultZUp('3mf'), true)
  assert.equal(defaultZUp('glb'), false)
  assert.equal(defaultZUp('obj'), false)
})

test('glTF facts: external buffers/images and extensions', () => {
  const f = gltfFacts({
    extensionsRequired: ['KHR_draco_mesh_compression'],
    extensionsUsed: ['KHR_draco_mesh_compression', 'KHR_texture_transform'],
    buffers: [{ uri: 'scene.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }, {}],
    images: [{ uri: 'tex.png' }, { bufferView: 1 }]
  })
  assert.deepEqual(f.externalUris, ['scene.bin', 'tex.png'])
  assert.deepEqual(f.required, ['KHR_draco_mesh_compression'])
  assert.equal(f.used.length, 2)
  assert.deepEqual(gltfFacts(null), { required: [], used: [], externalUris: [] })
})

test('GLB JSON chunk; damaged containers give null', () => {
  assert.deepEqual(glbJson(glb({ asset: { version: '2.0' } })), { asset: { version: '2.0' } })
  assert.equal(glbJson(glb({ a: 1 }).subarray(0, 24)), null)
  assert.equal(glbJson(new Uint8Array(10)), null)
})
