import { assert, test } from 'orca/testing'
import { buildHierarchy, flatten, joinSheetPath, missingSheets, projectTextVars, projectWorksheet, refLookup, rootTables, sheetEntries } from './hierarchy.ts'
import { buildSchematic } from './sch.ts'
import { Scene } from './scene.ts'
import { parseSexpr, type SList } from './sexpr.ts'
import { drawWorksheet, expandWksText, incrementLabel, isWorksheet } from './wks.ts'

const tr = (_ko: string, en: string) => en
const R = 'r00t'
const A = 'aaaa'
const B = 'bbbb'
const P = 'pppp'

const sheet = (uuid: string, name: string, file: string, page: string, parent = `/${R}`) =>
  `(sheet (at 10 10) (size 20 10) (uuid "${uuid}") (property "Sheetname" "${name}") (property "Sheetfile" "${file}") (instances (project "p" (path "${parent}" (page "${page}")))))`

// KiCad 7+: references live on each placed symbol, keyed by the sheet instance path.
const ROOT7 = `(kicad_sch (version 20231120) (uuid "${R}") (paper "A4") ${sheet(A, 'Channel A', 'channel.kicad_sch', '2')} ${sheet(B, 'Channel B', 'channel.kicad_sch', '3')} ${sheet(P, 'Power', 'sub/power.kicad_sch', '4')} (sheet_instances (path "/" (page "1"))))`
const CHANNEL7 = `(kicad_sch (version 20231120) (uuid "c1") (paper "A4")
  (symbol (lib_id "X:R") (at 60 70 0) (unit 1) (uuid "s1") (property "Reference" "R?" (at 62 70 0)) (property "Value" "10k" (at 62 72 0))
    (instances (project "p" (path "/${R}/${A}" (reference "R101") (unit 1)) (path "/${R}/${B}" (reference "R201") (unit 2))))))`
const POWER7 = `(kicad_sch (version 20231120) (uuid "p1") ${sheet('rrrr', 'Regulator', 'regulator.kicad_sch', '5', `/${R}/${P}`)} ${sheet('mmmm', 'Gone', 'gone.kicad_sch', '6', `/${R}/${P}`)})`
const REG7 = `(kicad_sch (version 20231120) (uuid "g1"))`

const files: Record<string, string> = { 'channel.kicad_sch': CHANNEL7, 'sub/power.kicad_sch': POWER7, 'sub/regulator.kicad_sch': REG7 }
const loader = async (f: string) => (files[f] ? { root: parseSexpr(files[f]), source: f } : null)

test('builds the sheet tree with pages, paths and missing sheets', async () => {
  const top = await buildHierarchy(parseSexpr(ROOT7), '', loader)
  const all = flatten(top)
  assert.deepEqual(
    all.map((n) => [n.sheetPath, n.page, n.missing]),
    [
      ['/', '1', false],
      ['/Channel A/', '2', false],
      ['/Channel B/', '3', false],
      ['/Power/', '4', false],
      ['/Power/Regulator/', '5', false],
      ['/Power/Gone/', '6', true]
    ]
  )
  // A sub-sheet in a sub-folder references its neighbours relative to itself.
  assert.equal(all[4].file, 'sub/regulator.kicad_sch')
  assert.equal(all[4].path, `/${R}/${P}/rrrr`)
  assert.equal(all[4].chain, `/${P}/rrrr`)
  assert.deepEqual(
    missingSheets(top).map((n) => n.file),
    ['sub/gone.kicad_sch']
  )
})

test('instance-specific references (KiCad 7+) reach the drawing', async () => {
  const root = parseSexpr(ROOT7)
  const top = await buildHierarchy(root, '', loader)
  const [, a, b] = flatten(top)
  const sym = (parseSexpr(CHANNEL7).find((x) => Array.isArray(x) && x[0] === 'symbol') as SList)!
  assert.deepEqual(refLookup(root, a)(sym), { ref: 'R101', unit: 1 })
  assert.deepEqual(refLookup(root, b)(sym), { ref: 'R201', unit: 2 })
  const model = buildSchematic(b.root!, tr, { refFor: refLookup(root, b) })
  const hit = model.hit(62, 70, 2)
  assert.ok(hit && hit.title.startsWith('R201'), hit?.title)
  const plain = buildSchematic(b.root!, tr)
  assert.ok(plain.hit(62, 70, 2)?.title.startsWith('R?'))
})

test('KiCad 6 roots keep references and pages in symbol_instances / sheet_instances', async () => {
  const root6 = parseSexpr(`(kicad_sch (version 20211123) (uuid "${R}")
    (sheet (at 1 1) (size 5 5) (uuid "${A}") (property "Sheet name" "Left") (property "Sheet file" "half.kicad_sch"))
    (sheet (at 9 1) (size 5 5) (uuid "${B}") (property "Sheet name" "Right") (property "Sheet file" "half.kicad_sch"))
    (sheet_instances (path "/" (page "1")) (path "/${A}/" (page "7")) (path "/${B}/" (page "8")))
    (symbol_instances (path "/${A}/s9" (reference "U1") (unit 1)) (path "/${B}/s9" (reference "U2") (unit 1))))`)
  const half = `(kicad_sch (version 20211123) (uuid "h") (symbol (lib_id "X:U") (at 5 5 0) (uuid "s9") (property "Reference" "U?" (at 5 5 0))))`
  const t = rootTables(root6)
  assert.equal(t.pages.get(`/${B}`), '8')
  assert.deepEqual(
    sheetEntries(root6, `/${R}`, '', t.pages).map((s) => [s.name, s.page]),
    [
      ['Left', '7'],
      ['Right', '8']
    ]
  )
  const top = await buildHierarchy(root6, '', async () => ({ root: parseSexpr(half), source: 'half.kicad_sch' }))
  const sym = parseSexpr(half)[3] as SList
  assert.equal(refLookup(root6, top.children[1])(sym)?.ref, 'U2')
  assert.equal(refLookup(root6, top.children[0])(sym)?.ref, 'U1')
})

test('a sheet that includes itself stops with an error', async () => {
  const self = `(kicad_sch (uuid "${R}") ${sheet(A, 'Again', 'loop.kicad_sch', '2')})`
  const top = await buildHierarchy(parseSexpr(self), 'loop.kicad_sch', async () => ({ root: parseSexpr(self), source: 'loop.kicad_sch' }))
  assert.equal(top.children[0].error, 'recursive')
  assert.equal(joinSheetPath('a/b/c.kicad_sch', 'd.kicad_sch'), 'a/b/d.kicad_sch')
  assert.equal(joinSheetPath('', 'd.kicad_sch'), 'd.kicad_sch')
})

test('.kicad_pro names the drawing sheet and text variables', () => {
  const pro = JSON.stringify({ schematic: { page_layout_descr_file: '${KIPRJMOD}/frames/my.kicad_wks' }, pcbnew: { page_layout_descr_file: 'b.kicad_wks' }, text_variables: { CODE: 'X1', N: 3 } })
  assert.equal(projectWorksheet(pro, 'sch'), 'frames/my.kicad_wks')
  assert.equal(projectWorksheet(pro, 'pcb'), 'b.kicad_wks')
  assert.deepEqual(projectTextVars(pro), { CODE: 'X1' })
  assert.equal(projectWorksheet('not json', 'sch'), '')
})

test('drawing sheet: corners, repeats, labels, variables and page-1 options', () => {
  const wks = parseSexpr(`(kicad_wks (version 20231118)
    (setup (textsize 1.5 1.5) (linewidth 0.15) (textlinewidth 0.15) (left_margin 10) (right_margin 10) (top_margin 10) (bottom_margin 10))
    (rect (start 0 0 ltcorner) (end 0 0))
    (line (start 50 0 ltcorner) (end 50 2 ltcorner) (repeat 100) (incrx 50))
    (tbtext "1" (pos 25 1 ltcorner) (repeat 100) (incrx 50))
    (tbtext "\${TITLE} \${CODE} \${#}/\${##} %R" (pos 100 10))
    (tbtext "only first" (pos 100 20) (option page1only)))`)
  assert.ok(isWorksheet(wks))
  const paper = { name: 'A4', w: 297, h: 210 }
  const tb = { title: 'T', date: 'D', rev: 'B', company: 'C', comments: [] }
  const s1 = new Scene()
  const n1 = drawWorksheet(s1.layer('border'), wks, { paper, tb, page: '1', pages: '5', project: { CODE: 'FP' } }, true)
  const s2 = new Scene()
  const n2 = drawWorksheet(s2.layer('border'), wks, { paper, tb, page: '2', pages: '5' }, false)
  // Frame 1 + lines at x=60..260 (5, stop at the right margin) + labels 1..6 (centres 35..285) + title + page-1 text.
  assert.equal(n1, 1 + 5 + 6 + 1 + 1)
  assert.equal(n2, n1 - 1)
  const b = s1.layer('border').box
  assert.ok(b.x0 >= 9.9 && b.x1 <= 287.1 && b.y0 >= 9.9 && b.y1 <= 200.1, JSON.stringify(b))
  assert.equal(expandWksText('${TITLE} ${CODE} ${#}/${##} %R %C0', { paper, tb: { ...tb, comments: ['c0'] }, page: '3', pages: '5', project: { CODE: 'FP' } }), 'T FP 3/5 B c0')
  assert.equal(incrementLabel('A', 2), 'C')
  assert.equal(incrementLabel('9', 1), '10')
  assert.equal(incrementLabel('Z', 1), 'A')
})
