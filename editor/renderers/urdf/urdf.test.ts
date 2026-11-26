import { assert, test } from 'orca/testing'
import { evaluate, floatRepr, globalNames, pyStr, type Value } from './expr.ts'
import { fileLabel, LoadError, loadRobot } from './load.ts'
import { dof, jointRange, resolvePositions } from './model.ts'
import { evalLiteral, parseParams, processXacro } from './xacro.ts'
import { attr, elements, parseXml, serializeXml, XmlError } from './xml.ts'

const G = globalNames(() => undefined)
const ev = (src: string, vars: Record<string, Value> = {}) => pyStr(evaluate(src, (n) => (n in vars ? vars[n] : G[n])))

test('xml: elements, attributes, entities, CDATA, comments, line numbers', () => {
  const root = parseXml('<?xml version="1.0"?>\n<!-- c -->\n<robot name="a&amp;b">\n  <link name=\'x\'>t &lt; <![CDATA[<raw>]]></link>\n  <!--inner-->\n</robot>\n')
  assert.equal(root.name, 'robot')
  assert.equal(attr(root, 'name'), 'a&b')
  const link = elements(root, 'link')[0]
  assert.equal(link.line, 4)
  assert.equal((link.children[0] as { text: string }).text, 't < <raw>')
  assert.ok(root.children.some((c) => c.type === 'comment'))
  // attribute-value normalisation
  assert.equal(attr(parseXml('<a b="1\n2\t3"/>'), 'b'), '1 2 3')
  assert.match(serializeXml(root), /<link name="x">t &lt; &lt;raw&gt;<\/link>/)
})

test('xml: malformed input fails with a line number', () => {
  const cases = ['<a><b></a>', '<a', '<a b=1/>', 'text', '<a/><b/>', '<a>&bogus;</a>', '<a b="1" b="2"/>', '']
  for (const c of cases) {
    assert.throws(() => parseXml(c), (e) => e instanceof XmlError)
  }
  try {
    parseXml('<robot>\n<link>\n</robot>')
  } catch (e) {
    assert.ok(e instanceof XmlError)
    assert.equal((e as XmlError).line, 3)
  }
})

test('expr: Python int/float arithmetic and float repr', () => {
  assert.equal(ev('7 / 2'), '3.5')
  assert.equal(ev('7 // 2'), '3')
  assert.equal(ev('-7 // 2'), '-4')
  assert.equal(ev('-7 % 3'), '2')
  assert.equal(ev('2 ** 10'), '1024')
  assert.equal(ev('2 ** -1'), '0.5')
  assert.equal(ev('-2 ** 2'), '-4')
  assert.equal(ev('0.1 + 0.2'), '0.30000000000000004')
  assert.equal(ev('1.0 * 2'), '2.0')
  assert.equal(ev('pi / 2'), '1.5707963267948966')
  assert.equal(floatRepr(1e-5), '1e-05')
  assert.equal(floatRepr(1.234e-5), '1.234e-05')
  assert.equal(floatRepr(1e16), '1e+16')
  assert.equal(floatRepr(123456789012345.6), '123456789012345.6')
  assert.equal(floatRepr(-0.0001), '-0.0001')
  assert.throws(() => ev('1 / 0'), /division by zero/)
})

test('expr: logic, comparisons, strings, functions, namespaces', () => {
  assert.equal(ev('1 < x <= 7', { x: 7 }), 'True')
  assert.equal(ev('0 and 5'), '0')
  assert.equal(ev("'' or 'b'"), 'b')
  assert.equal(ev('not x', { x: true }), 'False')
  assert.equal(ev("'a' if x > 1 else 'b'", { x: 2 }), 'a')
  assert.equal(ev("s + '_' + str(3)", { s: 'link' }), 'link_3')
  assert.equal(ev("'ab' * 2"), 'abab')
  assert.equal(ev("'%s-%d' % ('x', 4)"), 'x-4')
  assert.equal(ev("'bc' in 'abcd'"), 'True')
  assert.equal(ev('radians(180)'), '3.141592653589793')
  assert.equal(ev('degrees(pi)'), '180.0')
  assert.equal(ev('atan2(1, 1)'), '0.7853981633974483')
  assert.equal(ev('floor(2.7) + ceil(2.1)'), '5')
  assert.equal(ev('max(1, 2.5, 2)'), '2.5')
  assert.equal(ev('round(2.5)'), '2')
  assert.equal(ev('sqrt(16)'), '4.0')
  assert.equal(ev('pow(2, 3)'), '8.0')
  assert.equal(ev('math.cos(0)'), '1.0')
  assert.equal(ev('python.abs(-3)'), '3')
  assert.equal(ev("int('42') + len([1, 2])"), '44')
  assert.equal(ev('list(range(3))'), '[0, 1, 2]')
  assert.equal(ev('(1, 2)[1]'), '2')
  // xacro does not expose abs() without python.
  assert.throws(() => ev('abs(-1)'), /not defined/)
  assert.throws(() => ev('__import__'), /invalid name/)
  assert.throws(() => ev('1 +'), /unexpected end/)
  assert.throws(() => ev('x.y', { x: 1 }), /no attribute/)
})

test('xacro: literals, macro parameter lists', () => {
  assert.equal(evalLiteral('3'), 3)
  assert.equal(pyStr(evalLiteral('0.5')), '0.5')
  assert.equal(evalLiteral("'q'"), 'q')
  assert.equal(evalLiteral('1_000'), '1_000')
  assert.equal(evalLiteral('true'), true)
  assert.equal(evalLiteral('abc'), 'abc')
  const p = parseParams('name x:=1 color:=^|${d} *origin **rest y:=^ z:="a b"')
  assert.deepEqual(p.params, ['name', 'x', 'color', '*origin', '**rest', 'y', 'z'])
  assert.deepEqual(p.defaults.get('color'), { forward: 'color', dflt: '${d}' })
  assert.deepEqual(p.defaults.get('y'), { forward: 'y', dflt: null })
  assert.deepEqual(p.defaults.get('z'), { forward: null, dflt: '"a b"' })
})

const xacro = (body: string, args?: Record<string, string>) => processXacro(parseXml(`<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">${body}</robot>`), { args })

test('xacro: properties (lazy, default, remove, scope), args, if/unless', () => {
  const r = xacro(`
    <xacro:arg name="w" default="0.5"/>
    <xacro:property name="a" value="\${b * 2}"/>
    <xacro:property name="b" value="\${$(arg w) + 1}"/>
    <xacro:property name="d" default="1"/><xacro:property name="d" default="2"/>
    <xacro:property name="gone" value="1"/><xacro:property name="gone" remove="true"/>
    <xacro:macro name="m"><xacro:property name="g" value="7" scope="global"/></xacro:macro><xacro:m/>
    <link name="l" a="\${a}" d="\${d}" g="\${g}" s="x\${d}y" dollar="$\${a}"/>
    <xacro:if value="$(arg w)"><bad/></xacro:if>
    <xacro:if value="\${a > 1}"><yes/></xacro:if>
    <xacro:unless value="0"><also/></xacro:unless>
    <x v="\${gone}"/>`, { w: '1' })
  const l = elements(r.root, 'link')[0]
  assert.equal(attr(l, 'a'), '4', 'w:=1 → b = 1 + 1 (int) → a = 4')
  assert.equal(attr(l, 'd'), '1')
  assert.equal(attr(l, 'g'), '7')
  assert.equal(attr(l, 's'), 'x1y')
  assert.equal(attr(l, 'dollar'), '${a}')
  assert.equal(elements(r.root, 'bad').length, 1, '$(arg w) is "1" → true')
  assert.equal(elements(r.root, 'yes').length, 1)
  assert.equal(elements(r.root, 'also').length, 1)
  assert.ok(r.notes.some((n) => /name 'gone' is not defined/.test(n.message)))
  assert.equal(r.args.w, '1')
})

test('xacro: macros with defaults, forwarding, blocks, recursion, element/attribute, call', () => {
  const r = xacro(`
    <xacro:property name="color" value="red"/>
    <xacro:property name="blk"><inner a="1"/><inner a="2"/></xacro:property>
    <xacro:macro name="m" params="n k:=3 color:=^|blue *first **rest">
      <link name="\${n}" k="\${k}" c="\${color}"><xacro:insert_block name="first"/><xacro:insert_block name="rest"/><xacro:insert_block name="blk"/></link>
    </xacro:macro>
    <xacro:m n="one"><f1/><wrap><r1/><r2/></wrap></xacro:m>
    <xacro:macro name="chain" params="i"><xacro:if value="\${i > 0}"><c i="\${i}"/><xacro:chain i="\${i - 1}"/></xacro:if></xacro:macro>
    <xacro:chain i="3"/>
    <xacro:element xacro:name="\${'jo' + 'int'}" name="j"><xacro:attribute name="type" value="fixed"/></xacro:element>
    <xacro:call macro="m" n="two" k="5"><f2/><wrap/></xacro:call>`)
  const [one, two] = elements(r.root, 'link')
  assert.equal(attr(one, 'k'), '3')
  assert.equal(attr(one, 'c'), 'red')
  assert.deepEqual(elements(one).map((e) => e.name), ['f1', 'r1', 'r2', 'inner', 'inner'])
  assert.equal(attr(two, 'name'), 'two')
  assert.equal(attr(two, 'k'), '5')
  assert.deepEqual(elements(r.root, 'c').map((e) => attr(e, 'i')), ['3', '2', '1'])
  assert.equal(attr(elements(r.root, 'joint')[0], 'type'), 'fixed')
  assert.equal(r.notes.length, 0, JSON.stringify(r.notes))
})

test('xacro: missing includes and unresolved macros become notes; runaway recursion stops', () => {
  const r = xacro(`<xacro:include filename="$(find pkg)/a.xacro"/><xacro:thing x="1"/><link name="l" v="\${undefined_prop}"/>`)
  assert.deepEqual(r.includes.map((i) => i.filename), ['package://pkg/a.xacro'])
  assert.deepEqual(r.unresolvedMacros, ['thing'])
  assert.ok(r.notes.every((n) => n.level === 'warning'), JSON.stringify(r.notes))
  assert.throws(() => xacro('<xacro:macro name="f" params="i"><xacro:f i="${i+1}"/></xacro:macro><xacro:f i="0"/>'), /deeper than 100/)
})

const ARM = `<robot name="arm">
  <material name="blue"><color rgba="0 0 1 1"/></material>
  <link name="base"><visual><geometry><box size="1 2 3"/></geometry><material name="blue"/></visual></link>
  <link name="a"><visual><origin xyz="0 0 0.5" rpy="0 1.5708 0"/><geometry><cylinder radius="0.1" length="1"/></geometry></visual>
    <collision><geometry><capsule radius="0.1" length="0.5"/></geometry></collision></link>
  <link name="b"><visual><geometry><mesh filename="package://p/meshes/b.stl" scale="0.001 0.001 0.001"/></geometry></visual></link>
  <link name="c"/>
  <joint name="j1" type="revolute"><parent link="base"/><child link="a"/><axis xyz="0 0 2"/><limit lower="-1" upper="1"/></joint>
  <joint name="j2" type="continuous"><parent link="a"/><child link="b"/><origin xyz="1 0 0"/></joint>
  <joint name="j3" type="prismatic"><parent link="b"/><child link="c"/><limit lower="0" upper="0.2"/><mimic joint="j1" multiplier="0.1" offset="0.05"/></joint>
</robot>`

test('urdf: links, joints, materials, geometry, tree, DOF, mimic', () => {
  const { robot, meshes, dof: n } = loadRobot(ARM, 'urdf')
  assert.equal(robot.links.length, 4)
  assert.equal(robot.joints.length, 3)
  assert.deepEqual(robot.roots, [0])
  assert.deepEqual(robot.links[0].visuals[0].material?.rgba, [0, 0, 1, 1])
  assert.deepEqual(robot.joints[0].axis, [0, 0, 1], 'axis normalised')
  assert.deepEqual(robot.links[1].visuals[0].origin.rpy, [0, 1.5708, 0])
  assert.equal(robot.links[1].collisions[0].geometry.type, 'capsule')
  assert.deepEqual(meshes, [{ link: 'b', filename: 'package://p/meshes/b.stl', kind: 'visual' }])
  assert.equal(n, 2, 'j1 + j2; j3 mimics')
  assert.deepEqual(jointRange(robot.joints[1]), [-Math.PI, Math.PI])
  const pos = resolvePositions(robot, new Map([['j1', 0.5]]))
  assert.ok(Math.abs(pos.get('j3')! - 0.1) < 1e-12)
  assert.equal(robot.notes.length, 0, JSON.stringify(robot.notes))
  assert.equal(fileLabel('package://p/meshes/b.stl'), 'b.stl')
  assert.equal(fileLabel('C:\\m\\x.dae'), 'x.dae')
})

test('urdf: problems become notes (missing link, two parents, loop, bad numbers)', () => {
  const { robot } = loadRobot(
    `<robot name="p"><link name="a"/><link name="b"/><link name="c"/><link name="d"/>
      <joint name="ab" type="fixed"><parent link="a"/><child link="b"/></joint>
      <joint name="ab2" type="fixed"><parent link="a"/><child link="b"/></joint>
      <joint name="cd" type="fixed"><parent link="c"/><child link="d"/></joint>
      <joint name="dc" type="fixed"><parent link="d"/><child link="c"/></joint>
      <joint name="ax" type="weird"><parent link="a"/><child link="x"/><origin xyz="1 2"/></joint>
      <bogus/></robot>`,
    'urdf'
  )
  const text = robot.notes.map((n) => n.message).join('\n')
  assert.match(text, /two parent joints/)
  assert.match(text, /kinematic loop/)
  assert.match(text, /"x" link not found/)
  assert.match(text, /unknown type "weird"/)
  assert.match(text, /is not three numbers/)
  assert.match(text, /<bogus>/)
  assert.equal(robot.roots.length, 2)
  assert.equal(dof(robot), 0)
})

test('load: friendly failures', () => {
  const code = (src: string, t = 'urdf') => {
    try {
      loadRobot(src, t)
    } catch (e) {
      return (e as LoadError).code
    }
    return 'ok'
  }
  assert.equal(code('<robot><link name="a">'), 'urdf-xml')
  assert.equal(code('<robot/>'), 'urdf-empty')
  assert.equal(code('<html/>'), 'urdf-root')
  assert.equal(code('<robot xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:macro name="f"><xacro:f/></xacro:macro><xacro:f/></robot>', 'xacro'), 'xacro-recursion')
  assert.equal(code('<robot name="r"><link name="a"/></robot>'), 'ok')
})

test('urdf: a large robot loads quickly', () => {
  const parts = ['<robot name="big"><link name="l0"/>']
  for (let i = 1; i <= 2000; i++) parts.push(`<link name="l${i}"><visual><geometry><sphere radius="0.01"/></geometry></visual></link><joint name="j${i}" type="revolute"><parent link="l${i - 1}"/><child link="l${i}"/><origin xyz="0.01 0 0"/><axis xyz="0 0 1"/><limit lower="-1" upper="1"/></joint>`)
  parts.push('</robot>')
  const t0 = Date.now()
  const { robot } = loadRobot(parts.join(''), 'urdf')
  assert.equal(robot.links.length, 2001)
  assert.ok(Date.now() - t0 < 2000)
})
