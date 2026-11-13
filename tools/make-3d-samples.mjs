// Writes the 3D preview fixtures to samples/ (each well under 300 KB) and, with --perf, a large
// mesh to samples/perf/ (git-ignored) for the responsiveness check. Geometry comes from three.js'
// own generators; every file format is written by hand here (no DOM needed), so the fixtures are
// deterministic.
//
//   node tools/make-3d-samples.mjs [--perf [triangles]]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { crc32, deflateSync } from 'node:zlib'
import * as THREE from 'three'
import { zipSync, strToU8 } from 'fflate'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'samples')
const argv = process.argv.slice(2)

const out = (name, data) => {
  writeFileSync(join(OUT, name), data)
  console.log(`${name.padEnd(28)} ${(data.length / 1024).toFixed(1).padStart(8)} KB`)
}

/** Non-indexed triangle soup (positions + face normals) of a geometry. */
function soup(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------- shapes

/** A trophy cup turned on a lathe, Z up (CAD convention), about 60 × 60 × 100 mm. */
function trophy(segments = 48) {
  const profile = [
    [0, 0], [30, 0], [30, 4], [12, 8], [8, 14], [6, 30], [8, 42], [14, 48], [26, 56], [32, 70], [34, 86], [35, 100], [32, 100], [30, 87], [27, 72], [20, 60], [0, 58]
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const g = new THREE.LatheGeometry(profile, segments)
  g.rotateX(Math.PI / 2) // lathe axis Y → Z
  return soup(g)
}

/** A small house (box + roof) Z up, for 3MF. */
function house() {
  const body = new THREE.BoxGeometry(40, 30, 24).translate(0, 0, 12)
  const roof = new THREE.CylinderGeometry(0, 26, 16, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2).scale(1.1, 0.83, 1).translate(0, 0, 32)
  return [body, roof]
}

// ---------------------------------------------------------------- STL

function stlBinary(g, header = 'File Preview sample (binary STL) - trophy, mm, Z up') {
  const pos = g.getAttribute('position')
  const n = pos.count / 3
  const buf = Buffer.alloc(84 + n * 50)
  buf.write(header.padEnd(80, ' ').slice(0, 80), 0, 'latin1')
  buf.writeUInt32LE(n, 80)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    a.fromBufferAttribute(pos, i * 3)
    b.fromBufferAttribute(pos, i * 3 + 1)
    c.fromBufferAttribute(pos, i * 3 + 2)
    nrm.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize()
    let o = 84 + i * 50
    for (const v of [nrm, a, b, c]) {
      buf.writeFloatLE(v.x, o)
      buf.writeFloatLE(v.y, o + 4)
      buf.writeFloatLE(v.z, o + 8)
      o += 12
    }
  }
  return buf
}

function stlAscii(g, name) {
  const pos = g.getAttribute('position')
  const f = (x) => x.toExponential(5)
  const lines = [`solid ${name}`]
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i)
    b.fromBufferAttribute(pos, i + 1)
    c.fromBufferAttribute(pos, i + 2)
    nrm.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize()
    lines.push(` facet normal ${f(nrm.x)} ${f(nrm.y)} ${f(nrm.z)}`, '  outer loop')
    for (const v of [a, b, c]) lines.push(`   vertex ${f(v.x)} ${f(v.y)} ${f(v.z)}`)
    lines.push('  endloop', ' endfacet')
  }
  lines.push(`endsolid ${name}`, '')
  return Buffer.from(lines.join('\n'), 'latin1')
}

// ---------------------------------------------------------------- OBJ (vertex colours)

function obj() {
  const g = new THREE.IcosahedronGeometry(1, 12)
  // a bumpy ball: radius varies with direction, colour follows height (blue → orange)
  const pos = g.getAttribute('position')
  const merged = new Map()
  const verts = []
  const faces = []
  const v = new THREE.Vector3()
  const key = (x, y, z) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const k = key(v.x, v.y, v.z)
    let id = merged.get(k)
    if (id === undefined) {
      id = verts.length
      merged.set(k, id)
      const r = 1 + 0.12 * Math.sin(5 * v.x) * Math.sin(5 * v.y) * Math.sin(5 * v.z)
      const t = (v.y + 1) / 2
      verts.push([v.x * r, v.y * r, v.z * r, 0.15 + 0.8 * t, 0.35 + 0.25 * t, 0.85 - 0.7 * t])
    }
    if (i % 3 === 2) faces.push([merged.get(key(...[0, 1, 2].map((k) => pos.getComponent(i - 2, k)))), merged.get(key(...[0, 1, 2].map((k) => pos.getComponent(i - 1, k)))), id])
  }
  const lines = ['# File Preview sample (OBJ with vertex colours "v x y z r g b")', 'mtllib sample.mtl', 'o bumpy_ball', 'usemtl paint']
  for (const p of verts) lines.push(`v ${p.slice(0, 3).map((x) => x.toFixed(4)).join(' ')} ${p.slice(3).map((x) => x.toFixed(3)).join(' ')}`)
  for (const f of faces) lines.push(`f ${f.map((x) => x + 1).join(' ')}`)
  return Buffer.from(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------- PLY (binary, colours)

function ply() {
  const g = new THREE.TorusGeometry(1, 0.38, 32, 96)
  const pos = g.getAttribute('position')
  const idx = g.index.array
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    'comment File Preview sample (binary PLY with vertex colours)',
    `element vertex ${pos.count}`,
    'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue',
    `element face ${idx.length / 3}`,
    'property list uchar int vertex_indices',
    'end_header',
    ''
  ].join('\n')
  const body = Buffer.alloc(pos.count * 15 + (idx.length / 3) * 13)
  let o = 0
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    body.writeFloatLE(x, o); body.writeFloatLE(y, o + 4); body.writeFloatLE(z, o + 8)
    c.setHSL((Math.atan2(y, x) / (2 * Math.PI) + 1) % 1, 0.75, 0.55)
    body[o + 12] = Math.round(c.r * 255); body[o + 13] = Math.round(c.g * 255); body[o + 14] = Math.round(c.b * 255)
    o += 15
  }
  for (let i = 0; i < idx.length; i += 3) {
    body[o] = 3
    body.writeInt32LE(idx[i], o + 1); body.writeInt32LE(idx[i + 1], o + 5); body.writeInt32LE(idx[i + 2], o + 9)
    o += 13
  }
  return Buffer.concat([Buffer.from(header, 'latin1'), body])
}

// ---------------------------------------------------------------- OFF (face colours)

function off() {
  const g = new THREE.DodecahedronGeometry(1, 0)
  const pos = g.getAttribute('position')
  const verts = []
  const map = new Map()
  const tri = []
  for (let i = 0; i < pos.count; i++) {
    const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((x) => x.toFixed(5)).join(' ')
    if (!map.has(k)) {
      map.set(k, verts.length)
      verts.push(k)
    }
    tri.push(map.get(k))
  }
  // dodecahedron = 12 pentagons, three.js gives 3 triangles each: colour each pentagon
  const lines = ['OFF', '# File Preview sample (OFF with face colours, 0-255)', `${verts.length} ${tri.length / 3} 0`, ...verts]
  const palette = [[230, 57, 70], [241, 143, 1], [244, 211, 94], [42, 157, 143], [38, 70, 83], [69, 123, 157]]
  for (let f = 0; f < tri.length / 3; f++) {
    const col = palette[Math.floor(f / 3) % palette.length]
    lines.push(`3 ${tri[f * 3]} ${tri[f * 3 + 1]} ${tri[f * 3 + 2]} ${col.join(' ')}`)
  }
  return Buffer.from(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------- PNG

function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4)
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
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const checker = () =>
  png(128, 128, (x, y) => {
    const on = ((x >> 4) + (y >> 4)) % 2 === 0
    // a coloured checker with a darker border per tile so the texture reads clearly
    const edge = x % 16 === 0 || y % 16 === 0
    const c = on ? [240, 170, 40] : [45, 120, 200]
    return edge ? [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 255] : [...c, 255]
  })

// ---------------------------------------------------------------- glTF

/**
 * glTF 2.0 document: a textured sphere on a metallic base. `mode` 'glb' packs everything into the
 * binary chunk; 'embedded' writes data: URIs; 'draco' compresses the geometry (KHR_draco_mesh_compression).
 */
function gltf(mode, draco) {
  const meshes = [
    { geo: new THREE.SphereGeometry(1, 48, 24).translate(0, 1.2, 0), material: 0 },
    { geo: new THREE.CylinderGeometry(1.2, 1.4, 0.3, 48).translate(0, 0.15, 0), material: 1 }
  ]
  const chunks = []
  let offset = 0
  const bufferViews = []
  const accessors = []
  const view = (buf, target) => {
    const pad = (4 - (offset % 4)) % 4
    if (pad) {
      chunks.push(Buffer.alloc(pad))
      offset += pad
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) })
    chunks.push(buf)
    offset += buf.length
    return bufferViews.length - 1
  }
  const accessor = (arr, type, target, minmax) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
    const comp = arr instanceof Float32Array ? 5126 : arr instanceof Uint32Array ? 5125 : 5123
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type]
    const acc = { bufferView: view(buf, target), componentType: comp, count: arr.length / size, type }
    if (minmax) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], arr[i + k])), (max[k] = Math.max(max[k], arr[i + k]))
      acc.min = min
      acc.max = max
    }
    accessors.push(acc)
    return accessors.length - 1
  }
  const gltfMeshes = []
  for (const m of meshes) {
    const g = m.geo
    const position = g.getAttribute('position').array
    const normal = g.getAttribute('normal').array
    const uv = g.getAttribute('uv').array
    const index = new Uint32Array(g.index.array)
    if (draco) {
      const { data, ids } = dracoEncode(position, normal, uv, index)
      const bv = view(Buffer.from(data.buffer))
      // accessors without bufferView: counts and bounds only, the data comes from the Draco stream
      const pos = accessors.push({ componentType: 5126, count: position.length / 3, type: 'VEC3', min: minOf(position), max: maxOf(position) }) - 1
      const nrm = accessors.push({ componentType: 5126, count: normal.length / 3, type: 'VEC3' }) - 1
      const tex = accessors.push({ componentType: 5126, count: uv.length / 2, type: 'VEC2' }) - 1
      const ind = accessors.push({ componentType: 5125, count: index.length, type: 'SCALAR' }) - 1
      gltfMeshes.push({
        primitives: [
          {
            attributes: { POSITION: pos, NORMAL: nrm, TEXCOORD_0: tex },
            indices: ind,
            material: m.material,
            extensions: { KHR_draco_mesh_compression: { bufferView: bv, attributes: { POSITION: ids.position, NORMAL: ids.normal, TEXCOORD_0: ids.uv } } }
          }
        ]
      })
    } else {
      gltfMeshes.push({
        primitives: [
          {
            attributes: {
              POSITION: accessor(new Float32Array(position), 'VEC3', 34962, true),
              NORMAL: accessor(new Float32Array(normal), 'VEC3', 34962),
              TEXCOORD_0: accessor(new Float32Array(uv), 'VEC2', 34962)
            },
            indices: accessor(index, 'SCALAR', 34963),
            material: m.material
          }
        ]
      })
    }
  }
  const image = checker()
  const doc = {
    asset: { version: '2.0', generator: 'File Preview tools/make-3d-samples.mjs' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'textured sphere', mesh: 0 },
      { name: 'metal base', mesh: 1 }
    ],
    meshes: gltfMeshes,
    materials: [
      { name: 'checker', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 } },
      { name: 'brushed metal', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.2, 0.18, 1], metallicFactor: 0.8, roughnessFactor: 0.35 } }
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [],
    accessors,
    bufferViews,
    buffers: []
  }
  if (draco) {
    doc.extensionsUsed = ['KHR_draco_mesh_compression']
    doc.extensionsRequired = ['KHR_draco_mesh_compression']
  }
  if (mode === 'embedded') {
    doc.images.push({ uri: `data:image/png;base64,${image.toString('base64')}` })
    const bin = Buffer.concat(chunks)
    doc.buffers.push({ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` })
    return Buffer.from(JSON.stringify(doc))
  }
  doc.images.push({ bufferView: view(image), mimeType: 'image/png' })
  let bin = Buffer.concat(chunks)
  bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)])
  doc.buffers.push({ byteLength: bin.length })
  let json = Buffer.from(JSON.stringify(doc))
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
  const ch = (len, type) => {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(len, 0)
    b.writeUInt32LE(type, 4)
    return b
  }
  return Buffer.concat([header, ch(json.length, 0x4e4f534a), json, ch(bin.length, 0x004e4942), bin])
}
const minOf = (a) => [0, 1, 2].map((k) => Math.min(...a.filter((_, i) => i % 3 === k)))
const maxOf = (a) => [0, 1, 2].map((k) => Math.max(...a.filter((_, i) => i % 3 === k)))

let draco = null
function dracoEncode(position, normal, uv, index) {
  if (!draco) {
    // three's Draco encoder is an Emscripten (asm.js) script: run it in its own context.
    const src = readFileSync(join(ROOT, 'node_modules/three/examples/jsm/libs/draco/draco_encoder.js'), 'utf8')
    const sandbox = { module: { exports: {} }, exports: {}, console, Math, Date, performance }
    sandbox.exports = sandbox.module.exports
    runInNewContext(src, sandbox)
    draco = sandbox.module.exports()
  }
  const D = draco
  const encoder = new D.Encoder()
  const builder = new D.MeshBuilder()
  const mesh = new D.Mesh()
  builder.AddFacesToMesh(mesh, index.length / 3, index)
  const ids = {
    position: builder.AddFloatAttributeToMesh(mesh, D.POSITION, position.length / 3, 3, new Float32Array(position)),
    normal: builder.AddFloatAttributeToMesh(mesh, D.NORMAL, normal.length / 3, 3, new Float32Array(normal)),
    uv: builder.AddFloatAttributeToMesh(mesh, D.TEX_COORD, uv.length / 2, 2, new Float32Array(uv))
  }
  encoder.SetEncodingMethod(D.MESH_SEQUENTIAL_ENCODING)
  encoder.SetAttributeQuantization(D.POSITION, 14)
  encoder.SetAttributeQuantization(D.NORMAL, 10)
  encoder.SetAttributeQuantization(D.TEX_COORD, 12)
  const outData = new D.DracoInt8Array()
  const len = encoder.EncodeMeshToDracoBuffer(mesh, outData)
  if (!len) throw new Error('Draco encoding failed')
  const data = new Int8Array(len)
  for (let i = 0; i < len; i++) data[i] = outData.GetValue(i)
  for (const o of [outData, mesh, builder, encoder]) D.destroy(o)
  return { data, ids }
}

// ---------------------------------------------------------------- 3MF

function threeMF() {
  const parts = house()
  const colors = ['#D8CFC0FF', '#B23A2EFF']
  const objects = parts.map((g, i) => {
    const pos = g.getAttribute('position')
    const idx = g.index.array
    const v = []
    for (let k = 0; k < pos.count; k++) v.push(`<vertex x="${pos.getX(k).toFixed(3)}" y="${pos.getY(k).toFixed(3)}" z="${pos.getZ(k).toFixed(3)}"/>`)
    const t = []
    for (let k = 0; k < idx.length; k += 3) t.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`)
    return `<object id="${i + 2}" type="model" pid="1" pindex="${i}"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`
  })
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">File Preview sample house</metadata>
<resources>
<basematerials id="1">${colors.map((c, i) => `<base name="m${i}" displaycolor="${c}"/>`).join('')}</basematerials>
${objects.join('\n')}
</resources>
<build>${parts.map((_, i) => `<item objectid="${i + 2}"/>`).join('')}</build>
</model>`
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
      ),
      '3D/3dmodel.model': strToU8(model)
    })
  )
}

// ---------------------------------------------------------------- FBX (ASCII 7.4)

function fbx() {
  const g = new THREE.TorusKnotGeometry(30, 9, 96, 12)
  const pos = g.getAttribute('position')
  const idx = g.index.array
  const verts = Array.from(pos.array, (x) => +x.toFixed(3))
  // polygon vertex index: the last index of each polygon is stored as -(i + 1)
  const pvi = []
  for (let i = 0; i < idx.length; i += 3) pvi.push(idx[i], idx[i + 1], -(idx[i + 2] + 1))
  const text = `; FBX 7.4.0 project file
; File Preview sample (ASCII FBX, torus knot)
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
	Creator: "File Preview tools/make-3d-samples.mjs"
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",1
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",2
		P: "FrontAxisSign", "int", "Integer", "",1
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",1
	}
}
Objects:  {
	Geometry: 1000, "Geometry::knot", "Mesh" {
		Vertices: *${verts.length} {
			a: ${verts.join(',')}
		}
		PolygonVertexIndex: *${pvi.length} {
			a: ${pvi.join(',')}
		}
		GeometryVersion: 124
	}
	Model: 2000, "Model::knot", "Mesh" {
		Version: 232
		Properties70:  {
		}
	}
	Material: 3000, "Material::teal", "" {
		Version: 102
		ShadingModel: "phong"
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",0.1,0.62,0.58
			P: "SpecularColor", "Color", "", "A",0.6,0.6,0.6
			P: "Shininess", "double", "Number", "",40
		}
	}
}
Connections:  {
	C: "OO",2000,0
	C: "OO",1000,2000
	C: "OO",3000,2000
}
`
  return Buffer.from(text)
}

// ---------------------------------------------------------------- COLLADA

function dae() {
  const g = new THREE.TorusGeometry(1, 0.4, 24, 64)
  const pos = Array.from(g.getAttribute('position').array, (x) => +x.toFixed(4))
  const nrm = Array.from(g.getAttribute('normal').array, (x) => +x.toFixed(4))
  const idx = Array.from(g.index.array)
  const p = []
  for (const i of idx) p.push(i, i)
  const text = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><contributor><authoring_tool>File Preview tools/make-3d-samples.mjs</authoring_tool></contributor><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>
  <library_effects><effect id="fx"><profile_COMMON><technique sid="common"><phong>
    <diffuse><color>0.42 0.3 0.75 1</color></diffuse><specular><color>0.5 0.5 0.5 1</color></specular><shininess><float>30</float></shininess>
  </phong></technique></profile_COMMON></effect></library_effects>
  <library_materials><material id="mat" name="violet"><instance_effect url="#fx"/></material></library_materials>
  <library_geometries><geometry id="torus" name="torus"><mesh>
    <source id="pos"><float_array id="pos-a" count="${pos.length}">${pos.join(' ')}</float_array>
      <technique_common><accessor source="#pos-a" count="${pos.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <source id="nrm"><float_array id="nrm-a" count="${nrm.length}">${nrm.join(' ')}</float_array>
      <technique_common><accessor source="#nrm-a" count="${nrm.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="vtx"><input semantic="POSITION" source="#pos"/></vertices>
    <triangles material="m" count="${idx.length / 3}">
      <input semantic="VERTEX" source="#vtx" offset="0"/><input semantic="NORMAL" source="#nrm" offset="1"/>
      <p>${p.join(' ')}</p>
    </triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="scene"><node id="torus-node" name="torus">
    <instance_geometry url="#torus"><bind_material><technique_common><instance_material symbol="m" target="#mat"/></technique_common></bind_material></instance_geometry>
  </node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`
  return Buffer.from(text)
}

// ---------------------------------------------------------------- write

if (argv.includes('--perf')) {
  // A large binary STL: a finely tessellated torus knot (default ~2 million triangles, ~100 MB).
  const target = Number(argv[argv.indexOf('--perf') + 1]) || 2_000_000
  const radial = 64
  const tubular = Math.ceil(target / (2 * radial))
  const g = new THREE.TorusKnotGeometry(40, 12, tubular, radial)
  mkdirSync(join(OUT, 'perf'), { recursive: true })
  const name = `perf/large-${Math.round((tubular * radial * 2) / 1e6 * 10) / 10}M.stl`
  out(name, stlBinary(soup(g), 'File Preview perf sample (binary STL torus knot)'))
} else {
  mkdirSync(OUT, { recursive: true })
  out('sample.stl', stlBinary(trophy()))
  out('sample-ascii.stl', stlAscii(soup(new THREE.TorusKnotGeometry(10, 3, 48, 8)), 'knot'))
  out('sample.obj', obj())
  out('sample.ply', ply())
  out('sample.off', off())
  out('sample.glb', gltf('glb', false))
  out('sample-embedded.gltf', gltf('embedded', false))
  out('sample-draco.glb', gltf('glb', true))
  out('sample.3mf', threeMF())
  out('sample.fbx', fbx())
  out('sample.dae', dae())
  // damaged: a binary STL that promises 5,000 triangles but stops after a few; a GLB cut inside its JSON
  const stl = stlBinary(trophy(12))
  stl.writeUInt32LE(5000, 80)
  out('broken.stl', stl.subarray(0, 84 + 50 * 7))
  const glb = gltf('glb', false)
  out('broken.glb', glb.subarray(0, 120))
}
