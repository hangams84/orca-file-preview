/** Reference paths inside a file (a mesh of a URDF, an include of a xacro file, the .mtl of an OBJ, the
 *  .bin of a glTF, an xref of a DXF) resolved against the files the user handed to the preview
 *  (core/companions.ts). Relative references are first joined with the referring file's own path,
 *  when it is known, so `../meshes/a.stl` from `pkg/urdf/robot.urdf` prefers `pkg/meshes/a.stl`. */
import { companionFiles, findCompanion, type CompanionFile } from './companions.ts'

/** True for a scheme (`package://`, `file://`), a rooted path or a drive path. */
export function isAbsoluteRef(ref: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) || /^[\\/]/.test(ref) || /^[a-z]:[\\/]/i.test(ref)
}

/** `ref` joined with the directory of `base` (a companion path); absolute references as they are. */
export function joinRef(ref: string, base?: string): string {
  const r = ref.trim().replace(/\\/g, '/')
  if (!base || isAbsoluteRef(r)) return r
  const parts = base.replace(/\\/g, '/').split('/').filter(Boolean)
  parts.pop()
  for (const seg of r.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/** The companion for `ref` as seen from the file at `base` (or from an unknown place). */
export function resolveRef(ref: string, base?: string): CompanionFile | null {
  if (!ref.trim() || /^(data|blob):/i.test(ref)) return null
  return (base ? findCompanion(joinRef(ref, base)) : null) ?? findCompanion(ref)
}

export async function readRef(ref: string, base?: string): Promise<{ bytes: Uint8Array; path: string } | null> {
  const c = resolveRef(ref, base)
  if (!c) return null
  try {
    return { bytes: new Uint8Array(await c.file.arrayBuffer()), path: c.path }
  } catch {
    return null
  }
}

/** The companion path of the opened file itself, when the user's folder holds it (same size and bytes):
 *  relative references then resolve from its real place. `ext` narrows the candidates. */
export async function locateSelf(bytes: Uint8Array, ext?: RegExp): Promise<string | undefined> {
  const same = companionFiles().filter((c) => c.file.size === bytes.byteLength && (!ext || ext.test(c.path)))
  for (const c of same.slice(0, 8)) {
    try {
      const b = new Uint8Array(await c.file.arrayBuffer())
      let eq = true
      for (let i = 0; i < b.length && eq; i++) if (b[i] !== bytes[i]) eq = false
      if (eq) return c.path
    } catch {
      // unreadable: try the next
    }
  }
  return undefined
}

/** Object URLs for companions, one per file, revoked together (images, buffers: never scripts). */
export class CompanionUrls {
  private readonly urls = new Map<File, string>()
  /** References that matched no companion, in the order they were asked for. */
  readonly missing: string[] = []
  /** Companion paths handed out. */
  readonly used: string[] = []

  constructor(private readonly base?: string) {}

  /** A blob: URL for `ref`, or null (recorded in `missing`). */
  url(ref: string, base = this.base): string | null {
    const c = resolveRef(ref, base)
    if (!c) {
      const name = ref.replace(/[?#].*$/, '')
      if (!this.missing.includes(name)) this.missing.push(name)
      return null
    }
    if (!this.used.includes(c.path)) this.used.push(c.path)
    let u = this.urls.get(c.file)
    if (!u) {
      u = URL.createObjectURL(c.file)
      this.urls.set(c.file, u)
    }
    return u
  }

  dispose(): void {
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
  }
}
