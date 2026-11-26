import { assert, test } from 'orca/testing'
import { placeText, readable, symbolXf, upright, apply } from './common.ts'
import { hasGlyphs, parseMarkup, plainText, strokeText, textWidth, unescapeKicad, wrapText } from './font.ts'
import { buildBoard } from './pcb.ts'
import { buildSchematic } from './sch.ts'
import { Box, clockwise, Scene } from './scene.ts'
import { arcPoints, child, circleFrom3, flag, num, parseSexpr, SexprError, str, val } from './sexpr.ts'
import { buildSymbolView } from './symlib.ts'
import { kicadMajor } from '../kicad.ts'

const tr = (_ko: string, en: string) => en

test('parses S-expressions with quoted strings, escapes and nesting', () => {
  const r = parseSexpr('(kicad_sch (version 20231120) (text "a \\"b\\"\\nc" (at 1 -2.5 90)) (hide yes) bare)')
  assert.equal(r[0], 'kicad_sch')
  assert.equal(val(r, 'version'), '20231120')
  const t = child(r, 'text')!
  assert.equal(str(t[1]), 'a "b"\nc')
  assert.equal(num(child(t, 'at')![2]), -2.5)
  assert.ok(flag(r, 'hide'))
  assert.ok(flag(r, 'bare'))
})

test('refuses truncated and non-S-expression input', () => {
  assert.throws(() => parseSexpr('(kicad_pcb (version 1) (net 0 "'))
  assert.throws(() => parseSexpr('(kicad_pcb (version 1)'))
  assert.throws(() => parseSexpr('EESchema Schematic File Version 4'))
  let caught: unknown = null
  try {
    parseSexpr('(a (b)')
  } catch (e) {
    caught = e
  }
  assert.ok(caught instanceof SexprError)
})

test('circle through three points and arc sampling', () => {
  const c = circleFrom3([1, 0], [0, 1], [-1, 0])!
  assert.ok(Math.abs(c.cx) < 1e-9 && Math.abs(c.cy) < 1e-9 && Math.abs(c.r - 1) < 1e-9)
  const pts = arcPoints([1, 0], [0, 1], [-1, 0], 4)
  assert.equal(pts.length, 5)
  // Passes through the mid point side (y > 0).
  assert.ok(pts[2][1] > 0.99)
  assert.equal(circleFrom3([0, 0], [1, 1], [2, 2]), null)
})

test('stroke font: glyph coverage, markup, escapes and width', () => {
  assert.ok(hasGlyphs('R1 10kΩ ±5% µF'))
  assert.ok(!hasGlyphs('저항'))
  const runs = parseMarkup('A~{RST}_{x}^{2}')
  assert.deepEqual(
    runs.map((r) => [r.text, r.overbar, r.sub, r.sup]),
    [
      ['A', false, false, false],
      ['RST', true, false, false],
      ['x', false, true, false],
      ['2', false, false, true]
    ]
  )
  assert.equal(plainText('~{CS}/RD'), 'CS/RD')
  assert.equal(unescapeKicad('VPP{slash}MCLR{unknown}'), 'VPP/MCLR{unknown}')
  const w1 = textWidth('MMM', [1, 1])
  assert.ok(w1 > 2 && w1 < 4)
  assert.ok(Math.abs(textWidth('MMM', [2, 2]) - 2 * w1) < 1e-9)
  assert.equal(wrapText('one two three', [1, 1], textWidth('one two', [1, 1]) + 0.01), 'one two\nthree')
})

test('stroke text justification and rotation', () => {
  const box = (s: number[][][]) => {
    const b = new Box()
    for (const l of s) for (const p of l) b.add(p[0], p[1])
    return b
  }
  const left = box(strokeText('HELLO', 10, 10, { size: [1, 1], thickness: 0.1, h: 'left', v: 'bottom' }))
  assert.ok(left.x0 >= 10 - 0.2 && left.y1 <= 10.01)
  const right = box(strokeText('HELLO', 10, 10, { size: [1, 1], thickness: 0.1, h: 'right', v: 'bottom' }))
  assert.ok(right.x1 <= 10.2)
  // 90° turns the text upwards (y decreases along the text).
  const up = box(strokeText('HELLO', 0, 0, { size: [1, 1], thickness: 0.1, angle: 90, h: 'left', v: 'bottom' }))
  assert.ok(up.y0 < -2 && up.x1 <= 0.01)
})

test('symbol transforms match KiCad orientations', () => {
  // Lib y is up; schematic y is down.
  assert.deepEqual(apply(symbolXf(10, 10, 0, undefined), 1, 2), [11, 8])
  assert.deepEqual(apply(symbolXf(10, 10, 90, undefined), 1, 0), [10, 9])
  assert.deepEqual(apply(symbolXf(10, 10, 180, undefined), 1, 0), [9, 10])
  assert.deepEqual(apply(symbolXf(10, 10, 0, 'y'), 1, 0), [9, 10])
  assert.deepEqual(apply(symbolXf(10, 10, 0, 'x'), 0, 1), [10, 11])
  assert.deepEqual(readable(180, 'left'), { angle: 0, h: 'right' })
  assert.deepEqual(upright(180, 'left', 'top'), { angle: 0, h: 'right', v: 'bottom' })
  assert.deepEqual(upright(90, 'left', 'top'), { angle: 90, h: 'left', v: 'top' })
})

test('field text is centred in its transformed box', () => {
  const s = new Scene()
  const l = s.layer('ref')
  // Left-justified field on a symbol rotated 90°: the box extends upwards from the anchor.
  placeText(l, 'R1', [0, 0], { size: [1, 1], thickness: 0.1, bold: false, italic: false, h: 'left', v: 'center', mirror: false, hide: false, lineSpacing: 1 }, 0, symbolXf(0, 0, 90, undefined))
  assert.ok(l.box.y1 <= 0.2 && l.box.y0 < -1)
})

test('clockwise winding for fills', () => {
  const ccw: [number, number][] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0]
  ]
  assert.deepEqual(clockwise(ccw)[1], [1, 1])
  const cw: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ]
  assert.equal(clockwise(cw), cw)
})

const SCH = `(kicad_sch (version 20231120) (generator "eeschema") (paper "A4")
  (lib_symbols
    (symbol "D:R" (pin_numbers hide) (pin_names (offset 0))
      (property "Reference" "R" (at 2 0 90) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1 -2.5) (end 1 2.5) (stroke (width 0.254) (type default)) (fill (type none))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))))
    (symbol "D:GND" (power) (pin_names hide)
      (property "Reference" "#PWR" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
      (property "Value" "GND" (at 0 -3 0) (effects (font (size 1.27 1.27))))
      (symbol "GND_1_1" (pin power_in line (at 0 0 270) (length 0) hide (name "GND" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "D:R") (at 50 50 0) (unit 1)
    (property "Reference" "R1" (at 52 50 90) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 50 50 90) (effects (font (size 1.27 1.27)))))
  (symbol (lib_id "D:GND") (at 50 60 0) (unit 1)
    (property "Reference" "#PWR1" (at 50 60 0) (effects (font (size 1.27 1.27)) hide))
    (property "Value" "GND" (at 50 63 0) (effects (font (size 1.27 1.27)))))
  (wire (pts (xy 50 53.81) (xy 50 60)))
  (wire (pts (xy 50 46.19) (xy 50 40)))
  (wire (pts (xy 45 40) (xy 55 40)))
  (label "SIG" (at 45 40 0) (effects (font (size 1.27 1.27)) (justify left bottom)))
  (sheet (at 100 40) (size 20 10) (property "Sheetname" "Sub" (at 100 39 0) (effects (font (size 1.27 1.27)) (justify left bottom))) (property "Sheetfile" "sub.kicad_sch" (at 100 51 0) (effects (font (size 1.27 1.27)) (justify left top))))
)`

test('schematic: symbols, sheets and net names for hover', () => {
  const m = buildSchematic(parseSexpr(SCH), tr)
  assert.equal(m.info.symbols, 2)
  assert.deepEqual(
    m.info.sheets.map((s) => [s.name, s.file]),
    [['Sub', 'sub.kicad_sch']]
  )
  // Pin 2 of R1 connects to GND through the wire; pin 1 reaches the SIG label through a T.
  const pin2 = m.hit(50, 53.5, 0.2)!
  assert.ok(pin2.title.startsWith('Pin 2'))
  assert.ok((pin2.lines ?? []).includes('Net: GND'))
  const pin1 = m.hit(50, 46.5, 0.2)!
  assert.ok((pin1.lines ?? []).includes('Net: SIG'))
  const sym = m.hit(50, 50, 0.1)!
  assert.ok(sym.title.includes('R1'))
  assert.ok(m.scene.layers.has('body') && m.scene.layers.has('wire') && m.scene.layers.has('label'))
})

const PCB = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user "F.Silkscreen") (44 "Edge.Cuts" user))
  (net 0 "") (net 1 "GND")
  (footprint "R" (layer "F.Cu") (at 10 10 90)
    (property "Reference" "R1" (at 0 -2 90) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd roundrect (at -1 0 90) (size 1 1.4) (roundrect_rratio 0.25) (layers "F.Cu") (net 1 "GND"))
    (pad "2" thru_hole circle (at 1 0 90) (size 1.6 1.6) (drill 0.8) (layers "*.Cu") (net 0 "")))
  (segment (start 0 0) (end 5 0) (width 0.25) (layer "B.Cu") (net 1))
  (via (at 5 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
  (gr_rect (start -5 -5) (end 20 20) (stroke (width 0.1) (type default)) (fill none) (layer "Edge.Cuts"))
)`

test('board: layers, pads rotated with the footprint, nets, hover', () => {
  const m = buildBoard(parseSexpr(PCB), tr)
  assert.deepEqual(
    m.layers.map((l) => l.name),
    ['F.Cu', 'B.Cu', 'F.SilkS', 'Edge.Cuts']
  )
  assert.equal(m.layers[2].label, 'F.SilkS (F.Silkscreen)')
  assert.equal(m.info.footprints, 1)
  assert.equal(m.info.vias, 1)
  // Footprint at 90°: local (-1, 0) lands at (10, 11).
  const all = () => true
  const pad = m.hit(10, 11, 0.05, all)!
  assert.equal(pad.title, 'Pad 1 · R1')
  assert.ok((pad.lines ?? []).includes('Net: GND'))
  const track = m.hit(2.5, 0, 0.05, all)!
  assert.equal(track.title, 'Track')
  assert.ok((track.lines ?? []).includes('Net: GND'))
  assert.equal(m.hit(5, 0, 0.05, all)!.title, 'Via')
  // Hidden layers are not hit.
  assert.equal(m.hit(2.5, 0, 0.05, (l) => l !== 'B.Cu'), null)
  // Back view draws front copper first.
  const back = m.order(true)
  assert.ok(back.indexOf('F.Cu') < back.indexOf('B.Cu'))
  const front = m.order(false)
  assert.ok(front.indexOf('B.Cu') < front.indexOf('F.Cu'))
  assert.equal(front[front.length - 1], 'Holes')
})

test('KiCad 10 boards name nets directly', () => {
  const m = buildBoard(parseSexpr('(kicad_pcb (version 20260206) (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net "VCC")))'), tr)
  assert.ok((m.hit(0.5, 0, 0.05, () => true)!.lines ?? []).includes('Net: VCC'))
})

test('footprint file renders standalone', () => {
  const m = buildBoard(parseSexpr('(footprint "X" (layer "F.Cu") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))'), tr)
  assert.equal(m.info.pads, 1)
  assert.equal(m.info.name, 'X')
  assert.ok(!m.bounds.empty)
})

test('symbol library: list, units, derived symbols', () => {
  const lib = buildSymbolView(
    parseSexpr(`(kicad_symbol_lib (version 20231120)
      (symbol "A" (property "Reference" "U" (at 0 2 0) (effects (font (size 1.27 1.27))))
        (symbol "A_1_1" (rectangle (start -1 -1) (end 1 1) (stroke (width 0)) (fill (type background))) (pin input line (at -3 0 0) (length 2) (name "IN" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1))))))
        (symbol "A_2_1" (circle (center 0 0) (radius 1) (stroke (width 0)) (fill (type none)))))
      (symbol "B" (extends "A") (property "Reference" "U" (at 0 2 0) (effects (font (size 1.27 1.27))))))`)
  )
  assert.deepEqual(
    lib.symbols.map((s) => [s.name, s.unitCount, s.extendsName ?? '']),
    [
      ['A', 2, ''],
      ['B', 1, 'A']
    ]
  )
  const d = lib.draw(1, 1, 1)
  assert.ok(d.svg.includes('data-layer="pin"'), 'derived symbol draws its parent pins')
  assert.ok(lib.draw(0, 2, 1).svg.includes('data-layer="body"'))
  assert.equal(d.hit(-3, 0, 0.1)!.title, 'Pin 1 (IN)')
})

test('KiCad version from the file format date', () => {
  assert.equal(kicadMajor('20211014', 'sch'), '6')
  assert.equal(kicadMajor('20231120', 'sch'), '8')
  assert.equal(kicadMajor('20240108', 'pcb'), '8')
  assert.equal(kicadMajor('20250114', 'sch'), '9')
  assert.equal(kicadMajor('20260206', 'pcb'), '10')
  assert.equal(kicadMajor('', 'pcb'), '')
})
