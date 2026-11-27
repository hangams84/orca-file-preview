/** Tensor inspector: statistics, histogram, heatmap of 2-D weights, conv kernel grid; sampled reads
 *  for large tensors. */
import { decodable, histogram, numel, stats } from '../dtype.ts'
import type { TensorInfo } from '../ir.ts'
import { convKernels, heatmapGrid, sampleValues } from '../sample.ts'
import { el, fmtBytes, fmtInt, fmtNum, fmtShape, kvTable, svg, virtualList, type App, type View } from './common.ts'
import { tensorDetail } from './detail.ts'

const CSS = `
.am-ti { display: flex; flex: 1 1 auto; min-height: 0; }
.am-ti-list { flex: none; width: 260px; display: flex; flex-direction: column; border-right: 1px solid var(--orca-border, #ddd); min-height: 0; }
.am-ti-list .am-scroll { flex: 1 1 auto; }
.am-ti-item { padding: 0 8px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; line-height: 24px; box-sizing: border-box; }
.am-ti-item:hover { background: var(--orca-accent, #eee); }
.am-ti-item.sel { background: var(--orca-primary, #333); color: var(--orca-primary-foreground, #fff); }
.am-ti-main { flex: 1 1 auto; overflow: auto; padding: 10px 12px; min-width: 0; }
.am-ti-main h3 { margin: 0 0 4px; font-size: 14px; word-break: break-all; }
.am-ti-grid { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.am-ti-card { border: 1px solid var(--orca-border, #ddd); border-radius: 8px; padding: 8px; background: var(--orca-card, #fafafa); max-width: 100%; box-sizing: border-box; }
.am-ti-card h4 { margin: 0 0 6px; font-size: 12px; color: var(--orca-muted-foreground, #666); }
.am-ti-card canvas { image-rendering: pixelated; max-width: 100%; display: block; border: 1px solid var(--orca-border, #ddd); }
@media (max-width: 600px) { .am-ti { flex-direction: column; } .am-ti-list { width: auto; height: 160px; border-right: 0; border-bottom: 1px solid var(--orca-border, #ddd); } }
`

/** Diverging blue–white–red for x in [-1, 1]. */
function diverging(x: number): [number, number, number] {
  if (!Number.isFinite(x)) return [255, 0, 255]
  const t = Math.max(-1, Math.min(1, x))
  if (t < 0) {
    const a = -t
    return [Math.round(255 - a * (255 - 42)), Math.round(255 - a * (255 - 94)), Math.round(255 - a * (255 - 168))]
  }
  return [Math.round(255 - t * (255 - 192)), Math.round(255 - t * (255 - 57)), Math.round(255 - t * (255 - 43))]
}

function maxAbs(v: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) m = Math.max(m, Math.abs(v[i]))
  return m || 1
}

export const view: View = {
  mount(host, app, arg) {
    const { tr } = app
    const wrap = el('div', 'am-ti')
    const listBox = el('div', 'am-ti-list')
    const bar = el('div', 'am-bar')
    const search = el('input')
    search.type = 'search'
    search.placeholder = tr('텐서 검색', 'Search tensors')
    bar.append(search)
    const list = el('div', 'am-scroll')
    listBox.append(bar, list)
    const main = el('div', 'am-ti-main')
    wrap.append(listBox, main)
    host.append(el('style', undefined, CSS), wrap)
    const svgs: SVGSVGElement[] = []
    app.setExportSvg(() => svgs[0] ?? null)

    const all = app.ir.tensors
    let items: TensorInfo[] = all
    let current = arg && app.tensorsByName.has(arg) ? arg : (all.find((t) => t.shape.length >= 2 && t.read)?.name ?? all[0]?.name ?? '')
    const filter = () => {
      const q = search.value.trim().toLowerCase()
      items = q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all
    }
    const vl = virtualList(list, 24, () => items.length, (i) => {
      const t = items[i]
      const d = el('div', 'am-ti-item' + (t.name === current ? ' sel' : ''), t.name)
      d.title = `${t.name} · ${t.dtype} ${fmtShape(t.shape)}`
      d.addEventListener('click', () => {
        current = t.name
        vl.refresh()
        void show(t)
      })
      return d
    }, app.signal)
    search.addEventListener('input', () => (filter(), vl.refresh()), { signal: app.signal })

    let gen = 0
    async function show(t: TensorInfo) {
      const my = ++gen
      svgs.length = 0
      main.replaceChildren(el('h3', 'am-mono', t.name), el('div', 'am-info', `${t.dtype} · ${fmtShape(t.shape)} · ${fmtInt(numel(t.shape))} ${tr('원소', 'elements')} · ${fmtBytes(t.byteLength)}`))
      app.detail(tensorDetail(app, t.name))
      if (!t.read) {
        main.append(el('p', 'am-info', tr('이 텐서의 값은 파일에 저장되어 있지 않거나 읽을 수 없습니다.', 'The values of this tensor are not stored in the file or cannot be read.')))
        return
      }
      if (!decodable(t.dtype)) {
        main.append(el('p', 'am-info', tr(`dtype ${t.dtype}은(는) 값으로 풀지 않습니다(패킹·양자화 블록 형식). 모양과 크기만 표시합니다.`, `dtype ${t.dtype} is not decoded (packed/quantized block format): shape and size only.`)))
        return
      }
      const loading = el('p', 'am-info', tr('값을 읽는 중…', 'Reading values…'))
      main.append(loading)
      let s
      try {
        s = await sampleValues(t)
      } catch (e) {
        loading.textContent = tr(`값을 읽지 못했습니다: ${(e as Error).message}`, `Could not read values: ${(e as Error).message}`)
        return
      }
      if (my !== gen || app.signal.aborted) return
      loading.remove()
      const st = stats(s.values)
      const grid = el('div', 'am-ti-grid')
      main.append(grid)
      const card = (title: string) => {
        const c = el('div', 'am-ti-card')
        c.append(el('h4', undefined, title))
        grid.append(c)
        return c
      }
      const sc = card(tr('통계', 'Statistics') + (s.sampled ? tr(` (표본 ${fmtBytes(s.bytes)})`, ` (sample of ${fmtBytes(s.bytes)})`) : ''))
      sc.append(kvTable([
        ['min', fmtNum(st.min)],
        ['max', fmtNum(st.max)],
        ['mean', fmtNum(st.mean)],
        ['std', fmtNum(st.std)],
        [tr('0 비율', 'zeros'), `${((st.zeros / Math.max(1, st.count)) * 100).toFixed(2)}%`],
        ['NaN', fmtInt(st.nan)],
        ['Inf', fmtInt(st.inf)],
        [tr('읽은 원소', 'values read'), fmtInt(st.count)]
      ]))
      if (t.quant?.scale?.length === 1 && t.quant.axis === undefined) sc.append(el('div', 'am-info', tr('양자화 값 → 실수로 복원 (scale·zero point)', 'Quantized values dequantized (scale, zero point)')))
      else if (/^q/.test(t.dtype)) sc.append(el('div', 'am-info', tr('채널별 양자화: 저장된 정수 값', 'Per-channel quantized: stored integer values')))
      // Histogram (SVG, exportable).
      if (Number.isFinite(st.min) && st.count) {
        const bins = 64
        const h = histogram(s.values, bins, st.min, st.max)
        const W = 320
        const H = 140
        const peak = Math.max(...h) || 1
        const g = svg('svg', { width: W, height: H + 20, viewBox: `0 0 ${W} ${H + 20}`, xmlns: 'http://www.w3.org/2000/svg' })
        g.append(svg('rect', { x: 0, y: 0, width: W, height: H + 20, fill: app.theme() === 'dark' ? '#1e1f22' : '#ffffff' }))
        h.forEach((c, i) => {
          const bh = (c / peak) * (H - 4)
          const r = svg('rect', { x: (i * W) / bins, y: H - bh, width: W / bins - 0.5, height: bh, fill: '#4c8bf5' })
          r.append(svg('title'))
          r.firstChild!.textContent = `${fmtNum(st.min + ((st.max - st.min) * i) / bins)} … ${fmtNum(st.min + ((st.max - st.min) * (i + 1)) / bins)}: ${c}`
          g.append(r)
        })
        const txt = (x: number, anchor: string, s2: string) => {
          const e = svg('text', { x, y: H + 14, 'font-size': 10, 'text-anchor': anchor, fill: app.theme() === 'dark' ? '#bbb' : '#555', 'font-family': 'sans-serif' })
          e.textContent = s2
          g.append(e)
        }
        txt(2, 'start', fmtNum(st.min))
        txt(W - 2, 'end', fmtNum(st.max))
        if (st.min < 0 && st.max > 0) g.append(svg('line', { x1: (-st.min / (st.max - st.min)) * W, x2: (-st.min / (st.max - st.min)) * W, y1: 0, y2: H, stroke: '#c0392b', 'stroke-dasharray': '3 2' }))
        svgs.push(g)
        card(tr('히스토그램 (64 구간)', 'Histogram (64 bins)')).append(g)
      }
      // Heatmap.
      if (t.shape.length >= 1 && numel(t.shape) > 1) {
        try {
          const gridData = await heatmapGrid(t)
          if (my !== gen || app.signal.aborted) return
          if (gridData) {
            const m = maxAbs(gridData.values)
            const cv = el('canvas')
            cv.width = gridData.cols
            cv.height = gridData.rows
            const c2 = cv.getContext('2d')!
            const img = c2.createImageData(gridData.cols, gridData.rows)
            for (let i = 0; i < gridData.values.length; i++) {
              const [r, g2, b] = diverging(gridData.values[i] / m)
              img.data.set([r, g2, b, 255], i * 4)
            }
            c2.putImageData(img, 0, 0)
            const scale = Math.max(1, Math.min(4, Math.floor(512 / Math.max(gridData.cols, gridData.rows))))
            cv.style.width = `${gridData.cols * scale}px`
            cv.style.height = `${Math.max(gridData.rows * scale, 8)}px`
            const c = card(tr(`히트맵 ${fmtInt(gridData.srcRows)}×${fmtInt(gridData.srcCols)}${gridData.rows < gridData.srcRows || gridData.cols < gridData.srcCols ? ` → ${gridData.rows}×${gridData.cols} 표본` : ''}`, `Heatmap ${fmtInt(gridData.srcRows)}×${fmtInt(gridData.srcCols)}${gridData.rows < gridData.srcRows || gridData.cols < gridData.srcCols ? ` → ${gridData.rows}×${gridData.cols} sampled` : ''}`))
            c.append(cv, el('div', 'am-info', `±${fmtNum(m)} · ${tr('파랑 음수 · 빨강 양수', 'blue negative · red positive')}${gridData.note ? tr(' · 긴 행은 앞쪽 열만', ' · long rows: leading columns') : ''}`))
            cv.dataset.amHeatmap = '1'
          }
        } catch {
          // heatmap optional
        }
      }
      // Conv kernels.
      if (t.shape.length === 4) {
        try {
          const k = await convKernels(t)
          if (my !== gen || app.signal.aborted) return
          if (k) {
            const cell = Math.max(3, Math.min(12, Math.floor(48 / Math.max(k.kh, k.kw))))
            const rgb = k.ins === 3
            const cols = rgb ? Math.min(16, k.outs) : k.ins
            const rows = rgb ? Math.ceil(k.outs / cols) : k.outs
            const gap = 2
            const cv = el('canvas')
            cv.width = cols * (k.kw * cell + gap)
            cv.height = rows * (k.kh * cell + gap)
            const c2 = cv.getContext('2d')!
            c2.fillStyle = app.theme() === 'dark' ? '#222' : '#ccc'
            c2.fillRect(0, 0, cv.width, cv.height)
            const kk = k.kh * k.kw
            for (let o = 0; o < k.outs; o++) {
              if (rgb) {
                const base = o * 3 * kk
                const sub = k.values.subarray(base, base + 3 * kk)
                let lo = Infinity
                let hi = -Infinity
                for (const x of sub) (lo = Math.min(lo, x)), (hi = Math.max(hi, x))
                const span = hi - lo || 1
                const gx = (o % cols) * (k.kw * cell + gap)
                const gy = Math.floor(o / cols) * (k.kh * cell + gap)
                for (let p = 0; p < kk; p++) {
                  const [r, g2, b] = [0, 1, 2].map((ch) => Math.round(((sub[ch * kk + p] - lo) / span) * 255))
                  c2.fillStyle = `rgb(${r},${g2},${b})`
                  c2.fillRect(gx + (p % k.kw) * cell, gy + Math.floor(p / k.kw) * cell, cell, cell)
                }
              } else {
                for (let i = 0; i < k.ins; i++) {
                  const base = (o * k.ins + i) * kk
                  const sub = k.values.subarray(base, base + kk)
                  const m = maxAbs(sub)
                  const gx = i * (k.kw * cell + gap)
                  const gy = o * (k.kh * cell + gap)
                  for (let p = 0; p < kk; p++) {
                    const [r, g2, b] = diverging(sub[p] / m)
                    c2.fillStyle = `rgb(${r},${g2},${b})`
                    c2.fillRect(gx + (p % k.kw) * cell, gy + Math.floor(p / k.kw) * cell, cell, cell)
                  }
                }
              }
            }
            const [O, I] = t.shape
            const c = card(rgb ? tr(`합성곱 커널 ${k.outs}/${O}개 (RGB 입력, 컬러)`, `Conv kernels ${k.outs}/${O} (RGB input, colour)`) : tr(`합성곱 커널: 출력 ${k.outs}/${O} × 입력 ${k.ins}/${I}`, `Conv kernels: ${k.outs}/${O} out × ${k.ins}/${I} in`))
            c.append(cv)
            cv.dataset.amKernels = '1'
          }
        } catch {
          // optional
        }
      }
    }
    const first = app.tensorsByName.get(current)
    if (first) void show(first)
    if (arg) {
      const i = items.findIndex((t) => t.name === arg)
      if (i >= 0) vl.scrollTo(i)
    }
  }
}
