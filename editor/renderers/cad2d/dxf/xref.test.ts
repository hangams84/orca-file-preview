import { assert, test } from 'orca/testing'
import type { ImageItem, RefItem } from '../scene.ts'
import { buildScene, dxfReferences } from './build.ts'
import { readDxfDoc, resolveDxf, type DxfIo } from './resolve.ts'

const dxf = (pairs: [number, string | number][]) => new TextEncoder().encode(pairs.map(([c, v]) => `${String(c).padStart(3)}\n${v}`).join('\n') + '\n')
const line = (x1: number, y1: number, x2: number, y2: number, layer = '0'): [number, string | number][] => [[0, 'LINE'], [8, layer], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]]

const MAIN = dxf([
  [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'BLOCKS'],
  [0, 'BLOCK'], [8, '0'], [2, 'BOLT'], [70, 4], [10, 0], [20, 0], [30, 0], [3, 'BOLT'], [1, 'parts\\bolt.dxf'], [0, 'ENDBLK'],
  [0, 'BLOCK'], [8, '0'], [2, 'TITLE'], [70, 4], [10, 0], [20, 0], [30, 0], [3, 'TITLE'], [1, 'C:\\std\\title.dxf'], [0, 'ENDBLK'],
  [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'ENTITIES'],
  ...line(0, 0, 100, 0),
  [0, 'INSERT'], [8, '0'], [2, 'BOLT'], [10, 40], [20, 40], [30, 0],
  [0, 'INSERT'], [8, '0'], [2, 'TITLE'], [10, 0], [20, 0], [30, 0],
  [0, 'IMAGE'], [5, '30'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbRasterImage'], [10, 120], [20, 20], [30, 0], [11, 1], [21, 0], [31, 0], [12, 0], [22, 1], [32, 0], [13, 64], [23, 48], [340, '2A'],
  [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'OBJECTS'],
  [0, 'IMAGEDEF'], [5, '2A'], [100, 'AcDbRasterImageDef'], [1, 'images\\logo.png'], [10, 64], [20, 48],
  [0, 'ENDSEC'], [0, 'EOF']
])
const BOLT = dxf([
  [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [0, 'LAYER'], [2, 'BOLT'], [70, 0], [62, 3], [6, 'CONTINUOUS'], [0, 'ENDTAB'], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'ENTITIES'], [0, 'CIRCLE'], [8, 'BOLT'], [10, 0], [20, 0], [30, 0], [40, 10], ...line(-14, 0, 14, 0, 'BOLT'), [0, 'ENDSEC'], [0, 'EOF']
])

/** Files by path; read() resolves the last path segments like the companion store does. */
function io(files: Record<string, Uint8Array>): DxfIo & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    async read(ref) {
      reads.push(ref)
      const name = ref.replace(/\\/g, '/').split('/').slice(-2).join('/').toLowerCase()
      const hit = Object.keys(files).find((p) => p.toLowerCase().endsWith(name))
      return hit ? { bytes: files[hit], path: hit } : null
    },
    async image(bytes) {
      return bytes.byteLength ? { src: { fake: true } as unknown as CanvasImageSource, w: 64, h: 48 } : null
    }
  }
}

test('dxf refs: xref blocks and image definitions are found', () => {
  const doc = readDxfDoc(MAIN)
  const refs = dxfReferences(doc)
  assert.deepEqual(refs.xrefs, [
    { block: 'BOLT', path: 'parts\\bolt.dxf' },
    { block: 'TITLE', path: 'C:\\std\\title.dxf' }
  ])
  assert.deepEqual(refs.images, [{ handle: '2A', path: 'images\\logo.png' }])
})

test('dxf refs: without files the xrefs and the image are listed as missing and drawn as before', async () => {
  const doc = readDxfDoc(MAIN)
  const res = await resolveDxf(doc, undefined, io({}))
  assert.deepEqual(res.missing.map((m) => `${m.kind}:${m.path}`), ['xref:parts\\bolt.dxf', 'xref:C:\\std\\title.dxf', 'image:images\\logo.png'])
  const scene = buildScene(doc, res.resolved)
  assert.equal(scene.skipped.get('external reference (xref)'), 2)
  const img = scene.views[0].items.find((i) => i.k === 'image') as ImageItem
  assert.equal(img.src, null)
  assert.equal(img.label, 'images\\logo.png')
})

test('dxf refs: a supplied xref is inserted with its layers, the image is drawn', async () => {
  const doc = readDxfDoc(MAIN)
  const files = io({ 'drawings/parts/bolt.dxf': BOLT, 'drawings/images/logo.png': new Uint8Array([1, 2, 3]) })
  const res = await resolveDxf(doc, 'drawings/main.dxf', files)
  assert.deepEqual(res.missing.map((m) => m.path), ['C:\\std\\title.dxf'])
  assert.deepEqual(res.used.sort(), ['drawings/images/logo.png', 'drawings/parts/bolt.dxf'])
  const scene = buildScene(doc, res.resolved)
  const bolt = scene.blocks.get('BOLT')!
  assert.ok(bolt.items.length >= 1, 'xref geometry in the block')
  const layer = scene.layers.findIndex((l) => l.name === 'BOLT|BOLT')
  assert.ok(layer >= 0, 'xref layer is prefixed')
  assert.ok(bolt.items.every((i) => i.layer === layer))
  const ref = scene.views[0].items.find((i) => i.k === 'ref' && (i as RefItem).block === 'BOLT') as RefItem
  assert.deepEqual(ref.m.slice(4), [40, 40])
  assert.equal(scene.skipped.get('external reference (xref)'), 1)
  const img = scene.views[0].items.find((i) => i.k === 'image') as ImageItem
  assert.ok(img.src)
  assert.equal(img.pw, 64)
})

test('dxf refs: nested and circular xrefs', async () => {
  const A = dxf([
    [0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [2, 'B'], [70, 4], [10, 0], [20, 0], [1, 'b.dxf'], [0, 'ENDBLK'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'], ...line(0, 0, 1, 1), [0, 'INSERT'], [8, '0'], [2, 'B'], [10, 0], [20, 0], [0, 'ENDSEC'], [0, 'EOF']
  ])
  const B = dxf([
    [0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [2, 'A'], [70, 4], [10, 0], [20, 0], [1, 'a.dxf'], [0, 'ENDBLK'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'], ...line(0, 0, 2, 2), [0, 'INSERT'], [8, '0'], [2, 'A'], [10, 0], [20, 0], [0, 'ENDSEC'], [0, 'EOF']
  ])
  const res = await resolveDxf(readDxfDoc(A), 'a.dxf', io({ 'a.dxf': A, 'b.dxf': B }))
  assert.deepEqual(res.used, ['b.dxf'])
  assert.deepEqual(res.failed.map((x) => x.why), ['circular reference'])
  const scene = buildScene(readDxfDoc(A), res.resolved)
  assert.ok(scene.blocks.get('B')!.items.length >= 1)
})

test('dxf refs: a supplied file that is not a DXF is reported, not fatal', async () => {
  const res = await resolveDxf(readDxfDoc(MAIN), undefined, io({ 'parts/bolt.dxf': new TextEncoder().encode('hello') }))
  assert.equal(res.failed[0]?.kind, 'xref')
})
