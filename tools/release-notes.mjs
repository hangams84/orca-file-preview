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
const shaFile = join(ROOT, 'dist', `orca-file-preview-${v}.zip.sha256`)
const sha = existsSync(shaFile) ? read(shaFile).split(/\s+/)[0] : ''

const repo = 'https://github.com/hangams84/orca-file-preview'
const out = []
out.push(`Read-only previews of Office, PDF, text, table, HTML and image files inside [Orca](https://github.com/stablyai/orca) — desktop (Windows · macOS · Linux) and browser/mobile clients.`)
out.push(`Orca 안에서 Office · PDF · 텍스트 · 표 · HTML · 이미지 파일을 읽기 전용으로 미리보기 하는 플러그인입니다.`, '')
out.push('## 지원 형식 / Formats', '')
out.push('`.docx` `.doc` · `.pptx` `.ppt` · `.xlsx` `.xlsm` `.xls` `.ods` · `.pdf` · `.txt` `.log` · `.csv` `.tsv` · `.html` `.htm` `.xhtml` · `.svg` · `.gif` `.bmp`', '')
out.push('- Requires Orca **1.4.248+** · execution `sandboxed-ui` only (no extra capabilities, no network, never edits files)')
out.push('- Korean/English UI, dark/light theme, zoom (Ctrl+wheel, pinch, buttons), phone-width layouts, EUC-KR detection, safe HTML/SVG (scripts never run)', '')
out.push('## 설치 / Install', '')
out.push(`1. Download \`orca-file-preview-${v}.zip\` below and unzip it (a \`File Preview\` folder).`)
out.push('2. Windows: double-click `installer\\windows\\install.cmd` · macOS: double-click `installer/macos/Install File Preview.command` · Linux: `sh installer/linux/install.sh`')
out.push(`3. Or without the zip: \`orca plugin install ${repo}/tree/v${v}/plugin\``, '')
out.push('The installer shows the access Orca asks you to approve and approves only after you confirm; running it again updates the plugin. Uninstall with the matching `uninstall` script.', '')
if (sha) out.push(`SHA-256 \`orca-file-preview-${v}.zip\`: \`${sha}\``, '')

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
if (ci) out.push('### Orca version matrix (CI)', '', ci.trim(), '')
out.push(`Full reports, screenshots and charts: [docs/README.md](${repo}/blob/v${v}/docs/README.md) · [docs/index.html](${repo}/blob/v${v}/docs/index.html)`, '')
out.push('## Known limitations', '')
out.push("- Orca opens `.txt .csv .tsv .log .html .svg` (and text-like files) in its own Source view first: pick the preview with the view toggle at the tab's top right.")
out.push('- Office rendering is a preview, not Office: charts/SmartArt in PPTX, headers in .doc, and cell styles in sheets are simplified; spreadsheets show the first 20,000 rows.')
out.push('- Tested on real Orca for Windows 11, Ubuntu 22.04/24.04 and macOS 15; mobile clients were tested through the browser harness (phone profiles, WebKit, older-engine mode), not on physical devices.')
const file = opt('out') ?? join(ROOT, 'dist', 'RELEASE_NOTES.md')
writeFileSync(file, out.join('\n') + '\n')
console.log(`release notes → ${file}`)
