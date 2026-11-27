/** Side-panel contents shared by the views: a module, a tensor. */
import { numel } from '../dtype.ts'
import { isBuffer } from '../tree.ts'
import { el, fmtBytes, fmtCount, fmtInt, fmtShape, fmtValue, kvTable, shortType, type App } from './common.ts'

export function tensorLink(app: App, name: string, label = name): HTMLButtonElement {
  const b = el('button', 'am-link am-mono', label)
  b.type = 'button'
  b.title = app.tr('텐서 검사기에서 열기', 'Open in the tensor inspector')
  b.addEventListener('click', () => app.show('tensor', name))
  return b
}

export function moduleDetail(app: App, path: string): HTMLElement {
  const { tr } = app
  const m = app.moduleByPath.get(path)
  const box = el('div')
  if (!m) return box
  const st = app.stats.get(path)
  box.append(el('h3', undefined, path || m.name || tr('(루트)', '(root)')))
  box.append(el('div', 'sub', (m.type ?? tr('형식 미상', 'unknown type')) + (m.inferred ? tr(' · 이름에서 추론', ' · inferred from names') : '')))
  const rows: [string, string][] = []
  if (st) {
    rows.push([tr('파라미터', 'Parameters'), `${fmtInt(st.params)} (${fmtCount(st.params)})`])
    if (st.buffers) rows.push([tr('버퍼', 'Buffers'), fmtInt(st.buffers)])
    rows.push([tr('크기', 'Size'), fmtBytes(st.bytes)])
    rows.push([tr('텐서', 'Tensors'), fmtInt(st.tensors)])
    rows.push(['dtype', [...st.dtypes.keys()].join(', ')])
    const root = app.stats.get('')
    if (root && root.params && path) rows.push([tr('비율', 'Share'), `${((st.params / root.params) * 100).toFixed(2)}%`])
  }
  if (m.children.length) rows.push([tr('하위 모듈', 'Children'), fmtInt(m.children.length)])
  box.append(kvTable(rows))
  if (m.attrs && Object.keys(m.attrs).length) {
    box.append(el('h4', undefined, tr('속성', 'Attributes')))
    box.append(kvTable(Object.entries(m.attrs).slice(0, 200).map(([k, v]) => [k, fmtValue(v)])))
  }
  if (m.tensors.length) {
    box.append(el('h4', undefined, tr('텐서', 'Tensors')))
    const t = el('table', 'am-kv')
    for (const n of m.tensors.slice(0, 500)) {
      const info = app.tensorsByName.get(n)
      const tr_ = el('tr')
      const a = el('td')
      a.append(tensorLink(app, n, n.slice(path ? path.length + 1 : 0) || n))
      const b = el('td', 'am-mono', info ? `${info.dtype} ${fmtShape(info.shape)}` : '')
      tr_.append(a, b)
      t.append(tr_)
    }
    box.append(t)
  }
  return box
}

export function tensorDetail(app: App, name: string): HTMLElement {
  const { tr } = app
  const t = app.tensorsByName.get(name)
  const box = el('div')
  if (!t) return box
  box.append(el('h3', 'am-mono', name))
  const owner = app.ownerOf(name)
  const m = app.moduleByPath.get(owner)
  box.append(el('div', 'sub', `${t.kind ?? (isBuffer(t) ? 'buffer' : 'parameter')}${m?.type ? ` · ${shortType(m.type)}` : ''}`))
  const rows: [string, string | Node][] = [
    [tr('모양', 'Shape'), fmtShape(t.shape)],
    ['dtype', t.dtype],
    [tr('원소', 'Elements'), fmtInt(numel(t.shape))],
    [tr('바이트', 'Bytes'), `${fmtInt(t.byteLength)} (${fmtBytes(t.byteLength)})`]
  ]
  if (t.quant) rows.push([tr('양자화', 'Quantization'), fmtValue(t.quant as never)])
  if (t.storage) rows.push([tr('저장소', 'Storage'), t.storage])
  for (const [k, v] of Object.entries(t.attrs ?? {})) if (k !== 'storage') rows.push([k, fmtValue(v)])
  box.append(kvTable(rows))
  if (owner) {
    const b = el('button', 'am-link', tr(`모듈 ${owner} 보기`, `Show module ${owner}`))
    b.type = 'button'
    b.addEventListener('click', () => app.show('tree', owner))
    box.append(el('h4', undefined, tr('소속', 'Owner')), b)
  }
  if (t.read) {
    const b = el('button', 'am-link', tr('값 검사 →', 'Inspect values →'))
    b.type = 'button'
    b.addEventListener('click', () => app.show('tensor', name))
    box.append(el('h4', undefined, tr('값', 'Values')), b)
  }
  return box
}
