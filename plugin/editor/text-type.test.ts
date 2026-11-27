import { assert, test } from 'orca/testing'
import { RENDERERS, textType } from './app.ts'
import manifest from '../orca-plugin.json' with { type: 'json' }

const t = (family: string, text: string): string => textType(family, new TextEncoder().encode(text))

test('text documents: the suffix comes from the family and the content', () => {
  assert.equal(t('robot', '<?xml version="1.0"?>\n<robot name="arm"><link name="a"/></robot>'), 'urdf')
  assert.equal(t('robot', '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="r">'), 'xacro')
  assert.equal(t('kicad', '(kicad_sch (version 20231120)'), 'kicad_sch')
  assert.equal(t('kicad', '(kicad_pcb (version 20240108)'), 'kicad_pcb')
  assert.equal(t('kicad', '(kicad_symbol_lib (version 20231120)'), 'kicad_sym')
  assert.equal(t('kicad', '(footprint "R_0603"'), 'kicad_mod')
  assert.equal(t('kicad', '{ "board": {}, "meta": { "filename": "x.kicad_pro" } }'), 'kicad_pro')
  assert.equal(t('model3d', 'ISO-10303-21;\nHEADER;'), 'step')
  assert.equal(t('model3d', 'DBRep_DrawableShape\n'), 'brep')
  assert.equal(t('model3d', 'ply\nformat ascii 1.0\n'), 'ply')
  assert.equal(t('model3d', 'OFF\n8 6 0\n'), 'off')
  assert.equal(t('model3d', '<?xml version="1.0"?><COLLADA xmlns="x">'), 'dae')
  assert.equal(t('model3d', '{ "asset": { "version": "2.0" } }'), 'gltf')
  assert.equal(t('model3d', '; FBX 7.4.0 project file\n'), 'fbx')
  assert.equal(t('model3d', 'solid cube\n facet normal 0 0 1\n'), 'stl')
  assert.equal(t('model3d', 'v 0 0 0\nv 1 0 0\nf 1 2 3\n'), 'obj')
  assert.equal(t('model3d', `${'S'.padStart(73)}0000001\nG      1\n`.replace(/^ +S/, ' '.repeat(72) + 'S')), 'igs')
  assert.equal(t('csv', 'a,b,c\n1,2,3\n'), 'csv')
  assert.equal(t('csv', 'a\tb\tc\n1\t2\t3\n'), 'tsv')
  assert.equal(t('office', '{\\rtf1\\ansi Hello}'), 'doc')
  assert.equal(t('office', '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook>'), 'xls')
  assert.equal(t('dxf', '  0\nSECTION\n'), 'dxf')
})

test('every editor suffix has a renderer, and every text family returns a registered suffix', () => {
  const editors = manifest.contributes.customEditors as { extensions: string[]; entry: string; contentKind?: string }[]
  assert.ok(editors.length <= 16, 'Orca allows at most 16 custom editors')
  for (const e of editors) for (const x of e.extensions) assert.ok(RENDERERS[x.slice(1)], `${x} has no renderer`)
  for (const e of editors.filter((x) => x.contentKind === 'text')) {
    const family = e.entry.match(/editor\/text\/(\w+)\.ts$/)?.[1]
    assert.ok(family, `text editor entry ${e.entry}`)
    const got = textType(family ?? '', new Uint8Array())
    assert.ok(e.extensions.includes(`.${got}`), `${family} falls back to .${got}, not one of ${e.extensions.join(' ')}`)
  }
})
