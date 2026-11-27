import { assert, test } from 'orca/testing'
import { openSw, type SwMesh } from './sw.ts'
import { applyMat, flattenComponents, leafComponents, mulMat, placeMesh, readCompTree, readInstanceMeshes, readTessDirectory } from './swasm.ts'

const enc = (s: string) => new TextEncoder().encode(s)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function words(fmt: 'u32' | 'f32' | 'u16' | 'i32', values: number[]): Uint8Array {
  const size = fmt === 'u16' ? 2 : 4
  const out = new Uint8Array(values.length * size)
  const dv = new DataView(out.buffer)
  values.forEach((v, i) => {
    if (fmt === 'u32') dv.setUint32(i * 4, v, true)
    else if (fmt === 'i32') dv.setInt32(i * 4, v, true)
    else if (fmt === 'f32') dv.setFloat32(i * 4, v, true)
    else dv.setUint16(i * 2, v, true)
  })
  return out
}

const storedDeflate = (d: Uint8Array) => concat(Uint8Array.from([1]), words('u16', [d.length, ~d.length & 0xffff]), d)

/** A SolidWorks 2015+ container (same layout as sw.test.ts). */
function modern(streams: [string, Uint8Array][]): Uint8Array {
  const rot = (s: string) => enc(s).map((c) => ((c << 4) | (c >> 4)) & 0xff)
  const parts: Uint8Array[] = [Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0, 0, 0, 4])]
  let pos = 8
  const central: Uint8Array[] = []
  for (const [name, data] of streams) {
    const packed = storedDeflate(data)
    const n = rot(name)
    const local = concat(words('u32', [0xaabbccdd]), words('u16', [20, 6, 8]), words('u32', [0, 0, packed.length, data.length]), words('u16', [n.length, 0]), n, packed)
    central.push(concat(words('u32', [0x11223344]), words('u16', [0, 20, 6, 8]), words('u32', [0, 0, packed.length, data.length]), words('u16', [n.length, 0, 0, 0, 0]), words('u32', [0, pos - 8]), n))
    parts.push(local)
    pos += local.length
  }
  const dir = concat(...central)
  const end = concat(words('u32', [0x99887766, 0]), words('u16', [streams.length, streams.length]), words('u32', [dir.length, pos - 8]), words('u16', [0]))
  return concat(...parts, dir, end)
}

function face(): Uint8Array {
  const pos = [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 0.01, 0.01, 0]
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
  return concat(words('u32', [4, 8, 2, 1, 4]), words('u32', [12, 100, 2, 4]), words('f32', pos), words('u32', [12, 100, 2, 4]), words('f32', nrm), words('u32', [4, 8, 2, 6, 1, 5, 6, 0, 7, 8]))
}

function mfc(s: string): Uint8Array {
  const u = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) u[2 * i] = s.charCodeAt(i)
  return concat(Uint8Array.from([0xff, 0xfe, 0xff, s.length]), u)
}

const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))

// Two references copied from a public assembly (DSPEILab/SmartHarvest mechanical/cad/jaw.SLDASM, MIT).
const JAW = `<?xml version="1.0" encoding="UTF-8"?>
<swSolidWorks xmlns="http://www.solidworks.com/sw2003/schema" swVersion="17000"><swHeader>
<swFile id="3" swDocType="ASSEMBLY" swPath="C:\\MY\\soft_jaw\\jaw.SLDASM"/><swFile id="6" swDocType="PART" swPath="C:\\MY\\soft_jaw\\slider_base.SLDPRT"/><swFile id="9" swDocType="PART" swPath="C:\\MY\\soft_jaw\\slider.SLDPRT"/></swHeader>
<swModelList><swModel id="5" swName="slider_base" swFileRef="6" swBoundingBox="-0.035115 0.0082 -0.025 0.024 0.0145 0.025"/>
<swModel id="8" swName="slider" swFileRef="9" swBoundingBox="-0.003723922974465014 0 -5.694607616035193e-19 0.003723922974465014 0.05 0.003000000000000001"/>
<swModel id="2" swName="jaw" swFileRef="3">
<swReference id="4" swName="slider_base" swReferenceNumber="1" swID="17" swSuppressed="NO" swHidden="NO" swModelRef="5" swConfigurationName="默认" swTransform="1 0 0 0 0 1 0 0 0 0 1 0 -0.02139083378452275 -0.01098232610406332 0.02500000000000002 1"/>
<swReference id="7" swName="slider" swReferenceNumber="1" swID="18" swSuppressed="NO" swHidden="NO" swModelRef="8" swTransform="1 1.06003814407884e-16 -3.389199471893388e-16 0 3.389199471893388e-16 6.923379306986722e-32 1 0 1.06003814407884e-16 -1 3.33069858888787e-32 0 -0.03776583378452276 0.003517673895936681 -0.0002201880427569712 1"/>
</swModel></swModelList>
<swConfigurationList><swConfiguration id="1" swName="默认" swMostRecentConfiguration="YES" swModelRef="2"/></swConfigurationList></swSolidWorks>`

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('swasm: transforms are column-major, metres (values from a real assembly)', () => {
  const t = readCompTree(JAW)!
  assert.equal(t.config, '默认')
  const [base, slider] = t.components
  assert.equal(base.segment, 'slider_base-1@jaw')
  assert.equal(slider.file, 'C:\\MY\\soft_jaw\\slider.SLDPRT')
  // The second group of four, (≈0, ≈0, 1), is the image of the y axis; the third, (≈0, −1, ≈0), of z.
  const tip = applyMat(slider.world, 0, 0.05, 0)
  assert.ok(near(tip[0], -0.03776583378452276) && near(tip[1], 0.003517673895936681) && near(tip[2], 0.05 - 0.0002201880427569712), JSON.stringify(tip))
  const side = applyMat(slider.world, 0, 0, 0.003)
  assert.ok(near(side[1], 0.003517673895936681 - 0.003), JSON.stringify(side))
  // The union of the placed part boxes reproduces the assembly's stored box in x (−56.506 … 2.609 mm).
  const xs: number[] = []
  for (const c of t.components)
    for (const x of [c.box![0], c.box![3]]) for (const y of [c.box![1], c.box![4]]) for (const z of [c.box![2], c.box![5]]) xs.push(applyMat(c.world, x, y, z)[0])
  assert.ok(near(Math.min(...xs), -0.05650583378452276) && near(Math.max(...xs), 0.00260916621547725), `${Math.min(...xs)} ${Math.max(...xs)}`)
})

test('swasm: sub-assembly children compose with their parent; suppressed and hidden flags', () => {
  const xml = `<swSolidWorks><swHeader><swFile id="1" swDocType="ASSEMBLY" swPath="top.SLDASM"/><swFile id="2" swDocType="ASSEMBLY" swPath="sub.SLDASM"/><swFile id="3" swDocType="PART" swPath="p.SLDPRT"/></swHeader>
  <swModelList><swModel id="30" swName="p" swFileRef="3"/>
  <swModel id="20" swName="sub" swFileRef="2"><swReference swName="p" swReferenceNumber="1" swID="5" swModelRef="30" swTransform="0 1 0 0 -1 0 0 0 0 0 1 0 0 0.02 0 1"/></swModel>
  <swModel id="10" swName="top" swFileRef="1">
    <swReference swName="sub" swReferenceNumber="2" swID="7" swModelRef="20" swTransform="1 0 0 0 0 1 0 0 0 0 1 0 0.1 0 0 1"/>
    <swReference swName="p" swReferenceNumber="3" swID="8" swModelRef="30" swSuppressed="YES" swTransform="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    <swReference swName="p" swReferenceNumber="4" swID="9" swModelRef="30" swTransform="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
  </swModel></swModelList>
  <swConfigurationList><swConfiguration swName="A" swModelRef="10" swMostRecentConfiguration="YES"><swDisplayStateList swCompNameList="7,8,9,"><swDisplayState swShowState="Yes,Yes,No,"/></swDisplayStateList></swConfiguration></swConfigurationList></swSolidWorks>`
  const t = readCompTree(xml)!
  const all = flattenComponents(t.components)
  assert.deepEqual(
    all.map((c) => c.path),
    ['sub-2@top', 'sub-2@top/p-1@sub', 'p-3@top', 'p-4@top']
  )
  const leaves = leafComponents(t.components)
  assert.equal(leaves.length, 3)
  const inner = all[1]
  // Child: rotate 90° about z, then move 20 mm up; parent: move 100 mm along x.
  const p = applyMat(inner.world, 0.01, 0, 0)
  assert.ok(near(p[0], 0.1) && near(p[1], 0.03) && near(p[2], 0), JSON.stringify(p))
  assert.deepEqual(mulMat(all[0].world, inner.local), inner.world)
  assert.ok(all[2].suppressed && !all[2].hidden)
  assert.ok(all[3].hidden, 'hidden by the display state')
  assert.equal(readCompTree('<swSolidWorks/>'), null)
  assert.equal(readCompTree('not xml <'), null)
})

test('swasm: tessellation directory maps instance paths to blocks; copies reuse the first block by hash', () => {
  const h1 = 'b98dbe0d21634c21'
  const h2 = 'e2a67a29a46d3429'
  const h3 = 'd204c21ddd2b0829'
  const entry = (name: string, own: string, src: string, stream: string, block: number, i: number) =>
    concat(mfc(name), words('u32', [0x87]), new Uint8Array(8), hexBytes(src), hexBytes(own), mfc(stream), words('i32', [block]), words('u32', [1, 0x66, 0x50, 6, i]))
  const dir = concat(
    words('u32', [2, 46, 12, 1]),
    entry('base-1@asm', h1, '0000000000000000', '000-000-046', 0, 2),
    entry('slider-1@asm', h2, '0000000000000000', '000-000-046', 1, 3),
    entry('slider-2@asm', h3, h2, '', -1, 4)
  )
  const e = readTessDirectory(dir)
  assert.deepEqual(
    e.map((x) => [x.path, x.stream, x.block, x.source === h2]),
    [
      ['base-1@asm', '000-000-046', 0, false],
      ['slider-1@asm', '000-000-046', 1, false],
      ['slider-2@asm', '', -1, true]
    ]
  )
  assert.equal(e[0].stamp, 0x87)
  // Block 0: one face; block 1: two faces.
  const stream = concat(words('u32', [0]), hexBytes(h1), words('u32', [0x38, 0x30]), face(), words('u32', [1]), hexBytes(h2), words('u32', [0x38, 0x30]), face(), face())
  const c = openSw(modern([['FaceTessellations/Directory', dir], ['FaceTessellations/000-000-046', stream]]))
  const m = readInstanceMeshes(c)
  assert.equal(m.get('base-1@asm')?.faces, 1)
  assert.equal(m.get('slider-1@asm')?.faces, 2)
  assert.equal(m.get('slider-2@asm'), m.get('slider-1@asm'))
})

test('swasm: placing a mesh rotates normals and converts the translation to millimetres', () => {
  const mesh: SwMesh = { name: 'x', position: Float32Array.from([10, 0, 0]), normal: Float32Array.from([1, 0, 0]), index: new Uint32Array(0), faces: 0 }
  const rotZ = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1]
  const p = placeMesh(mesh, rotZ)
  assert.ok(near(p.position[0], 500) && near(p.position[1], 10) && near(p.position[2], 0), String([...p.position]))
  assert.ok(near(p.normal[0], 0) && near(p.normal[1], 1), String([...p.normal]))
})
