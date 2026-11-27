/** Checkpoint info: epoch/step, hyper-parameters, optimizers, schedulers, versions, metadata, notes. */
import type { Value } from '../ir.ts'
import { el, fmtBytes, fmtInt, fmtValue, type App, type View } from './common.ts'

function section(title: string, body: Node): HTMLElement {
  const s = el('section', 'am-section')
  s.append(el('h3', undefined, title), body)
  return s
}

function valueTable(obj: Record<string, Value>, depth = 0): HTMLElement {
  const t = el('table', 'am-table')
  for (const [k, v] of Object.entries(obj)) {
    const row = el('tr')
    const a = el('td', 'am-mono', k)
    const b = el('td', 'am-mono')
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'bigint' && depth < 3 && Object.keys(v).length <= 40) b.append(valueTable(v as Record<string, Value>, depth + 1))
    else b.textContent = fmtValue(v)
    row.append(a, b)
    t.append(row)
  }
  return t
}

export const view: View = {
  mount(host, app) {
    const { tr, ir } = app
    const scroll = el('div', 'am-scroll am-pad')
    host.append(scroll)
    const ck = ir.checkpoint
    const overview: Record<string, Value> = { [tr('형식', 'Format')]: ir.formatLabel }
    if (ir.framework) overview[tr('프레임워크', 'Framework')] = ir.framework
    if (ir.producer) overview[tr('생성 도구', 'Producer')] = ir.producer
    if (ck?.epoch !== undefined) overview['epoch'] = ck.epoch
    if (ck?.step !== undefined) overview['step'] = ck.step
    const root = app.stats.get('')
    if (root) {
      overview[tr('파라미터', 'Parameters')] = fmtInt(root.params)
      overview[tr('크기', 'Size')] = fmtBytes(root.bytes)
    }
    overview[tr('텐서', 'Tensors')] = fmtInt(ir.tensors.length)
    for (const [k, v] of Object.entries(ck?.versions ?? {})) overview[k] = v
    scroll.append(section(tr('개요', 'Overview'), valueTable(overview)))
    if (ck?.hyperParameters && Object.keys(ck.hyperParameters).length) scroll.append(section(tr('하이퍼파라미터', 'Hyper-parameters'), valueTable(ck.hyperParameters)))
    if (ck?.optimizers?.length) {
      const box = el('div')
      ck.optimizers.forEach((o, i) => {
        const head = el('div', undefined, `#${i} `)
        head.append(el('b', undefined, o.type ?? tr('형식 미상', 'unknown type')))
        if (o.inferred && o.type) head.append(' ', el('span', 'am-inferred', tr('(상태 키에서 추정 — 클래스는 저장되지 않음)', '(guessed from state keys — the class is not stored)')))
        if (o.stateTensors) head.append(el('div', 'am-info', tr(`상태 텐서 ${fmtInt(o.stateTensors)}개 · ${fmtBytes(o.stateBytes ?? 0)}`, `${fmtInt(o.stateTensors)} state tensors · ${fmtBytes(o.stateBytes ?? 0)}`)))
        box.append(head)
        if (o.groups.length) {
          const keys = [...new Set(o.groups.flatMap((g) => Object.keys(g)))]
          const t = el('table', 'am-table')
          const hr = el('tr')
          hr.append(el('th', undefined, tr('그룹', 'Group')), ...keys.map((k) => el('th', 'am-mono', k)))
          t.append(hr)
          o.groups.forEach((g, gi) => {
            const r = el('tr')
            r.append(el('td', undefined, String(gi)), ...keys.map((k) => el('td', 'am-mono', fmtValue(g[k]))))
            t.append(r)
          })
          const wrapT = el('div')
          wrapT.style.overflowX = 'auto'
          wrapT.append(t)
          box.append(wrapT)
        }
      })
      scroll.append(section(tr('옵티마이저', 'Optimizers'), box))
    }
    if (ck?.schedulers?.length) {
      const box = el('div')
      ck.schedulers.forEach((s, i) => {
        box.append(el('div', undefined, `#${i}`), valueTable(s))
      })
      scroll.append(section(tr('학습률 스케줄러', 'LR schedulers'), box))
    }
    if (ck?.extra && Object.keys(ck.extra).length) scroll.append(section(tr('기타 키', 'Other keys'), valueTable(ck.extra)))
    if (Object.keys(ir.metadata).length) scroll.append(section(tr('메타데이터', 'Metadata'), valueTable(ir.metadata)))
    if (ir.notes.length) {
      const ul = el('ul')
      for (const n of ir.notes) ul.append(el('li', n.level === 'warn' ? 'am-inferred' : undefined, tr(n.ko ?? n.en, n.en)))
      scroll.append(section(tr('노트·제한 사항', 'Notes and limitations'), ul))
    }
    if (!ck) scroll.append(el('div', 'am-info', tr('이 파일에는 학습 상태(epoch·옵티마이저 등)가 없습니다.', 'This file holds no training state (epoch, optimizer, …).')))
  }
}
