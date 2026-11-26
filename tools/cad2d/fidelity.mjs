// Fidelity of the CAD Drawing Preview against ezdxf's own renderer (drawing add-on, SVG backend).
//
//   python tools/cad2d/ezdxf_ref.py --out .orca/fid/ref <files>      (reference SVGs)
//   node tools/cad2d/shoot.mjs --theme light --size 1000x750 --stage-only --first-view --out .orca/fid/ours <files>
//   node tools/cad2d/fidelity.mjs --out docs/evidence/cad2d/fidelity <files>
//
// Both pictures are cropped to their ink (non-white pixels), scaled to the same width and compared
// as ink masks with a 3-pixel tolerance: precision = our ink near reference ink, recall = reference
// ink near ours, F1 = their harmonic mean. Colour agreement compares the hue of matched ink pixels.
// Writes a side-by-side PNG per file (reference | ours | overlay: red = only reference, blue = only
// ours, dark = both) and fidelity.json / fidelity.md.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const oi = argv.indexOf('--out')
const out = join(ROOT, oi >= 0 ? argv.splice(oi, 2)[1] : 'docs/evidence/cad2d/fidelity')
const files = argv
mkdirSync(out, { recursive: true })
const refDir = join(ROOT, '.orca/fid/ref')
const oursDir = join(ROOT, '.orca/fid/ours')

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr}`)
  return r.stdout
}
console.log(run('python', ['tools/cad2d/ezdxf_ref.py', '--out', '.orca/fid/ref', ...files]))
console.log(run(process.execPath, ['tools/cad2d/shoot.mjs', '--theme', 'light', '--locale', 'en', '--size', '1000x750', '--stage-only', '--first-view', '--out', '.orca/fid/ours', ...files]))

const { chromium } = await import('playwright-core')
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
})
const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage()
await page.setContent('<html><body></body></html>')
const rows = []
for (const f of files) {
  const name = basename(f)
  let refSvg
  try {
    refSvg = readFileSync(join(refDir, `${name}.svg`), 'utf8')
  } catch {
    rows.push({ file: f, error: 'no reference render' })
    continue
  }
  const ours = readFileSync(join(oursDir, `${name}.png`)).toString('base64')
  const res = await page.evaluate(
    async ({ refSvg, ours }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const i = new Image()
          i.onload = () => res(i)
          i.onerror = () => rej(new Error('image load'))
          i.src = src
        })
      const svgUrl = URL.createObjectURL(new Blob([refSvg], { type: 'image/svg+xml' }))
      const ref = await load(svgUrl)
      const mine = await load(`data:image/png;base64,${ours}`)
      // Rasterise the reference at the same 1000×750 box (contain).
      const W = 1000
      const H = 750
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d')
      const draw = (img, contain) => {
        g.fillStyle = '#fff'
        g.fillRect(0, 0, W, H)
        if (contain) {
          const s = Math.min((W - 32) / img.naturalWidth, (H - 32) / img.naturalHeight)
          const w = img.naturalWidth * s
          const h = img.naturalHeight * s
          g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
        } else g.drawImage(img, 0, 0, W, H)
        return g.getImageData(0, 0, W, H)
      }
      const A = draw(ref, true)
      const B = draw(mine, true)
      const inkOf = (d) => {
        const m = new Uint8Array(W * H)
        let x0 = W, y0 = H, x1 = -1, y1 = -1
        for (let i = 0; i < W * H; i++) {
          const r = d.data[i * 4], gg = d.data[i * 4 + 1], b = d.data[i * 4 + 2]
          if (765 - (r + gg + b) > 60) {
            m[i] = 1
            const x = i % W, y = (i / W) | 0
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
        }
        return { m, box: [x0, y0, x1, y1] }
      }
      const ia = inkOf(A)
      const ib = inkOf(B)
      if (ia.box[2] < 0 || ib.box[2] < 0) return { error: 'blank render' }
      // Normalise: crop each to its ink box and scale to a common 800 px wide frame.
      const N = 800
      const norm = (d, box) => {
        const [x0, y0, x1, y1] = box
        const bw = x1 - x0 + 1
        const bh = y1 - y0 + 1
        const s = N / bw
        const nh = Math.max(1, Math.round(bh * s))
        const cc = document.createElement('canvas')
        cc.width = N
        cc.height = nh
        const src = document.createElement('canvas')
        src.width = W
        src.height = H
        src.getContext('2d').putImageData(d, 0, 0)
        const gg = cc.getContext('2d')
        gg.fillStyle = '#fff'
        gg.fillRect(0, 0, N, nh)
        gg.drawImage(src, x0, y0, bw, bh, 0, 0, N, nh)
        return { cv: cc, aspect: bw / bh }
      }
      const na = norm(A, ia.box)
      const nb = norm(B, ib.box)
      const NH = Math.max(na.cv.height, nb.cv.height)
      const grab = (cv) => {
        const cc = document.createElement('canvas')
        cc.width = N
        cc.height = NH
        const gg = cc.getContext('2d')
        gg.fillStyle = '#fff'
        gg.fillRect(0, 0, N, NH)
        gg.drawImage(cv, 0, 0)
        return gg.getImageData(0, 0, N, NH)
      }
      const da = grab(na.cv)
      const db = grab(nb.cv)
      const mask = (d) => {
        const m = new Uint8Array(N * NH)
        for (let i = 0; i < N * NH; i++) if (765 - (d.data[i * 4] + d.data[i * 4 + 1] + d.data[i * 4 + 2]) > 60) m[i] = 1
        return m
      }
      const ma = mask(da)
      const mb = mask(db)
      const R = 3
      const dilate = (m) => {
        const t = new Uint8Array(N * NH)
        for (let y = 0; y < NH; y++)
          for (let x = 0; x < N; x++) {
            if (!m[y * N + x]) continue
            for (let dx = -R; dx <= R; dx++) {
              const xx = x + dx
              if (xx >= 0 && xx < N) t[y * N + xx] = 1
            }
          }
        const o = new Uint8Array(N * NH)
        for (let y = 0; y < NH; y++)
          for (let x = 0; x < N; x++) {
            if (!t[y * N + x]) continue
            for (let dy = -R; dy <= R; dy++) {
              const yy = y + dy
              if (yy >= 0 && yy < NH) o[yy * N + x] = 1
            }
          }
        return o
      }
      const xa = dilate(ma)
      const xb = dilate(mb)
      let inkA = 0, inkB = 0, hitB = 0, hitA = 0, colourPairs = 0, colourSame = 0
      const hue = (d, i) => {
        const r = d.data[i * 4], gg = d.data[i * 4 + 1], b = d.data[i * 4 + 2]
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b)
        if (mx - mn < 40) return -1 // grey/black
        let h = mx === r ? (gg - b) / (mx - mn) : mx === gg ? 2 + (b - r) / (mx - mn) : 4 + (r - gg) / (mx - mn)
        return ((h * 60) + 360) % 360
      }
      for (let i = 0; i < N * NH; i++) {
        if (ma[i]) {
          inkA++
          if (xb[i]) hitA++
        }
        if (mb[i]) {
          inkB++
          if (xa[i]) {
            hitB++
            if (ma[i]) {
              const h1 = hue(da, i), h2 = hue(db, i)
              colourPairs++
              if ((h1 < 0 && h2 < 0) || (h1 >= 0 && h2 >= 0 && Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2)) < 30)) colourSame++
            }
          }
        }
      }
      const precision = inkB ? hitB / inkB : 0
      const recall = inkA ? hitA / inkA : 0
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
      // Composite: reference | ours | overlay
      const comp = document.createElement('canvas')
      comp.width = N * 3 + 40
      comp.height = NH + 30
      const cg = comp.getContext('2d')
      cg.fillStyle = '#fff'
      cg.fillRect(0, 0, comp.width, comp.height)
      cg.font = '16px sans-serif'
      cg.fillStyle = '#333'
      cg.fillText('ezdxf (reference)', 4, 18)
      cg.fillText('CAD Drawing Preview', N + 24, 18)
      cg.fillText('overlay: red = only reference, blue = only preview', 2 * N + 44, 18)
      cg.putImageData(da, 0, 30)
      cg.putImageData(db, N + 20, 30)
      const ov = cg.createImageData(N, NH)
      for (let i = 0; i < N * NH; i++) {
        let c = [255, 255, 255]
        if (ma[i] && mb[i]) c = [40, 40, 40]
        else if (ma[i]) c = xb[i] ? [160, 160, 160] : [220, 30, 30]
        else if (mb[i]) c = xa[i] ? [160, 160, 160] : [30, 80, 230]
        ov.data.set([...c, 255], i * 4)
      }
      cg.putImageData(ov, 2 * N + 40, 30)
      cg.strokeStyle = '#bbb'
      cg.strokeRect(0.5, 30.5, N - 1, NH - 1)
      cg.strokeRect(N + 20.5, 30.5, N - 1, NH - 1)
      cg.strokeRect(2 * N + 40.5, 30.5, N - 1, NH - 1)
      return {
        precision,
        recall,
        f1,
        colour: colourPairs ? colourSame / colourPairs : null,
        aspectRef: na.aspect,
        aspectOurs: nb.aspect,
        png: comp.toDataURL('image/png').split(',')[1]
      }
    },
    { refSvg, ours }
  )
  if (res.error) {
    rows.push({ file: f, error: res.error })
    continue
  }
  const shot = `${name}.compare.png`
  writeFileSync(join(out, shot), Buffer.from(res.png, 'base64'))
  delete res.png
  rows.push({ file: f, ...res, shot })
  console.log(`${name.padEnd(28)} P ${(res.precision * 100).toFixed(1)}%  R ${(res.recall * 100).toFixed(1)}%  F1 ${(res.f1 * 100).toFixed(1)}%  colour ${res.colour == null ? '-' : (res.colour * 100).toFixed(1) + '%'}  aspect ${res.aspectRef.toFixed(3)}/${res.aspectOurs.toFixed(3)}`)
}
await browser.close()
writeFileSync(join(out, 'fidelity.json'), JSON.stringify(rows, null, 2))
const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)} %`)
const md = [
  '| File | Precision | Recall | F1 | Colour match | Aspect ref/ours | Comparison |',
  '|---|---:|---:|---:|---:|---:|---|',
  ...rows.map((r) =>
    r.error
      ? `| ${r.file} | – | – | – | – | – | ${r.error} |`
      : `| ${r.file} | ${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.f1)} | ${pct(r.colour)} | ${r.aspectRef.toFixed(3)} / ${r.aspectOurs.toFixed(3)} | [png](${r.shot}) |`
  )
].join('\n')
writeFileSync(join(out, 'fidelity.md'), md + '\n')
console.log(md)
