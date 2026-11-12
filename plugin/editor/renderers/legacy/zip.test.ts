import { assert, test } from 'orca/testing'
import { inflateSync } from '../../../vendor/zip.js'
import { concat, u32le } from './testkit.ts'
import { hasDeflateRaw, isZip, listZip, readZipEntry, readZipText } from './zip.ts'

const u16le = (...v: number[]) => {
  const out = new Uint8Array(v.length * 2)
  const dv = new DataView(out.buffer)
  v.forEach((x, i) => dv.setUint16(i * 2, x, true))
  return out
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A ZIP with the given entries (method 0 = stored, 8 = deflate). CRCs are left zero: the reader
 *  does not check them. */
function buildZip(entries: { name: string; method: number; data: Uint8Array; size: number }[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const local = concat(u32le(0x04034b50), u16le(20, 0, e.method, 0, 0), u32le(0, e.data.length, e.size), u16le(name.length, 0), name, e.data)
    central.push(
      concat(u32le(0x02014b50), u16le(20, 20, 0, e.method, 0, 0), u32le(0, e.data.length, e.size), u16le(name.length, 0, 0, 0, 0), u32le(0, offset), name)
    )
    locals.push(local)
    offset += local.length
  }
  const cd = concat(...central)
  const eocd = concat(u32le(0x06054b50), u16le(0, 0, entries.length, entries.length), u32le(cd.length, offset), u16le(0))
  return concat(...locals, cd, eocd)
}

test('zip: stored and deflated entries, and the fflate fallback agrees with DecompressionStream', async () => {
  const text = '<w:document>' + '한글 text '.repeat(200) + '</w:document>'
  const raw = new TextEncoder().encode(text)
  const deflated = await deflateRaw(raw)
  const zip = buildZip([
    { name: 'stored.txt', method: 0, data: new TextEncoder().encode('plain'), size: 5 },
    { name: 'word/document.xml', method: 8, data: deflated, size: raw.length }
  ])
  assert.equal(isZip(zip), true)
  const entries = listZip(zip)
  assert.deepEqual(
    entries.map((e) => e.name),
    ['stored.txt', 'word/document.xml']
  )
  assert.equal(await readZipText(zip, entries, 'stored.txt'), 'plain')
  assert.equal(hasDeflateRaw(), true)
  assert.equal(await readZipText(zip, entries, 'word/document.xml'), text)
  // the path used when DecompressionStream('deflate-raw') is missing
  assert.equal(new TextDecoder().decode(inflateSync(deflated)), text)
  assert.equal(await readZipText(zip, entries, 'missing.xml'), null)
})

test('zip: a file without an end-of-central-directory record is rejected', async () => {
  assert.throws(() => listZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])))
  const zip = buildZip([{ name: 'a', method: 99, data: new Uint8Array(4), size: 4 }])
  let threw = false
  try {
    await readZipEntry(zip, listZip(zip)[0])
  } catch {
    threw = true
  }
  assert.ok(threw, 'unknown compression method throws')
})
