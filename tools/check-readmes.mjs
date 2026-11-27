#!/usr/bin/env node
// Checks the 11 language READMEs against each other and against the repository:
//   - every file starts with the same language bar, which links all 11 files;
//   - relative links resolve (files exist; #anchors exist in the target, GitHub heading slugs or explicit ids);
//     links into docs/install-guide/ may point at pages that do not exist yet (reported as notes);
//   - each README links its own install guide docs/install-guide/<code>.md and the CI table README.md#ci-matrix;
//   - README.md keeps exactly one <!-- ci-matrix:start/end --> block, and no other README copies it;
//   - the format table has the same rows with the same extensions in every language, and covers every
//     extension registered in plugin/orca-plugin.json and dwg-plugin/orca-plugin.json;
//   - the companion-file table has the same number of rows, and key facts (URLs, versions) are present.
// Usage: node tools/check-readmes.mjs [--quiet]
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const LANGS = [
  { code: 'ko', file: 'README.md', name: '한국어' },
  { code: 'en', file: 'README.en.md', name: 'English' },
  { code: 'zh-CN', file: 'README.zh-CN.md', name: '简体中文' },
  { code: 'zh-TW', file: 'README.zh-TW.md', name: '繁體中文' },
  { code: 'ja', file: 'README.ja.md', name: '日本語' },
  { code: 'de', file: 'README.de.md', name: 'Deutsch' },
  { code: 'fr', file: 'README.fr.md', name: 'Français' },
  { code: 'es', file: 'README.es.md', name: 'Español' },
  { code: 'pt-BR', file: 'README.pt-BR.md', name: 'Português (Brasil)' },
  { code: 'ru', file: 'README.ru.md', name: 'Русский' },
  { code: 'tr', file: 'README.tr.md', name: 'Türkçe' }
]
export const BAR = LANGS.map((l) => `[${l.name}](${l.file})`).join(' · ')
const FACTS = [
  'https://github.com/hangams84/orca-file-preview.git',
  'https://github.com/hangams84/orca-file-preview-dwg',
  'orca plugin install https://github.com/hangams84/orca-file-preview',
  'installer/README.md',
  'v0.4.0',
  '1.4.248',
  '1.4.252',
  'GPL-3.0-or-later',
  'MIT'
]

/** GitHub's heading anchor: lower case, drop punctuation (keep letters, marks, numbers, _ and -), spaces → -. */
export function slug(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Lines outside fenced code blocks. */
function proseLines(md) {
  const out = []
  let fence = false
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue }
    if (!fence) out.push(line)
  }
  return out
}

export function anchors(md) {
  const set = new Set()
  const seen = new Map()
  for (const line of proseLines(md)) {
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      const base = slug(h[1])
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      set.add(n ? `${base}-${n}` : base)
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) set.add(m[1])
  }
  return set
}

export function links(md) {
  const out = []
  for (const line of proseLines(md)) {
    const stripped = line.replace(/`[^`]*`/g, '')
    for (const m of stripped.matchAll(/!?\[(?:[^\]]|\][^(])*\]\(([^)\s]+)\)/g)) out.push(m[1])
  }
  return out
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim())
}

/** Markdown tables in prose order: arrays of rows (header and separator dropped). */
export function tables(md) {
  const out = []
  let cur = null
  for (const line of proseLines(md)) {
    if (/^\s*\|/.test(line)) {
      if (!cur) cur = []
      cur.push(line)
    } else if (cur) {
      out.push(cur.slice(2).map(splitRow))
      cur = null
    }
  }
  if (cur) out.push(cur.slice(2).map(splitRow))
  return out
}

const extsOf = (cell) => [...cell.matchAll(/`(\.[a-z0-9_]+)`/g)].map((m) => m[1])

export function check({ root = ROOT, only = null } = {}) {
  const errors = []
  const notes = []
  const docs = {}
  for (const l of LANGS) {
    if (only && !only.includes(l.code)) continue
    const p = join(root, l.file)
    if (!existsSync(p)) { errors.push(`${l.file}: missing`); continue }
    docs[l.code] = readFileSync(p, 'utf8').replace(/^﻿/, '')
  }
  if (errors.length) return { errors, notes }

  const formatTables = {}
  for (const l of LANGS) {
    const md = docs[l.code]
    if (md === undefined) continue
    const first = md.split(/\r?\n/)[0]
    if (first !== BAR) errors.push(`${l.file}: first line is not the language bar`)

    // links
    for (const target of links(md)) {
      if (/^(https?:|mailto:)/.test(target)) continue
      const [path, anchor] = target.split('#')
      const file = path ? join(root, decodeURI(path)) : join(root, l.file)
      if (!existsSync(file)) {
        if (/^docs\/install-guide\//.test(path)) notes.push(`${l.file}: ${path} does not exist yet (owned by the install-guide work)`)
        else errors.push(`${l.file}: broken link ${target}`)
        continue
      }
      if (anchor !== undefined) {
        if (statSync(file).isDirectory() || !/\.md$/.test(file)) { errors.push(`${l.file}: anchor on a non-Markdown target ${target}`); continue }
        const set = anchors(readFileSync(file, 'utf8'))
        if (!set.has(decodeURIComponent(anchor))) errors.push(`${l.file}: anchor #${anchor} not found in ${path || l.file}`)
      }
    }
    const all = links(md)
    if (!all.includes(`docs/install-guide/${l.code}.md`)) errors.push(`${l.file}: no link to docs/install-guide/${l.code}.md`)
    for (const other of LANGS) {
      if (other.code !== l.code && all.includes(`docs/install-guide/${other.code}.md`))
        errors.push(`${l.file}: links another language's guide docs/install-guide/${other.code}.md`)
    }
    if (l.code !== 'ko' && !all.includes('README.md#ci-matrix')) errors.push(`${l.file}: no link to README.md#ci-matrix`)

    // CI markers
    const starts = md.split('<!-- ci-matrix:start -->').length - 1
    const ends = md.split('<!-- ci-matrix:end -->').length - 1
    if (l.code === 'ko') {
      if (starts !== 1 || ends !== 1) errors.push(`${l.file}: expected one ci-matrix block, found ${starts}/${ends}`)
      if (!/<a id="ci-matrix"><\/a>[\s\S]*<!-- ci-matrix:start -->/.test(md)) errors.push(`${l.file}: <a id="ci-matrix"> must come before the CI block`)
    } else if (starts || ends) errors.push(`${l.file}: must not copy the ci-matrix block`)

    for (const f of FACTS) if (!md.includes(f)) errors.push(`${l.file}: missing "${f}"`)

    // tables: the format table is the first one with an extension in column 2 of most rows
    const ts = tables(md)
    const fmt = ts.find((t) => t.length >= 10 && t.filter((r) => extsOf(r[1] ?? '').length).length >= 10)
    if (!fmt) { errors.push(`${l.file}: format table not found`); continue }
    formatTables[l.code] = { rows: fmt.map((r) => extsOf(r[1] ?? '').join(' ')), companion: ts[ts.indexOf(fmt) + 1] }
    if (fmt.some((r) => r.length !== 3)) errors.push(`${l.file}: a format-table row does not have 3 cells`)
  }

  const ref = formatTables.ko
  if (ref) {
    for (const l of LANGS) {
      const t = formatTables[l.code]
      if (!t || l.code === 'ko') continue
      if (t.rows.length !== ref.rows.length) errors.push(`${l.file}: format table has ${t.rows.length} rows, README.md has ${ref.rows.length}`)
      ref.rows.forEach((exts, i) => {
        if (t.rows[i] !== exts) errors.push(`${l.file}: format row ${i + 1} extensions "${t.rows[i]}" ≠ "${exts}"`)
      })
      if ((t.companion?.length ?? 0) !== (ref.companion?.length ?? 0))
        errors.push(`${l.file}: companion table has ${t.companion?.length ?? 0} rows, README.md has ${ref.companion?.length ?? 0}`)
    }
    // coverage against the manifests
    const listed = new Set(ref.rows.join(' ').split(' ').filter(Boolean))
    for (const m of ['plugin/orca-plugin.json', 'dwg-plugin/orca-plugin.json']) {
      const p = join(root, m)
      if (!existsSync(p)) continue
      const man = JSON.parse(readFileSync(p, 'utf8'))
      for (const ed of man.contributes?.customEditors ?? []) {
        for (const ext of ed.extensions ?? []) if (!listed.has(ext)) errors.push(`README.md: ${ext} (${m}) is not in the format table`)
      }
    }
  }
  return { errors, notes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--only')
  const { errors, notes } = check({ only: i > 0 ? process.argv[i + 1].split(',') : null })
  if (!process.argv.includes('--quiet')) for (const n of notes) console.log(`note: ${n}`)
  for (const e of errors) console.error(`error: ${e}`)
  console.log(errors.length ? `check-readmes: ${errors.length} error(s)` : `check-readmes: ${LANGS.length} READMEs ok`)
  process.exit(errors.length ? 1 : 0)
}
