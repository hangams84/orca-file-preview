// Builds the project documentation from the evidence folders:
//   docs/evidence/round-<n>/summary.json   (tools/verify.mjs)
//   docs/evidence/round-<n>/issues.json    (problems found in that round and how they were fixed)
//   docs/evidence/<area>/NOTES.md          (development notes per area)
// Writes docs/README.md, docs/index.html and SVG charts under docs/evidence/charts/.
//   node tools/build-docs.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'docs')
const EV = join(DOCS, 'evidence')
mkdirSync(join(EV, 'charts'), { recursive: true })

const FORMATS = [
  ['.docx', 'Word', 'docx-preview (Apache-2.0) + JSZip', 'Pages, styles, tables, images, lists; zoom / fit width'],
  ['.doc', 'Word 97-2003', 'Own OLE/CFB + piece-table parser', 'Text, paragraphs, tables, page breaks'],
  ['.pptx', 'PowerPoint', 'Own OOXML renderer (fflate)', 'Positioned text, pictures, tables, fills, notes'],
  ['.ppt', 'PowerPoint 97-2003', 'Own CFB record parser', 'Per-slide titles and body text, pictures'],
  ['.xlsx .xlsm .xls .ods', 'Spreadsheets', 'SheetJS CE 0.20.3 (Apache-2.0)', 'Sheet picker, merged cells, formatted values, sticky headers'],
  ['.pdf', 'PDF', 'pdf.js 6.5 (Apache-2.0)', 'Lazy page rendering, page navigation, zoom, CJK cMaps'],
  ['.gif .bmp', 'Images', 'Browser decoder', 'Animated GIF, fit / zoom / pinch, dimensions'],
  ['.svg', 'SVG', 'Browser <img> (scripts never run)', 'Zoom, source view'],
  ['.html .htm', 'HTML', 'DOMPurify (Apache-2.0 / MPL-2.0)', 'Sanitised preview, source view, links blocked'],
  ['.csv .tsv', 'Tables', 'Own RFC 4180 parser', 'Encoding + delimiter detection, sort, filter, raw view'],
  ['.txt .log', 'Text', 'Own', 'Encoding detection (UTF-8/16, EUC-KR, …), line numbers, wrap']
]

const rounds = existsSync(EV)
  ? readdirSync(EV)
      .filter((d) => /^round-\d+$/.test(d) && existsSync(join(EV, d, 'summary.json')))
      .map((d) => {
        const s = JSON.parse(readFileSync(join(EV, d, 'summary.json'), 'utf8'))
        const issuesPath = join(EV, d, 'issues.json')
        s.issues = existsSync(issuesPath) ? JSON.parse(readFileSync(issuesPath, 'utf8')) : []
        s.dir = d
        return s
      })
      .sort((a, b) => a.round - b.round)
  : []
const areas = existsSync(EV)
  ? readdirSync(EV).filter((d) => existsSync(join(EV, d, 'NOTES.md')))
  : []

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)
function stats(r) {
  const h = r.harness ?? []
  const o = (r.orca ?? []).filter((x) => x.ok !== null)
  return {
    harnessPass: h.filter((x) => x.pass).length,
    harnessTotal: h.length,
    orcaPass: o.filter((x) => x.ok).length,
    orcaTotal: o.length,
    checksPass: r.checks.filter((c) => c.ok).length,
    checksTotal: r.checks.length,
    issues: r.issues.length,
    fixed: r.issues.filter((i) => i.status === 'fixed').length
  }
}

// ---- charts (static SVG, readable in both themes) ----
function barChart({ title, series, labels, max, unit, file }) {
  const W = 640
  const H = 280
  const pad = { l: 48, r: 16, t: 40, b: 48 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const group = iw / Math.max(1, labels.length)
  const bw = Math.min(36, (group - 16) / series.length)
  const y = (v) => pad.t + ih - (v / max) * ih
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`
  s += `<rect width="${W}" height="${H}" fill="#ffffff"/><text x="${pad.l}" y="22" font-size="14" font-weight="600" fill="#111827">${title}</text>`
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" fill="#6b7280">${Math.round(v)}${unit}</text>`
  }
  labels.forEach((lab, gi) => {
    const gx = pad.l + gi * group + (group - bw * series.length) / 2
    series.forEach((se, si) => {
      const v = se.values[gi] ?? 0
      const x = gx + si * bw
      s += `<rect x="${x + 2}" y="${y(v)}" width="${bw - 4}" height="${pad.t + ih - y(v)}" rx="3" fill="${se.color}"><title>${se.name}: ${v}${unit}</title></rect>`
      s += `<text x="${x + bw / 2}" y="${y(v) - 4}" text-anchor="middle" fill="#374151" font-size="10">${v}</text>`
    })
    s += `<text x="${pad.l + gi * group + group / 2}" y="${H - pad.b + 18}" text-anchor="middle" fill="#374151">${lab}</text>`
  })
  series.forEach((se, si) => {
    const lx = pad.l + si * 170
    s += `<rect x="${lx}" y="${H - 18}" width="10" height="10" rx="2" fill="${se.color}"/><text x="${lx + 16}" y="${H - 9}" fill="#374151">${se.name}</text>`
  })
  s += '</svg>\n'
  writeFileSync(join(EV, 'charts', file), s)
  return `evidence/charts/${file}`
}

const labels = rounds.map((r) => `Round ${r.round}`)
const st = rounds.map(stats)
const passChart = rounds.length
  ? barChart({
      title: 'Pass rate per verification round',
      labels,
      max: 100,
      unit: '%',
      file: 'pass-rate.svg',
      series: [
        { name: 'Browser harness', color: '#2563eb', values: st.map((x) => pct(x.harnessPass, x.harnessTotal)) },
        { name: 'Orca app shots', color: '#16a34a', values: st.map((x) => pct(x.orcaPass, x.orcaTotal)) },
        { name: 'Static checks', color: '#9333ea', values: st.map((x) => pct(x.checksPass, x.checksTotal)) }
      ]
    })
  : null
const issueChart = rounds.length
  ? barChart({
      title: 'Issues found and fixed per round',
      labels,
      max: Math.max(4, ...st.map((x) => x.issues)),
      unit: '',
      file: 'issues.svg',
      series: [
        { name: 'Found', color: '#f59e0b', values: st.map((x) => x.issues) },
        { name: 'Fixed', color: '#16a34a', values: st.map((x) => x.fixed) }
      ]
    })
  : null

// ---- Markdown ----
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')
const md = []
md.push('# File Preview for Orca — 개발 문서 / Development docs', '')
md.push('Orca 데스크톱(Windows · macOS · Linux)과 브라우저/모바일 클라이언트에서 Office·PDF·텍스트·이미지 파일을 **읽기 전용으로 미리보기** 하는 Orca 플러그인입니다.', '')
md.push('> HTML 버전: [index.html](index.html) · 원본 증빙 자료: [evidence/](evidence/)', '')
md.push('## 지원 형식 / Supported formats', '', '| 확장자 | 종류 | 엔진 | 기능 |', '| --- | --- | --- | --- |')
for (const f of FORMATS) md.push(`| ${f[0]} | ${f[1]} | ${f[2]} | ${f[3]} |`)
md.push('')
md.push('## 검증 라운드 요약 / Verification rounds', '')
if (rounds.length) {
  md.push(`![pass rate](${passChart})`, '', `![issues](${issueChart})`, '')
  md.push('| Round | 날짜 | 커밋 | 정적 검사 | 브라우저 하네스 | Orca 앱 | 발견/수정 |', '| --- | --- | --- | --- | --- | --- | --- |')
  rounds.forEach((r, i) => {
    const x = st[i]
    md.push(
      `| [${r.round}](#round-${r.round}) | ${r.date.slice(0, 16).replace('T', ' ')} | \`${r.commit}\` | ${x.checksPass}/${x.checksTotal} | ${x.harnessPass}/${x.harnessTotal} | ${x.orcaPass}/${x.orcaTotal} | ${x.issues}/${x.fixed} |`
    )
  })
  md.push('')
  for (const [i, r] of rounds.entries()) {
    md.push(`### Round ${r.round}`, '')
    md.push(`커밋 \`${r.commit}\` · ${r.date} · Orca ${r.orcaVersion} · ${r.platform}`, '')
    md.push('| 검사 | 결과 | 상세 |', '| --- | --- | --- |')
    for (const c of r.checks) md.push(`| ${c.name} | ${c.ok ? '✅' : '❌'} | ${esc(c.detail).slice(0, 300)} |`)
    md.push('')
    if (r.issues.length) {
      md.push('**발견된 문제와 조치 / Issues and fixes**', '', '| ID | 심각도 | 영역 | 문제 | 원인 | 조치 | 상태 |', '| --- | --- | --- | --- | --- | --- | --- |')
      for (const is of r.issues)
        md.push(`| ${is.id} | ${is.severity} | ${is.area} | ${esc(is.title)} | ${esc(is.cause)} | ${esc(is.fix)} | ${is.status} |`)
      md.push('')
    }
    const failed = (r.harness ?? []).filter((h) => !h.pass)
    if (failed.length) {
      md.push('<details><summary>하네스 실패 항목</summary>', '')
      for (const h of failed) md.push(`- ${h.profile} \`${h.file}\`: ${h.state} ${esc(h.checkError ?? '')} ${esc((h.errors ?? []).join('; ')).slice(0, 200)}`)
      md.push('', '</details>', '')
    }
    md.push(`증빙: [harness](evidence/${r.dir}/harness/) · [orca](evidence/${r.dir}/orca/) · [summary.json](evidence/${r.dir}/summary.json)`, '')
    void i
  }
} else {
  md.push('_아직 실행된 검증 라운드가 없습니다._', '')
}
if (areas.length) {
  md.push('## 영역별 개발 노트 / Development notes', '')
  for (const a of areas) md.push(`- [${a}](evidence/${a}/NOTES.md)`)
  md.push('')
}
md.push('## 구조 / Architecture', '')
md.push('```text', 'plugin/                     # 배포되는 Orca 플러그인 (orca-plugin.json, editor/, vendor/)', '  editor/main.ts            # 확장자 → 렌더러 디스패처, 파일 변경 시 재렌더', '  editor/core/              # 툴바, 줌/핀치, 인코딩 감지, i18n', '  editor/renderers/*.ts     # 형식별 렌더러 (지연 로딩)', '  vendor/                   # esbuild 로 번들한 서드파티 ESM (네트워크 없음)', 'samples/                    # 테스트 픽스처 (tools/make-samples.py)', 'tools/harness/              # Orca 유사 CSP + 모의 호스트 브라우저 하네스 (Playwright)', 'tools/verify.mjs            # 검증 라운드 실행기', 'tools/build-docs.mjs        # 이 문서 생성기', 'docs/evidence/              # 라운드별 스크린샷 · 결과 · 차트', '```', '')
writeFileSync(join(DOCS, 'README.md'), md.join('\n'))

// ---- HTML ----
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const gallery = (r) => {
  const items = []
  for (const x of r.harness ?? [])
    items.push({ src: `evidence/${r.dir}/harness/${x.shot}`, cap: `${x.file} · ${x.profile}`, ok: x.pass, kind: x.profile })
  for (const x of r.orca ?? [])
    if (x.shot) items.push({ src: `evidence/${r.dir}/orca/${x.shot}`, cap: `${x.file} · Orca ${x.size}`, ok: x.ok, kind: `orca-${x.size}` })
  return items
}
const roundHtml = rounds
  .map((r, i) => {
    const x = st[i]
    const items = gallery(r)
    const kinds = [...new Set(items.map((it) => it.kind))]
    return `<section class="round" id="round-${r.round}">
  <h3>Round ${r.round} <small>${h(r.date.slice(0, 16).replace('T', ' '))} · <code>${h(r.commit)}</code> · Orca ${h(r.orcaVersion)}</small></h3>
  <div class="kpis">
    <div><b>${x.checksPass}/${x.checksTotal}</b><span>정적 검사</span></div>
    <div><b>${x.harnessPass}/${x.harnessTotal}</b><span>브라우저 하네스</span></div>
    <div><b>${x.orcaPass}/${x.orcaTotal}</b><span>Orca 앱</span></div>
    <div><b>${x.issues}/${x.fixed}</b><span>발견 / 수정</span></div>
  </div>
  <table><thead><tr><th>검사</th><th>결과</th><th>상세</th></tr></thead><tbody>
  ${r.checks.map((c) => `<tr><td>${h(c.name)}</td><td>${c.ok ? '✅' : '❌'}</td><td><pre>${h(c.detail).slice(0, 600)}</pre></td></tr>`).join('')}
  </tbody></table>
  ${
    r.issues.length
      ? `<h4>발견된 문제와 조치</h4><table><thead><tr><th>ID</th><th>심각도</th><th>영역</th><th>문제</th><th>원인</th><th>조치</th><th>상태</th></tr></thead><tbody>${r.issues
          .map(
            (is) =>
              `<tr><td>${h(is.id)}</td><td><span class="sev ${h(is.severity)}">${h(is.severity)}</span></td><td>${h(is.area)}</td><td>${h(is.title)}</td><td>${h(is.cause)}</td><td>${h(is.fix)}</td><td>${h(is.status)}</td></tr>`
          )
          .join('')}</tbody></table>`
      : ''
  }
  <details><summary>스크린샷 ${items.length}장</summary>
    <div class="filters">${['all', ...kinds].map((k) => `<button data-k="${h(k)}">${h(k)}</button>`).join('')}</div>
    <div class="grid">${items
      .map(
        (it) =>
          `<figure data-k="${h(it.kind)}" class="${it.ok ? '' : 'bad'}"><a href="${h(it.src)}" target="_blank"><img loading="lazy" src="${h(it.src)}" alt="${h(it.cap)}"></a><figcaption>${it.ok ? '✅' : '❌'} ${h(it.cap)}</figcaption></figure>`
      )
      .join('')}</div>
  </details>
</section>`
  })
  .join('\n')

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>File Preview Docs</title>
<style>
:root { --bg:#ffffff; --fg:#111827; --muted:#6b7280; --card:#f9fafb; --border:#e5e7eb; --accent:#2563eb; --ok:#16a34a; --bad:#dc2626; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0b0f17; --fg:#e5e7eb; --muted:#9ca3af; --card:#111827; --border:#1f2937; --accent:#60a5fa; } }
:root[data-theme="dark"] { --bg:#0b0f17; --fg:#e5e7eb; --muted:#9ca3af; --card:#111827; --border:#1f2937; --accent:#60a5fa; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; } h2 { margin-top: 40px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
h3 small { font-weight: 400; color: var(--muted); font-size: 13px; }
p.lead { color: var(--muted); margin-top: 0; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: var(--card); }
pre { margin: 0; white-space: pre-wrap; font-size: 12px; }
code { font-size: 13px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin: 12px 0; }
.kpis div { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.kpis b { display: block; font-size: 22px; } .kpis span { color: var(--muted); font-size: 13px; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.charts img { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 10px; }
figure { margin: 0; background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
figure.bad { border-color: var(--bad); }
figure img { width: 100%; height: 150px; object-fit: cover; object-position: top; display: block; background: #fff; }
figcaption { font-size: 12px; padding: 4px 8px; color: var(--muted); word-break: break-all; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.filters button { border: 1px solid var(--border); background: var(--card); color: var(--fg); border-radius: 999px; padding: 2px 10px; cursor: pointer; }
.filters button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.sev { padding: 1px 6px; border-radius: 4px; font-size: 12px; background: var(--card); }
.sev.high { color: #fff; background: var(--bad); } .sev.medium { background: #f59e0b; color: #111; }
details summary { cursor: pointer; color: var(--accent); }
.toggle { position: fixed; top: 10px; right: 12px; border:1px solid var(--border); background: var(--card); color: var(--fg); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
</style></head>
<body><button class="toggle" id="theme" type="button">◐</button><main>
<h1>File Preview for Orca</h1>
<p class="lead">Orca 데스크톱(Windows · macOS · Linux)과 브라우저/모바일 클라이언트에서 Office · PDF · 텍스트 · 이미지 파일을 읽기 전용으로 미리보기 하는 플러그인 — 개발 및 검증 기록</p>
<h2>지원 형식</h2>
<table><thead><tr><th>확장자</th><th>종류</th><th>엔진</th><th>기능</th></tr></thead><tbody>
${FORMATS.map((f) => `<tr><td><code>${h(f[0])}</code></td><td>${h(f[1])}</td><td>${h(f[2])}</td><td>${h(f[3])}</td></tr>`).join('')}
</tbody></table>
<h2>검증 라운드</h2>
${rounds.length ? `<div class="charts"><img src="${passChart}" alt="pass rate per round"><img src="${issueChart}" alt="issues per round"></div>` : '<p>아직 실행된 검증 라운드가 없습니다.</p>'}
${roundHtml}
${areas.length ? `<h2>영역별 개발 노트</h2><ul>${areas.map((a) => `<li><a href="evidence/${a}/NOTES.md">${h(a)}</a> · <a href="evidence/${a}/results.md">results</a></li>`).join('')}</ul>` : ''}
<p style="color:var(--muted);font-size:13px;margin-top:40px">Generated by tools/build-docs.mjs · ${new Date().toISOString()}</p>
</main>
<script>
document.querySelectorAll('.round').forEach((sec) => {
  const btns = sec.querySelectorAll('.filters button');
  const set = (k) => { btns.forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    sec.querySelectorAll('figure').forEach((f) => { f.style.display = k === 'all' || f.dataset.k === k ? '' : 'none'; }); };
  btns.forEach((b) => b.addEventListener('click', () => set(b.dataset.k))); if (btns.length) set('all');
});
document.getElementById('theme').addEventListener('click', () => {
  const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = dark ? 'light' : 'dark';
});
</script>
</body></html>
`
writeFileSync(join(DOCS, 'index.html'), html)
console.log(`docs: ${rounds.length} rounds, ${areas.length} area notes → docs/README.md, docs/index.html`)
