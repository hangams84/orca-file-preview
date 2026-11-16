import { assert, test } from 'orca/testing'
import { OFFICE_SANS, OFFICE_SERIF, patchCssFonts, withFallback } from './fonts.ts'

test('appends a sans or serif chain depending on the first family', () => {
  assert.equal(withFallback('Calibri'), `Calibri, ${OFFICE_SANS}`)
  assert.equal(withFallback('Cambria, "Malgun Gothic"'), `Cambria, "Malgun Gothic", ${OFFICE_SERIF}`)
  assert.equal(withFallback('"바탕"'), `"바탕", ${OFFICE_SERIF}`)
  assert.equal(withFallback('var(--docx-minorHAnsi-font)'), `var(--docx-minorHAnsi-font), ${OFFICE_SANS}`)
  assert.equal(withFallback(''), OFFICE_SANS)
})

test('leaves values that already end in a generic family alone', () => {
  assert.equal(withFallback('Arial, sans-serif'), 'Arial, sans-serif')
  assert.equal(withFallback('Consolas, monospace'), 'Consolas, monospace')
})

test('patches every font-family declaration in CSS text', () => {
  const css = '.a { font-family: Calibri; color: red } .b{font-family:Cambria !important}'
  const out = patchCssFonts(css)
  assert.ok(out.includes(`font-family: Calibri, ${OFFICE_SANS}; color: red`))
  assert.ok(out.includes(`font-family: Cambria, ${OFFICE_SERIF} !important}`))
})
