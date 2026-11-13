// Writes the GitHub release body for the current plugin version with the verification results:
//   node tools/release-notes.mjs [--ci ci-results.md] [--out dist/RELEASE_NOTES.md]
// Reads docs/evidence/round-*/summary.json + issues.json, docs/evidence/platforms/*/results.json and
// installer results, the CI table (from tools/ci-report.mjs) and dist/*.sha256.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const argv = process.argv.slice(2)
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const read = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '')
const manifest = JSON.parse(read(join(ROOT, 'plugin', 'orca-plugin.json')))
const v = manifest.version
const EV = join(ROOT, 'docs', 'evidence')

const rounds = readdirSync(EV)
  .filter((d) => /^round-\d+$/.test(d) && existsSync(join(EV, d, 'summary.json')))
  .map((d) => {
    const s = JSON.parse(read(join(EV, d, 'summary.json')))
    const issues = existsSync(join(EV, d, 'issues.json')) ? JSON.parse(read(join(EV, d, 'issues.json'))) : []
    return { ...s, issues }
  })
  .sort((a, b) => a.round - b.round)
const last = rounds.at(-1)

const PLAT = join(EV, 'platforms')
const platforms = existsSync(PLAT)
  ? readdirSync(PLAT)
      .filter((d) => existsSync(join(PLAT, d, 'results.json')))
      .map((d) => ({ dir: d, ...JSON.parse(read(join(PLAT, d, 'results.json'))) }))
  : []
const installer = existsSync(PLAT)
  ? readdirSync(PLAT)
      .map((d) => [d, [join(PLAT, d, 'installer.md'), join(PLAT, d, 'installer', 'installer.md')].find(existsSync)])
      .filter(([, f]) => f)
      .map(([d, f]) => {
        const t = read(f)
        return [d, (t.match(/✅/g) ?? []).length, (t.match(/❌/g) ?? []).length]
      })
  : []
const ci = opt('ci') && existsSync(opt('ci')) ? read(opt('ci')) : ''
const shas = readdirSync(join(ROOT, 'dist')).filter((f) => f.endsWith('.sha256')).sort().map((f) => read(join(ROOT, 'dist', f)).trim())

const repo = 'https://github.com/hangams84/orca-file-preview'
const out = []
out.push(`Read-only previews of Office, Hangul (HWP/HWPX), PDF, text, table, HTML, image and 3D model files inside [Orca](https://github.com/stablyai/orca) — desktop (Windows · macOS · Linux) and browser/mobile clients.`)
out.push(`Orca 안에서 Office · 한글(HWP/HWPX) · PDF · 텍스트 · 표 · HTML · 이미지 · 3D 모델 파일을 읽기 전용으로 미리보기 하는 플러그인입니다.`, '')
out.push('## 지원 형식 / Formats', '')
out.push(manifest.contributes.customEditors.map((e) => `**${e.title}** ${e.extensions.map((x) => '`' + x + '`').join(' ')}`).join(' · '), '')
out.push('- Requires Orca **1.4.248+** · execution `sandboxed-ui` only (no extra capabilities, no network, never edits files)')
out.push('- Korean/English UI, dark/light theme, zoom (Ctrl+wheel, pinch, buttons), phone-width layouts, EUC-KR detection, safe HTML/SVG (scripts never run)', '')
out.push('## 설치 / Install', '')
out.push('| OS | 실행 파일 / Executable | 스크립트 패키지 / Script package |', '| --- | --- | --- |')
out.push(`| Windows 10/11 | \`FilePreviewSetup-${v}.exe\` (메뉴: 설치 · 업데이트 · 제거 · 상태 / \`/install /update /uninstall /status /yes\`) | \`orca-file-preview-${v}.zip\` → \`installer\\windows\\install.cmd\` · \`update.cmd\` · \`uninstall.cmd\` |`)
out.push(`| macOS | \`File-Preview-Setup-${v}-macos.zip\` → *File Preview Setup.app* (first open: Control-click → Open) | \`file-preview-setup-${v}.run\` or \`orca-file-preview-${v}.tar.gz\` → \`installer/macos/*.command\` |`)
out.push(`| Linux | \`sh file-preview-setup-${v}.run [install\\|update\\|uninstall\\|status]\` | \`orca-file-preview-${v}.tar.gz\` → \`installer/linux/{install,update,uninstall}.sh\` |`, '')
out.push("Every installer shows the access Orca asks you to approve and approves only after you confirm. **Update** checks this repository's latest release, downloads it, verifies the SHA-256 and reinstalls (`update --check` only reports). Orca 1.4.248–1.4.251 have no `plugin install`, so the folder is registered with `plugin dev load` there. Windows 7/8 are refused with a clear message (Orca needs Windows 10+). The executables are unsigned: Windows SmartScreen → *More info* → *Run anyway*; macOS Gatekeeper → Control-click → *Open*.", '')
out.push(`Without the packages: \`orca plugin install ${repo}/tree/v${v}/plugin\` (Orca 1.4.252+).`, '')
if (shas.length) out.push('<details><summary>SHA-256</summary>', '', '```', ...shas, '```', '', '</details>', '')

out.push('## 검증 결과 / Verification', '')
if (last) {
  const ok = last.checks.filter((c) => c.ok).length
  out.push(`### Development verification — ${rounds.length} rounds (final round ${last.round}: ${ok}/${last.checks.length} checks)`, '')
  out.push('| Round | Checks | Browser harness | Issues found / fixed |', '| --- | --- | --- | --- |')
  for (const r of rounds) {
    const h = r.harness ?? []
    out.push(`| ${r.round} | ${r.checks.filter((c) => c.ok).length}/${r.checks.length} | ${h.filter((x) => x.pass).length}/${h.length} | ${r.issues.length} / ${r.issues.filter((i) => i.status === 'fixed').length} |`)
  }
  const detail = (c) => {
    const d = String(c.detail ?? '').split('\n')[0].trim()
    return d && d !== '""' ? ` (${d})` : ''
  }
  out.push('', `Final round checks: ${last.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name}${detail(c)}`).join(' · ')}`, '')
}
if (platforms.length) {
  out.push('### Fresh Orca installs per OS', '', '| Environment | Checks |', '| --- | --- |')
  for (const p of platforms) out.push(`| ${p.os} · Orca ${p.orcaVersion} | ${p.checks.filter((c) => c.ok).length}/${p.checks.length} ✅ |`)
  out.push('')
}
if (installer.length) {
  out.push('### Installer scripts', '', installer.map(([d, okN, bad]) => `${d}: ${bad ? '❌' : '✅'} ${okN}/${okN + bad}`).join(' · '), '')
}
const fid = join(EV, 'fidelity', 'final', 'report.json')
if (existsSync(fid)) {
  const rep = JSON.parse(read(fid))
  const by = {}
  for (const r of rep) (by[r.fmt] ??= []).push(r)
  out.push('### Layout fidelity vs Word / Hangul', '', '| Format | Within limits | Truth |', '| --- | --- | --- |')
  for (const [fmt, rs] of Object.entries(by))
    out.push(`| .${fmt} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${fmt === 'doc' ? 'Word 2021 PDF export' : "Hangul's saved line layout"} |`)
  const bad = rep.filter((r) => !r.pass)
  if (bad.length) out.push('', `Outside limits: ${bad.map((r) => `\`${r.file.split('/').pop()}\``).join(', ')} — see [docs/evidence/fidelity/final/report.md](${repo}/blob/v${v}/docs/evidence/fidelity/final/report.md) (LibreOffice-made, HTML-as-.doc and DOCX-as-.doc fixtures).`)
  out.push('')
}
if (ci) out.push('### Orca version matrix (CI)', '', ci.trim(), '')
out.push(`Full reports, screenshots and charts: [docs/README.md](${repo}/blob/v${v}/docs/README.md) · [docs/index.html](${repo}/blob/v${v}/docs/index.html)`, '')
out.push('## Known limitations', '')
out.push("- Orca opens `.txt .csv .tsv .log .html .svg` (and text-like files) in its own Source view first: pick the preview with the view toggle at the tab's top right.")
out.push('- Office rendering is a preview, not Office: charts/SmartArt in PPTX and cell styles in sheets are simplified; spreadsheets show the first 20,000 rows; .hwp equations/charts/OLE objects show as labelled boxes; 3D glTF with external .bin/textures and meshopt compression is not supported (no network).')
out.push('- Tested on real Orca for Windows 11, Ubuntu 22.04/24.04 and macOS 15; mobile clients were tested through the browser harness (phone profiles, WebKit, older-engine mode), not on physical devices.')
const file = opt('out') ?? join(ROOT, 'dist', 'RELEASE_NOTES.md')
writeFileSync(file, out.join('\n') + '\n')
console.log(`release notes → ${file}`)
