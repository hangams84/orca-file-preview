import { assert, test } from 'orca/testing'
import { CfbError, isCfb, readCfb } from './cfb.ts'
import { buildCfb } from './testkit.ts'

const bytesOf = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff)

test('cfb: header validation', () => {
  assert.equal(isCfb(new Uint8Array(600)), false)
  assert.equal(isCfb(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), false, 'too short')
  assert.throws(() => readCfb(new TextEncoder().encode('not a compound file'.padEnd(600, ' '))), (e) => e instanceof CfbError)
  const ok = buildCfb([{ name: 'A', data: bytesOf(10, 1) }]).bytes
  assert.equal(isCfb(ok), true)
  const badShift = ok.slice()
  badShift[0x1e] = 7
  assert.throws(() => readCfb(badShift), (e) => e instanceof CfbError)
})

test('cfb: mini-FAT stream and FAT stream round-trip', () => {
  const small = bytesOf(300, 3) // 5 mini sectors
  const large = bytesOf(5000, 9) // 10 regular sectors
  const c = readCfb(buildCfb([{ name: 'Small', data: small }, { name: 'Large', data: large }]).bytes)
  assert.deepEqual(c.rootNames().sort(), ['Large', 'Small'])
  assert.deepEqual([...c.stream('Small')!], [...small])
  assert.deepEqual([...c.stream('Large')!], [...large])
  assert.ok(c.stream('small'), 'names are case-insensitive')
  assert.equal(c.stream('Missing'), null)
})

test('cfb: a FAT cycle ends the chain instead of looping', () => {
  const built = buildCfb([{ name: 'Large', data: bytesOf(5000, 2) }])
  const dv = new DataView(built.bytes.buffer)
  const start = built.bigStart.Large
  // second sector points back to the first: start -> start+1 -> start -> ...
  dv.setUint32(built.fatOffset + (start + 1) * 4, start, true)
  const s = readCfb(built.bytes).stream('Large')!
  assert.ok(s.length <= 1024, `read ${s.length} bytes from a two-sector cycle`)
})

test('cfb: out-of-range start sectors give empty or truncated streams, not exceptions', () => {
  const built = buildCfb([{ name: 'Large', data: bytesOf(5000, 4) }, { name: 'Small', data: bytesOf(100, 5) }])
  const dv = new DataView(built.bytes.buffer)
  // directory sector is sector 1: entry 1 = Large, entry 2 = Small; patch their start sectors
  dv.setUint32(1024 + 128 + 0x74, 0x00ffffff, true)
  dv.setUint32(1024 + 256 + 0x74, 0x00ffffff, true)
  const c = readCfb(built.bytes)
  assert.equal(c.stream('Large')!.length, 0)
  assert.equal(c.stream('Small')!.length, 0)
})

test('cfb: a truncated file still opens the entries it can reach', () => {
  const built = buildCfb([{ name: 'Large', data: bytesOf(5000, 6) }])
  const cut = built.bytes.subarray(0, built.bytes.length - 2048)
  const s = readCfb(cut).stream('Large')!
  assert.ok(s.length <= 5000)
})

test('cfb: sibling cycles in the directory tree terminate', () => {
  const built = buildCfb([{ name: 'A', data: bytesOf(10, 1) }, { name: 'B', data: bytesOf(10, 2) }])
  const dv = new DataView(built.bytes.buffer)
  dv.setUint32(1024 + 256 + 0x48, 1, true) // B.right -> A (A.right -> B)
  assert.deepEqual(readCfb(built.bytes).rootNames().sort(), ['A', 'B'])
})
