/** An EPLAN project folder (`<name>.edb`, next to the `.elk` link file) given as companion files.
 *
 *  Its real structure (public EPLAN 2026 sample project, docs/evidence/companions-eng/README.md): not SQLite,
 *  SQL CE or XML, but EPLAN's own object store — one `.eod` data file + `.eox` index per object class
 *  (Page, Function, Article, Connection …), records tagged `33 e8 <class u16> <id u32>`, many of them
 *  zlib-compressed, plus `ProjectInfo.xml` (all project properties), `Images/`, and symbol (`*.sdb`) and
 *  function-definition (`FctDefLib.fdb`) sub-stores of the same kind. The viewer reads ProjectInfo.xml, the page
 *  descriptions in Page.eod and the parts in Article.eod (part number + descriptions, by pattern). */
import type { CompanionFile } from '../../core/companions.ts'
import { unzlibSync } from '../../../vendor/zip.js'
import type { Archive, ArchiveEntry } from './eplan.ts'

/** The `.edb` folder among the companion files: the one named by the link file, else the only one that has a
 *  ProjectInfo.xml. Returns its path prefix (`a/b/Project.edb/`) and the candidates. */
export function findEdb(files: readonly CompanionFile[], dataDir: string): { prefix: string | null; candidates: string[] } {
  const dirs = new Set<string>()
  for (const f of files) {
    const p = f.path.replace(/\\/g, '/')
    const m = /^(.*?[^/]+\.edb)\//i.exec(p)
    if (m) dirs.add(m[1])
  }
  const withInfo = [...dirs].filter((d) => files.some((f) => f.path.replace(/\\/g, '/').toLowerCase() === `${d}/projectinfo.xml`.toLowerCase()))
  const want = dataDir.replace(/^.*[\\/$)]/, '').toLowerCase()
  const named = [...dirs].find((d) => d.split('/').pop()!.toLowerCase() === want)
  const pick = named ?? (withInfo.length === 1 ? withInfo[0] : null)
  return { prefix: pick ? `${pick}/` : null, candidates: withInfo.length ? withInfo : [...dirs] }
}

/** The files under `prefix` as an Archive, so the project-backup view can show them. */
export function edbArchive(files: readonly CompanionFile[], prefix: string): Archive {
  const lower = prefix.toLowerCase()
  const entries: ArchiveEntry[] = files
    .filter((f) => f.path.replace(/\\/g, '/').toLowerCase().startsWith(lower))
    .map((f) => ({
      path: f.path.replace(/\\/g, '/').slice(prefix.length),
      size: f.file.size,
      dir: false,
      mtime: new Date(f.file.lastModified),
      read: async () => new Uint8Array(await f.file.arrayBuffer())
    }))
  return { format: 'zip', entries, methods: [], solid: false, encrypted: false }
}

export interface EdbArticle {
  partNumber: string
  /** Multilingual descriptions (`en_US@…;de_DE@…;`), in record order. */
  texts: string[]
  record: number
}

const ARTICLE_CLASS = 0x75

/** Part records of Article.eod: each `33 e8 75 00 <id>` record, stored plain or zlib-compressed. The part
 *  number is the string after tag `32 f3` (seen in every record that has one); descriptions are the
 *  multilingual strings. */
export function scanArticles(eod: Uint8Array, limit = 20000): EdbArticle[] {
  const out: EdbArticle[] = []
  const seen = new Set<number>()
  const visit = (r: Uint8Array) => {
    for (let i = 0; i + 8 < r.length && out.length < limit; i++) {
      if (r[i] !== 0x33 || r[i + 1] !== 0xe8 || r[i + 2] !== ARTICLE_CLASS || r[i + 3] !== 0) continue
      const id = r[i + 4] | (r[i + 5] << 8) | (r[i + 6] << 16) | (r[i + 7] << 24)
      if (seen.has(id)) continue
      let end = r.length
      for (let k = i + 8; k + 3 < r.length; k++)
        if (r[k] === 0x33 && r[k + 1] === 0xe8 && r[k + 2] === ARTICLE_CLASS && r[k + 3] === 0) {
          end = k
          break
        }
      const rec = r.subarray(i, end)
      const part = readArticle(rec)
      if (part.partNumber || part.texts.length) {
        seen.add(id)
        out.push({ ...part, record: id })
      }
      i = end - 1
    }
  }
  visit(eod)
  // zlib streams (78 01 / 5e / 9c / da) hold the compressed records.
  for (let i = 0; i + 2 < eod.length && out.length < limit; i++) {
    if (eod[i] !== 0x78 || (eod[i + 1] !== 0x01 && eod[i + 1] !== 0x5e && eod[i + 1] !== 0x9c && eod[i + 1] !== 0xda)) continue
    if (((eod[i] << 8) | eod[i + 1]) % 31 !== 0) continue
    let r: Uint8Array
    try {
      r = unzlibSync(eod.subarray(i, Math.min(eod.length, i + 4 * 1024 * 1024)))
    } catch {
      continue
    }
    if (r.length < 12 || r[0] !== 0x33 || r[1] !== 0xe8) continue
    visit(r)
  }
  return out
}

const utf8 = new TextDecoder('utf-8')

function readArticle(rec: Uint8Array): { partNumber: string; texts: string[] } {
  let partNumber = ''
  for (let k = 8; k + 2 < rec.length; k++) {
    if (rec[k] !== 0x32 || rec[k + 1] !== 0xf3) continue
    let e = k + 2
    while (e < rec.length && rec[e] !== 0 && e - k < 120) e++
    const s = utf8.decode(rec.subarray(k + 2, e))
    if (e < rec.length && rec[e] === 0 && /^[\x20-\x7e -￿]{1,100}$/.test(s)) {
      partNumber = s
      break
    }
  }
  const texts: string[] = []
  const str = utf8.decode(rec)
  for (const m of str.matchAll(/(?:[a-z]{2}_[A-Z]{2}|\?\?_\?\?)@[^\u0000]*?;(?=[^@;\u0000]*(?:\u0000|$))/g)) {
    if (texts.length >= 6) break
    texts.push(m[0])
  }
  return { partNumber, texts }
}
