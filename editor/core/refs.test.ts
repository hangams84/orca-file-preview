import { assert, test } from 'orca/testing'
import { addCompanions, clearCompanions } from './companions.ts'
import { CompanionUrls, isAbsoluteRef, joinRef, locateSelf, readRef, resolveRef } from './refs.ts'

const f = (path: string, body: string = path) => ({ path, file: new File([body], path.split('/').pop() ?? path) })

test('refs: relative references join the referring file’s directory', () => {
  assert.equal(joinRef('../meshes/a.stl', 'pkg/urdf/robot.urdf'), 'pkg/meshes/a.stl')
  assert.equal(joinRef('parts/wheel.xacro', 'pkg/urdf/robot.urdf.xacro'), 'pkg/urdf/parts/wheel.xacro')
  assert.equal(joinRef('./tex.png', 'model.obj'), 'tex.png')
  assert.equal(joinRef('..\\..\\x.dxf', 'a/b/c/main.dxf'), 'a/x.dxf')
  assert.equal(joinRef('package://p/m.stl', 'pkg/urdf/r.urdf'), 'package://p/m.stl')
  assert.equal(joinRef('file:///opt/x.stl', 'a/b.urdf'), 'file:///opt/x.stl')
  assert.equal(joinRef('C:\\Projects\\std\\title.dxf', 'a/main.dxf'), 'C:/Projects/std/title.dxf')
  assert.equal(joinRef('a.stl'), 'a.stl')
  assert.ok(isAbsoluteRef('/usr/share/x.stl'))
  assert.ok(isAbsoluteRef('D:/x.stl'))
  assert.ok(!isAbsoluteRef('meshes/x.stl'))
})

test('refs: the referring file’s place picks between files with the same name', () => {
  clearCompanions()
  addCompanions([f('ws/src/bot_a/meshes/base.stl', 'A'), f('ws/src/bot_b/meshes/base.stl', 'B'), f('ws/src/bot_b/urdf/bot.urdf', 'U')])
  assert.equal(resolveRef('../meshes/base.stl', 'ws/src/bot_a/urdf/bot.urdf')?.path, 'ws/src/bot_a/meshes/base.stl')
  assert.equal(resolveRef('../meshes/base.stl', 'ws/src/bot_b/urdf/bot.urdf')?.path, 'ws/src/bot_b/meshes/base.stl')
  assert.equal(resolveRef('package://bot_b/meshes/base.stl')?.path, 'ws/src/bot_b/meshes/base.stl')
  assert.equal(resolveRef('data:image/png;base64,AAAA'), null)
  assert.equal(resolveRef('nothing.stl', 'ws/src/bot_a/urdf/bot.urdf'), null)
  clearCompanions()
})

test('refs: readRef returns bytes and the companion path; locateSelf finds the opened file', async () => {
  clearCompanions()
  addCompanions([f('pkg/urdf/robot.urdf', '<robot name="x"/>'), f('pkg/urdf/other.urdf', '<robot name="y"/>'), f('pkg/meshes/a.stl', 'solid a')])
  const got = await readRef('../meshes/a.stl', 'pkg/urdf/robot.urdf')
  assert.equal(got?.path, 'pkg/meshes/a.stl')
  assert.equal(new TextDecoder().decode(got!.bytes), 'solid a')
  assert.equal(await readRef('missing.stl'), null)
  assert.equal(await locateSelf(new TextEncoder().encode('<robot name="y"/>'), /\.urdf$/), 'pkg/urdf/other.urdf')
  assert.equal(await locateSelf(new TextEncoder().encode('<robot name="z"/>')), undefined)
  clearCompanions()
})

test('refs: CompanionUrls hands out one URL per file and records what is missing', () => {
  clearCompanions()
  addCompanions([f('model/textures/checker.png', 'png')])
  const urls = new CompanionUrls('model/model.obj')
  const a = urls.url('textures/checker.png')
  const b = urls.url('./textures/checker.png')
  assert.ok(a && a.startsWith('blob:'))
  assert.equal(a, b)
  assert.equal(urls.url('textures/missing.png?x=1'), null)
  assert.equal(urls.url('textures/missing.png'), null)
  assert.deepEqual(urls.missing, ['textures/missing.png'])
  assert.deepEqual(urls.used, ['model/textures/checker.png'])
  urls.dispose()
  clearCompanions()
})
