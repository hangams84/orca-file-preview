// Writes docs/install-guide/<lang>.md and docs/install-guide/README.md from the labels that
// capture.mjs read from Orca's DOM (tools/install-guide/captured/<lang>.json). The sentences around
// the labels are in text.mjs; every UI label in a page is the exact text of that language's screenshot.
//   node tools/install-guide/build-pages.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEXT, LANGS } from './text.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DOCS = path.join(ROOT, 'docs/install-guide')
const PLUGIN_URL = 'https://github.com/hangams84/orca-file-preview.git'
const DWG_URL = 'https://github.com/hangams84/orca-file-preview-dwg.git'

const bold = (s) => `**${s}**`
function fill(template, labels, lang) {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'url') return PLUGIN_URL
    if (k === 'dwgUrl') return DWG_URL
    const v = labels[k]
    if (v === undefined) throw new Error(`${lang}: no label "${k}" was captured`)
    return bold(v)
  }).replace(/\[(\w+)\]/g, (_, k) => {
    // [key] = the label quoted as plain text (for long sentences such as the resolved version).
    const v = labels[k]
    if (v === undefined) throw new Error(`${lang}: no label "${k}" was captured`)
    return v
  })
}

const index = []
for (const { code, name } of LANGS) {
  const metaFile = path.join(HERE, 'captured', `${code}.json`)
  if (!fs.existsSync(metaFile)) {
    console.warn(`skip ${code}: no capture`)
    continue
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  const t = TEXT[code]
  // All labels of the run, by key (a later step's label of the same key wins only if it was missing).
  const labels = {}
  for (const s of meta.steps) for (const [k, v] of Object.entries(s.labels)) labels[k] ??= v
  const lines = []
  lines.push(`# ${t.title}`, '')
  lines.push(fill(t.intro, labels, code).replace('{version}', meta.orcaVersion || ''), '')
  lines.push(`> ${t.labelsNote.replace('{version}', meta.orcaVersion || '')}`, '')
  lines.push(`## ${t.stepsHeading}`, '')
  for (const s of meta.steps) {
    const tpl = t.steps[s.slug]
    if (!tpl) throw new Error(`${code}: no text for step ${s.slug}`)
    // Continuation lines are indented by the width of the list marker ("9. " = 3, "10. " = 4).
    const ind = ' '.repeat(String(s.n).length + 2)
    lines.push(`${s.n}. ${fill(tpl, labels, code)}`, '')
    if (s.slug === 'repository-url') lines.push(`${ind}\`\`\`text`, `${ind}${PLUGIN_URL}`, `${ind}\`\`\``, '')
    if (s.slug === 'optional-dwg') lines.push(`${ind}\`\`\`text`, `${ind}${DWG_URL}`, `${ind}\`\`\``, '')
    lines.push(`${ind}![${t.stepAlt.replace('{n}', s.n)}](${code}/${s.file})`, '')
  }
  lines.push(`## ${t.troubleHeading}`, '')
  for (const item of t.trouble) lines.push(`- ${item}`)
  lines.push('')
  lines.push(`---`, '', t.footer, '')
  fs.writeFileSync(path.join(DOCS, `${code}.md`), lines.join('\n'))
  index.push({ code, name, steps: meta.steps.length, version: meta.orcaVersion })
  console.log(`${code}.md: ${meta.steps.length} steps`)
}

const readme = [
  '# File Preview — install guide / 설치 안내',
  '',
  'Step-by-step screenshots of installing File Preview from its GitHub URL in the Orca app',
  '(Settings → Plugins → Add plugin → From a Git URL → Install → Enable), one page per Orca UI language.',
  '',
  'Orca 앱에서 GitHub 주소로 File Preview를 설치하는 과정을 단계별 스크린샷으로 보여 줍니다. Orca UI 언어마다 한 쪽입니다.',
  '',
  '| Language | Guide | Steps | Orca |',
  '| --- | --- | --- | --- |',
  ...index.map((i) => `| ${i.name} | [${i.code}.md](${i.code}.md) | ${i.steps} | ${i.version} |`),
  '',
  'The screenshots are captured automatically from a real Orca in Docker; to refresh them after an Orca UI change see',
  '[`tools/install-guide/README.md`](../../tools/install-guide/README.md).',
  ''
]
fs.writeFileSync(path.join(DOCS, 'README.md'), readme.join('\n'))
