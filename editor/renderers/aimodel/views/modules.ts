/** Module tree: collapsible hierarchy with parameters, size, dtypes and share per module (virtual list). */
import type { ModuleNode } from '../ir.ts'
import { dtypeColor, el, fmtBytes, fmtCount, fmtInt, shortType, virtualList, type App, type View } from './common.ts'
import { moduleDetail } from './detail.ts'

const CSS = `
.am-tree-row { display: flex; align-items: center; gap: 6px; padding: 0 8px; box-sizing: border-box; cursor: pointer; white-space: nowrap; font-size: 12.5px; }
.am-tree-row:hover { background: var(--orca-accent, #eee); }
.am-tree-row.sel { background: var(--orca-accent, #e4e4e4); outline: 1px solid var(--orca-ring, #48f); outline-offset: -1px; }
.am-tree-row .tg { width: 14px; text-align: center; color: var(--orca-muted-foreground, #666); flex: none; }
.am-tree-row .nm { overflow: hidden; text-overflow: ellipsis; min-width: 40px; }
.am-tree-row .ty { color: var(--orca-muted-foreground, #666); overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
.am-tree-row .sp { flex: 1 1 auto; }
.am-tree-row .pc { font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; }
.am-tree-row .by { font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; color: var(--orca-muted-foreground, #666); }
.am-tree-row .share { width: 60px; height: 6px; background: var(--orca-muted, #eee); border-radius: 3px; overflow: hidden; flex: none; }
.am-tree-row .share i { display: block; height: 100%; background: var(--orca-primary, #4c8bf5); opacity: .7; }
.am-tree-row .dt { display: flex; gap: 2px; flex: none; }
@media (max-width: 600px) { .am-tree-row .by, .am-tree-row .share, .am-tree-row .ty { display: none; } }
`

interface Row {
  node: ModuleNode
  depth: number
}

export const view: View = {
  mount(host, app, arg) {
    const { tr } = app
    const style = el('style', undefined, CSS)
    const bar = el('div', 'am-bar')
    const search = el('input')
    search.type = 'search'
    search.placeholder = tr('모듈·형식 필터', 'Filter modules or types')
    const expandAll = el('button', undefined, tr('모두 펼치기', 'Expand all'))
    const collapseAll = el('button', undefined, tr('모두 접기', 'Collapse all'))
    const info = el('span', 'am-info')
    bar.append(search, expandAll, collapseAll, info)
    const list = el('div', 'am-scroll')
    host.append(style, bar, list)

    const open = new Set<string>([''])
    // Open the first levels while they stay small.
    const autoOpen = (n: ModuleNode, depth: number) => {
      if (depth >= 2 || n.children.length > 50) return
      open.add(n.path)
      n.children.forEach((c) => autoOpen(c, depth + 1))
    }
    autoOpen(app.modules, 0)
    let selected = arg && app.moduleByPath.has(arg) ? arg : ''
    if (arg) {
      // Reveal the selected module.
      const parts = arg.split('.')
      for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('.'))
    }
    const rootParams = app.stats.get('')?.params || 1
    let rows: Row[] = []
    const rebuild = () => {
      const q = search.value.trim().toLowerCase()
      rows = []
      const matches = (n: ModuleNode): boolean => !q || n.path.toLowerCase().includes(q) || (n.type ?? '').toLowerCase().includes(q) || n.children.some(matches)
      const visit = (n: ModuleNode, depth: number) => {
        if (q && !matches(n)) return
        rows.push({ node: n, depth })
        if (open.has(n.path) || q) for (const c of n.children) visit(c, depth + 1)
      }
      visit(app.modules, 0)
      info.textContent = tr(`모듈 ${fmtInt(app.moduleByPath.size)}개`, `${fmtInt(app.moduleByPath.size)} modules`)
    }
    const render = (i: number): HTMLElement => {
      const { node, depth } = rows[i]
      const st = app.stats.get(node.path)
      const r = el('div', 'am-tree-row' + (node.path === selected ? ' sel' : ''))
      r.style.paddingLeft = `${8 + depth * 16}px`
      r.dataset.path = node.path
      const tg = el('span', 'tg', node.children.length ? (open.has(node.path) ? '▾' : '▸') : '')
      const nm = el('span', 'nm', node.path === '' ? node.name || 'model' : node.name)
      const ty = el('span', 'ty', shortType(node.type) + (node.inferred && node.type ? '~' : ''))
      if (node.type) ty.title = node.type + (node.inferred ? tr(' (이름·모양에서 추론)', ' (inferred from names and shapes)') : '')
      const sp = el('span', 'sp')
      const dt = el('span', 'dt')
      if (st) for (const d of [...st.dtypes.keys()].slice(0, 3)) {
        const c = el('span', 'am-chip', d)
        c.style.borderLeft = `3px solid ${dtypeColor(d)}`
        dt.append(c)
      }
      const pc = el('span', 'pc', st ? fmtCount(st.params) : '')
      if (st) pc.title = `${fmtInt(st.params)} ${tr('파라미터', 'parameters')}${st.buffers ? ` + ${fmtInt(st.buffers)} ${tr('버퍼', 'buffer')}` : ''}`
      const by = el('span', 'by', st ? fmtBytes(st.bytes) : '')
      const share = el('span', 'share')
      const fill = el('i')
      fill.style.width = `${Math.min(100, ((st?.params ?? 0) / rootParams) * 100)}%`
      share.append(fill)
      r.append(tg, nm, ty, sp, dt, pc, by, share)
      r.addEventListener('click', (e) => {
        if (node.children.length && (e.target === tg || node.path === selected)) {
          if (open.has(node.path)) open.delete(node.path)
          else open.add(node.path)
        }
        selected = node.path
        app.detail(moduleDetail(app, node.path))
        rebuild()
        vl.refresh()
      })
      return r
    }
    rebuild()
    const vl = virtualList(list, 26, () => rows.length, render, app.signal)
    search.addEventListener('input', () => {
      rebuild()
      vl.refresh()
    }, { signal: app.signal })
    expandAll.addEventListener('click', () => {
      for (const p of app.moduleByPath.keys()) open.add(p)
      rebuild()
      vl.refresh()
    }, { signal: app.signal })
    collapseAll.addEventListener('click', () => {
      open.clear()
      open.add('')
      rebuild()
      vl.refresh()
    }, { signal: app.signal })
    if (arg && app.moduleByPath.has(arg)) {
      app.detail(moduleDetail(app, arg))
      vl.scrollTo(rows.findIndex((r) => r.node.path === arg))
    }
  }
}
