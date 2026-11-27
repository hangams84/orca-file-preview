// Generates the companion-file samples (samples/companions/…): files that refer to other files, for the
// 📁 picker / drop tests (tools/harness/companions.mjs) and the unit tests. Everything here is made by this
// script (public-safe, MIT like the repo):
//   ros_pkg/demo_bot/…         a ROS-style package: urdf/robot.urdf.xacro including macros (recursively, by
//                              $(find demo_bot) and by relative path), urdf/robot.urdf, meshes/*.stl|dae|obj
//                              with an .mtl and textures
//   obj/  model.obj + model.mtl + checker.png
//   gltf/ model.gltf + model.bin + checker.png
//   dae/  textured.dae + checker.png
//   dxf/  main.dxf with an xref (parts\bolt.dxf, supplied; std\title.dxf, not) and an IMAGE (logo.png)
//
//   node tools/make-companion-samples.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'samples', 'companions')
rmSync(OUT, { recursive: true, force: true })
const put = (rel, data) => {
  const p = join(OUT, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, data)
}

// ---- PNG -----------------------------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 3 + 1) + 1 + x * 3)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const checker = (a, b, n = 8) => png(64, 64, (x, y) => ((Math.floor(x / n) + Math.floor(y / n)) % 2 ? a : b))
const CHECKER = checker([230, 120, 30], [40, 60, 160])
const STRIPES = png(32, 32, (x) => (Math.floor(x / 4) % 2 ? [30, 170, 90] : [240, 240, 240]))
// A small logo: a filled circle with a bar, on white.
const LOGO = png(64, 48, (x, y) => {
  const d = Math.hypot(x - 20, y - 24)
  if (d < 14) return [200, 30, 40]
  if (x > 38 && x < 58 && y > 18 && y < 30) return [30, 60, 200]
  return [255, 255, 255]
})

// ---- box mesh (24 vertices, per-face normals and UVs) ---------------------------------------------
function box(sx, sy, sz, cx = 0, cy = 0, cz = 0) {
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
    [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]
  ]
  const pos = []
  const nor = []
  const uv = []
  const idx = []
  const h = [sx / 2, sy / 2, sz / 2]
  for (const [n, u, v] of faces) {
    const base = pos.length / 3
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) pos.push([cx, cy, cz][k] + (n[k] + u[k] * a + v[k] * b) * h[k])
      nor.push(...n)
      uv.push((a + 1) / 2, (b + 1) / 2)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { pos, nor, uv, idx }
}
const fmt = (x) => String(Number(x.toFixed(5)))

function stlBinary(m) {
  const n = m.idx.length / 3
  const buf = Buffer.alloc(84 + n * 50)
  buf.write('File Preview sample (tools/make-companion-samples.mjs)', 0, 'latin1')
  buf.writeUInt32LE(n, 80)
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50
    const [a, b, c] = [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]]
    for (let k = 0; k < 3; k++) buf.writeFloatLE(m.nor[a * 3 + k], o + k * 4)
    ;[a, b, c].forEach((v, j) => {
      for (let k = 0; k < 3; k++) buf.writeFloatLE(m.pos[v * 3 + k], o + 12 + j * 12 + k * 4)
    })
  }
  return buf
}
function stlAscii(m, name) {
  let s = `solid ${name}\n`
  for (let t = 0; t < m.idx.length / 3; t++) {
    const [a, b, c] = [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]]
    s += `  facet normal ${m.nor.slice(a * 3, a * 3 + 3).map(fmt).join(' ')}\n    outer loop\n`
    for (const v of [a, b, c]) s += `      vertex ${m.pos.slice(v * 3, v * 3 + 3).map(fmt).join(' ')}\n`
    s += '    endloop\n  endfacet\n'
  }
  return s + `endsolid ${name}\n`
}
function obj(m, mtllib, material) {
  let s = `# File Preview sample (tools/make-companion-samples.mjs)\nmtllib ${mtllib}\no part\n`
  for (let i = 0; i < m.pos.length; i += 3) s += `v ${m.pos.slice(i, i + 3).map(fmt).join(' ')}\n`
  for (let i = 0; i < m.uv.length; i += 2) s += `vt ${m.uv.slice(i, i + 2).map(fmt).join(' ')}\n`
  for (let i = 0; i < m.nor.length; i += 3) s += `vn ${m.nor.slice(i, i + 3).map(fmt).join(' ')}\n`
  s += `usemtl ${material}\n`
  for (let t = 0; t < m.idx.length; t += 3) s += `f ${[0, 1, 2].map((j) => m.idx[t + j] + 1).map((v) => `${v}/${v}/${v}`).join(' ')}\n`
  return s
}
function dae(m, { image, color = [0.8, 0.8, 0.8], upAxis = 'Z_UP', name = 'part' }) {
  const n = m.pos.length / 3
  const p = []
  for (const i of m.idx) p.push(i, i, i)
  const diffuse = image
    ? '<diffuse><texture texture="tex-sampler" texcoord="UVSET0"/></diffuse>'
    : `<diffuse><color>${color.join(' ')} 1</color></diffuse>`
  const params = image
    ? `<newparam sid="tex-surface"><surface type="2D"><init_from>tex-image</init_from></surface></newparam>
      <newparam sid="tex-sampler"><sampler2D><source>tex-surface</source></sampler2D></newparam>`
    : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><contributor><authoring_tool>File Preview tools/make-companion-samples.mjs</authoring_tool></contributor><unit name="meter" meter="1"/><up_axis>${upAxis}</up_axis></asset>
  ${image ? `<library_images><image id="tex-image" name="tex-image"><init_from>${image}</init_from></image></library_images>` : ''}
  <library_effects><effect id="fx"><profile_COMMON>${params}<technique sid="common"><phong>${diffuse}<specular><color>0.3 0.3 0.3 1</color></specular><shininess><float>20</float></shininess></phong></technique></profile_COMMON></effect></library_effects>
  <library_materials><material id="mat" name="${name}-material"><instance_effect url="#fx"/></material></library_materials>
  <library_geometries><geometry id="geo" name="${name}"><mesh>
    <source id="pos"><float_array id="pos-a" count="${n * 3}">${m.pos.map(fmt).join(' ')}</float_array><technique_common><accessor source="#pos-a" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <source id="nor"><float_array id="nor-a" count="${n * 3}">${m.nor.map(fmt).join(' ')}</float_array><technique_common><accessor source="#nor-a" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <source id="uv"><float_array id="uv-a" count="${n * 2}">${m.uv.map(fmt).join(' ')}</float_array><technique_common><accessor source="#uv-a" count="${n}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
    <vertices id="verts"><input semantic="POSITION" source="#pos"/></vertices>
    <triangles material="mat" count="${m.idx.length / 3}"><input semantic="VERTEX" source="#verts" offset="0"/><input semantic="NORMAL" source="#nor" offset="1"/><input semantic="TEXCOORD" source="#uv" offset="2" set="0"/><p>${p.join(' ')}</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="scene"><node id="node" name="${name}"><instance_geometry url="#geo"><bind_material><technique_common><instance_material symbol="mat" target="#mat"><bind_vertex_input semantic="UVSET0" input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material></instance_geometry></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`
}
function gltf(m, binName, imageName) {
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer)
  const parts = [f32(m.pos), f32(m.nor), f32(m.uv), Buffer.from(new Uint16Array(m.idx).buffer)]
  const views = []
  let off = 0
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: off, byteLength: p.length })
    off += p.length
    while (off % 4) off++
  }
  const bin = Buffer.alloc(off)
  parts.forEach((p, i) => p.copy(bin, views[i].byteOffset))
  const min = [0, 1, 2].map((k) => Math.min(...m.pos.filter((_, i) => i % 3 === k)))
  const max = [0, 1, 2].map((k) => Math.max(...m.pos.filter((_, i) => i % 3 === k)))
  const json = {
    asset: { version: '2.0', generator: 'File Preview tools/make-companion-samples.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'box' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'checker', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [{ uri: imageName }],
    buffers: [{ uri: binName, byteLength: bin.length }],
    bufferViews: views.map((v, i) => ({ ...v, target: i === 3 ? 34963 : 34962 })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: m.pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: m.nor.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: m.uv.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: m.idx.length, type: 'SCALAR' }
    ]
  }
  return { json: JSON.stringify(json, null, 1), bin }
}

// ---- ROS package -----------------------------------------------------------------------------------
const PKG = 'ros_pkg/demo_bot'
put(`${PKG}/package.xml`, `<?xml version="1.0"?>
<package format="3">
  <name>demo_bot</name>
  <version>0.1.0</version>
  <description>Sample robot for File Preview (generated by tools/make-companion-samples.mjs)</description>
  <maintainer email="noreply@example.com">File Preview</maintainer>
  <license>MIT</license>
  <exec_depend>xacro</exec_depend>
</package>
`)
// Meshes: base (binary STL, millimetres → scale 0.001), wheel (ASCII STL), arm (COLLADA, Z-up, textured),
// gripper (OBJ with .mtl colours and a texture).
put(`${PKG}/meshes/base.stl`, stlBinary(box(400, 300, 100)))
put(`${PKG}/meshes/wheel.stl`, stlAscii(box(0.12, 0.04, 0.12), 'wheel'))
put(`${PKG}/meshes/arm.dae`, dae(box(0.06, 0.06, 0.4, 0, 0, 0.2), { image: '../textures/stripes.png', name: 'arm' }))
put(`${PKG}/textures/stripes.png`, STRIPES)
put(`${PKG}/meshes/gripper.obj`, obj(box(0.08, 0.14, 0.05), 'gripper.mtl', 'gripper_skin'))
put(`${PKG}/meshes/gripper.mtl`, `# File Preview sample\nnewmtl gripper_skin\nKa 0 0 0\nKd 1 1 1\nKs 0.2 0.2 0.2\nmap_Kd ../textures/checker.png\n`)
put(`${PKG}/textures/checker.png`, CHECKER)

put(`${PKG}/urdf/inertia.xacro`, `<?xml version="1.0"?>
<!-- Included by macros.xacro (relative include, one level deeper). -->
<robot xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:property name="arm_length" value="0.4"/>
  <xacro:macro name="box_inertia" params="m x y z">
    <inertial><mass value="\${m}"/><inertia ixx="\${m*(y*y+z*z)/12}" ixy="0" ixz="0" iyy="\${m*(x*x+z*z)/12}" iyz="0" izz="\${m*(x*x+y*y)/12}"/></inertial>
  </xacro:macro>
</robot>
`)
put(`${PKG}/urdf/macros.xacro`, `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:include filename="inertia.xacro"/>
  <material name="steel"><color rgba="0.6 0.62 0.66 1"/></material>
  <material name="signal"><color rgba="0.95 0.75 0.1 1"/></material>
  <xacro:macro name="arm_link" params="name parent *origin">
    <link name="\${name}">
      <visual><geometry><mesh filename="package://demo_bot/meshes/arm.dae"/></geometry><material name="signal"/></visual>
      <collision><origin xyz="0 0 \${arm_length/2}"/><geometry><box size="0.06 0.06 \${arm_length}"/></geometry></collision>
      <xacro:box_inertia m="1.5" x="0.06" y="0.06" z="\${arm_length}"/>
    </link>
    <joint name="\${name}_joint" type="revolute">
      <xacro:insert_block name="origin"/>
      <parent link="\${parent}"/><child link="\${name}"/>
      <axis xyz="0 1 0"/><limit lower="-1.57" upper="1.57" effort="10" velocity="1"/>
    </joint>
  </xacro:macro>
</robot>
`)
put(`${PKG}/urdf/parts/wheel.xacro`, `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:macro name="wheel" params="side y">
    <link name="wheel_\${side}">
      <visual><origin rpy="0 0 0"/><geometry><mesh filename="package://demo_bot/meshes/wheel.stl"/></geometry><material name="black"><color rgba="0.1 0.1 0.1 1"/></material></visual>
      <collision><geometry><cylinder radius="0.06" length="0.04"/></geometry></collision>
    </link>
    <joint name="wheel_\${side}_joint" type="continuous">
      <origin xyz="0 \${y} 0.06"/><parent link="base_link"/><child link="wheel_\${side}"/><axis xyz="0 1 0"/>
    </joint>
  </xacro:macro>
</robot>
`)
put(`${PKG}/urdf/robot.urdf.xacro`, `<?xml version="1.0"?>
<!-- demo_bot: a base, two wheels, an arm and a gripper. Macros come from included files:
     $(find demo_bot)/urdf/macros.xacro (which includes inertia.xacro) and parts/wheel.xacro. -->
<robot name="demo_bot" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:arg name="with_gripper" default="true"/>
  <xacro:include filename="$(find demo_bot)/urdf/macros.xacro"/>
  <xacro:include filename="parts/wheel.xacro"/>
  <link name="base_link">
    <visual><origin xyz="0 0 0.11"/><geometry><mesh filename="package://demo_bot/meshes/base.stl" scale="0.001 0.001 0.001"/></geometry><material name="steel"/></visual>
    <collision><origin xyz="0 0 0.11"/><geometry><box size="0.4 0.3 0.1"/></geometry></collision>
  </link>
  <xacro:wheel side="left" y="0.18"/>
  <xacro:wheel side="right" y="-0.18"/>
  <xacro:arm_link name="arm" parent="base_link"><origin xyz="0.1 0 0.16"/></xacro:arm_link>
  <xacro:if value="$(arg with_gripper)">
    <link name="gripper">
      <visual><origin xyz="0 0 0.025"/><geometry><mesh filename="package://demo_bot/meshes/gripper.obj"/></geometry></visual>
    </link>
    <joint name="gripper_joint" type="fixed"><origin xyz="0 0 \${arm_length}"/><parent link="arm"/><child link="gripper"/></joint>
  </xacro:if>
</robot>
`)
// The same robot as plain URDF with relative and package:// mesh references.
put(`${PKG}/urdf/robot.urdf`, `<?xml version="1.0"?>
<robot name="demo_bot_plain">
  <material name="steel"><color rgba="0.6 0.62 0.66 1"/></material>
  <link name="base_link">
    <visual><origin xyz="0 0 0.11"/><geometry><mesh filename="package://demo_bot/meshes/base.stl" scale="0.001 0.001 0.001"/></geometry><material name="steel"/></visual>
  </link>
  <link name="arm">
    <visual><geometry><mesh filename="../meshes/arm.dae"/></geometry></visual>
  </link>
  <joint name="arm_joint" type="revolute"><origin xyz="0.1 0 0.16"/><parent link="base_link"/><child link="arm"/><axis xyz="0 1 0"/><limit lower="-1.57" upper="1.57" effort="1" velocity="1"/></joint>
  <link name="gripper">
    <visual><origin xyz="0 0 0.025"/><geometry><mesh filename="file:///opt/ros/humble/share/demo_bot/meshes/gripper.obj"/></geometry></visual>
  </link>
  <joint name="gripper_joint" type="fixed"><origin xyz="0 0 0.4"/><parent link="arm"/><child link="gripper"/></joint>
  <link name="sensor">
    <visual><geometry><mesh filename="package://other_pkg/meshes/lidar.stl"/></geometry><material name="dark"><color rgba="0.2 0.2 0.25 1"/></material></visual>
    <collision><geometry><cylinder radius="0.04" length="0.05"/></geometry></collision>
  </link>
  <joint name="sensor_joint" type="fixed"><origin xyz="-0.12 0 0.19"/><parent link="base_link"/><child link="sensor"/></joint>
</robot>
`)

// ---- OBJ + MTL + texture ---------------------------------------------------------------------------
put('obj/model.obj', obj(box(1, 1, 1), 'model.mtl', 'checker'))
put('obj/model.mtl', `# File Preview sample\nnewmtl checker\nKa 0 0 0\nKd 1 1 1\nKs 0.1 0.1 0.1\nmap_Kd textures/checker.png\n`)
put('obj/textures/checker.png', CHECKER)

// ---- glTF + external .bin + image ------------------------------------------------------------------
{
  const g = gltf(box(1, 1, 1), 'model.bin', 'checker.png')
  put('gltf/model.gltf', g.json)
  put('gltf/model.bin', g.bin)
  put('gltf/checker.png', CHECKER)
}

// ---- COLLADA + texture -----------------------------------------------------------------------------
put('dae/textured.dae', dae(box(1, 1, 1), { image: 'checker.png', upAxis: 'Y_UP', name: 'cube' }))
put('dae/checker.png', CHECKER)

// ---- DXF with xrefs and an image -------------------------------------------------------------------
const dxf = (pairs) => pairs.map(([c, v]) => `${String(c).padStart(3)}\n${v}`).join('\n') + '\n'
const line = (x1, y1, x2, y2, layer = '0') => [[0, 'LINE'], [8, layer], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]]
put(
  'dxf/main.dxf',
  dxf([
    [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'],
    [0, 'TABLE'], [2, 'LAYER'], [70, 2],
    [0, 'LAYER'], [2, '0'], [70, 0], [62, 7], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'FRAME'], [70, 0], [62, 5], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'BLOCKS'],
    // Xref blocks: flag 4 = external reference, group 1 = path of the referenced drawing.
    [0, 'BLOCK'], [8, '0'], [2, 'BOLT'], [70, 4], [10, 0], [20, 0], [30, 0], [3, 'BOLT'], [1, 'parts\\bolt.dxf'], [0, 'ENDBLK'], [8, '0'],
    [0, 'BLOCK'], [8, '0'], [2, 'TITLE'], [70, 4], [10, 0], [20, 0], [30, 0], [3, 'TITLE'], [1, 'C:\\Projects\\std\\title.dxf'], [0, 'ENDBLK'], [8, '0'],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    ...line(0, 0, 200, 0, 'FRAME'), ...line(200, 0, 200, 120, 'FRAME'), ...line(200, 120, 0, 120, 'FRAME'), ...line(0, 120, 0, 0, 'FRAME'),
    [0, 'TEXT'], [8, '0'], [10, 10], [20, 105], [30, 0], [40, 6], [1, 'Plate with xref bolts and an image'],
    [0, 'INSERT'], [8, '0'], [2, 'BOLT'], [10, 40], [20, 40], [30, 0],
    [0, 'INSERT'], [8, '0'], [2, 'BOLT'], [10, 90], [20, 40], [30, 0], [41, 1.5], [42, 1.5], [50, 30],
    [0, 'INSERT'], [8, '0'], [2, 'TITLE'], [10, 0], [20, 0], [30, 0],
    // IMAGE: insertion point, U and V vectors (one pixel), size in pixels, IMAGEDEF handle.
    [0, 'IMAGE'], [5, '30'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbRasterImage'], [90, 0], [10, 120], [20, 20], [30, 0], [11, 1.0], [21, 0], [31, 0], [12, 0], [22, 1.0], [32, 0], [13, 64], [23, 48], [340, '2A'], [70, 7], [280, 0],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'OBJECTS'],
    [0, 'DICTIONARY'], [5, 'C'], [100, 'AcDbDictionary'],
    [0, 'IMAGEDEF'], [5, '2A'], [100, 'AcDbRasterImageDef'], [90, 0], [1, 'images\\logo.png'], [10, 64], [20, 48], [11, 1], [21, 1], [280, 1], [281, 0],
    [0, 'ENDSEC'],
    [0, 'EOF']
  ])
)
put(
  'dxf/parts/bolt.dxf',
  dxf([
    [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 1], [0, 'LAYER'], [2, 'BOLT'], [70, 0], [62, 3], [6, 'CONTINUOUS'], [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'CIRCLE'], [8, 'BOLT'], [10, 0], [20, 0], [30, 0], [40, 10],
    [0, 'CIRCLE'], [8, 'BOLT'], [10, 0], [20, 0], [30, 0], [40, 5],
    ...line(-14, 0, 14, 0, 'BOLT'), ...line(0, -14, 0, 14, 'BOLT'),
    [0, 'ENDSEC'],
    [0, 'EOF']
  ])
)
put('dxf/images/logo.png', LOGO)
console.log(`wrote ${OUT}`)
