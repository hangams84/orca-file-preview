import { assert, test } from 'orca/testing'
import {
  findByBasename,
  openArchive,
  parseLinkFile,
  parseManifest,
  parseMultiLang,
  parsePartXml,
  parseProjectInfo,
  parseXml,
  pickLang,
  resolveItem,
  scanMultiLangStrings,
  type Archive
} from './eplan.ts'
import { EDZ, ZW1 } from './fixtures.ts'
import { entropy, hexDump, identify, readableStrings } from './inspect.ts'

const text = (b: Uint8Array) => new TextDecoder().decode(b)

test('eplan: multi-language strings', () => {
  const s = 'de_DE@Einspeisung;en_US@Feed-in;ko_KR@인입;'
  assert.equal(parseMultiLang(s).get('de_DE'), 'Einspeisung')
  assert.equal(pickLang(s, false), 'Feed-in')
  assert.equal(pickLang(s, true), '인입')
  assert.equal(pickLang('??_??@800 V;', false), '800 V')
  assert.equal(pickLang('fr_FR@Bornier;', false), 'Bornier', 'falls back to the first language')
  assert.equal(pickLang('plain text', false), 'plain text')
})

test('eplan: link files', () => {
  const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('Plant.edb\n18.0\n').flatMap((c) => [c.charCodeAt(0), 0])])
  const l = parseLinkFile(utf16)!
  assert.equal(l.dataDir, 'Plant.edb')
  assert.equal(l.dbVersion, '18.0')
  assert.equal(l.encoding, 'UTF-16LE')
  assert.equal(parseLinkFile(new TextEncoder().encode('Plant.edb\r\n17.0'))?.dbVersion, '17.0')
  assert.equal(parseLinkFile(Uint8Array.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4, 1, 2, 3])), null, 'binary is not a link file')
})

test('eplan: XML reader', () => {
  const root = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b y=\'z\'/>t&#x41;<![CDATA[<raw>]]></a>')
  const a = root.children[0]
  assert.equal(a.attrs.x, '1 & 2')
  assert.equal(a.children[0].attrs.y, 'z')
  assert.equal(a.text, 'tA<raw>')
  assert.throws(() => parseXml('<a><b></a>'))
  assert.throws(() => parseXml('<a>'))
})

test('eplan: EDZ package from a 7z (sample.edz)', async () => {
  const a = openArchive(EDZ)
  assert.equal(a.format, '7z')
  const manifest = parseManifest(text(await a.entries.find((e) => e.path === 'manifest.xml')!.read()))
  assert.equal(manifest.version, '2.0')
  const pkg = manifest.packages[0]
  assert.equal(pkg.key, 'ORCA.TB-100')
  const partEntry = resolveItem(a, pkg.items.find((i) => i.name === 'part')!)!
  assert.equal(partEntry.path, 'items/partxml/ORCA.TB-100.part.xml')
  const [part] = parsePartXml(text(await partEntry.read()))
  assert.equal(part.attrs.P_ARTICLE_TYPENR, 'TB-100')
  assert.equal(pickLang(part.attrs.P_ARTICLE_DESCR1, false), 'Feed-through terminal 2.5 mm²')
  assert.equal(part.free.length, 2)
  assert.equal(part.functionTemplates, 2)
  assert.equal(part.units.length, 'mm')
  assert.equal(resolveItem(a, pkg.items.find((i) => i.type === 'picture')!)?.path, 'items/picture/Orca/TB-100.png')
  assert.equal(resolveItem(a, pkg.items.find((i) => i.type === 'document')!)?.path, 'items/document/Orca/TB-100_en.pdf')
})

test('eplan: part XML locators with escaped characters', () => {
  const entries = ['items/partxml/BACH.AI202%2FSI.part.xml', 'items/macro/Vendor/Sub/M.ema'].map((path) => ({ path, size: 1, dir: false, read: async () => new Uint8Array(0) }))
  const a: Archive = { format: '7z', entries, methods: [], solid: false, encrypted: false }
  assert.equal(resolveItem(a, { type: 'partxml', name: 'part', locator: 'BACH.AI202/SI.part.xml' })?.path, entries[0].path)
  assert.equal(resolveItem(a, { type: 'partxml', name: 'part', locator: 'BACH.AI202%2FSI.part.xml' })?.path, entries[0].path)
  assert.equal(resolveItem(a, { type: 'macro', name: 'graphicmacro', locator: 'Vendor\\Sub\\M.ema' })?.path, entries[1].path)
  assert.equal(resolveItem(a, { type: 'macro', name: 'graphicmacro', locator: 'Missing.ema' }), undefined)
})

test('eplan: project backup (sample.zw1)', async () => {
  const a = openArchive(ZW1)
  const info = findByBasename(a, /^ProjectInfo\.xml$/i)[0]
  const props = parseProjectInfo(text(await info.read()))
  assert.equal(props.find((p) => p.id === 10043)?.value, '2026.0.3')
  assert.equal(pickLang(props.find((p) => p.id === 10011)!.value, false), 'Test bench')
  const pages = scanMultiLangStrings(await findByBasename(a, /^Page\.eod$/)[0].read()).map((s) => pickLang(s, false))
  assert.deepEqual(pages, ['Title page', 'Table of contents', '400 V feed-in', '24 V control voltage', 'Terminal diagram'])
})

test('inspect: identification, hex dump and strings', () => {
  assert.equal(identify(ZW1).name, '7z archive')
  assert.equal(identify(new TextEncoder().encode('%PDF-1.7\n')).name, 'PDF document')
  assert.equal(identify(new TextEncoder().encode('<?xml version="1.0"?><EplanPxfRoot Type="WindowMacro">')).name, 'EPLAN PXF XML')
  assert.equal(identify(Uint8Array.from([0, 1, 2, 3, 200, 201, 0, 0])).name, 'Unknown binary data')
  const dump = hexDump(new TextEncoder().encode('ABCDEFGHIJKLMNOPQ'), 32)
  assert.equal(dump.split('\n')[0], '00000000  41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50  ABCDEFGHIJKLMNOP')
  const strings = readableStrings(new Uint8Array([0, ...new TextEncoder().encode('hello world'), 0, 0, ...Array.from('wide text').flatMap((c) => [c.charCodeAt(0), 0]), 0, 0]))
  assert.ok(strings.includes('hello world'))
  assert.ok(strings.includes('wide text'))
  assert.ok(entropy(new Uint8Array(1000)) === 0)
})
