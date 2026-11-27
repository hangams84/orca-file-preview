import { assert, test } from 'orca/testing'
import { addCompanions, clearCompanions } from '../../core/companions.ts'
import { readRef, resolveRef } from '../../core/refs.ts'
import { loadRobot, loadRobotWithIncludes } from './load.ts'

const f = (path: string, body: string) => ({ path, file: new File([body], path.split('/').pop() ?? path) })
const XNS = 'xmlns:xacro="http://www.ros.org/wiki/xacro"'

/** The same reader the renderer uses: companions resolved by path tail, relative to the includer. */
const fetchInclude = async (filename: string, from: string | undefined) => {
  const got = await readRef(filename, from)
  return got ? { text: new TextDecoder().decode(got.bytes), path: got.path } : null
}

const MAIN = `<robot name="demo_bot" ${XNS}>
  <xacro:include filename="$(find demo_bot)/urdf/macros.xacro"/>
  <xacro:include filename="parts/wheel.xacro"/>
  <link name="base_link"><visual><geometry><mesh filename="package://demo_bot/meshes/base.stl" scale="0.001 0.001 0.001"/></geometry></visual></link>
  <xacro:wheel side="left"/>
  <xacro:arm name="arm" parent="base_link"/>
</robot>`
const PKG = {
  'demo_bot/urdf/macros.xacro': `<robot ${XNS}>
    <xacro:include filename="inertia.xacro"/>
    <xacro:macro name="arm" params="name parent">
      <link name="\${name}"><visual><geometry><mesh filename="package://demo_bot/meshes/arm.dae"/></geometry></visual>
        <xacro:mass m="\${arm_mass}"/></link>
      <joint name="\${name}_joint" type="revolute"><parent link="\${parent}"/><child link="\${name}"/><axis xyz="0 1 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint>
    </xacro:macro>
  </robot>`,
  'demo_bot/urdf/inertia.xacro': `<robot ${XNS}><xacro:property name="arm_mass" value="1.5"/><xacro:macro name="mass" params="m"><inertial><mass value="\${m}"/></inertial></xacro:macro></robot>`,
  'demo_bot/urdf/parts/wheel.xacro': `<robot ${XNS}><xacro:macro name="wheel" params="side">
      <link name="wheel_\${side}"><visual><geometry><mesh filename="../../meshes/wheel.stl"/></geometry></visual></link>
      <joint name="wheel_\${side}_joint" type="continuous"><parent link="base_link"/><child link="wheel_\${side}"/></joint>
    </xacro:macro></robot>`
}

test('xacro includes: without files every include is listed and its macros are unresolved', async () => {
  clearCompanions()
  const r = await loadRobotWithIncludes(MAIN, 'xacro', fetchInclude)
  assert.deepEqual(r.xacro!.includes.map((i) => i.filename), ['package://demo_bot/urdf/macros.xacro', 'parts/wheel.xacro'])
  assert.deepEqual(r.xacro!.included, [])
  assert.deepEqual(r.robot.links.map((l) => l.name), ['base_link'])
  assert.ok(r.xacro!.unresolvedMacros.includes('wheel'))
})

test('xacro includes: $(find pkg) and relative includes resolve recursively; the missing list shrinks', async () => {
  clearCompanions()
  addCompanions(Object.entries(PKG).map(([p, t]) => f(p, t)))
  const r = await loadRobotWithIncludes(MAIN, 'xacro', fetchInclude)
  assert.deepEqual(r.xacro!.includes, [])
  assert.deepEqual(
    r.xacro!.included.map((i) => i.path).sort(),
    ['demo_bot/urdf/inertia.xacro', 'demo_bot/urdf/macros.xacro', 'demo_bot/urdf/parts/wheel.xacro']
  )
  assert.deepEqual(r.robot.links.map((l) => l.name).sort(), ['arm', 'base_link', 'wheel_left'])
  assert.equal(r.robot.links.find((l) => l.name === 'arm')!.mass, 1.5)
  assert.deepEqual(r.xacro!.unresolvedMacros, [])
  assert.equal(r.dof, 2)
  clearCompanions()
})

test('xacro includes: a partial set loads what it can and lists the rest', async () => {
  clearCompanions()
  addCompanions([f('demo_bot/urdf/parts/wheel.xacro', PKG['demo_bot/urdf/parts/wheel.xacro'])])
  const r = await loadRobotWithIncludes(MAIN, 'xacro', fetchInclude)
  assert.deepEqual(r.xacro!.includes.map((i) => i.filename), ['package://demo_bot/urdf/macros.xacro'])
  assert.deepEqual(r.robot.links.map((l) => l.name).sort(), ['base_link', 'wheel_left'])
  clearCompanions()
})

test('xacro includes: a file that includes itself is stopped with a note', async () => {
  const files: Record<string, string> = {
    'a.xacro': `<robot ${XNS}><xacro:include filename="b.xacro"/><link name="from_a"/></robot>`,
    'b.xacro': `<robot ${XNS}><xacro:include filename="a.xacro"/><link name="from_b"/></robot>`
  }
  const r = await loadRobotWithIncludes(`<robot name="loop" ${XNS}><xacro:include filename="a.xacro"/></robot>`, 'xacro', async (name) =>
    files[name] ? { text: files[name], path: name } : null
  )
  assert.ok(r.xacro!.notes.some((n) => n.level === 'error' && /includes itself/.test(n.message)))
  assert.deepEqual(r.robot.links.map((l) => l.name).sort(), ['from_a', 'from_b'])
})

test('xacro includes: a malformed included file is a note, not a failure', async () => {
  const r = await loadRobotWithIncludes(`<robot name="x" ${XNS}><xacro:include filename="bad.xacro"/><link name="l"/></robot>`, 'xacro', async () => ({ text: '<robot><link></robot>', path: 'bad.xacro' }))
  assert.ok(r.xacro!.notes.some((n) => /not well-formed/.test(n.message)))
  assert.deepEqual(r.xacro!.includes.map((i) => i.filename), ['bad.xacro'])
  assert.deepEqual(r.robot.links.map((l) => l.name), ['l'])
})

test('mesh references map to the supplied files (package://, relative, file://, bare)', () => {
  clearCompanions()
  addCompanions([
    f('src/demo_bot/meshes/base.stl', 'x'),
    f('src/demo_bot/meshes/arm.dae', 'x'),
    f('src/demo_bot/meshes/gripper.obj', 'x'),
    f('src/demo_bot/urdf/robot.urdf', 'x'),
    f('src/other/meshes/base.stl', 'x')
  ])
  const urdf = `<robot name="r">
    <link name="a"><visual><geometry><mesh filename="package://demo_bot/meshes/base.stl"/></geometry></visual></link>
    <link name="b"><visual><geometry><mesh filename="../meshes/arm.dae"/></geometry></visual></link>
    <link name="c"><visual><geometry><mesh filename="file:///opt/ros/humble/share/demo_bot/meshes/gripper.obj"/></geometry></visual></link>
    <link name="d"><visual><geometry><mesh filename="package://missing_pkg/meshes/lidar.stl"/></geometry></visual></link>
    <joint name="j1" type="fixed"><parent link="a"/><child link="b"/></joint>
    <joint name="j2" type="fixed"><parent link="b"/><child link="c"/></joint>
    <joint name="j3" type="fixed"><parent link="a"/><child link="d"/></joint>
  </robot>`
  const r = loadRobot(urdf, 'urdf')
  const self = 'src/demo_bot/urdf/robot.urdf'
  const mapped = r.meshes.map((m) => resolveRef(m.filename, self)?.path ?? null)
  assert.deepEqual(mapped, ['src/demo_bot/meshes/base.stl', 'src/demo_bot/meshes/arm.dae', 'src/demo_bot/meshes/gripper.obj', null])
  clearCompanions()
})
