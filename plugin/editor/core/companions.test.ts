import { assert, test } from 'orca/testing'
import { addCompanions, clearCompanions, findCompanion, referenceSegments } from './companions.ts'

const f = (path: string) => ({ path, file: new File([path], path.split('/').pop() ?? path) })

test('companion references resolve by the longest path tail', () => {
  clearCompanions()
  addCompanions([f('robot_description/meshes/base.stl'), f('other_pkg/meshes/base.stl'), f('robot_description/urdf/arm.xacro'), f('textures/wood.png')])
  assert.equal(findCompanion('package://robot_description/meshes/base.stl')?.path, 'robot_description/meshes/base.stl')
  assert.equal(findCompanion('package://other_pkg/meshes/base.stl')?.path, 'other_pkg/meshes/base.stl')
  assert.equal(findCompanion('file:///opt/ros/share/robot_description/meshes/BASE.STL')?.path, 'robot_description/meshes/base.stl')
  assert.equal(findCompanion('../urdf/arm.xacro')?.path, 'robot_description/urdf/arm.xacro')
  assert.equal(findCompanion('C:\models\textures\wood.png')?.path, 'textures/wood.png')
  assert.equal(findCompanion('missing.stl'), null)
  assert.deepEqual(referenceSegments('package://p/a%20b/./c.dae?x=1'), ['p', 'a b', 'c.dae'])
  clearCompanions()
})
