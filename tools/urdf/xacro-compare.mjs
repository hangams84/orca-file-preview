// Compares File Preview's xacro processor with the reference implementation (ROS 2 `xacro` from
// PyPI, run by tools/urdf/xacro_ref.py) on every xacro case, two ways:
//   1. text: both URDF trees, canonicalised (comments and blank text dropped, attributes sorted),
//      element by element and attribute by attribute, as exact strings;
//   2. model: both parsed by the preview's URDF reader; links, joints (type, parent, child, origin,
//      axis, limits, mimic), visual/collision geometry numbers and material colours compared
//      within 1e-9.
// Writes docs/evidence/urdf/xacro-compare.{json,md}.
//
//   node --experimental-transform-types tools/urdf/xacro-compare.mjs [--python path/to/python]
//        [--dir other/descriptions --out .orca/report]   (local checks on files that are not committed)
//
// Needs `pip install xacro` (no ROS required). Cases: samples/*.xacro (except broken.* and files
// with includes, which the reference cannot expand without the included files) and
// tools/urdf/cases/*.xacro.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseXml } from '../../plugin/editor/renderers/urdf/xml.ts'
import { processXacro } from '../../plugin/editor/renderers/urdf/xacro.ts'
import { parseRobot } from '../../plugin/editor/renderers/urdf/model.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const PY = argv.includes('--python') ? argv[argv.indexOf('--python') + 1] : process.env.XACRO_PYTHON || 'python'
const DIR = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : null
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(ROOT, 'docs', 'evidence', 'urdf')

const cases = DIR
  ? readdirSync(DIR).filter((f) => /\.(xacro|urdf)$/i.test(f)).map((f) => join(DIR, f))
  : [
  ...readdirSync(join(ROOT, 'samples'))
    .filter((f) => /\.xacro$/i.test(f) && !f.startsWith('broken.'))
    .map((f) => join(ROOT, 'samples', f)),
  ...readdirSync(join(ROOT, 'tools', 'urdf', 'cases'))
    .filter((f) => f.endsWith('.xacro'))
    .map((f) => join(ROOT, 'tools', 'urdf', 'cases', f))
  ]

const version = execFileSync(PY, ['-c', 'import importlib.metadata as m; print(m.version("xacro"))'], { encoding: 'utf8' }).trim()

function canon(el) {
  const kids = []
  let text = ''
  for (const c of el.children) {
    if (c.type === 'element') kids.push(canon(c))
    else if (c.type === 'text') text += c.text
  }
  return { name: el.name, attrs: Object.fromEntries([...el.attrs].filter(([k]) => !k.startsWith('xmlns')).sort(([a], [b]) => (a < b ? -1 : 1))), text: text.trim(), kids }
}

function textDiff(a, b, path, out, counts) {
  counts.elements++
  if (a.name !== b.name) {
    out.push(`${path}: element <${a.name}> vs <${b.name}>`)
    return
  }
  const keys = new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])
  for (const k of keys) {
    counts.attrs++
    if (a.attrs[k] === b.attrs[k]) counts.sameAttrs++
    else out.push(`${path}/@${k}: ${JSON.stringify(a.attrs[k])} vs ${JSON.stringify(b.attrs[k])}`)
  }
  if (a.text !== b.text) out.push(`${path}: text ${JSON.stringify(a.text)} vs ${JSON.stringify(b.text)}`)
  if (a.kids.length !== b.kids.length) out.push(`${path}: ${a.kids.length} vs ${b.kids.length} children`)
  for (let i = 0; i < Math.min(a.kids.length, b.kids.length); i++) {
    const nm = a.kids[i].attrs.name ? `[@name=${a.kids[i].attrs.name}]` : `[${i}]`
    textDiff(a.kids[i], b.kids[i], `${path}/${a.kids[i].name}${nm}`, out, counts)
  }
}

const close = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))
function modelDiff(ra, rb, out, counts) {
  const cmpNums = (what, xs, ys) => {
    counts.numbers += xs.length
    if (xs.length !== ys.length || xs.some((x, i) => !close(x, ys[i]))) out.push(`${what}: ${JSON.stringify(xs)} vs ${JSON.stringify(ys)}`)
    else counts.sameNumbers += xs.length
  }
  const geomNums = (g) =>
    g.type === 'box' ? g.size : g.type === 'sphere' ? [g.radius] : g.type === 'mesh' ? g.scale : [g.radius, g.length]
  if (ra.name !== rb.name) out.push(`robot name ${ra.name} vs ${rb.name}`)
  if (ra.links.length !== rb.links.length) out.push(`${ra.links.length} vs ${rb.links.length} links`)
  if (ra.joints.length !== rb.joints.length) out.push(`${ra.joints.length} vs ${rb.joints.length} joints`)
  for (const la of ra.links) {
    const lb = rb.links[rb.linkIndex.get(la.name) ?? -1]
    if (!lb) {
      out.push(`link ${la.name} missing`)
      continue
    }
    counts.links++
    for (const kind of ['visuals', 'collisions']) {
      if (la[kind].length !== lb[kind].length) out.push(`link ${la.name}: ${la[kind].length} vs ${lb[kind].length} ${kind}`)
      la[kind].forEach((sa, i) => {
        const sb = lb[kind][i]
        if (!sb) return
        const w = `link ${la.name} ${kind}[${i}]`
        if (sa.geometry.type !== sb.geometry.type) out.push(`${w}: ${sa.geometry.type} vs ${sb.geometry.type}`)
        else cmpNums(`${w} ${sa.geometry.type}`, geomNums(sa.geometry), geomNums(sb.geometry))
        if (sa.geometry.type === 'mesh' && sa.geometry.filename !== sb.geometry.filename) out.push(`${w} mesh ${sa.geometry.filename} vs ${sb.geometry.filename}`)
        cmpNums(`${w} xyz`, sa.origin.xyz, sb.origin.xyz)
        cmpNums(`${w} rpy`, sa.origin.rpy, sb.origin.rpy)
        cmpNums(`${w} rgba`, sa.material?.rgba ?? [], sb.material?.rgba ?? [])
      })
    }
  }
  for (const ja of ra.joints) {
    const jb = rb.joints[rb.jointIndex.get(ja.name) ?? -1]
    if (!jb) {
      out.push(`joint ${ja.name} missing`)
      continue
    }
    counts.joints++
    for (const k of ['type', 'parent', 'child']) if (ja[k] !== jb[k]) out.push(`joint ${ja.name} ${k}: ${ja[k]} vs ${jb[k]}`)
    cmpNums(`joint ${ja.name} xyz`, ja.origin.xyz, jb.origin.xyz)
    cmpNums(`joint ${ja.name} rpy`, ja.origin.rpy, jb.origin.rpy)
    cmpNums(`joint ${ja.name} axis`, ja.axis, jb.axis)
    cmpNums(`joint ${ja.name} limit`, ja.limit ? [ja.limit.lower, ja.limit.upper, ja.limit.effort ?? 0, ja.limit.velocity ?? 0] : [], jb.limit ? [jb.limit.lower, jb.limit.upper, jb.limit.effort ?? 0, jb.limit.velocity ?? 0] : [])
    cmpNums(`joint ${ja.name} mimic`, ja.mimic ? [ja.mimic.multiplier, ja.mimic.offset] : [], jb.mimic ? [jb.mimic.multiplier, jb.mimic.offset] : [])
  }
}

const results = []
for (const file of cases) {
  const name = basename(file)
  const src = readFileSync(file, 'utf8')
  if (/<xacro:include\b/.test(src)) {
    results.push({ name, skipped: 'includes other files' })
    continue
  }
  let ref
  try {
    ref = execFileSync(PY, [join(ROOT, 'tools', 'urdf', 'xacro_ref.py'), file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    results.push({ name, skipped: `reference failed: ${String(e.stderr).trim().split('\n').pop()}` })
    continue
  }
  const t0 = performance.now()
  const mine = processXacro(parseXml(src))
  const ms = performance.now() - t0
  const refRoot = parseXml(ref)
  const text = []
  const tc = { elements: 0, attrs: 0, sameAttrs: 0 }
  textDiff(canon(refRoot), canon(mine.root), `/${refRoot.name}`, text, tc)
  const model = []
  const mc = { links: 0, joints: 0, numbers: 0, sameNumbers: 0 }
  let ra, rb
  try {
    ra = parseRobot(refRoot, true)
    rb = parseRobot(mine.root, true)
    modelDiff(ra, rb, model, mc)
  } catch (e) {
    model.push(`model: ${e.message}`)
  }
  results.push({
    name,
    elements: tc.elements,
    attrs: tc.attrs,
    sameAttrs: tc.sameAttrs,
    textDiffs: text,
    links: ra?.links.length ?? 0,
    joints: ra?.joints.length ?? 0,
    numbers: mc.numbers,
    sameNumbers: mc.sameNumbers,
    modelDiffs: model,
    notes: mine.notes.map((n) => `${n.level}: ${n.message}`),
    ms: Math.round(ms * 10) / 10
  })
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'xacro-compare.json'), JSON.stringify({ reference: `xacro ${version} (PyPI)`, results }, null, 2) + '\n')
const rows = results.map((r) =>
  r.skipped
    ? `| \`${r.name}\` | — | — | — | — | skipped: ${r.skipped} |`
    : `| \`${r.name}\` | ${r.links} / ${r.joints} | ${r.elements} | ${r.sameAttrs} / ${r.attrs} | ${r.sameNumbers} / ${r.numbers} | ${r.textDiffs.length + r.modelDiffs.length === 0 ? '✅ identical' : `❌ ${[...r.textDiffs, ...r.modelDiffs].slice(0, 3).join('; ')}`} |`
)
const md = [
  `# xacro processor vs reference (xacro ${version} from PyPI)`,
  '',
  'Generated by `node --experimental-transform-types tools/urdf/xacro-compare.mjs`.',
  '',
  '| Case | Links / joints | Elements | Attributes equal (exact text) | Model numbers equal (1e-9) | Result |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows,
  ''
].join('\n')
writeFileSync(join(OUT, 'xacro-compare.md'), md)
console.log(md)
const failed = results.filter((r) => !r.skipped && r.textDiffs.length + r.modelDiffs.length)
for (const r of failed) console.log(`\n${r.name}:\n  ${[...r.textDiffs, ...r.modelDiffs].slice(0, 20).join('\n  ')}`)
process.exitCode = failed.length ? 1 : 0
