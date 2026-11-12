import { assert, test } from 'orca/testing'
import { applyColorMods, cssOf, linearToSrgb, parseHex, srgbToLinear } from './color.ts'

const run = (hex: string, mods: [string, number][]) =>
  cssOf(applyColorMods(parseHex(hex)!, mods.map(([name, val]) => ({ name, val }))))

test('sRGB <-> linear round-trips', () => {
  for (const v of [0, 1, 10, 64, 128, 200, 255]) assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-6, String(v))
})

test('tint works in linear RGB like Office (tx1 black with tint 75% -> #898989)', () => {
  assert.equal(run('000000', [['tint', 75000]]), '#898989')
  assert.equal(run('FFFFFF', [['tint', 40000]]), '#ffffff')
  assert.equal(run('000000', [['tint', 0]]), '#ffffff')
  assert.equal(run('4472C4', [['tint', 100000]]), '#4472c4')
})

test('shade works in linear RGB', () => {
  assert.equal(run('FFFFFF', [['shade', 50000]]), '#bcbcbc')
  assert.equal(run('000000', [['shade', 50000]]), '#000000')
  assert.equal(run('4472C4', [['shade', 100000]]), '#4472c4')
})

test('lumMod / lumOff in HSL (theme "lighter 40%" and "darker 25%")', () => {
  // accent1 4472C4, Lighter 40%: lumMod 60000 lumOff 40000 -> 8FAADC
  assert.equal(run('4472C4', [['lumMod', 60000], ['lumOff', 40000]]), '#8faadc')
  // Darker 25%: lumMod 75000 -> 2F5597
  assert.equal(run('4472C4', [['lumMod', 75000]]), '#2f5597')
  // bg1 white, darker 5%: lumMod 95000 -> F2F2F2
  assert.equal(run('FFFFFF', [['lumMod', 95000]]), '#f2f2f2')
})

test('satMod, alpha and channel mods', () => {
  assert.equal(run('808080', [['satMod', 200000]]), '#808080', 'grey has no saturation to scale')
  assert.equal(run('FF0000', [['alpha', 50000]]), 'rgba(255,0,0,0.5)')
  assert.equal(run('FF0000', [['alpha', 50000], ['alphaMod', 50000]]), 'rgba(255,0,0,0.25)')
  assert.equal(run('FFFFFF', [['inv', 0]]), '#000000')
  assert.equal(run('FF0000', [['comp', 0]]), '#00ffff')
})

test('modifiers apply in document order', () => {
  const a = run('4472C4', [['lumMod', 50000], ['tint', 50000]])
  const b = run('4472C4', [['tint', 50000], ['lumMod', 50000]])
  assert.notEqual(a, b)
})
