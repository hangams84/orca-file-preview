import { assert, test } from 'orca/testing'
import { symbolBullets } from '../docx.ts'

const BS = '\\'

test('maps Word Symbol bullets to Unicode in CSS escapes and raw text', () => {
  assert.equal(symbolBullets(`content:"${BS}f0b7${BS}9";`), `content:"${BS}2022 ${BS}9";`)
  assert.equal(symbolBullets(`content:"${BS}0f0a7";`), `content:"${BS}25aa ";`)
  assert.equal(symbolBullets('content:"";'), 'content:"•";')
  assert.equal(symbolBullets(`content:"${BS}f0e9";`), `content:"${BS}f0e9";`)
  assert.equal(symbolBullets('content:"o";'), 'content:"o";')
})
