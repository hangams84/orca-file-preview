// Writes small, self-made KiCad 8 test files (public-safe, MIT like the rest of the repo) to
// samples/kicad/: a schematic with a sub-sheet, a 4-layer board, a footprint, a symbol library,
// a project file, and broken variants that must end in a friendly error.
//
//   node tools/kicad/make-kicad-samples.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'samples')
mkdirSync(OUT, { recursive: true })

let uuidN = 0
const uuid = () => {
  const h = (++uuidN).toString(16).padStart(12, '0')
  return `5ca1ab1e-0000-4000-8000-${h}`
}
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
const r4 = (n) => String(Math.round(n * 10000) / 10000)
const font = (size = 1.27, extra = '') => `(effects (font (size ${size} ${size})${extra ? ' ' + extra : ''}))`
const fontJ = (size, just, hide = false) => `(effects (font (size ${size} ${size})) (justify ${just})${hide ? ' hide' : ''})`
const hidden = (size = 1.27) => `(effects (font (size ${size} ${size})) hide)`

// ---------------------------------------------------------------------------------------------
// Library symbols (lib coordinates, y up)
// ---------------------------------------------------------------------------------------------
const pin = (type, shape, x, y, ang, len, name, num, opts = '') =>
  `(pin ${type} ${shape} (at ${x} ${y} ${ang}) (length ${len})${opts} (name ${q(name)} ${font()}) (number ${q(num)} ${font()}))`
const stroke = (w = 0, type = 'default') => `(stroke (width ${w}) (type ${type}))`
const fill = (t = 'none') => `(fill (type ${t}))`

const LIB = {
  R: `(symbol "R" (pin_numbers hide) (pin_names (offset 0)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 2.032 0 90) ${font()})
    (property "Value" "R" (at 0 0 90) ${font()})
    (property "Footprint" "" (at -1.778 0 90) ${hidden()})
    (property "Datasheet" "~" (at 0 0 0) ${hidden()})
    (property "Description" "Resistor" (at 0 0 0) ${hidden()})
    (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54) ${stroke(0.254)} ${fill()}))
    (symbol "R_1_1"
      ${pin('passive', 'line', 0, 3.81, 270, 1.27, '~', '1')}
      ${pin('passive', 'line', 0, -3.81, 90, 1.27, '~', '2')}))`,
  C_Polarized: `(symbol "C_Polarized" (pin_numbers hide) (pin_names (offset 0.254)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "C" (at 0.635 2.54 0) ${fontJ(1.27, 'left')})
    (property "Value" "C_Polarized" (at 0.635 -2.54 0) ${fontJ(1.27, 'left')})
    (property "Footprint" "" (at 0.9652 -3.81 0) ${hidden()})
    (property "Datasheet" "~" (at 0 0 0) ${hidden()})
    (symbol "C_Polarized_0_1"
      (rectangle (start -2.286 0.508) (end 2.286 1.016) ${stroke(0)} ${fill()})
      (polyline (pts (xy -1.778 2.286) (xy -0.762 2.286)) ${stroke(0)} ${fill()})
      (polyline (pts (xy -1.27 2.794) (xy -1.27 1.778)) ${stroke(0)} ${fill()})
      (rectangle (start 2.286 -0.508) (end -2.286 -1.016) ${stroke(0)} ${fill('outline')}))
    (symbol "C_Polarized_1_1"
      ${pin('passive', 'line', 0, 3.81, 270, 2.794, '~', '1')}
      ${pin('passive', 'line', 0, -3.81, 90, 2.794, '~', '2')}))`,
  OPAMP: `(symbol "OPAMP" (pin_names (offset 0.127)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "U" (at 0 5.08 0) ${fontJ(1.27, 'left')})
    (property "Value" "OPAMP" (at 0 -5.08 0) ${fontJ(1.27, 'left')})
    (property "Footprint" "" (at 0 0 0) ${hidden()})
    (property "Datasheet" "~" (at 0 0 0) ${hidden()})
    (symbol "OPAMP_1_1"
      (polyline (pts (xy -5.08 5.08) (xy 5.08 0) (xy -5.08 -5.08) (xy -5.08 5.08)) ${stroke(0.254)} ${fill('background')})
      ${pin('input', 'line', -7.62, 2.54, 0, 2.54, '+', '3')}
      ${pin('input', 'line', -7.62, -2.54, 0, 2.54, '-', '2')}
      ${pin('output', 'line', 7.62, 0, 180, 2.54, '~', '1')})
    (symbol "OPAMP_2_1"
      (polyline (pts (xy -5.08 5.08) (xy 5.08 0) (xy -5.08 -5.08) (xy -5.08 5.08)) ${stroke(0.254)} ${fill('background')})
      ${pin('input', 'line', -7.62, 2.54, 0, 2.54, '+', '5')}
      ${pin('input', 'line', -7.62, -2.54, 0, 2.54, '-', '6')}
      ${pin('output', 'line', 7.62, 0, 180, 2.54, '~', '7')})
    (symbol "OPAMP_3_1"
      ${pin('power_in', 'line', -2.54, 7.62, 270, 3.81, 'V+', '8')}
      ${pin('power_in', 'line', -2.54, -7.62, 90, 3.81, 'V-', '4')}))`,
  NAND: `(symbol "NAND" (pin_names (offset 1.016)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "U" (at 0 6.35 0) ${font()})
    (property "Value" "NAND" (at 0 -6.35 0) ${font()})
    (property "Footprint" "" (at 0 0 0) ${hidden()})
    (property "Datasheet" "~" (at 0 0 0) ${hidden()})
    (symbol "NAND_1_1"
      (arc (start 0 -3.81) (mid 3.81 0) (end 0 3.81) ${stroke(0.254)} ${fill('background')})
      (polyline (pts (xy 0 3.81) (xy -3.81 3.81) (xy -3.81 -3.81) (xy 0 -3.81)) ${stroke(0.254)} ${fill('background')})
      ${pin('input', 'line', -7.62, 2.54, 0, 3.81, '~', '1')}
      ${pin('input', 'line', -7.62, -2.54, 0, 3.81, '~', '2')}
      ${pin('output', 'inverted', 7.62, 0, 180, 3.81, '~', '3')})
    (symbol "NAND_1_2"
      (arc (start -3.81 -3.81) (mid -2.4067 0) (end -3.81 3.81) ${stroke(0.254)} ${fill('none')})
      (arc (start -0.6096 -3.81) (mid 2.1842 -2.5851) (end 3.81 0) ${stroke(0.254)} ${fill('background')})
      (polyline (pts (xy -3.81 -3.81) (xy -0.635 -3.81)) ${stroke(0.254)} ${fill('background')})
      (polyline (pts (xy -3.81 3.81) (xy -0.635 3.81)) ${stroke(0.254)} ${fill('background')})
      (arc (start 3.81 0) (mid 2.1915 2.5936) (end -0.6096 3.81) ${stroke(0.254)} ${fill('background')})
      ${pin('input', 'inverted', -7.62, 2.54, 0, 4.318, '~', '1')}
      ${pin('input', 'inverted', -7.62, -2.54, 0, 4.318, '~', '2')}
      ${pin('output', 'line', 7.62, 0, 180, 3.81, '~', '3')}))`,
  MCU: `(symbol "MCU" (pin_names (offset 1.016)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "U" (at -10.16 13.97 0) ${fontJ(1.27, 'left')})
    (property "Value" "MCU" (at 2.54 13.97 0) ${fontJ(1.27, 'left')})
    (property "Footprint" "Package_SO:SOIC-16" (at 0 -17.78 0) ${hidden()})
    (property "Datasheet" "~" (at 0 0 0) ${hidden()})
    (symbol "MCU_0_1" (rectangle (start -10.16 12.7) (end 10.16 -12.7) ${stroke(0.254)} ${fill('background')})
      (text "µC" (at 0 0 0) ${font(2)}))
    (symbol "MCU_1_1"
      ${pin('input', 'clock', -12.7, 7.62, 0, 2.54, 'CLK', '1')}
      ${pin('input', 'inverted', -12.7, 5.08, 0, 2.54, '~{RESET}', '2')}
      ${pin('input', 'input_low', -12.7, 2.54, 0, 2.54, 'EN', '3')}
      ${pin('bidirectional', 'line', -12.7, 0, 0, 2.54, 'SDA', '4')}
      ${pin('input', 'line', -12.7, -2.54, 0, 2.54, 'SCL', '5')}
      ${pin('no_connect', 'non_logic', -12.7, -5.08, 0, 2.54, 'NC', '6')}
      ${pin('output', 'line', 12.7, 7.62, 180, 2.54, 'TX', '7')}
      ${pin('input', 'line', 12.7, 5.08, 180, 2.54, 'RX', '8')}
      ${pin('output', 'output_low', 12.7, 2.54, 180, 2.54, 'IRQ', '9')}
      ${pin('tri_state', 'line', 12.7, 0, 180, 2.54, 'D0', '10')}
      ${pin('tri_state', 'line', 12.7, -2.54, 180, 2.54, 'D1', '11')}
      ${pin('power_in', 'line', 0, 15.24, 270, 2.54, 'VCC', '12')}
      ${pin('power_in', 'line', 0, -15.24, 90, 2.54, 'GND', '13')}
      ${pin('passive', 'clock_low', 5.08, -15.24, 90, 2.54, 'CK2', '14')}))`,
  GND: `(symbol "GND" (power) (pin_numbers hide) (pin_names (offset 0) hide) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "#PWR" (at 0 -6.35 0) ${hidden()})
    (property "Value" "GND" (at 0 -3.81 0) ${font()})
    (property "Footprint" "" (at 0 0 0) ${hidden()})
    (property "Datasheet" "" (at 0 0 0) ${hidden()})
    (symbol "GND_0_1" (polyline (pts (xy 0 0) (xy 0 -1.27) (xy 1.27 -1.27) (xy 0 -2.54) (xy -1.27 -1.27) (xy 0 -1.27)) ${stroke(0)} ${fill()}))
    (symbol "GND_1_1" (pin power_in line (at 0 0 270) (length 0) hide (name "GND" ${font()}) (number "1" ${font()}))))`,
  '+5V': `(symbol "+5V" (power) (pin_numbers hide) (pin_names (offset 0) hide) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "#PWR" (at 0 -3.81 0) ${hidden()})
    (property "Value" "+5V" (at 0 3.556 0) ${font()})
    (property "Footprint" "" (at 0 0 0) ${hidden()})
    (property "Datasheet" "" (at 0 0 0) ${hidden()})
    (symbol "+5V_0_1"
      (polyline (pts (xy -0.762 1.27) (xy 0 2.54)) ${stroke(0)} ${fill()})
      (polyline (pts (xy 0 0) (xy 0 2.54)) ${stroke(0)} ${fill()})
      (polyline (pts (xy 0 2.54) (xy 0.762 1.27)) ${stroke(0)} ${fill()}))
    (symbol "+5V_1_1" (pin power_in line (at 0 0 90) (length 0) hide (name "+5V" ${font()}) (number "1" ${font()}))))`,
  CONN4: `(symbol "CONN4" (pin_names (offset 1.016) hide) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "J" (at 0 5.08 0) ${font()})
    (property "Value" "CONN4" (at 0 -7.62 0) ${font()})
    (property "Footprint" "" (at 0 0 0) ${hidden()})
    (property "Datasheet" "~" (at 0 0 0) ${hidden()})
    (symbol "CONN4_1_1"
      (rectangle (start -1.27 3.81) (end 1.27 -6.35) ${stroke(0.254)} ${fill('background')})
      ${pin('passive', 'line', -5.08, 2.54, 0, 3.81, 'P1', '1')}
      ${pin('passive', 'line', -5.08, 0, 0, 3.81, 'P2', '2')}
      ${pin('passive', 'line', -5.08, -2.54, 0, 3.81, 'P3', '3')}
      ${pin('passive', 'line', -5.08, -5.08, 0, 3.81, 'P4', '4')}))`
}

// ---------------------------------------------------------------------------------------------
// Symbol library (.kicad_sym)
// ---------------------------------------------------------------------------------------------
const symLib = `(kicad_symbol_lib (version 20231120) (generator "kicad_symbol_editor") (generator_version "8.0")
  ${Object.values(LIB).join('\n  ')}
  (symbol "R_Small" (extends "R") (pin_numbers hide) (pin_names (offset 0)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 2.032 0 90) ${font()})
    (property "Value" "R_Small" (at 0 0 90) ${font()})
    (property "Footprint" "" (at 0 0 0) ${hidden()})
    (property "Datasheet" "~" (at 0 0 0) ${hidden()})
    (property "Description" "Derived resistor" (at 0 0 0) ${hidden()}))
)
`
writeFileSync(join(OUT, 'sample.kicad_sym'), symLib)

// ---------------------------------------------------------------------------------------------
// Schematic
// ---------------------------------------------------------------------------------------------
const libSyms = (names) =>
  `(lib_symbols\n${names
    .map((n) => LIB[n].replace(/^\(symbol "([^"]+)"/, (_m, s) => `(symbol "Demo:${s}"`))
    .join('\n')})`

/** lib (x, y up) → schematic for a placed symbol (same transform KiCad uses). */
function xfOf(x, y, ang, mirror) {
  const m = { 0: [1, 0, 0, -1], 90: [0, -1, -1, 0], 180: [-1, 0, 0, 1], 270: [0, 1, 1, 0] }[ang]
  let [a, b, c, d] = m
  if (mirror === 'x') [c, d] = [-c, -d]
  if (mirror === 'y') [a, b] = [-a, -b]
  return (lx, ly) => [x + a * lx + b * ly, y + c * lx + d * ly]
}

const ROOT_UUID = uuid()
const PROJECT = 'sample'

function place(lib, ref, value, x, y, { ang = 0, mirror, unit = 1, convert, extra = [], sheetUuid = ROOT_UUID, fields } = {}) {
  const libText = LIB[lib]
  const props = [...libText.matchAll(/\(property "([^"]+)" "([^"]*)" \(at ([-\d.]+) ([-\d.]+) ([-\d.]+)\) (\(effects[^\n]*\))\)/g)]
  const xf = xfOf(x, y, ang, mirror)
  const out = []
  for (const [, name, , lx, ly, la, eff] of props) {
    let val = name === 'Reference' ? ref : name === 'Value' ? value : ''
    if (fields?.[name] !== undefined) val = fields[name]
    if (name !== 'Reference' && name !== 'Value' && !fields?.[name]) val = props.find((p) => p[1] === name)[2]
    const [wx, wy] = xf(Number(lx), Number(ly))
    out.push(`(property ${q(name)} ${q(val)} (at ${r4(wx)} ${r4(wy)} ${la}) ${eff})`)
  }
  const pinNums = [...libText.matchAll(/\(number "([^"]+)"/g)].map((m) => m[1])
  return `(symbol (lib_id "Demo:${lib}") (at ${x} ${y} ${ang})${mirror ? ` (mirror ${mirror})` : ''} (unit ${unit})${convert ? ` (convert ${convert})` : ''}
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid ${q(uuid())})
    ${out.join('\n    ')}
    ${extra.join('\n    ')}
    ${pinNums.map((n) => `(pin ${q(n)} (uuid ${q(uuid())}))`).join(' ')}
    (instances (project ${q(PROJECT)} (path "/${sheetUuid}" (reference ${q(ref)}) (unit ${unit}))))
  )`
}

// Schematic wires and buses are two-point segments.
const segs = (kind, pts) =>
  pts
    .slice(1)
    .map((p, i) => `(${kind} (pts (xy ${pts[i][0]} ${pts[i][1]}) (xy ${p[0]} ${p[1]})) ${stroke(0)} (uuid ${q(uuid())}))`)
    .join('\n  ')
const wire = (...pts) => segs('wire', pts)
const bus = (...pts) => segs('bus', pts)
const junction = (x, y) => `(junction (at ${x} ${y}) (diameter 0) (color 0 0 0 0) (uuid ${q(uuid())}))`
const noConnect = (x, y) => `(no_connect (at ${x} ${y}) (uuid ${q(uuid())}))`
const label = (name, x, y, ang) => {
  const just = ang === 0 || ang === 90 ? 'left bottom' : 'right bottom'
  return `(label ${q(name)} (at ${x} ${y} ${ang}) ${fontJ(1.27, just)} (uuid ${q(uuid())}))`
}
const glabel = (name, shape, x, y, ang) => {
  const just = ang === 0 || ang === 90 ? 'left' : 'right'
  return `(global_label ${q(name)} (shape ${shape}) (at ${x} ${y} ${ang}) (fields_autoplaced yes) ${fontJ(1.27, just)} (uuid ${q(uuid())})
    (property "Intersheetrefs" "\${INTERSHEET_REFS}" (at ${x} ${y} 0) ${hidden()}))`
}
const hlabel = (name, shape, x, y, ang) => {
  const just = ang === 0 || ang === 90 ? 'left' : 'right'
  return `(hierarchical_label ${q(name)} (shape ${shape}) (at ${x} ${y} ${ang}) ${fontJ(1.27, just)} (uuid ${q(uuid())}))`
}
const text = (s, x, y, ang = 0, size = 1.27, just = 'left bottom') => `(text ${q(s)} (exclude_from_sim no) (at ${x} ${y} ${ang}) ${fontJ(size, just)} (uuid ${q(uuid())}))`

const SUB_UUID = uuid()
const sch = []
// Resistors in every orientation, plus mirrors.
const rs = [
  ['R1', 40.64, 45.72, 0],
  ['R2', 55.88, 45.72, 90],
  ['R3', 71.12, 45.72, 180],
  ['R4', 86.36, 45.72, 270],
  ['R5', 101.6, 45.72, 0, 'x'],
  ['R6', 116.84, 45.72, 90, 'y']
]
for (const [ref, x, y, ang, mirror] of rs) sch.push(place('R', ref, `${ref.slice(1)}k`, x, y, { ang, mirror }))
sch.push(place('C_Polarized', 'C1', '10u', 132.08, 45.72, {}))
sch.push(place('C_Polarized', 'C2', '100u', 147.32, 45.72, { ang: 90 }))
// Dual op-amp: units A, B and the power unit.
sch.push(place('OPAMP', 'U1', 'OPAMP', 60.96, 81.28, { unit: 1 }))
sch.push(place('OPAMP', 'U1', 'OPAMP', 101.6, 81.28, { unit: 2, mirror: 'x' }))
sch.push(place('OPAMP', 'U1', 'OPAMP', 132.08, 81.28, { unit: 3 }))
// NAND gate, normal and De Morgan body style.
sch.push(place('NAND', 'U2', 'NAND', 60.96, 116.84, { unit: 1 }))
sch.push(place('NAND', 'U3', 'NAND', 91.44, 116.84, { unit: 1, convert: 2 }))
// MCU with pin shapes on all sides.
sch.push(place('MCU', 'U4', 'MCU', 190.5, 76.2, {}))
sch.push(place('CONN4', 'J1', 'CONN4', 241.3, 73.66, { ang: 180 }))
// Power symbols.
sch.push(place('GND', '#PWR01', 'GND', 132.08, 96.52, {}))
sch.push(place('+5V', '#PWR02', '+5V', 132.08, 68.58, {}))
sch.push(place('GND', '#PWR03', 'GND', 190.5, 96.52, {}))
sch.push(place('+5V', '#PWR04', '+5V', 190.5, 55.88, {}))
// Wiring.
sch.push(wire([40.64, 49.53], [40.64, 78.74], [53.34, 78.74]))
sch.push(wire([53.34, 83.82], [45.72, 83.82], [45.72, 91.44], [68.58, 91.44], [68.58, 81.28]))
sch.push(wire([68.58, 81.28], [93.98, 81.28]))
sch.push(junction(68.58, 81.28))
sch.push(wire([93.98, 78.74], [86.36, 78.74], [86.36, 49.53]))
sch.push(wire([129.54, 73.66], [129.54, 68.58], [132.08, 68.58]))
sch.push(wire([129.54, 88.9], [129.54, 96.52], [132.08, 96.52]))
sch.push(wire([190.5, 55.88], [190.5, 60.96]))
sch.push(wire([190.5, 91.44], [190.5, 96.52]))
sch.push(wire([203.2, 83.82], [215.9, 83.82]))
sch.push(wire([203.2, 68.58], [236.22, 68.58]))
sch.push(noConnect(177.8, 71.12))
sch.push(wire([109.22, 81.28], [119.38, 81.28]))
sch.push(label('OUT_B', 109.22, 81.28, 0))
// Labels in all orientations.
sch.push(wire([160.02, 76.2], [177.8, 76.2]))
sch.push(label('SDA', 165.1, 76.2, 0))
sch.push(wire([160.02, 73.66], [177.8, 73.66]))
sch.push(label('SCL', 177.8, 73.66, 180))
sch.push(wire([154.94, 101.6], [154.94, 116.84]))
sch.push(label('V_UP', 154.94, 101.6, 90))
sch.push(label('V_DOWN', 154.94, 116.84, 270))
// Global and hierarchical labels with every shape.
const gl = [
  ['IN', 'input', 20.32, 132.08, 180],
  ['OUT', 'output', 20.32, 137.16, 180],
  ['BIDI', 'bidirectional', 20.32, 142.24, 180],
  ['TRI', 'tri_state', 20.32, 147.32, 180],
  ['PASS', 'passive', 20.32, 152.4, 180]
]
for (const [n, s, x, y, a] of gl) {
  sch.push(glabel(n, s, x, y, a))
  sch.push(wire([x, y], [x + 12.7, y]))
  sch.push(glabel(n + '_R', s, x + 12.7, y, 0))
}
sch.push(glabel('CLK', 'input', 177.8, 68.58, 180))
sch.push(hlabel('H_IN', 'input', 60.96, 152.4, 180))
sch.push(hlabel('H_OUT', 'output', 60.96, 157.48, 0))
sch.push(hlabel('H_BIDI', 'bidirectional', 76.2, 152.4, 90))
sch.push(hlabel('H_PASS', 'passive', 76.2, 165.1, 270))
// Bus with entries.
sch.push(bus([101.6, 142.24], [101.6, 162.56]))
sch.push(`(bus_entry (at 101.6 144.78) (size 2.54 2.54) ${stroke(0)} (uuid ${q(uuid())}))`)
sch.push(`(bus_entry (at 101.6 149.86) (size 2.54 2.54) ${stroke(0)} (uuid ${q(uuid())}))`)
sch.push(wire([104.14, 147.32], [114.3, 147.32]))
sch.push(wire([104.14, 152.4], [114.3, 152.4]))
sch.push(label('D0', 106.68, 147.32, 0))
sch.push(label('D1', 106.68, 152.4, 0))
sch.push(label('D[0..7]', 101.6, 142.24, 90))
// Hierarchical sheet.
sch.push(`(sheet (at 175.26 109.22) (size 30.48 20.32) (fields_autoplaced yes) ${stroke(0.1524)} (fill (color 255 255 225 1.0)) (uuid ${q(SUB_UUID)})
    (property "Sheetname" "Power supply" (at 175.26 108.5084 0) ${fontJ(1.27, 'left bottom')})
    (property "Sheetfile" "sample-power.kicad_sch" (at 175.26 130.1246 0) ${fontJ(1.27, 'left top')})
    (pin "VIN" input (at 175.26 116.84 180) ${fontJ(1.27, 'left')} (uuid ${q(uuid())}))
    (pin "VOUT" output (at 205.74 116.84 0) ${fontJ(1.27, 'right')} (uuid ${q(uuid())}))
    (pin "EN" bidirectional (at 175.26 121.92 180) ${fontJ(1.27, 'left')} (uuid ${q(uuid())}))
    (instances (project ${q(PROJECT)} (path "/${ROOT_UUID}" (page "2")))))`)
sch.push(wire([165.1, 116.84], [175.26, 116.84]))
sch.push(wire([205.74, 116.84], [215.9, 116.84]))
// Text, text box, graphics.
sch.push(text('Test notes: KiCad Preview corpus (made by hand)', 20.32, 172.72, 0, 1.524))
sch.push(text('Vertical note', 254, 121.92, 90))
sch.push(text('Line 1\nLine 2 ~{OVER} x_{sub} y^{sup}', 116.84, 172.72, 0))
sch.push(`(text_box "Text box with a border, wrapped by hand" (exclude_from_sim no) (at 223.52 149.86 0) (size 38.1 10.16) (margins 0.9525 0.9525 0.9525 0.9525) ${stroke(0.254, 'solid')} ${fill()} ${fontJ(1.27, 'left top')} (uuid ${q(uuid())}))`)
sch.push(`(rectangle (start 20.32 30.48) (end 160.02 58.42) ${stroke(0, 'dash')} ${fill()} (uuid ${q(uuid())}))`)
sch.push(`(circle (center 236.22 104.14) (radius 5.08) ${stroke(0.254, 'solid')} ${fill()} (uuid ${q(uuid())}))`)
sch.push(`(arc (start 222.25 109.22) (mid 226.06 105.41) (end 229.87 109.22) ${stroke(0.254, 'solid')} ${fill()} (uuid ${q(uuid())}))`)
sch.push(`(polyline (pts (xy 220.98 93.98) (xy 228.6 99.06) (xy 220.98 99.06)) ${stroke(0.254, 'dot')} ${fill()} (uuid ${q(uuid())}))`)

const schText = `(kicad_sch (version 20231120) (generator "eeschema") (generator_version "8.0")
  (uuid ${q(ROOT_UUID)})
  (paper "A4")
  (title_block (title "KiCad Preview test") (date "2026-11-26") (rev "A") (company "File Preview")
    (comment 1 "Hand-written corpus for the Orca File Preview plugin") (comment 2 "MIT licensed"))
  ${libSyms(Object.keys(LIB))}
  ${sch.join('\n  ')}
  (sheet_instances (path "/" (page "1")))
)
`
writeFileSync(join(OUT, 'sample.kicad_sch'), schText)

// Sub-sheet.
const sub = [
  place('R', 'R10', '1k', 101.6, 76.2, { sheetUuid: `${ROOT_UUID}/${SUB_UUID}` }),
  place('C_Polarized', 'C10', '47u', 127, 76.2, { sheetUuid: `${ROOT_UUID}/${SUB_UUID}` }),
  wire([76.2, 72.39], [101.6, 72.39]),
  wire([101.6, 80.01], [101.6, 83.82], [127, 83.82], [127, 80.01]),
  wire([127, 72.39], [127, 68.58], [149.86, 68.58]),
  hlabel('VIN', 'input', 76.2, 72.39, 180),
  hlabel('VOUT', 'output', 149.86, 68.58, 0),
  hlabel('EN', 'bidirectional', 76.2, 91.44, 180),
  wire([76.2, 91.44], [88.9, 91.44]),
  noConnect(88.9, 91.44)
]
writeFileSync(
  join(OUT, 'sample-power.kicad_sch'),
  `(kicad_sch (version 20231120) (generator "eeschema") (generator_version "8.0")
  (uuid ${q(uuid())})
  (paper "A5")
  (title_block (title "Power supply") (rev "A"))
  ${libSyms(['R', 'C_Polarized'])}
  ${sub.join('\n  ')}
)
`
)

// ---------------------------------------------------------------------------------------------
// Board (4 layers)
// ---------------------------------------------------------------------------------------------
const NETS = ['', 'GND', '+5V', 'SIG', 'SDA', 'SCL']
const net = (name) => `(net ${NETS.indexOf(name)} ${q(name)})`
/** Tracks, vias and zones carry the net number only. */
const netN = (name) => `(net ${NETS.indexOf(name)})`
const fpProp = (name, value, x, y, layer, { hide = false, size = 1, thick = 0.15, ang = 0, mirror = false } = {}) =>
  `(property ${q(name)} ${q(value)} (at ${x} ${y} ${ang}) (layer ${q(layer)})${hide ? ' hide' : ''} (uuid ${q(uuid())}) (effects (font (size ${size} ${size}) (thickness ${thick}))${mirror ? ' (justify mirror)' : ''}))`
const fpLine = (x0, y0, x1, y1, layer, w = 0.12) => `(fp_line (start ${x0} ${y0}) (end ${x1} ${y1}) (stroke (width ${w}) (type solid)) (layer ${q(layer)}) (uuid ${q(uuid())}))`
const fpRect = (x0, y0, x1, y1, layer, w = 0.05) => `(fp_rect (start ${x0} ${y0}) (end ${x1} ${y1}) (stroke (width ${w}) (type solid)) (fill none) (layer ${q(layer)}) (uuid ${q(uuid())}))`
const fpCircle = (cx, cy, r, layer, w = 0.12) => `(fp_circle (center ${cx} ${cy}) (end ${cx + r} ${cy}) (stroke (width ${w}) (type solid)) (fill none) (layer ${q(layer)}) (uuid ${q(uuid())}))`

function footprint(name, ref, value, x, y, ang, items, { side = 'F' } = {}) {
  const B = side === 'B'
  const L = (l) => (B ? l.replace(/^F\./, 'B.') : l)
  return `(footprint ${q(name)} (layer ${q(L('F.Cu'))}) (uuid ${q(uuid())}) (at ${x} ${y}${ang ? ' ' + ang : ''})
    ${fpProp('Reference', ref, 0, -2, L('F.SilkS'), { ang, mirror: B })}
    ${fpProp('Value', value, 0, 2, L('F.Fab'), { ang, mirror: B })}
    ${fpProp('Footprint', name, 0, 0, L('F.Fab'), { hide: true })}
    ${fpProp('Datasheet', '', 0, 0, L('F.Fab'), { hide: true })}
    ${items.map((s) => (B ? s.replace(/"F\.(SilkS|Fab|CrtYd|Paste|Mask|Cu)"/g, '"B.$1"') : s)).join('\n    ')}
  )`
}
const pad = (n, type, shape, x, y, ang, w, h, layers, extra = '') =>
  `(pad ${q(n)} ${type} ${shape} (at ${x} ${y}${ang ? ' ' + ang : ''}) (size ${w} ${h})${extra} (layers ${layers.map(q).join(' ')}) (uuid ${q(uuid())}))`
const SMD = ['F.Cu', 'F.Paste', 'F.Mask']
const THT = ['*.Cu', '*.Mask']

const r0805 = (ref, x, y, ang, n1, n2, side) =>
  footprint(
    'Resistor_SMD:R_0805_2012Metric',
    ref,
    '10k',
    x,
    y,
    ang,
    [
      pad('1', 'smd', 'roundrect', -0.9125, 0, ang, 1.025, 1.4, SMD, ` (roundrect_rratio 0.243902) ${net(n1)}`),
      pad('2', 'smd', 'roundrect', 0.9125, 0, ang, 1.025, 1.4, SMD, ` (roundrect_rratio 0.243902) ${net(n2)}`),
      fpLine(-0.227064, -0.735, 0.227064, -0.735, 'F.SilkS'),
      fpLine(-0.227064, 0.735, 0.227064, 0.735, 'F.SilkS'),
      fpRect(-1.68, -0.95, 1.68, 0.95, 'F.CrtYd'),
      fpRect(-1, -0.625, 1, 0.625, 'F.Fab', 0.1)
    ],
    { side }
  )

const soicPads = []
for (let i = 0; i < 4; i++) {
  soicPads.push(pad(String(i + 1), 'smd', 'roundrect', -2.475, -1.905 + i * 1.27, 0, 1.95, 0.6, SMD, ` (roundrect_rratio 0.25) ${net(i === 3 ? 'GND' : 'SIG')}`))
  soicPads.push(pad(String(8 - i), 'smd', 'roundrect', 2.475, -1.905 + i * 1.27, 0, 1.95, 0.6, SMD, ` (roundrect_rratio 0.25) ${net(i === 0 ? '+5V' : 'SDA')}`))
}
const soic = footprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', 'U1', 'MCU', 130, 80, 0, [
  ...soicPads,
  fpLine(0, -2.56, -3.45, -2.56, 'F.SilkS'),
  fpLine(0, 2.56, 1.95, 2.56, 'F.SilkS'),
  fpLine(0, -2.56, 1.95, -2.56, 'F.SilkS'),
  fpLine(0, 2.56, -1.95, 2.56, 'F.SilkS'),
  fpRect(-3.7, -2.7, 3.7, 2.7, 'F.CrtYd'),
  fpLine(-0.975, -2.45, 1.95, -2.45, 'F.Fab', 0.1),
  fpLine(1.95, -2.45, 1.95, 2.45, 'F.Fab', 0.1),
  fpLine(1.95, 2.45, -1.95, 2.45, 'F.Fab', 0.1),
  fpLine(-1.95, 2.45, -1.95, -1.475, 'F.Fab', 0.1),
  fpLine(-1.95, -1.475, -0.975, -2.45, 'F.Fab', 0.1),
  `(fp_text user "\${REFERENCE}" (at 0 0 0) (layer "F.Fab") (uuid ${q(uuid())}) (effects (font (size 0.98 0.98) (thickness 0.15))))`
])

const conn = footprint('Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', 'J1', 'Conn', 105, 76.19, 90, [
  pad('1', 'thru_hole', 'rect', 0, 0, 90, 1.7, 1.7, THT, ` (drill 1) ${net('+5V')}`),
  pad('2', 'thru_hole', 'oval', 0, 2.54, 90, 1.7, 1.7, THT, ` (drill 1) ${net('GND')}`),
  pad('3', 'thru_hole', 'oval', 0, 5.08, 90, 2.4, 1.7, THT, ` (drill 1) ${net('SDA')}`),
  pad('4', 'thru_hole', 'circle', 0, 7.62, 90, 1.7, 1.7, THT, ` (drill 1) ${net('SCL')}`),
  fpLine(-1.33, 8.95, 1.33, 8.95, 'F.SilkS'),
  fpLine(-1.33, 1.27, -1.33, 8.95, 'F.SilkS'),
  fpLine(1.33, 1.27, 1.33, 8.95, 'F.SilkS'),
  fpLine(-1.33, 0, -1.33, -1.33, 'F.SilkS'),
  fpLine(-1.33, -1.33, 0, -1.33, 'F.SilkS'),
  fpRect(-1.8, -1.8, 1.8, 9.4, 'F.CrtYd')
])

const odd = footprint('Demo:OddPads', 'X1', 'ODD', 145, 92, 30, [
  pad('1', 'smd', 'trapezoid', -3, 0, 30, 1.5, 2, SMD, ` (rect_delta 0 0.6) ${net('SIG')}`),
  pad('2', 'smd', 'roundrect', 0, 0, 30, 1.6, 1.6, SMD, ` (roundrect_rratio 0) (chamfer_ratio 0.25) (chamfer top_left bottom_right) ${net('SIG')}`),
  pad('3', 'smd', 'custom', 3, 0, 30, 0.8, 0.8, SMD, ` (options (clearance outline) (anchor circle)) (primitives (gr_poly (pts (xy -0.4 -0.4) (xy 1.6 -1) (xy 1.6 1) (xy -0.4 0.4)) (width 0) (fill yes))) ${net('SIG')}`),
  pad('4', 'thru_hole', 'oval', 0, 3, 30, 2.4, 1.4, THT, ` (drill oval 1.6 0.8) ${net('GND')}`),
  pad('5', 'thru_hole', 'circle', -3, 3, 30, 1.6, 1.6, THT, ` (drill 0.8 (offset 0.2 0)) ${net('GND')}`),
  fpCircle(0, 0, 5, 'F.Fab', 0.1),
  `(fp_arc (start -4 -4) (mid 0 -5.656854) (end 4 -4) (stroke (width 0.12) (type solid)) (layer "F.SilkS") (uuid ${q(uuid())}))`,
  `(fp_poly (pts (xy 4.5 -4.5) (xy 5.5 -4.5) (xy 5.5 -3.5)) (stroke (width 0.1) (type solid)) (fill solid) (layer "F.SilkS") (uuid ${q(uuid())}))`
])

const hole = footprint('MountingHole:MountingHole_3.2mm_M3', 'H1', 'M3', 96, 71, 0, [
  pad('', 'np_thru_hole', 'circle', 0, 0, 0, 3.2, 3.2, ['*.Cu', '*.Mask'], ' (drill 3.2)'),
  fpCircle(0, 0, 3.2, 'Cmts.User', 0.15)
])

const board = []
board.push(r0805('R1', 115, 76, 0, '+5V', 'SIG'))
board.push(r0805('R2', 120, 86, 90, 'SIG', 'GND'))
board.push(r0805('R3', 140, 76, 45, 'SDA', '+5V'))
board.push(r0805('C1', 125, 94, 180, 'GND', '+5V', 'B'))
board.push(soic, conn, odd, hole)
// Tracks.
const seg = (x0, y0, x1, y1, w, layer, n) => `(segment (start ${x0} ${y0}) (end ${x1} ${y1}) (width ${w}) (layer ${q(layer)}) ${netN(n)} (uuid ${q(uuid())}))`
board.push(seg(105, 76.19, 114.0875, 76, 0.4, 'F.Cu', '+5V'))
board.push(seg(115.9125, 76, 120, 76, 0.25, 'F.Cu', 'SIG'))
board.push(seg(120, 76, 120, 85.0875, 0.25, 'F.Cu', 'SIG'))
board.push(seg(127.525, 78.095, 124, 78.095, 0.25, 'F.Cu', 'SIG'))
board.push(seg(124, 78.095, 120, 82, 0.25, 'F.Cu', 'SIG'))
board.push(seg(132.475, 78.095, 136, 78.095, 0.4, 'F.Cu', '+5V'))
board.push(`(arc (start 136 78.095) (mid 139.2 79.4) (end 140.5 82.6) (width 0.4) (layer "F.Cu") ${netN('+5V')} (uuid ${q(uuid())}))`)
board.push(seg(140.5, 82.6, 140.5, 88, 0.4, 'F.Cu', '+5V'))
board.push(`(via (at 140.5 88) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") ${netN('+5V')} (uuid ${q(uuid())}))`)
board.push(seg(140.5, 88, 126, 94, 0.4, 'B.Cu', '+5V'))
board.push(seg(107.54, 76.19, 107.54, 84, 0.3, 'B.Cu', 'GND'))
board.push(seg(107.54, 84, 116, 90, 0.3, 'In2.Cu', 'GND'))
board.push(`(via (at 107.54 84) (size 0.6) (drill 0.3) (layers "B.Cu" "In2.Cu") ${netN('GND')} (uuid ${q(uuid())}))`)
board.push(`(via (at 116 90) (size 0.6) (drill 0.3) (layers "In2.Cu" "B.Cu") ${netN('GND')} (uuid ${q(uuid())}))`)
board.push(`(via micro (at 128 84) (size 0.3) (drill 0.1) (layers "F.Cu" "In1.Cu") ${netN('SDA')} (uuid ${q(uuid())}))`)
board.push(seg(110.08, 76.19, 110.08, 70, 0.25, 'In1.Cu', 'SDA'))
board.push(seg(110.08, 70, 128, 70, 0.25, 'In1.Cu', 'SDA'))
board.push(seg(128, 70, 128, 84, 0.25, 'In1.Cu', 'SDA'))
// Zone with its fill (as KiCad stores it).
board.push(`(zone ${netN('GND')} (net_name "GND") (layer "B.Cu") (uuid ${q(uuid())}) (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 92 99) (xy 150 99) (xy 150 104) (xy 92 104)))
    (filled_polygon (layer "B.Cu") (pts (xy 92.5 99.5) (xy 149.5 99.5) (xy 149.5 103.5) (xy 122 103.5) (xy 121 102) (xy 119 102) (xy 118 103.5) (xy 92.5 103.5))))`)
board.push(`(zone ${netN('+5V')} (net_name "+5V") (layer "In1.Cu") (uuid ${q(uuid())}) (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 135 66) (xy 150 66) (xy 150 72) (xy 135 72)))
    (filled_polygon (layer "In1.Cu") (pts (xy 135.5 66.5) (xy 149.5 66.5) (xy 149.5 71.5) (xy 135.5 71.5))))`)
// Outline with rounded corners.
const gl2 = (x0, y0, x1, y1) => `(gr_line (start ${x0} ${y0}) (end ${x1} ${y1}) (stroke (width 0.1) (type default)) (layer "Edge.Cuts") (uuid ${q(uuid())}))`
const garc = (s, m, e) => `(gr_arc (start ${s.join(' ')}) (mid ${m.join(' ')}) (end ${e.join(' ')}) (stroke (width 0.1) (type default)) (layer "Edge.Cuts") (uuid ${q(uuid())}))`
const k = 2 - Math.SQRT1_2 * 2
board.push(gl2(92, 66, 150, 66), gl2(152, 68, 152, 103), gl2(150, 105, 92, 105), gl2(90, 103, 90, 68))
board.push(garc([150, 66], [150 + 2 - k, 66 + k], [152, 68]), garc([152, 103], [152 - k, 105 - k], [150, 105]))
board.push(garc([92, 105], [90 + k, 105 - k], [90, 103]), garc([90, 68], [90 + k, 66 + k], [92, 66]))
// Board graphics and text.
board.push(`(gr_text "KiCad Preview" (at 120 69 0) (layer "F.SilkS") (uuid ${q(uuid())}) (effects (font (size 1.5 1.5) (thickness 0.3) bold)))`)
board.push(`(gr_text "BACK SIDE" (at 120 97 0) (layer "B.SilkS") (uuid ${q(uuid())}) (effects (font (size 1.2 1.2) (thickness 0.18)) (justify mirror)))`)
board.push(`(gr_text "Cu text" (at 98 96 90) (layer "F.Cu") (uuid ${q(uuid())}) (effects (font (size 1 1) (thickness 0.2)) (justify left)))`)
board.push(`(gr_circle (center 146 70) (end 147.5 70) (stroke (width 0.15) (type default)) (fill none) (layer "Dwgs.User") (uuid ${q(uuid())}))`)
board.push(`(gr_poly (pts (xy 92.5 100) (xy 95 100) (xy 93.75 102.2)) (stroke (width 0.1) (type solid)) (fill solid) (layer "F.SilkS") (uuid ${q(uuid())}))`)
board.push(`(gr_rect (start 144 95) (end 149 98) (stroke (width 0.1) (type default)) (fill none) (layer "Cmts.User") (uuid ${q(uuid())}))`)

const pcbText = `(kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (title_block (title "KiCad Preview test board") (date "2026-11-26") (rev "A") (company "File Preview"))
  (layers
    (0 "F.Cu" signal) (1 "In1.Cu" power) (2 "In2.Cu" signal) (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive") (33 "F.Adhes" user "F.Adhesive")
    (34 "B.Paste" user) (35 "F.Paste" user)
    (36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user) (39 "F.Mask" user)
    (40 "Dwgs.User" user "User.Drawings") (41 "Cmts.User" user "User.Comments")
    (42 "Eco1.User" user "User.Eco1") (43 "Eco2.User" user "User.Eco2")
    (44 "Edge.Cuts" user) (45 "Margin" user)
    (46 "B.CrtYd" user "B.Courtyard") (47 "F.CrtYd" user "F.Courtyard")
    (48 "B.Fab" user) (49 "F.Fab" user))
  (setup (pad_to_mask_clearance 0) (allow_soldermask_bridges_in_footprints no))
  ${NETS.map((n, i) => `(net ${i} ${q(n)})`).join('\n  ')}
  ${board.join('\n  ')}
)
`
writeFileSync(join(OUT, 'sample.kicad_pcb'), pcbText)

// ---------------------------------------------------------------------------------------------
// Footprint (.kicad_mod): QFN-16 with an exposed pad and thermal vias
// ---------------------------------------------------------------------------------------------
const qfn = []
for (let side = 0; side < 4; side++) {
  for (let i = 0; i < 4; i++) {
    const n = side * 4 + i + 1
    const o = -0.975 + i * 0.65
    const [x, y, a] = [
      [-1.9, o, 0],
      [o, 1.9, 90],
      [1.9, -o, 0],
      [-o, -1.9, 90]
    ][side]
    qfn.push(pad(String(n), 'smd', 'roundrect', x, y, a, 0.8, 0.3, SMD, ' (roundrect_rratio 0.25)'))
  }
}
qfn.push(pad('17', 'smd', 'rect', 0, 0, 0, 2.1, 2.1, ['F.Cu', 'F.Mask']))
for (const [x, y] of [
  [-0.5, -0.5],
  [0.5, -0.5],
  [-0.5, 0.5],
  [0.5, 0.5]
])
  qfn.push(pad('17', 'thru_hole', 'circle', x, y, 0, 0.5, 0.5, ['*.Cu'], ' (drill 0.2)'))
for (const [x, y] of [
  [-0.5, -0.5],
  [0.5, -0.5],
  [-0.5, 0.5],
  [0.5, 0.5]
])
  qfn.push(pad('', 'smd', 'roundrect', x * 1.0, y * 1.0, 0, 0.85, 0.85, ['F.Paste'], ' (roundrect_rratio 0.25)'))
const modText = `(footprint "QFN-16-1EP_3x3mm_P0.65mm" (version 20240108) (generator "pcbnew") (generator_version "8.0")
  (layer "F.Cu")
  (descr "QFN, 16 pins, 3x3 mm body, 0.65 mm pitch, exposed pad with thermal vias (test footprint)")
  (tags "QFN NoLead")
  ${fpProp('Reference', 'REF**', 0, -2.8, 'F.SilkS')}
  ${fpProp('Value', 'QFN-16-1EP_3x3mm_P0.65mm', 0, 2.8, 'F.Fab')}
  ${fpProp('Footprint', '', 0, 0, 'F.Fab', { hide: true })}
  ${fpProp('Datasheet', '', 0, 0, 'F.Fab', { hide: true })}
  (attr smd)
  ${fpLine(1.135, -1.61, 1.61, -1.61, 'F.SilkS')}
  ${fpLine(1.61, -1.61, 1.61, -1.135, 'F.SilkS')}
  ${fpLine(-1.135, 1.61, -1.61, 1.61, 'F.SilkS')}
  ${fpLine(-1.61, 1.61, -1.61, 1.135, 'F.SilkS')}
  ${fpLine(1.135, 1.61, 1.61, 1.61, 'F.SilkS')}
  ${fpLine(1.61, 1.61, 1.61, 1.135, 'F.SilkS')}
  ${fpLine(-1.135, -1.61, -1.61, -1.61, 'F.SilkS')}
  (fp_poly (pts (xy -1.9 -1.61) (xy -2.14 -1.94) (xy -1.66 -1.94)) (stroke (width 0.12) (type solid)) (fill solid) (layer "F.SilkS") (uuid ${q(uuid())}))
  ${fpRect(-2.1, -2.1, 2.1, 2.1, 'F.CrtYd')}
  ${fpLine(-0.75, -1.5, 1.5, -1.5, 'F.Fab', 0.1)}
  ${fpLine(1.5, -1.5, 1.5, 1.5, 'F.Fab', 0.1)}
  ${fpLine(1.5, 1.5, -1.5, 1.5, 'F.Fab', 0.1)}
  ${fpLine(-1.5, 1.5, -1.5, -0.75, 'F.Fab', 0.1)}
  ${fpLine(-1.5, -0.75, -0.75, -1.5, 'F.Fab', 0.1)}
  (fp_text user "\${REFERENCE}" (at 0 0 0) (layer "F.Fab") (uuid ${q(uuid())}) (effects (font (size 0.75 0.75) (thickness 0.11))))
  ${qfn.join('\n  ')}
)
`
writeFileSync(join(OUT, 'sample.kicad_mod'), modText)
// The footprint also as a one-entry .pretty library for `kicad-cli fp export svg`.
mkdirSync(join(ROOT, '.orca', 'kicad', 'Demo.pretty'), { recursive: true })
writeFileSync(join(ROOT, '.orca', 'kicad', 'Demo.pretty', 'QFN-16-1EP_3x3mm_P0.65mm.kicad_mod'), modText)

// ---------------------------------------------------------------------------------------------
// Project (.kicad_pro)
// ---------------------------------------------------------------------------------------------
const pro = {
  board: {
    design_settings: {
      defaults: { board_outline_line_width: 0.1, copper_line_width: 0.2, copper_text_size_h: 1.5, copper_text_size_v: 1.5, copper_text_thickness: 0.3, silk_line_width: 0.12, silk_text_size_h: 1, silk_text_size_v: 1, silk_text_thickness: 0.15 },
      diff_pair_dimensions: [{ gap: 0, via_gap: 0, width: 0 }, { gap: 0.15, via_gap: 0.25, width: 0.2 }],
      meta: { version: 2 },
      rule_severities: { clearance: 'error', silk_overlap: 'warning', footprint_type_mismatch: 'ignore' },
      rules: { min_clearance: 0.15, min_copper_edge_clearance: 0.3, min_hole_clearance: 0.25, min_hole_to_hole: 0.25, min_microvia_diameter: 0.2, min_microvia_drill: 0.1, min_through_hole_diameter: 0.3, min_track_width: 0.15, min_via_annular_width: 0.1, min_via_diameter: 0.5, use_height_for_length_calcs: true },
      track_widths: [0, 0.25, 0.4, 0.8],
      via_dimensions: [{ diameter: 0, drill: 0 }, { diameter: 0.6, drill: 0.3 }, { diameter: 0.8, drill: 0.4 }]
    }
  },
  boards: [],
  erc: { rule_severities: { pin_not_connected: 'error', pin_not_driven: 'error', power_pin_not_driven: 'error', unconnected_wire_endpoint: 'warning', lib_symbol_issues: 'warning' } },
  libraries: { pinned_footprint_libs: ['Demo'], pinned_symbol_libs: ['Demo'] },
  meta: { filename: 'sample.kicad_pro', version: 1 },
  net_settings: {
    classes: [
      { bus_width: 12, clearance: 0.2, diff_pair_gap: 0.25, diff_pair_via_gap: 0.25, diff_pair_width: 0.2, line_style: 0, microvia_diameter: 0.3, microvia_drill: 0.1, name: 'Default', pcb_color: 'rgba(0, 0, 0, 0.000)', schematic_color: 'rgba(0, 0, 0, 0.000)', track_width: 0.25, via_diameter: 0.8, via_drill: 0.4, wire_width: 6 },
      { bus_width: 12, clearance: 0.3, diff_pair_gap: 0.25, diff_pair_via_gap: 0.25, diff_pair_width: 0.2, line_style: 0, microvia_diameter: 0.3, microvia_drill: 0.1, name: 'Power', pcb_color: 'rgba(200, 50, 50, 1.000)', schematic_color: 'rgba(180, 0, 0, 1.000)', track_width: 0.5, via_diameter: 1, via_drill: 0.5, wire_width: 10 }
    ],
    meta: { version: 3 },
    net_colors: null,
    netclass_assignments: null,
    netclass_patterns: [{ netclass: 'Power', pattern: '+5V' }, { netclass: 'Power', pattern: 'GND' }]
  },
  pcbnew: { last_paths: {}, page_layout_descr_file: '' },
  schematic: {
    annotate_start_num: 0,
    drawing: { dashed_lines_dash_length_ratio: 12, dashed_lines_gap_length_ratio: 3, default_line_thickness: 6, default_text_size: 50, field_names: [{ name: 'MPN', url: false, visible: false }], intersheets_ref_show: false, junction_size_choice: 3, label_size_ratio: 0.375, pin_symbol_size: 25, text_offset_ratio: 0.15 },
    legacy_lib_dir: '',
    legacy_lib_list: [],
    meta: { version: 1 },
    net_format_name: '',
    page_layout_descr_file: '',
    plot_directory: '',
    subpart_first_id: 65,
    subpart_id_separator: 0
  },
  sheets: [
    [ROOT_UUID, 'Root'],
    [SUB_UUID, 'Power supply']
  ],
  text_variables: { BOARD_REV: 'A', VENDOR: 'File Preview <test>' }
}
writeFileSync(join(OUT, 'sample.kicad_pro'), JSON.stringify(pro, null, 2) + '\n')

// ---------------------------------------------------------------------------------------------
// Broken files: must end in a friendly error, never hang.
// ---------------------------------------------------------------------------------------------
writeFileSync(join(OUT, 'broken.kicad_sch'), schText.slice(0, Math.floor(schText.length / 2)))
writeFileSync(join(OUT, 'broken.kicad_pcb'), 'EESchema Schematic File Version 4\nthis is not an S-expression\n')
writeFileSync(join(OUT, 'broken.kicad_pro'), '{ "meta": { "filename": "broken.kicad_pro", ')
writeFileSync(join(OUT, 'broken.kicad_sym'), '(kicad_symbol_lib (version 20231120) (generator "x"))\n')
writeFileSync(join(OUT, 'broken.kicad_mod'), '(kicad_wks (version 20231120))\n')
console.log('wrote samples/*.kicad_*')
