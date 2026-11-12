/** PowerPoint 97-2003 binary (.ppt) reader: Current User -> UserEditAtom chain -> persist
 *  directory -> DocumentContainer and slides; then each slide's OfficeArt drawing gives shapes
 *  (anchors, fills, pictures) and text (ClientTextbox atoms or OutlineTextRef into the
 *  SlideListWithText). Text styling comes from StyleTextPropAtom. */
import { readBlip } from './blip.ts'
import type { Cfb } from './cfb.ts'
import type { Picture } from './model.ts'

export class PptError extends Error {
  readonly code: 'encrypted' | 'corrupt'
  constructor(code: 'encrypted' | 'corrupt', message: string) {
    super(message)
    this.code = code
  }
}

export interface PptRun {
  text: string
  b?: boolean
  i?: boolean
  u?: boolean
  /** Points. */
  size?: number
  color?: string
  /** Face name from the font collection. */
  font?: string
}

export interface PptPara {
  runs: PptRun[]
  level: number
  bullet?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  /** Multiple of single line spacing (1 = 100 %). */
  lineSpacing?: number
  /** Space before, in lines. */
  spaceBefore?: number
}

export interface PptShape {
  /** Rectangle in master units (576 per inch). */
  x: number
  y: number
  w: number
  h: number
  /** 0 title, 1 body, 2 notes, 4 other, 5 centre body, 6 centre title, 7 half body, 8 quarter body. */
  textType?: number
  paras?: PptPara[]
  picture?: number
  fill?: string
  line?: string
  valign?: 'top' | 'middle' | 'bottom'
  /** Shape lacked an anchor; the renderer places it by text type. */
  noAnchor?: boolean
}

export interface PptSlide {
  shapes: PptShape[]
  notes: string
  background?: string
}

export interface PptDoc {
  width: number
  height: number
  slides: PptSlide[]
  /** BStore pictures, index 0 = blip id 1. Null for metafiles / unsupported. */
  pictures: (Picture | null)[]
}

interface PF {
  bullet?: boolean
  char?: string
  align?: number
  lineSpacing?: number
  spaceBefore?: number
}

interface CF {
  b?: boolean
  i?: boolean
  u?: boolean
  size?: number
  color?: string
  colorIndex?: number
  font?: string
  eaFont?: string
}

/** Text type -> per indent level master styles. */
type MasterStyles = Map<number, { pf: PF; cf: CF }[]>
const PARENT_TYPE: Record<number, number> = { 5: 1, 6: 0, 7: 1, 8: 1 }

function pick<T extends object>(...xs: (T | undefined)[]): T {
  const out = {} as T
  for (const x of xs) if (x) for (const [k, v] of Object.entries(x)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

interface Rec {
  type: number
  inst: number
  ver: number
  /** Offset of the record body. */
  body: number
  len: number
}

const T = {
  Document: 0x03e8,
  DocumentAtom: 0x03e9,
  Slide: 0x03ee,
  SlideAtom: 0x03ef,
  Notes: 0x03f0,
  SlidePersistAtom: 0x03f3,
  Environment: 0x03f2,
  SlideListWithText: 0x0ff0,
  TextHeader: 0x0f9f,
  TextChars: 0x0fa0,
  TextBytes: 0x0fa8,
  StyleTextProp: 0x0fa1,
  OutlineTextRef: 0x0f9e,
  ColorScheme: 0x07f0,
  PPDrawing: 0x040c,
  PPDrawingGroup: 0x040b,
  CurrentUserAtom: 0x0ff6,
  UserEditAtom: 0x0ff5,
  PersistDirectory: 0x1772,
  DggContainer: 0xf000,
  BStoreContainer: 0xf001,
  DgContainer: 0xf002,
  SpgrContainer: 0xf003,
  SpContainer: 0xf004,
  FSPGR: 0xf009,
  FSP: 0xf00a,
  FOPT: 0xf00b,
  ClientTextbox: 0xf00d,
  ChildAnchor: 0xf00f,
  ClientAnchor: 0xf010,
  ClientData: 0xf011,
  FBSE: 0xf007,
  PlaceholderAtom: 0x0bc3
}

export function readPpt(cfb: Cfb): PptDoc {
  const stream = cfb.stream('PowerPoint Document')
  if (!stream || stream.length < 16) throw new PptError('corrupt', 'no PowerPoint Document stream')
  const s: Uint8Array = stream
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength)
  const u16 = (o: number) => dv.getUint16(o, true)
  const u32 = (o: number) => dv.getUint32(o, true)
  const i32 = (o: number) => dv.getInt32(o, true)
  const i16 = (o: number) => dv.getInt16(o, true)

  const rec = (o: number): Rec | null => {
    if (o < 0 || o + 8 > s.length) return null
    const vi = u16(o)
    const len = u32(o + 4)
    if (o + 8 + len > s.length) return null
    return { ver: vi & 0xf, inst: vi >> 4, type: u16(o + 2), body: o + 8, len }
  }
  const kids = (r: Rec): Rec[] => {
    const out: Rec[] = []
    let o = r.body
    const end = r.body + r.len
    while (o + 8 <= end) {
      const c = rec(o)
      if (!c) break
      out.push(c)
      o = c.body + c.len
    }
    return out
  }
  const first = (r: Rec, type: number) => kids(r).find((k) => k.type === type)

  // Persist directory through the user edit chain (newest edit wins).
  const persist = new Map<number, number>()
  let docRef = -1
  const cu = cfb.stream('Current User')
  if (cu && cu.length >= 20) {
    const cdv = new DataView(cu.buffer, cu.byteOffset, cu.byteLength)
    const token = cdv.getUint32(12, true)
    if (token === 0xf3d1c4df) throw new PptError('encrypted', 'encrypted')
    let edit = cdv.getUint32(16, true)
    const seen = new Set<number>()
    while (edit > 0 && !seen.has(edit)) {
      seen.add(edit)
      const ue = rec(edit)
      if (!ue || ue.type !== T.UserEditAtom) break
      if (docRef < 0) docRef = u32(ue.body + 16)
      if (ue.len >= 0x20 && u32(ue.body + 28)) throw new PptError('encrypted', 'encrypted')
      const pd = rec(u32(ue.body + 12))
      if (pd && pd.type === T.PersistDirectory) {
        let o = pd.body
        const end = pd.body + pd.len
        while (o + 4 <= end) {
          const v = u32(o)
          const id = v & 0xfffff
          const n = v >>> 20
          for (let k = 0; k < n && o + 4 + k * 4 + 4 <= end; k++) if (!persist.has(id + k)) persist.set(id + k, u32(o + 4 + k * 4))
          o += 4 + n * 4
        }
      }
      edit = u32(ue.body + 8)
    }
  }

  // Top-level records, for the fallback when the persist chain is missing or broken.
  const top: Rec[] = []
  for (let o = 0; o + 8 <= s.length; ) {
    const r = rec(o)
    if (!r) break
    top.push(r)
    o = r.body + r.len
  }
  let doc = docRef >= 0 && persist.has(docRef) ? rec(persist.get(docRef)!) : null
  if (!doc || doc.type !== T.Document) doc = [...top].reverse().find((r) => r.type === T.Document) ?? null
  if (!doc) throw new PptError('corrupt', 'no DocumentContainer')

  const docAtom = first(doc, T.DocumentAtom)
  const width = docAtom ? i32(docAtom.body) : 5760
  const height = docAtom ? i32(docAtom.body + 4) : 4320

  // Pictures (BStore in the drawing group; blips inline or delayed in the Pictures stream).
  const pics = cfb.stream('Pictures')
  const pictures: (Picture | null)[] = []
  const dgg = first(doc, T.PPDrawingGroup)
  const dggC = dgg && first(dgg, T.DggContainer)
  const bstore = dggC && first(dggC, T.BStoreContainer)
  if (bstore) {
    for (const fbse of kids(bstore)) {
      if (fbse.type !== T.FBSE) {
        pictures.push(null)
        continue
      }
      let pic: Picture | null = null
      const cbName = s[fbse.body + 33]
      const inlineAt = fbse.body + 36 + cbName
      if (fbse.len > 36 + cbName + 8) pic = readBlip(s, inlineAt)?.picture ?? null
      else if (pics) {
        const fo = u32(fbse.body + 28)
        if (fo < pics.length) pic = readBlip(pics, fo)?.picture ?? null
      }
      pictures.push(pic)
    }
  }

  // SlideListWithText: per slide, the placeholder texts (for OutlineTextRefAtom) and notes ids.
  const lists = kids(doc).filter((r) => r.type === T.SlideListWithText)
  const slideList = lists.find((r) => r.inst === 0)
  const notesList = lists.find((r) => r.inst === 2)
  interface Entry {
    persistId: number
    slideId: number
    texts: { type: number; text: string; style?: Rec }[]
  }
  const entries = (list: Rec | undefined): Entry[] => {
    const out: Entry[] = []
    if (!list) return out
    let cur: Entry | null = null
    for (const r of kids(list)) {
      if (r.type === T.SlidePersistAtom) {
        cur = { persistId: u32(r.body), slideId: u32(r.body + 12), texts: [] }
        out.push(cur)
      } else if (!cur) continue
      else if (r.type === T.TextHeader) cur.texts.push({ type: u32(r.body), text: '' })
      else if (r.type === T.TextChars || r.type === T.TextBytes) {
        const t = cur.texts[cur.texts.length - 1]
        if (t) t.text = decodeTextAtom(s, r)
      } else if (r.type === T.StyleTextProp) {
        const t = cur.texts[cur.texts.length - 1]
        if (t) t.style = r
      }
    }
    return out
  }
  const slideEntries = entries(slideList)
  const notesById = new Map(entries(notesList).map((e) => [e.slideId, e]))

  let slideRecs: { rec: Rec; entry?: Entry }[] = slideEntries
    .map((e) => ({ rec: rec(persist.get(e.persistId) ?? -1)!, entry: e }))
    .filter((x) => x.rec && x.rec.type === T.Slide)
  if (!slideRecs.length) slideRecs = top.filter((r) => r.type === T.Slide).map((r) => ({ rec: r }))

  // Font collection (Environment > FontCollection > FontEntityAtom, instance = index).
  const fonts: string[] = []
  const env = first(doc, T.Environment)
  const fc = env && first(env, 0x07d5)
  if (fc) {
    for (const fe of kids(fc)) {
      if (fe.type !== 0x0fb7 || fe.len < 64) continue
      let name = ''
      for (let k = 0; k < 32; k++) {
        const c = u16(fe.body + k * 2)
        if (!c) break
        name += String.fromCharCode(c)
      }
      fonts[fe.inst] = name
    }
  }

  // Master text styles: the Environment defaults, then each main master's TxMasterStyleAtoms.
  const readMaster = (container: Rec | undefined): MasterStyles => {
    const out: MasterStyles = new Map()
    if (!container) return out
    for (const r of kids(container)) {
      if (r.type !== 0x0fa3) continue
      try {
        const levels: { pf: PF; cf: CF }[] = []
        const n = Math.min(5, u16(r.body))
        let o = r.body + 2
        for (let k = 0; k < n && o < r.body + r.len; k++) {
          if (r.inst >= 5) o += 2
          const a = readPF(o)
          const b = readCF(a.o, [])
          o = b.o
          levels.push({ pf: a.pf, cf: b.cf })
        }
        out.set(r.inst, levels)
      } catch {
        // ignore a damaged style atom
      }
    }
    return out
  }
  const envStyles = readMaster(env)
  const masterList = lists.find((r) => r.inst === 1)
  const masters = new Map<number, MasterStyles>()
  let firstMaster: MasterStyles | null = null
  for (const e of entries(masterList)) {
    const mr = rec(persist.get(e.persistId) ?? -1)
    if (!mr) continue
    const ms = readMaster(mr)
    masters.set(e.slideId, ms)
    if (!firstMaster && ms.size) firstMaster = ms
  }
  const merged = (ms: MasterStyles | null | undefined): MasterStyles => {
    const out: MasterStyles = new Map(envStyles)
    if (ms) for (const [t, lv] of ms) out.set(t, lv.map((l, k) => ({ pf: pick(out.get(t)?.[k]?.pf, l.pf), cf: pick(out.get(t)?.[k]?.cf, l.cf) })))
    return out
  }

  const scheme = (r: Rec): string[] => {
    const cs = kids(r).find((k) => k.type === T.ColorScheme)
    if (!cs || cs.len < 32) return []
    return Array.from({ length: 8 }, (_, k) => rgb(s[cs.body + k * 4], s[cs.body + k * 4 + 1], s[cs.body + k * 4 + 2]))
  }

  const slides: PptSlide[] = slideRecs.map(({ rec: sr, entry }) => {
    const colors = scheme(sr)
    const slideAtom = first(sr, T.SlideAtom)
    const master = merged(slideAtom && slideAtom.len >= 16 ? (masters.get(u32(slideAtom.body + 12)) ?? firstMaster) : firstMaster)
    const shapes: PptShape[] = []
    const drawing = first(sr, T.PPDrawing)
    const dg = drawing && first(drawing, T.DgContainer)
    const spgr = dg && first(dg, T.SpgrContainer)
    if (spgr) walkGroup(spgr, null)
    const atom = first(sr, T.SlideAtom)
    let notes = ''
    if (atom && atom.len >= 20) {
      const ne = notesById.get(u32(atom.body + 16))
      if (ne) {
        const nr = rec(persist.get(ne.persistId) ?? -1)
        if (nr && nr.type === T.Notes) notes = notesText(nr)
        if (!notes) notes = ne.texts.filter((t) => t.type === 2).map((t) => t.text).join('\n')
      }
    }
    return { shapes, notes: notes.replace(/\r/g, '\n').trim(), background: colors[0] }

    /** `map` turns child coordinates into slide coordinates for shapes in a group. */
    function walkGroup(g: Rec, map: ((x: number, y: number) => [number, number]) | null): void {
      const items = kids(g)
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx]
        if (it.type === T.SpgrContainer) {
          const head = kids(it).find((k) => k.type === T.SpContainer)
          const fspgr = head && first(head, T.FSPGR)
          const rect = head && anchorOf(head, map)
          if (fspgr && rect) {
            const gx1 = i32(fspgr.body)
            const gy1 = i32(fspgr.body + 4)
            const gx2 = i32(fspgr.body + 8)
            const gy2 = i32(fspgr.body + 12)
            const sx = gx2 !== gx1 ? rect.w / (gx2 - gx1) : 1
            const sy = gy2 !== gy1 ? rect.h / (gy2 - gy1) : 1
            walkGroup(it, (x, y) => [rect.x + (x - gx1) * sx, rect.y + (y - gy1) * sy])
          } else walkGroup(it, map)
          continue
        }
        if (it.type !== T.SpContainer) continue
        const fsp = first(it, T.FSP)
        if (fsp && u32(fsp.body + 4) & 0x405) continue // group header, patriarch or background
        const shape = readShape(it, map)
        if (shape) shapes.push(shape)
      }
    }

    function anchorOf(sp: Rec, map: ((x: number, y: number) => [number, number]) | null): { x: number; y: number; w: number; h: number } | null {
      const child = first(sp, T.ChildAnchor)
      if (child && map && child.len >= 16) {
        const [x1, y1] = map(i32(child.body), i32(child.body + 4))
        const [x2, y2] = map(i32(child.body + 8), i32(child.body + 12))
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
      }
      const a = first(sp, T.ClientAnchor)
      if (!a) return null
      if (a.len >= 16) {
        const t = i32(a.body), l = i32(a.body + 4), r = i32(a.body + 8), b = i32(a.body + 12)
        return { x: l, y: t, w: r - l, h: b - t }
      }
      if (a.len >= 8) {
        const t = i16(a.body), l = i16(a.body + 2), r = i16(a.body + 4), b = i16(a.body + 6)
        return { x: l, y: t, w: r - l, h: b - t }
      }
      return null
    }

    function readShape(sp: Rec, map: ((x: number, y: number) => [number, number]) | null): PptShape | null {
      const rect = anchorOf(sp, map)
      const props = new Map<number, number>()
      const opt = first(sp, T.FOPT)
      if (opt) {
        for (let k = 0; k < opt.inst && opt.body + k * 6 + 6 <= opt.body + opt.len; k++) {
          props.set(u16(opt.body + k * 6) & 0x3fff, u32(opt.body + k * 6 + 2))
        }
      }
      const shape: PptShape = rect ? { ...rect } : { x: 0, y: 0, w: width, h: height, noAnchor: true }
      const pib = props.get(0x104)
      if (pib && pib > 0) {
        shape.picture = pib
      }
      const fillBools = props.get(0x1bf)
      const filled = fillBools == null ? props.has(0x181) : fillBools & 0x100000 ? (fillBools & 0x10) !== 0 : true
      if (filled && props.has(0x181) && (props.get(0x180) ?? 0) === 0) shape.fill = colorRef(props.get(0x181)!, colors)
      const lineBools = props.get(0x1ff)
      const lined = lineBools != null && lineBools & 0x80000 ? (lineBools & 0x8) !== 0 : false
      if (lined) shape.line = colorRef(props.get(0x1c0) ?? 0, colors) ?? '#000'
      const anchorText = props.get(0x87)
      if (anchorText != null) shape.valign = [0, 3, 6, 8].includes(anchorText) ? 'top' : [1, 4, 7, 9].includes(anchorText) ? 'middle' : 'bottom'

      // Text: inline atoms in the client textbox, or a reference into the slide list.
      const tb = first(sp, T.ClientTextbox)
      const cd = first(sp, T.ClientData)
      let type: number | undefined
      let text: string | null = null
      let style: Rec | undefined
      for (const holder of [tb, cd]) {
        if (!holder) continue
        for (const r of kids(holder)) {
          if (r.type === T.TextHeader) type = u32(r.body)
          else if (r.type === T.TextChars || r.type === T.TextBytes) text = decodeTextAtom(s, r)
          else if (r.type === T.StyleTextProp) style = r
          else if (r.type === T.OutlineTextRef && entry) {
            const t = entry.texts[u32(r.body)]
            if (t) {
              type = t.type
              text = t.text
              style = t.style
            }
          }
        }
      }
      if (text != null && text.length) {
        shape.textType = type ?? 4
        shape.paras = styleText(text, style, shape.textType, colors, master)
        if (shape.valign == null && (type === 0 || type === 6)) shape.valign = 'middle'
      }
      if (!shape.paras && !shape.picture && !shape.fill && !shape.line) return null
      if (shape.noAnchor && !shape.paras) return null
      return shape
    }
  })

  function notesText(nr: Rec): string {
    const out: string[] = []
    const visit = (r: Rec) => {
      let type = -1
      for (const k of kids(r)) {
        if (k.type === T.TextHeader) type = u32(k.body)
        else if ((k.type === T.TextChars || k.type === T.TextBytes) && type === 2) out.push(decodeTextAtom(s, k))
        else if (k.ver === 0xf) visit(k)
      }
    }
    visit(nr)
    return out.join('\n')
  }

  /** TextPFException at `o` (masks first). */
  function readPF(o: number): { pf: PF; o: number } {
    const masks = u32(o)
    o += 4
    const pf: PF = {}
    if (masks & 0x0f) {
      const flags = u16(o)
      if (masks & 0x1) pf.bullet = (flags & 1) !== 0
      o += 2
    }
    if (masks & 0x80) {
      pf.char = String.fromCharCode(u16(o))
      o += 2
    }
    if (masks & 0x10) o += 2
    if (masks & 0x40) o += 2
    if (masks & 0x20) o += 4
    if (masks & 0x800) {
      pf.align = u16(o)
      o += 2
    }
    if (masks & 0x1000) {
      pf.lineSpacing = i16(o)
      o += 2
    }
    if (masks & 0x2000) {
      pf.spaceBefore = i16(o)
      o += 2
    }
    if (masks & 0x4000) o += 2
    if (masks & 0x100) o += 2
    if (masks & 0x400) o += 2
    if (masks & 0x8000) o += 2
    if (masks & 0x100000) o += 2 + u16(o) * 4
    if (masks & 0x10000) o += 2
    if (masks & 0xe0000) o += 2
    if (masks & 0x200000) o += 2
    return { pf, o }
  }

  /** TextCFException at `o` (masks first). */
  function readCF(o: number, colors: string[]): { cf: CF; o: number } {
    const masks = u32(o)
    o += 4
    const cf: CF = {}
    if (masks & 0x3ef7) {
      const fs = u16(o)
      if (masks & 1) cf.b = (fs & 1) !== 0
      if (masks & 2) cf.i = (fs & 2) !== 0
      if (masks & 4) cf.u = (fs & 4) !== 0
      o += 2
    }
    if (masks & 0x10000) {
      cf.font = fonts[u16(o)]
      o += 2
    }
    if (masks & 0x200000) {
      cf.eaFont = fonts[u16(o)]
      o += 2
    }
    if (masks & 0x400000) o += 2
    if (masks & 0x800000) o += 2
    if (masks & 0x20000) {
      cf.size = u16(o)
      o += 2
    }
    if (masks & 0x40000) {
      const idx = s[o + 3]
      cf.color = idx === 0xfe ? rgb(s[o], s[o + 1], s[o + 2]) : colors[idx]
      cf.colorIndex = idx === 0xfe ? undefined : idx
      o += 4
    }
    if (masks & 0x80000) o += 2
    if (masks & 0x100000) o += 4
    if (masks & 0x1000000) o += 2
    if (masks & 0x2000000) o += 2
    if (masks & 0x4000000) o += 4
    return { cf, o }
  }

  function styleText(text: string, style: Rec | undefined, type: number, colors: string[], master: MasterStyles): PptPara[] {
    const parts = text.split('\r')
    const paras: PptPara[] = parts.map(() => ({ runs: [], level: 0 }))
    const bodyBullets = type === 1 || type === 7 || type === 8
    const pf: (PF & { level: number })[] = []
    const cf: (CF & { len: number })[] = []
    if (style) {
      try {
        let o = style.body
        const end = style.body + style.len
        let covered = 0
        while (covered < text.length + 1 && o + 10 <= end) {
          const count = u32(o)
          const level = u16(o + 4)
          const r = readPF(o + 6)
          o = r.o
          const entry = { ...r.pf, level }
          // one PF run covers `count` characters, which may span several paragraphs
          let pos = 0
          for (let p = 0; p < parts.length; p++) {
            if (pos >= covered && pos < covered + count) pf[p] = entry
            pos += parts[p].length + 1
          }
          covered += count
        }
        let cfCovered = 0
        while (cfCovered < text.length + 1 && o + 8 <= end) {
          const count = u32(o)
          cfCovered += count
          const r = readCF(o + 4, colors)
          o = r.o
          cf.push({ ...r.cf, len: count })
          if (o > end) break
        }
      } catch {
        // malformed style atom: plain text
      }
    }
    // Split character runs over paragraphs; unset properties come from the master text styles.
    let ci = 0
    let left = cf[0]?.len ?? Number.POSITIVE_INFINITY
    parts.forEach((part, p) => {
      const para = paras[p]
      const e = pf[p]
      para.level = Math.min(4, e?.level ?? 0)
      const m = masterLevel(master, type, para.level)
      const hasBullet = e?.bullet ?? m.pf.bullet ?? bodyBullets
      const ch = e?.char ?? m.pf.char
      if (hasBullet && part.trim()) para.bullet = ch && ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) < 0xf000 ? ch : '•'
      const align = e?.align ?? m.pf.align
      if (align != null) para.align = (['left', 'center', 'right', 'justify'] as const)[align] ?? undefined
      else if (type === 6 || type === 5) para.align = 'center'
      const ls = e?.lineSpacing ?? m.pf.lineSpacing
      if (ls != null && ls > 0) para.lineSpacing = ls / 100
      const sb = e?.spaceBefore ?? m.pf.spaceBefore
      if (sb != null && sb > 0 && p > 0) para.spaceBefore = sb / 100
      let k = 0
      const str = part + '\r'
      while (k < str.length) {
        const run = cf[ci]
        const take = Math.max(1, Math.min(left, str.length - k))
        const piece = str.slice(k, k + take).replace(/\r$/, '').replace(/\x0b/g, '\n')
        if (piece) {
          const color = run?.color ?? (m.cf.colorIndex != null ? colors[m.cf.colorIndex] : m.cf.color)
          para.runs.push({
            text: piece,
            b: run?.b ?? m.cf.b,
            i: run?.i ?? m.cf.i,
            u: run?.u ?? m.cf.u,
            size: run?.size ?? m.cf.size,
            color,
            font: run?.font ?? m.cf.font
          })
        }
        k += take
        left -= take
        if (left <= 0 && ci < cf.length - 1) {
          ci++
          left = cf[ci].len
        }
      }
    })
    return paras
  }

  return { width, height, slides, pictures }
}

/** Master style for a text type and indent level; centre/half/quarter types inherit body or title. */
function masterLevel(master: MasterStyles, type: number, level: number): { pf: PF; cf: CF } {
  const parent = PARENT_TYPE[type]
  const at = (t: number | undefined) => (t == null ? undefined : (master.get(t)?.[level] ?? master.get(t)?.[0]))
  const a = at(parent)
  const b = at(type)
  return { pf: pick<PF>(a?.pf, b?.pf), cf: pick<CF>(a?.cf, b?.cf) }
}

function decodeTextAtom(s: Uint8Array, r: Rec): string {
  const raw = s.subarray(r.body, r.body + r.len)
  return new TextDecoder(r.type === 0x0fa0 ? 'utf-16le' : 'windows-1252').decode(raw)
}

function rgb(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** OfficeArtCOLORREF: RGB, or a scheme index when fSchemeIndex is set. */
function colorRef(v: number, scheme: string[]): string | undefined {
  const r = v & 0xff
  const g = (v >> 8) & 0xff
  const b = (v >> 16) & 0xff
  const flags = v >>> 24
  if (flags & 0x08) return scheme[r]
  if (flags & 0x16) return undefined
  return rgb(r, g, b)
}
