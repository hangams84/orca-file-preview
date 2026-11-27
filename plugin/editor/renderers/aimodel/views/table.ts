/** Layer table: every tensor with owner type, shape, dtype, #params and bytes; sortable, filterable,
 *  CSV copy; virtual rows (100k+). */
import { numel } from '../dtype.ts'
import type { TensorInfo } from '../ir.ts'
import { isBuffer } from '../tree.ts'
import { copyText, el, fmtBytes, fmtInt, fmtShape, shortType, virtualList, type App, type View } from './common.ts'
import { tensorDetail } from './detail.ts'

const CSS = `
.am-tbl-head, .am-tbl-row { display: grid; grid-template-columns: minmax(160px, 3fr) minmax(70px, 1fr) minmax(80px, 1.2fr) 64px 90px 80px 70px;
  gap: 8px; align-items: center; padding: 0 8px; box-sizing: border-box; font-size: 12px; white-space: nowrap; }
.am-tbl-head { flex: none; height: 28px; font-weight: 600; color: var(--orca-muted-foreground, #666); border-bottom: 1px solid var(--orca-border, #ddd); user-select: none; }
.am-tbl-head span { cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
.am-tbl-row { cursor: pointer; border-bottom: 1px solid var(--orca-border, #f0f0f0); }
.am-tbl-row:hover { background: var(--orca-accent, #eee); }
.am-tbl-row.sel { background: var(--orca-accent, #e4e4e4); }
.am-tbl-row span { overflow: hidden; text-overflow: ellipsis; }
.am-tbl-row .num, .am-tbl-head .num { text-align: right; font-variant-numeric: tabular-nums; }
.am-tbl-row .muted { color: var(--orca-muted-foreground, #777); }
@media (max-width: 600px) {
  .am-tbl-head, .am-tbl-row { grid-template-columns: minmax(120px, 3fr) 56px 70px; }
  .am-tbl-head .c1, .am-tbl-row .c1, .am-tbl-head .c2, .am-tbl-row .c2, .am-tbl-head .c5, .am-tbl-row .c5, .am-tbl-head .c6, .am-tbl-row .c6 { display: none; }
}
`

type Col = { key: string; ko: string; en: string; num?: boolean; get(t: TensorInfo): string | number }

export const view: View = {
  mount(host, app, arg) {
    const { tr } = app
    const cols: Col[] = [
      { key: 'name', ko: '이름', en: 'Name', get: (t) => t.name },
      { key: 'type', ko: '모듈 형식', en: 'Module type', get: (t) => shortType(app.moduleByPath.get(app.ownerOf(t.name))?.type) },
      { key: 'shape', ko: '모양', en: 'Shape', get: (t) => fmtShape(t.shape) },
      { key: 'dtype', ko: 'dtype', en: 'dtype', get: (t) => t.dtype },
      { key: 'params', ko: '#원소', en: '#params', num: true, get: (t) => numel(t.shape) },
      { key: 'bytes', ko: '바이트', en: 'Bytes', num: true, get: (t) => t.byteLength },
      { key: 'kind', ko: '종류', en: 'Kind', get: (t) => t.kind ?? (isBuffer(t) ? 'buffer' : 'param') }
    ]
    const bar = el('div', 'am-bar')
    const search = el('input')
    search.type = 'search'
    search.placeholder = tr('이름·형식·dtype 필터', 'Filter by name, type, dtype')
    const optLabel = el('label', 'am-info')
    const opt = el('input')
    opt.type = 'checkbox'
    optLabel.append(opt, ' ', tr('옵티마이저·기타 상태 포함', 'Include optimizer/other state'))
    const copy = el('button', undefined, tr('CSV 복사', 'Copy CSV'))
    const info = el('span', 'am-info')
    bar.append(search, optLabel, copy, info)
    const headEl = el('div', 'am-tbl-head')
    const list = el('div', 'am-scroll')
    host.append(el('style', undefined, CSS), bar, headEl, list)
    const hasOther = app.ir.tensors.some((t) => t.kind === 'optimizer-state' || t.kind === 'other')
    if (!hasOther) optLabel.hidden = true

    let sortKey = ''
    let sortDir = 1
    let rows: TensorInfo[] = []
    let selected = arg ?? ''
    const rebuild = () => {
      const q = search.value.trim().toLowerCase()
      rows = app.ir.tensors.filter((t) => (opt.checked || (t.kind !== 'optimizer-state' && t.kind !== 'other')) && (!q || cols.some((c) => String(c.get(t)).toLowerCase().includes(q))))
      if (sortKey) {
        const c = cols.find((x) => x.key === sortKey)!
        rows = rows.slice().sort((a, b) => {
          const x = c.get(a)
          const y = c.get(b)
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sortDir
        })
      }
      const elems = rows.reduce((s, t) => s + numel(t.shape), 0)
      info.textContent = tr(`${fmtInt(rows.length)}행 · ${fmtInt(elems)} 원소`, `${fmtInt(rows.length)} rows · ${fmtInt(elems)} elements`)
      headEl.replaceChildren(
        ...cols.map((c, i) => {
          const s = el('span', `c${i}${c.num ? ' num' : ''}`, tr(c.ko, c.en) + (sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''))
          s.addEventListener('click', () => {
            if (sortKey === c.key) sortDir = -sortDir
            else {
              sortKey = c.key
              sortDir = c.num ? -1 : 1
            }
            rebuild()
            vl.refresh()
          })
          return s
        })
      )
    }
    const render = (i: number) => {
      const t = rows[i]
      const r = el('div', 'am-tbl-row' + (t.name === selected ? ' sel' : ''))
      cols.forEach((c, k) => {
        const v = c.get(t)
        r.append(el('span', `c${k}${c.num ? ' num' : ''}${k === 1 || k === 6 ? ' muted' : ''}${k === 0 || k === 2 ? ' am-mono' : ''}`, typeof v === 'number' ? (c.key === 'bytes' ? fmtBytes(v) : fmtInt(v)) : v))
      })
      r.title = t.name
      r.addEventListener('click', () => {
        selected = t.name
        app.detail(tensorDetail(app, t.name))
        vl.refresh()
      })
      return r
    }
    rebuild()
    const vl = virtualList(list, 26, () => rows.length, render, app.signal)
    search.addEventListener('input', () => (rebuild(), vl.refresh()), { signal: app.signal })
    opt.addEventListener('change', () => (rebuild(), vl.refresh()), { signal: app.signal })
    copy.addEventListener('click', () => {
      const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
      const csv = [cols.map((c) => c.en).join(','), ...rows.map((t) => cols.map((c) => esc(String(c.get(t)))).join(','))].join('\n')
      void copyText(csv).then((ok) => {
        copy.textContent = ok ? tr('복사됨 ✓', 'Copied ✓') : tr('복사 실패', 'Copy failed')
        setTimeout(() => (copy.textContent = tr('CSV 복사', 'Copy CSV')), 1500)
      })
    }, { signal: app.signal })
    if (arg) {
      search.value = ''
      const i = rows.findIndex((t) => t.name === arg)
      if (i >= 0) vl.scrollTo(i)
    }
  }
}
