import { assert, test } from 'orca/testing'
import { buildCfb } from '../legacy/testkit.ts'
import { FMTID_SUMMARY, readPropertySet } from './olepropset.ts'
import { decodeZlbFrame, dibToBmp, isModernSw, openSw, readDisplayMesh, readHistory, readMfcStrings, releaseName } from './sw.ts'

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

function words(fmt: 'u32' | 'f32' | 'u16' | 'f64', values: number[]): Uint8Array {
  const size = fmt === 'u16' ? 2 : fmt === 'f64' ? 8 : 4
  const out = new Uint8Array(values.length * size)
  const dv = new DataView(out.buffer)
  values.forEach((v, i) => {
    if (fmt === 'u32') dv.setUint32(i * 4, v, true)
    else if (fmt === 'f32') dv.setFloat32(i * 4, v, true)
    else if (fmt === 'u16') dv.setUint16(i * 2, v, true)
    else dv.setFloat64(i * 8, v, true)
  })
  return out
}

/** Raw deflate made of one stored block (enough for the container reader). */
function storedDeflate(data: Uint8Array): Uint8Array {
  return concat(Uint8Array.from([1]), words('u16', [data.length, ~data.length & 0xffff]), data)
}

function adler32(d: Uint8Array): number {
  let a = 1
  let b = 0
  for (const x of d) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function zlibStored(data: Uint8Array): Uint8Array {
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, adler32(data), false)
  return concat(Uint8Array.from([0x78, 0x01]), storedDeflate(data), tail)
}

/** A SolidWorks 2015+ container (rotation 4, per-file signatures, offsets from byte 8). */
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

/** One face record: a single strip of 4 vertices (a unit square in the z = 0 plane, metres). */
function face(): Uint8Array {
  const pos = [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 0.01, 0.01, 0]
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
  return concat(words('u32', [4, 8, 2, 1, 4]), words('u32', [12, 100, 2, 4]), words('f32', pos), words('u32', [12, 100, 2, 4]), words('f32', nrm), words('u32', [4, 8, 2, 6, 1, 5, 6, 0, 7, 8]))
}

test('sw: release names', () => {
  assert.equal(releaseName(17000), '2024')
  assert.equal(releaseName(6000), '2013')
  assert.equal(releaseName(4700), '2011')
  assert.equal(releaseName(629), '95+')
})

test('sw: modern container streams decode', () => {
  const b = modern([
    ['PreviewPNG', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])],
    ['_MO_VERSION_17000/History', new Uint8Array(3)],
    ['Contents/DisplayLists', concat(words('u32', [1, 1]), Uint8Array.from([9, 9, 9]), face())]
  ])
  assert.ok(isModernSw(b))
  const c = openSw(b)
  assert.equal(c.kind, 'modern')
  assert.deepEqual(c.streams.map((s) => s.name), ['PreviewPNG', '_MO_VERSION_17000/History', 'Contents/DisplayLists'])
  assert.deepEqual([...c.get('PreviewPNG')!], [0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])
  // The face record sits at an unaligned offset (after three filler bytes).
  const mesh = readDisplayMesh(c.get('Contents/DisplayLists')!, 'x')!
  assert.equal(mesh.faces, 1)
  assert.deepEqual([...mesh.index], [0, 1, 2, 2, 1, 3])
  assert.ok(Math.abs(mesh.position[3] - 10) < 1e-6, 'metres become millimetres')
  assert.throws(() => openSw(b.subarray(0, b.length - 30)))
})

test('sw: display mesh rejects look-alike headers', () => {
  // Strip header with a bad strip length, then positions whose count does not match.
  const junk = concat(words('u32', [4, 8, 2, 1, 2]), words('u32', [4, 8, 2, 1, 4, 12, 100, 2, 5]))
  assert.equal(readDisplayMesh(junk, 'x'), null)
  // Normals that are not unit length.
  const f = face()
  const dv = new DataView(f.buffer)
  dv.setFloat32(20 + 16 + 48 + 16 + 8, 3, true)
  assert.equal(readDisplayMesh(f, 'x'), null)
})

test('sw: OLE container with a __ZLB stream', () => {
  const payload = enc('<Keywords Name="P"><Feature id="1" Name="Boss" Type="Extrusion"/></Keywords>')
  const guid = Uint8Array.from([0x23, 0x1d, 0xd5, 0x71, 0xda, 0x81, 0x48, 0xa2, 0xa8, 0x58, 0x98, 0xb2, 0x1b, 0x89, 0xef, 0x99])
  const z = zlibStored(payload)
  const frame = concat(guid, words('u32', [payload.length, z.length]), z, new Uint8Array(8))
  assert.equal(new TextDecoder().decode(decodeZlbFrame(frame)), new TextDecoder().decode(payload))
  const c = openSw(buildCfb([{ name: 'KeyWords__ZLB', data: frame }]).bytes)
  assert.equal(c.kind, 'ole')
  assert.equal(c.streams[0].name, 'KeyWords')
  assert.equal(c.streams[0].encoding, 'zlb')
  assert.equal(new TextDecoder().decode(c.get('KeyWords')!), new TextDecoder().decode(payload))
  assert.throws(() => decodeZlbFrame(new Uint8Array(32)))
})

test('sw: History stream', () => {
  const cls = (name: string) => concat(words('u16', [0xffff, 1, name.length]), enc(name))
  const save = (code: number, date: number, first: boolean) =>
    concat(words('u32', [0]), words('u16', [0]), words('u32', [1700000000]), Uint8Array.from([0xff, 0xfe, 0xff, 0]), words('u32', [code]), first ? cls('moDateCodeHistory_c') : words('u16', [0x8003]), words('u32', [1, date]))
  const s = concat(cls('moVersionHistory_c'), words('u32', [2]), save(15000, 2022009 | (1 << 24), true), save(17000, 2024157, false))
  const saves = readHistory(s)
  assert.equal(saves.length, 2)
  assert.deepEqual(saves[0], { code: 15000, release: '2022', build: '2022/009', created: true })
  assert.equal(saves[1].release, '2024')
  assert.equal(saves[1].created, false)
  assert.deepEqual(readHistory(new Uint8Array(4)), [])
})

test('sw: DIB preview becomes a BMP file', () => {
  const dib = concat(words('u32', [40, 2, 2]), words('u16', [1, 24]), words('u32', [0, 16, 0, 0, 0, 0]), new Uint8Array(16))
  const bmp = dibToBmp(dib)!
  assert.equal(String.fromCharCode(bmp[0], bmp[1]), 'BM')
  const dv = new DataView(bmp.buffer)
  assert.equal(dv.getUint32(2, true), bmp.length)
  assert.equal(dv.getUint32(10, true), 54)
  assert.equal(dibToBmp(new Uint8Array(10)), null)
})

test('sw: MFC strings', () => {
  const s = concat(Uint8Array.from([1, 0, 0xff, 0xfe, 0xff, 6]), new Uint8Array(Array.from('Sheet1').flatMap((c) => [c.charCodeAt(0), 0])), new Uint8Array(3))
  assert.deepEqual(readMfcStrings(s), ['Sheet1'])
})

test('olepropset: summary section with a string and a date', () => {
  const fmtid = Uint8Array.from([0xe0, 0x85, 0x9f, 0xf2, 0xf9, 0x4f, 0x68, 0x10, 0xab, 0x91, 0x08, 0x00, 0x2b, 0x27, 0xb3, 0xd9])
  const title = concat(words('u32', [0x1e, 6]), enc('Plate'), new Uint8Array(3))
  const ft = 133500000000000000 // 2024-01-20
  const date = concat(words('u32', [0x40, ft % 2 ** 32, Math.floor(ft / 2 ** 32)]))
  const cp = concat(words('u32', [2]), words('u16', [1252, 0]))
  const head = 8 + 3 * 8
  const body = concat(cp, title, date)
  const section = concat(words('u32', [head + body.length, 3, 1, head, 2, head + cp.length, 12, head + cp.length + title.length]), body)
  const stream = concat(words('u16', [0xfffe, 0]), words('u32', [0x20006]), new Uint8Array(16), words('u32', [1]), fmtid, words('u32', [48]), section)
  const [sec] = readPropertySet(stream)
  assert.equal(sec.fmtid, FMTID_SUMMARY)
  assert.equal(sec.properties.find((p) => p.name === 'Title')?.value, 'Plate')
  const created = sec.properties.find((p) => p.name === 'Created')?.value as Date
  assert.equal(created.getUTCFullYear(), 2024)
  assert.deepEqual(readPropertySet(new Uint8Array(20)), [])
})
