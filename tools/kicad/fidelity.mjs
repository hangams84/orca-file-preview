// KiCad Preview fidelity check against kicad-cli SVG exports (ground truth).
//
// For every case, kicad-cli exports a black-and-white SVG; the plugin's own scene builder (bundled
// for Node with esbuild) draws the same file in black. Both are rasterised in Chromium over the
// same world window and compared as ink masks: precision = share of our ink within D px of
// KiCad's ink, recall = share of KiCad's ink within D px of ours, F1 of both. Also writes
// side-by-side images (KiCad | preview | overlay: red = KiCad only, blue = preview only).
//
//   node tools/kicad/fidelity.mjs [--kicad-cli <path>] [--out docs/evidence/kicad] [--extra <dir>]
//   --extra <dir>: also compare every .kicad_sch / .kicad_pcb found there (local checks only; the
//                  images go to .orca/kicad/extra, never into docs/).
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launch } from '../harness/lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
    return acc
  }, [])
)
const CLI = args['kicad-cli'] ?? 'C:/Program Files/KiCad/10.0/bin/kicad-cli.exe'
const OUT = join(ROOT, args.out ?? 'docs/evidence/kicad')
const WORK = join(ROOT, '.orca', 'kicad', 'fidelity')
mkdirSync(WORK, { recursive: true })
mkdirSync(OUT, { recursive: true })

// --- bundle the renderer's scene builders for Node --------------------------------------------
const libFile = join(WORK, 'kicad-lib.mjs')
await build({
  stdin: {
    contents: `
      export { parseSexpr } from './plugin/editor/renderers/kicad/sexpr.ts'
      export { buildSchematic, SCH_ORDER } from './plugin/editor/renderers/kicad/sch.ts'
      export { buildBoard } from './plugin/editor/renderers/kicad/pcb.ts'
      export { buildSymbolView } from './plugin/editor/renderers/kicad/symlib.ts'
      export { layerClass } from './plugin/editor/renderers/kicad/theme.ts'
    `,
    resolveDir: ROOT,
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: libFile,
  logLevel: 'warning'
})
const K = await import(pathToFileURL(libFile).href)
const tr = (_ko, en) => en

const cli = (...a) => execFileSync(CLI, a, { stdio: 'pipe' }).toString()
const version = cli('version').trim()

/** Our drawing of `layers` as black ink (holes white) in an SVG with the given viewBox. */
function mineSvg(scene, order, layers, vb, extraCss = '') {
  const keep = new Set(layers)
  const css =
    `path.s{fill:none;stroke-linecap:round;stroke-linejoin:round}path.f{stroke:none}` +
    `g{stroke:#000;fill:#000}` +
    [...new Set([...scene.layers.values()].map((l) => l.base))]
      .filter((b) => !keep.has(b))
      .map((b) => `.${K.layerClass(b)}{display:none}`)
      .join('') +
    `.${K.layerClass('Holes')}{fill:#fff;stroke:none}.${K.layerClass('bodyfill')},.${K.layerClass('sheetfill')}{display:none}text{font-family:sans-serif}` +
    extraCss
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}mm" height="${vb[3]}mm"><style>${css}</style><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>${scene.toSvg(order, K.layerClass)}</svg>`
}

/** Colour drawing for the side-by-side image (light theme colours). */
function colourSvg(scene, order, layers, vb, colour) {
  const keep = new Set(layers)
  const css =
    `path.s{fill:none;stroke-linecap:round;stroke-linejoin:round}path.f{stroke:none}` +
    [...new Set([...scene.layers.values()].map((l) => l.base))]
      .map((b) => (keep.has(b) ? `.${K.layerClass(b)}{stroke:${colour(b)};fill:${colour(b)}}` : `.${K.layerClass(b)}{display:none}`))
      .join('') +
    (keep.has('Holes') ? `.${K.layerClass('Holes')}{fill:#fff;stroke:none}` : '')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}mm" height="${vb[3]}mm"><style>${css}</style><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>${scene.toSvg(order, K.layerClass)}</svg>`
}

/** Re-targets a kicad-cli SVG (page coordinates in mm) at a viewBox; white background. */
function truthSvg(file, vb) {
  let s = readFileSync(file, 'utf8')
  s = s.replace(/<svg([^>]*?)width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `<svg$1width="${vb[2]}mm" height="${vb[3]}mm" viewBox="${vb.join(' ')}"`)
  return s.replace(/(<svg[^>]*>)/, `$1<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>`)
}

const SCH_COLOURS = {
  wire: '#009600', bus: '#000084', junction: '#009600', nc: '#000084', body: '#840000', bodyfill: '#ffffc2', pin: '#840000', pinname: '#006464',
  pinnum: '#a90000', ref: '#006464', value: '#006464', field: '#840084', label: '#0f0f0f', glabel: '#840000', hlabel: '#725600', netclass: '#484848',
  note: '#0000c2', sheet: '#840000', sheetfill: '#ffffff', sheetname: '#006464', sheetfile: '#725600', sheetpin: '#006464', border: '#840000'
}
const schColour = (b) => SCH_COLOURS[b.replace(/^dim-/, '')] ?? '#333'
const pcbColour = (b) => ({ 'F.Cu': '#c83434', 'B.Cu': '#3a6fb8', 'In1.Cu': '#3f9a3f', 'In2.Cu': '#c06a14', 'F.SilkS': '#4d4a1e', 'B.SilkS': '#8a4f42', 'Edge.Cuts': '#2a2a2a', 'F.Fab': '#6a6a6a', 'B.Fab': '#4a5084', 'F.CrtYd': '#c41aad', 'B.CrtYd': '#1a9ab8' })[b] ?? '#555'

const browser = await launch(args)
const page = await browser.newPage()
await page.setContent('<html><body></body></html>')

/** Rasterises both SVGs at `pxPerUnit` and returns the scores plus a side-by-side PNG. */
async function compare(truth, mine, truthColour, mineColour, vb, pxPerUnit, dilate) {
  const w = Math.round(vb[2] * pxPerUnit)
  const h = Math.round(vb[3] * pxPerUnit)
  return page.evaluate(
    async ({ truth, mine, truthColour, mineColour, w, h, dilate }) => {
      const load = (svg) =>
        new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => res(img)
          img.onerror = () => rej(new Error('svg load failed'))
          img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
        })
      const raster = async (svg) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')
        g.fillStyle = '#fff'
        g.fillRect(0, 0, w, h)
        g.drawImage(await load(svg), 0, 0, w, h)
        return { c, d: g.getImageData(0, 0, w, h).data }
      }
      const mask = (d) => {
        const m = new Uint8Array(w * h)
        for (let i = 0; i < w * h; i++) {
          const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
          m[i] = l < 160 ? 1 : 0
        }
        return m
      }
      const dil = (m) => {
        // Square dilation via two separable passes.
        const a = new Uint8Array(w * h)
        const b = new Uint8Array(w * h)
        for (let y = 0; y < h; y++) {
          let run = -1e9
          for (let x = 0; x < w; x++) {
            if (m[y * w + x]) run = x
            if (x - run <= dilate) a[y * w + x] = 1
          }
          run = 1e9
          for (let x = w - 1; x >= 0; x--) {
            if (m[y * w + x]) run = x
            if (run - x <= dilate) a[y * w + x] = 1
          }
        }
        for (let x = 0; x < w; x++) {
          let run = -1e9
          for (let y = 0; y < h; y++) {
            if (a[y * w + x]) run = y
            if (y - run <= dilate) b[y * w + x] = 1
          }
          run = 1e9
          for (let y = h - 1; y >= 0; y--) {
            if (a[y * w + x]) run = y
            if (run - y <= dilate) b[y * w + x] = 1
          }
        }
        return b
      }
      const T = mask((await raster(truth)).d)
      const M = mask((await raster(mine)).d)
      const Td = dil(T)
      const Md = dil(M)
      let t = 0
      let m = 0
      let tm = 0
      let mt = 0
      for (let i = 0; i < w * h; i++) {
        if (T[i]) {
          t++
          if (Md[i]) tm++
        }
        if (M[i]) {
          m++
          if (Td[i]) mt++
        }
      }
      const recall = t ? tm / t : 1
      const precision = m ? mt / m : 1
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
      // Side by side: KiCad colour | preview colour | overlay.
      const tc = (await raster(truthColour)).c
      const mc = (await raster(mineColour)).c
      const scale = Math.min(1, 1100 / w)
      const sw = Math.round(w * scale)
      const sh = Math.round(h * scale)
      const out = document.createElement('canvas')
      out.width = sw * 3 + 20
      out.height = sh + 24
      const g = out.getContext('2d')
      g.fillStyle = '#fff'
      g.fillRect(0, 0, out.width, out.height)
      g.drawImage(tc, 0, 24, sw, sh)
      g.drawImage(mc, sw + 10, 24, sw, sh)
      const ov = document.createElement('canvas')
      ov.width = w
      ov.height = h
      const og = ov.getContext('2d')
      const id = og.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const [r, gg, b] = T[i] && M[i] ? [0, 0, 0] : T[i] ? [220, 30, 30] : M[i] ? [30, 80, 230] : [255, 255, 255]
        id.data.set([r, gg, b, 255], i * 4)
      }
      og.putImageData(id, 0, 0)
      g.drawImage(ov, sw * 2 + 20, 24, sw, sh)
      g.fillStyle = '#000'
      g.font = '14px sans-serif'
      g.fillText('kicad-cli (ground truth)', 4, 16)
      g.fillText('File Preview', sw + 14, 16)
      g.fillText('overlay: red = KiCad only, blue = preview only', sw * 2 + 24, 16)
      return { precision, recall, f1, truthInk: t, mineInk: m, png: out.toDataURL('image/png') }
    },
    { truth, mine, truthColour, mineColour, w, h, dilate }
  )
}

const results = []
function save(name, r, dir) {
  writeFileSync(join(dir, `${name}.png`), Buffer.from(r.png.split(',')[1], 'base64'))
}
const fmt = (x) => (x * 100).toFixed(1)

async function schCase(file, label, dir) {
  const out = join(WORK, 'sch-' + basename(file, '.kicad_sch'))
  mkdirSync(out, { recursive: true })
  cli('sch', 'export', 'svg', '--exclude-drawing-sheet', '--black-and-white', '-o', out, file)
  const want = basename(file, '.kicad_sch') + '.svg'
  const bw = readdirSync(out).find((f) => f === want) ?? readdirSync(out).filter((f) => f.endsWith('.svg'))[0]
  const outC = out + '-c'
  mkdirSync(outC, { recursive: true })
  cli('sch', 'export', 'svg', '--exclude-drawing-sheet', '-o', outC, file)
  const col = readdirSync(outC).find((f) => f === want) ?? readdirSync(outC).filter((f) => f.endsWith('.svg'))[0]
  const root = K.parseSexpr(readFileSync(file, 'utf8'))
  const model = K.buildSchematic(root, tr)
  const content = model.scene.bounds((l) => l.base !== 'border')
  const m = Math.max(content.w, content.h) * 0.03
  const vb = [content.x0 - m, content.y0 - m, content.w + 2 * m, content.h + 2 * m].map((v) => Math.round(v * 1000) / 1000)
  const layers = [...new Set([...model.scene.layers.values()].map((l) => l.base))].filter((b) => b !== 'border')
  const r = await compare(
    truthSvg(join(out, bw), vb),
    mineSvg(model.scene, K.SCH_ORDER, layers, vb),
    truthSvg(join(outC, col), vb),
    colourSvg(model.scene, K.SCH_ORDER, layers, vb, schColour),
    vb,
    12,
    2
  )
  save(label, r, dir)
  results.push({ case: label, kind: 'schematic', file: basename(file), ...strip(r) })
}

async function pcbCase(file, label, layerSets, dir) {
  const root = K.parseSexpr(readFileSync(file, 'utf8'))
  const model = K.buildBoard(root, tr)
  const b = model.bounds
  const vb = [b.x0, b.y0, b.w, b.h].map((v) => Math.round(v * 1000) / 1000)
  const px = Math.min(30, 2400 / Math.max(vb[2], vb[3]))
  for (const [name, layers] of layerSets) {
    if (!layers.some((l) => model.layers.some((i) => i.name === l))) continue
    const cu = layers.every((l) => l.endsWith('.Cu'))
    const t = join(WORK, `pcb-${label}-${name}.svg`)
    const tc = join(WORK, `pcb-${label}-${name}-c.svg`)
    cli('pcb', 'export', 'svg', '--exclude-drawing-sheet', '--black-and-white', '--mode-single', '--page-size-mode', '0', '--drill-shape-opt', cu ? '2' : '0', '--layers', layers.join(','), '-o', t, file)
    cli('pcb', 'export', 'svg', '--exclude-drawing-sheet', '--mode-single', '--page-size-mode', '0', '--drill-shape-opt', cu ? '2' : '0', '--layers', layers.join(','), '-o', tc, file)
    const order = model.order(false)
    const r = await compare(truthSvg(t, vb), mineSvg(model.scene, order, cu ? [...layers, 'Holes'] : layers, vb), truthSvg(tc, vb), colourSvg(model.scene, order, cu ? [...layers, 'Holes'] : layers, vb, pcbColour), vb, px, 2)
    save(`${label}-${name}`, r, dir)
    results.push({ case: `${label} ${name}`, kind: 'board', file: basename(file), ...strip(r) })
  }
}

const strip = ({ png, ...r }) => r

// --- the committed corpus -----------------------------------------------------------------------
// kicad-cli writes .kicad_prl files next to what it opens: work on copies.
const SRC = join(WORK, 'src')
mkdirSync(SRC, { recursive: true })
for (const f of readdirSync(join(ROOT, 'samples')).filter((x) => /^sample.*\.kicad_/.test(x))) copyFileSync(join(ROOT, 'samples', f), join(SRC, f))
const S = (f) => join(SRC, f)
await schCase(S('sample.kicad_sch'), 'sch-sample', OUT)
await schCase(S('sample-power.kicad_sch'), 'sch-sample-power', OUT)
const LAYERS = [
  ['F.Cu', ['F.Cu']],
  ['In1.Cu', ['In1.Cu']],
  ['In2.Cu', ['In2.Cu']],
  ['B.Cu', ['B.Cu']],
  ['F.SilkS', ['F.SilkS']],
  ['B.SilkS', ['B.SilkS']],
  ['F.Fab', ['F.Fab']],
  ['F.CrtYd', ['F.CrtYd']],
  ['Edge.Cuts', ['Edge.Cuts']]
]
await pcbCase(S('sample.kicad_pcb'), 'pcb-sample', LAYERS, OUT)

// Footprint: compare through a one-footprint board so both sides share coordinates.
{
  const mod = readFileSync(S('sample.kicad_mod'), 'utf8')
  const inner = mod.replace(/^\(footprint\s+("[^"]*")\s+\(version[^)]*\)\s+\(generator[^)]*\)\s+\(generator_version[^)]*\)/, '(footprint $1 (at 20 20)')
  const boardText = `(kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0") (general (thickness 1.6)) (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (35 "F.Paste" user) (37 "F.SilkS" user) (39 "F.Mask" user) (44 "Edge.Cuts" user) (47 "F.CrtYd" user) (49 "F.Fab" user))
  (setup (pad_to_mask_clearance 0))
  ${inner}
)`
  const f = join(WORK, 'fp-board.kicad_pcb')
  writeFileSync(f, boardText)
  // The plugin renders the .kicad_mod itself; check that path draws the same geometry.
  await pcbCase(f, 'fp-sample', [['F.Cu', ['F.Cu']], ['F.SilkS', ['F.SilkS']], ['F.Fab', ['F.Fab']], ['F.Paste', ['F.Paste']]], OUT)
}

// Symbols: kicad-cli draws each unit on its own page at its own scale; both drawings are cropped
// to their ink bounding box and stretched to a common size before the same ink comparison.
{
  const out = join(WORK, 'sym')
  const outC = join(WORK, 'sym-c')
  mkdirSync(out, { recursive: true })
  mkdirSync(outC, { recursive: true })
  cli('sym', 'export', 'svg', '--black-and-white', '-o', out, S('sample.kicad_sym'))
  cli('sym', 'export', 'svg', '-o', outC, S('sample.kicad_sym'))
  const lib = K.buildSymbolView(K.parseSexpr(readFileSync(S('sample.kicad_sym'), 'utf8')))
  const css = (colour) =>
    `path.s{fill:none;stroke-linecap:round;stroke-linejoin:round}path.f{stroke:none}` +
    (colour
      ? Object.keys(SCH_COLOURS)
          .map((b) => `.${K.layerClass(b)}{stroke:${schColour(b)};fill:${schColour(b)}}`)
          .join('') + `.${K.layerClass('bodyfill')}{stroke:none}`
      : `g{stroke:#000;fill:#000}.${K.layerClass('bodyfill')}{display:none}`) +
    `.${K.layerClass('note')}{display:none}`
  for (const f of readdirSync(out).filter((x) => x.endsWith('.svg'))) {
    const m = /^(.*)_unit(\d+)(_demorgan)?\.svg$/.exec(f)
    if (!m) continue
    const idx = lib.symbols.findIndex((s) => s.name === m[1])
    if (idx < 0) continue
    const d = lib.draw(idx, Number(m[2]), m[3] ? 2 : 1)
    const b = d.bounds
    const wrap = (colour) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[b.x0, b.y0, b.w, b.h].join(' ')}" width="${b.w * 20}" height="${b.h * 20}"><style>${css(colour)}</style>${d.svg}</svg>`
    const r = await page.evaluate(
      async ({ truth, mine, truthC, mineC, dilate }) => {
        const load = (svg) =>
          new Promise((res, rej) => {
            const img = new Image()
            img.onload = () => res(img)
            img.onerror = () => rej(new Error('svg'))
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
          })
        const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        // Rasterise large, find the ink box (from the black-and-white version), return the crop.
        const crop = async (bw, colour, W) => {
          const out = []
          let box = null
          for (const svg of [bw, colour]) {
            const img = await load(svg)
            const c = document.createElement('canvas')
            c.width = W
            c.height = Math.round((W * (img.naturalHeight || 1)) / (img.naturalWidth || 1))
            const g = c.getContext('2d')
            g.fillStyle = '#fff'
            g.fillRect(0, 0, c.width, c.height)
            g.drawImage(img, 0, 0, c.width, c.height)
            if (!box) {
              const d = g.getImageData(0, 0, c.width, c.height).data
              let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
              for (let y = 0; y < c.height; y++)
                for (let x = 0; x < c.width; x++)
                  if (lum(d, (y * c.width + x) * 4) < 160) {
                    if (x < x0) x0 = x
                    if (y < y0) y0 = y
                    if (x > x1) x1 = x
                    if (y > y1) y1 = y
                  }
              box = [x0, y0, x1 - x0 + 1, y1 - y0 + 1]
            }
            out.push(c)
          }
          return { bw: out[0], colour: out[1], box }
        }
        const T = await crop(truth, truthC, 4000)
        const M = await crop(mine, mineC, 1600)
        const w = 600
        const h = Math.max(20, Math.round((w * T.box[3]) / T.box[2]))
        const norm = (src, box) => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const g = c.getContext('2d')
          g.fillStyle = '#fff'
          g.fillRect(0, 0, w, h)
          g.drawImage(src, box[0], box[1], box[2], box[3], 0, 0, w, h)
          return c
        }
        const mask = (c) => {
          const d = c.getContext('2d').getImageData(0, 0, w, h).data
          const m = new Uint8Array(w * h)
          for (let i = 0; i < w * h; i++) m[i] = lum(d, i * 4) < 160 ? 1 : 0
          return m
        }
        const dil = (m) => {
          const o = new Uint8Array(w * h)
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              if (!m[y * w + x]) continue
              for (let dy = -dilate; dy <= dilate; dy++)
                for (let dx = -dilate; dx <= dilate; dx++) {
                  const yy = y + dy
                  const xx = x + dx
                  if (yy >= 0 && yy < h && xx >= 0 && xx < w) o[yy * w + xx] = 1
                }
            }
          return o
        }
        const tm = mask(norm(T.bw, T.box))
        const mm = mask(norm(M.bw, M.box))
        const td = dil(tm)
        const md = dil(mm)
        let t = 0, m = 0, a = 0, b = 0
        for (let i = 0; i < w * h; i++) {
          if (tm[i]) {
            t++
            if (md[i]) a++
          }
          if (mm[i]) {
            m++
            if (td[i]) b++
          }
        }
        const recall = t ? a / t : 1
        const precision = m ? b / m : 1
        const out = document.createElement('canvas')
        out.width = w * 3 + 20
        out.height = h + 24
        const g = out.getContext('2d')
        g.fillStyle = '#fff'
        g.fillRect(0, 0, out.width, out.height)
        g.drawImage(norm(T.colour, T.box), 0, 24)
        g.drawImage(norm(M.colour, M.box), w + 10, 24)
        const ov = g.createImageData(w, h)
        for (let i = 0; i < w * h; i++) {
          const px = tm[i] && mm[i] ? [0, 0, 0] : tm[i] ? [220, 30, 30] : mm[i] ? [30, 80, 230] : [255, 255, 255]
          ov.data.set([...px, 255], i * 4)
        }
        g.putImageData(ov, w * 2 + 20, 24)
        g.fillStyle = '#000'
        g.font = '14px sans-serif'
        g.fillText('kicad-cli', 4, 16)
        g.fillText('File Preview', w + 14, 16)
        g.fillText('overlay', w * 2 + 24, 16)
        return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, png: out.toDataURL('image/png') }
      },
      {
        truth: readFileSync(join(out, f), 'utf8'),
        truthC: readFileSync(join(outC, f), 'utf8'),
        mine: wrap(false),
        mineC: wrap(true),
        dilate: 3
      }
    )
    const label = `sym-${f.replace('.svg', '')}`
    save(label, r, OUT)
    results.push({ case: label, kind: 'symbol', file: 'sample.kicad_sym', ...strip(r) })
  }
}


// --- optional local corpus (never committed) ----------------------------------------------------
if (typeof args.extra === 'string') {
  const dir = args.extra
  const xout = join(ROOT, '.orca', 'kicad', 'extra')
  mkdirSync(xout, { recursive: true })
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  for (const f of walk(dir)) {
    const label = 'extra-' + basename(dirname(f)) + '-' + basename(f).replace(/\.kicad_(sch|pcb)$/, '')
    try {
      if (f.endsWith('.kicad_sch')) await schCase(f, label, xout)
      else if (f.endsWith('.kicad_pcb')) await pcbCase(f, label, [['F.Cu', ['F.Cu']], ['B.Cu', ['B.Cu']], ['F.SilkS', ['F.SilkS']], ['Edge.Cuts', ['Edge.Cuts']]], xout)
    } catch (e) {
      results.push({ case: label, kind: 'error', file: f, error: String(e.message ?? e).slice(0, 200) })
    }
  }
}

await browser.close()
const target = typeof args.extra === 'string' ? join(ROOT, '.orca', 'kicad', 'extra') : OUT
writeFileSync(join(target, 'fidelity.json'), JSON.stringify({ kicad: version, results }, null, 2))
const rows = results.map((r) =>
  r.kind === 'error'
      ? `| ${r.case} | error | ${r.error} | | |`
      : `| ${r.case} | ${r.kind} | ${fmt(r.precision)} | ${fmt(r.recall)} | **${fmt(r.f1)}** |`
)
const md = [`KiCad ${version}`, '', '| Case | Kind | Precision % | Recall % | F1 % |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n')
writeFileSync(join(target, 'fidelity.md'), md)
console.log(md)
if (!existsSync(OUT)) mkdirSync(OUT)
