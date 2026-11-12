/** An unzipped OOXML package: parts by path, parsed XML (cached), relationships and media URLs. */
import { strFromU8, unzipSync } from '../../../vendor/zip.js'
import { objectUrl } from '../../core/ui.ts'
import { attr, kids, parseXml } from './xml.ts'

export interface Rel {
  id: string
  type: string
  target: string
  external: boolean
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

const SKIP = /^(?:[^/]+\/(?:embeddings|fonts|customXml)\/|docProps\/thumbnail|customXml\/)|printerSettings|vbaProject\.bin$/i

export class OoxmlPackage {
  private xmlCache = new Map<string, Document | null>()
  private relCache = new Map<string, Map<string, Rel>>()
  private urlCache = new Map<string, string | null>()

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

  /** Blob URL for an image part, or null when it is missing or a format browsers cannot show (EMF/WMF). */
  mediaUrl(path: string): string | null {
    if (this.urlCache.has(path)) return this.urlCache.get(path)!
    const raw = this.files[path]
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const type = MIME[ext]
    const url = raw && type ? objectUrl(raw, type, this.signal) : null
    this.urlCache.set(path, url)
    return url
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
