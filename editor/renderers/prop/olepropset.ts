/** OLE property sets (MS-OLEPS): the SummaryInformation, DocumentSummaryInformation and named
 *  user-defined property streams that SolidWorks (and Office) store in compound files. */

export interface OleProperty {
  id: number
  /** Dictionary name for user-defined properties, or the well-known name for summary fields. */
  name: string
  value: string | number | boolean | Date | null
}

export interface OlePropertySection {
  fmtid: string
  properties: OleProperty[]
}

export const FMTID_SUMMARY = 'f29f85e0-4ff9-1068-ab91-08002b27b3d9'
export const FMTID_DOCSUMMARY = 'd5cdd502-2e9c-101b-9397-08002b2cf9ae'
export const FMTID_USER = 'd5cdd505-2e9c-101b-9397-08002b2cf9ae'

const SUMMARY_NAMES: Record<number, string> = {
  2: 'Title',
  3: 'Subject',
  4: 'Author',
  5: 'Keywords',
  6: 'Comments',
  7: 'Template',
  8: 'Last saved by',
  9: 'Revision number',
  10: 'Total editing time',
  11: 'Last printed',
  12: 'Created',
  13: 'Last saved',
  14: 'Pages',
  18: 'Application'
}

const DOCSUMMARY_NAMES: Record<number, string> = {
  2: 'Category',
  14: 'Manager',
  15: 'Company'
}

function guid(b: Uint8Array, o: number): string {
  const hex = (from: number, to: number, rev: boolean) => {
    const parts: string[] = []
    for (let i = from; i < to; i++) parts.push(b[o + i].toString(16).padStart(2, '0'))
    return (rev ? parts.reverse() : parts).join('')
  }
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`
}

const CODEPAGES: Record<number, string> = {
  65001: 'utf-8',
  1200: 'utf-16le',
  1252: 'windows-1252',
  1250: 'windows-1250',
  1251: 'windows-1251',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5'
}

function decoder(codepage: number): TextDecoder {
  try {
    return new TextDecoder(CODEPAGES[codepage] ?? 'windows-1252')
  } catch {
    return new TextDecoder('windows-1252')
  }
}

const trimNul = (s: string) => s.replace(/\u0000+$/, '').replace(/\u0000/g, ' ')

/** Parses every section of a property set stream. Unreadable properties are skipped. */
export function readPropertySet(b: Uint8Array): OlePropertySection[] {
  if (b.length < 48) return []
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (dv.getUint16(0, true) !== 0xfffe) return []
  const numSections = dv.getUint32(24, true)
  const out: OlePropertySection[] = []
  for (let s = 0; s < Math.min(numSections, 8); s++) {
    const hdr = 28 + s * 20
    if (hdr + 20 > b.length) break
    const fmtid = guid(b, hdr)
    const base = dv.getUint32(hdr + 16, true)
    if (base + 8 > b.length) continue
    const count = dv.getUint32(base + 4, true)
    const ids: { id: number; off: number }[] = []
    for (let i = 0; i < Math.min(count, 4096); i++) {
      const p = base + 8 + i * 8
      if (p + 8 > b.length) break
      ids.push({ id: dv.getUint32(p, true), off: base + dv.getUint32(p + 4, true) })
    }
    let codepage = 1252
    const cp = ids.find((x) => x.id === 1)
    if (cp && cp.off + 6 <= b.length && dv.getUint16(cp.off, true) === 2) codepage = dv.getUint16(cp.off + 4, true)
    const dec = decoder(codepage)
    const names = new Map<number, string>()
    const dict = ids.find((x) => x.id === 0)
    if (dict && dict.off + 4 <= b.length) {
      let p = dict.off
      const n = dv.getUint32(p, true)
      p += 4
      for (let i = 0; i < Math.min(n, 4096) && p + 8 <= b.length; i++) {
        const pid = dv.getUint32(p, true)
        const len = dv.getUint32(p + 4, true)
        p += 8
        if (codepage === 1200) {
          const end = Math.min(b.length, p + len * 2)
          names.set(pid, trimNul(new TextDecoder('utf-16le').decode(b.subarray(p, end))))
          p = end
          p += (4 - (p % 4)) % 4
        } else {
          const end = Math.min(b.length, p + len)
          names.set(pid, trimNul(dec.decode(b.subarray(p, end))))
          p = end
        }
      }
    }
    const known = fmtid === FMTID_SUMMARY ? SUMMARY_NAMES : fmtid === FMTID_DOCSUMMARY ? DOCSUMMARY_NAMES : {}
    const properties: OleProperty[] = []
    for (const { id, off } of ids) {
      if (id === 0 || id === 1 || id >= 0x80000000) continue
      const value = readValue(b, dv, off, dec, codepage)
      if (value === undefined) continue
      properties.push({ id, name: names.get(id) ?? known[id] ?? `#${id}`, value })
    }
    out.push({ fmtid, properties })
  }
  return out
}

function readValue(b: Uint8Array, dv: DataView, off: number, dec: TextDecoder, codepage: number): OleProperty['value'] | undefined {
  if (off + 4 > b.length) return undefined
  const type = dv.getUint16(off, true)
  const p = off + 4
  const fits = (n: number) => p + n <= b.length
  switch (type) {
    case 2:
      return fits(2) ? dv.getInt16(p, true) : undefined
    case 3:
      return fits(4) ? dv.getInt32(p, true) : undefined
    case 0x13:
      return fits(4) ? dv.getUint32(p, true) : undefined
    case 4:
      return fits(4) ? dv.getFloat32(p, true) : undefined
    case 5:
      return fits(8) ? dv.getFloat64(p, true) : undefined
    case 0x0b:
      return fits(2) ? dv.getUint16(p, true) !== 0 : undefined
    case 0x1e: {
      if (!fits(4)) return undefined
      const len = dv.getUint32(p, true)
      const end = Math.min(b.length, p + 4 + (codepage === 1200 ? len * 2 : len))
      const raw = b.subarray(p + 4, end)
      return trimNul(codepage === 1200 ? new TextDecoder('utf-16le').decode(raw) : dec.decode(raw))
    }
    case 0x1f: {
      if (!fits(4)) return undefined
      const len = dv.getUint32(p, true)
      return trimNul(new TextDecoder('utf-16le').decode(b.subarray(p + 4, Math.min(b.length, p + 4 + len * 2))))
    }
    case 0x40: {
      if (!fits(8)) return undefined
      const lo = dv.getUint32(p, true)
      const hi = dv.getUint32(p + 4, true)
      const ticks = hi * 2 ** 32 + lo
      if (ticks === 0) return null
      const ms = ticks / 10000 - 11644473600000
      // Editing time is a duration stored as a FILETIME: show it as minutes.
      if (ms < 0) return `${Math.round(ticks / 600000000)} min`
      return new Date(ms)
    }
    default:
      return undefined
  }
}
