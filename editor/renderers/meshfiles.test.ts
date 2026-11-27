import { assert, test } from 'orca/testing'
import { gltfFacts } from './model3d/format.ts'
import { meshKind, objMaterialLibs } from './meshfiles.ts'

test('meshfiles: an OBJ’s material libraries (names may contain spaces)', () => {
  const obj = '# c\nmtllib model.mtl\nmtllib  textures/My Materials.mtl \nv 0 0 0\nmtllib model.mtl\n  mtllib\tindent.mtl\n'
  assert.deepEqual(objMaterialLibs(obj), ['model.mtl', 'textures/My Materials.mtl', 'indent.mtl'])
  assert.deepEqual(objMaterialLibs('v 0 0 0\nf 1 1 1\n'), [])
})

test('meshfiles: the mesh format from the name, else from the content', () => {
  const b = (s: string) => new TextEncoder().encode(s)
  assert.equal(meshKind('package://p/meshes/A.STL', b('xx')), 'stl')
  assert.equal(meshKind('arm.dae?x', b('')), 'dae')
  assert.equal(meshKind('noext', b('glTF\u0002\u0000\u0000\u0000')), 'glb')
  assert.equal(meshKind('noext', b('<?xml version="1.0"?><COLLADA xmlns="x">')), 'dae')
  assert.equal(meshKind('noext', b('solid x\nfacet')), 'stl')
  assert.equal(meshKind('noext', b('tiny')), null)
})

test('gltf: external buffers are told apart from external images', () => {
  const facts = gltfFacts({
    buffers: [{ uri: 'model.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
    images: [{ uri: 'tex/checker.png' }, { bufferView: 0 }]
  })
  assert.deepEqual(facts.externalBuffers, ['model.bin'])
  assert.deepEqual(facts.externalUris, ['model.bin', 'tex/checker.png'])
})
