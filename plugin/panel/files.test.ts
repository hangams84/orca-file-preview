import { assert, test } from 'orca/testing'
import { fileTypeOf, openCandidates } from './files.ts'

const KNOWN = ['stl', 'obj', 'gltf', 'urdf', 'xacro', 'dxf', 'kicad_sch', 'kicad_pcb', 'step', 'stp', 'stpz', 'pdf', 'txt']
const f = (path: string) => ({ path, file: new File(['x'], path.split('/').pop() ?? path) })

test('panel: the type of a file comes from its longest known suffix', () => {
  assert.equal(fileTypeOf('robot.urdf.xacro', KNOWN), 'xacro')
  assert.equal(fileTypeOf('C:\\boards\\Main.KiCad_Sch', KNOWN), 'kicad_sch')
  assert.equal(fileTypeOf('big/part.STPZ', KNOWN), 'stpz')
  assert.equal(fileTypeOf('model.mtl', KNOWN), '')
  assert.equal(fileTypeOf('noext', KNOWN), '')
  assert.equal(fileTypeOf('archive.tar.gz', KNOWN), '')
})

test('panel: openable files from a folder, the least nested first', () => {
  const list = openCandidates([f('pkg/meshes/a.stl'), f('pkg/package.xml'), f('pkg/urdf/robot.urdf.xacro'), f('pkg/README.txt'), f('pkg/meshes/a.mtl')], KNOWN)
  assert.deepEqual(list.map((c) => c.path), ['pkg/README.txt', 'pkg/meshes/a.stl', 'pkg/urdf/robot.urdf.xacro'])
  assert.deepEqual(openCandidates([f('x.bin')], KNOWN), [])
})
