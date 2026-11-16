import { assert, test } from 'orca/testing'
import { decodeText, looksBinary } from './encoding.ts'

const KO = '한글 미리보기'
// "한글" in EUC-KR / CP949
const EUCKR = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])

test('decodes UTF-8 with and without a BOM', () => {
  const bytes = new TextEncoder().encode(KO)
  assert.equal(decodeText(bytes).text, KO)
  assert.equal(decodeText(bytes).encoding, 'utf-8')
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])
  assert.equal(decodeText(bom).text, KO)
})

test('falls back to EUC-KR for Korean legacy files', () => {
  const r = decodeText(EUCKR)
  assert.equal(r.encoding, 'euc-kr')
  assert.equal(r.text, '한글')
})

test('detects UTF-16 LE by BOM and without one', () => {
  const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])
  assert.equal(decodeText(le).text, 'AB')
  const noBom = new Uint8Array([0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x44, 0x00])
  assert.equal(decodeText(noBom).encoding, 'utf-16le')
})

test('honours a forced encoding', () => {
  assert.equal(decodeText(EUCKR, 'euc-kr').text, '한글')
})

test('flags binary data but not text', () => {
  assert.equal(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])), true)
  assert.equal(looksBinary(new TextEncoder().encode('plain text\nline 2')), false)
})
