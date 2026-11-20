/** An unzipped OOXML package: parts by path, parsed XML (cached), relationships and media URLs. */
import { strFromU8, unzipSync } from '../../../vendor/zip.js'
import { effectsKey, loadPicture, type PictureEffects, type PictureResult } from './images.ts'
import { attr, kids, parseXml } from './xml.ts'

export interface Rel {
  id: string
  type: string
  target: string
  external: boolean
}


const SKIP = /^(?:[^/]+\/(?:embeddings|fonts|customXml)\/|docProps\/thumbnail|customXml\/)|printerSettings|vbaProject\.bin$/i

export class OoxmlPackage {
  private xmlCache = new Map<string, Document | null>()
  private relCache = new Map<string, Map<string, Rel>>()
  private pictureCache = new Map<string, Promise<PictureResult>>()

  private constructor(
    private files: Record<string, Uint8Array>,
    private signal: AbortSignal
  ) {}

  /** Throws when the bytes are not a readable zip. */
  /** Throws when the bytes are not a readable zip. Callers run office/zipguard.ts first, so the
   *  declared sizes are sane; parts the slide renderer never reads (embedded OLE objects and fonts,
   *  thumbnails, printer settings, VBA, custom XML) are not inflated at all. */
  static open(bytes: Uint8Array, signal: AbortSignal): OoxmlPackage {
    return new OoxmlPackage(unzipSync(bytes, { filter: (f) => !SKIP.test(f.name) }), signal)
  }

  has(path: string): boolean {
    return path in this.files
  }

  bytes(path: string): Uint8Array | undefined {
    return this.files[path]
  }

  xml(path: string): Document | null {
    if (this.xmlCache.has(path)) return this.xmlCache.get(path)!
    const raw = this.files[path]
    const doc = raw ? parseXml(strFromU8(raw)) : null
    this.xmlCache.set(path, doc)
    return doc
  }

  /** Relationships of a part, by id. */
  rels(part: string): Map<string, Rel> {
    const cached = this.relCache.get(part)
    if (cached) return cached
    const slash = part.lastIndexOf('/')
    const relsPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`
    const map = new Map<string, Rel>()
    const doc = this.xml(relsPath)
    for (const r of kids(doc?.documentElement, 'Relationship')) {
      const external = attr(r, 'TargetMode') === 'External'
      const target = attr(r, 'Target') ?? ''
      map.set(attr(r, 'Id') ?? '', {
        id: attr(r, 'Id') ?? '',
        type: (attr(r, 'Type') ?? '').replace(/^.*\//, ''),
        target: external ? target : resolvePath(part, target),
        external
      })
    }
    this.relCache.set(part, map)
    return map
  }

  /** First relationship of a type such as `slideLayout`. */
  relOfType(part: string, type: string): Rel | undefined {
    for (const r of this.rels(part).values()) if (r.type === type) return r
    return undefined
  }

  /** A picture part as a URL the browser can show (any format office/images.ts decodes, with
   *  blip effects applied), cached per part and effect set; object URLs are revoked on abort. */
  picture(path: string, effects?: PictureEffects): Promise<PictureResult> {
    const key = `${path}|${effectsKey(effects)}`
    let p = this.pictureCache.get(key)
    if (!p) {
      const raw = this.files[path]
      p = raw
        ? loadPicture({ bytes: raw, name: path }, effects, (url) => {
            this.signal.addEventListener('abort', () => URL.revokeObjectURL(url), { once: true })
            return url
          })
        : Promise.resolve({ error: 'picture part missing' })
      this.pictureCache.set(key, p)
    }
    return p
  }
}

/** Resolves a relationship target against the part that owns it. */
export function resolvePath(part: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = part.split('/')
  parts.pop()
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
