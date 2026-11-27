/** External files of a DXF drawing: xref drawings (parsed, nested xrefs too) and raster images, read
 *  through `io` (files the user handed to the preview). No DOM here, so the unit tests run in Node. */
import { dxfReferences, type DxfResolved } from './build.ts'
import { DxfError, parseDoc, readTags, type DxfDoc } from './reader.ts'

export interface DxfIo {
  /** Bytes and companion path of `ref` as seen from the file at `base`, or null. */
  read(ref: string, base: string | undefined): Promise<{ bytes: Uint8Array; path: string } | null>
  /** Decodes a raster image; null when it cannot be decoded. */
  image(bytes: Uint8Array, path: string): Promise<{ src: CanvasImageSource; w: number; h: number } | null>
}

export interface DxfResolution {
  resolved: DxfResolved
  /** References that matched no supplied file (`kind` and the path as written). */
  missing: { kind: 'xref' | 'image'; path: string }[]
  /** Supplied files that could not be used (not a DXF, an image that does not decode, a cycle). */
  failed: { kind: 'xref' | 'image'; path: string; why: string }[]
  /** Companion paths that were used. */
  used: string[]
}

const MAX_DEPTH = 8

export function readDxfDoc(bytes: Uint8Array): DxfDoc {
  const tags = readTags(bytes)
  if (tags.n < 2) throw new DxfError('no group codes')
  return parseDoc(tags)
}

export async function resolveDxf(doc: DxfDoc, self: string | undefined, io: DxfIo): Promise<DxfResolution> {
  const out: DxfResolution = { resolved: {}, missing: [], failed: [], used: [] }
  out.resolved = await walk(doc, self, io, out, self ? [self] : [], 0)
  return out
}

async function walk(doc: DxfDoc, base: string | undefined, io: DxfIo, out: DxfResolution, stack: string[], depth: number): Promise<DxfResolved> {
  const refs = dxfReferences(doc)
  const resolved: DxfResolved = {}
  for (const x of refs.xrefs) {
    const got = await io.read(x.path, base)
    if (!got) {
      if (!out.missing.some((m) => m.path === x.path)) out.missing.push({ kind: 'xref', path: x.path })
      continue
    }
    if (stack.includes(got.path) || depth >= MAX_DEPTH) {
      out.failed.push({ kind: 'xref', path: x.path, why: 'circular reference' })
      continue
    }
    let sub: DxfDoc
    try {
      sub = readDxfDoc(got.bytes)
    } catch (e) {
      out.failed.push({ kind: 'xref', path: x.path, why: (e as Error).message })
      continue
    }
    if (!out.used.includes(got.path)) out.used.push(got.path)
    const nested = await walk(sub, got.path, io, out, [...stack, got.path], depth + 1)
    ;(resolved.xrefs ??= new Map()).set(x.block, { doc: sub, resolved: nested })
  }
  for (const im of refs.images) {
    const got = await io.read(im.path, base)
    if (!got) {
      if (!out.missing.some((m) => m.path === im.path)) out.missing.push({ kind: 'image', path: im.path })
      continue
    }
    const img = await io.image(got.bytes, got.path)
    if (!img) {
      out.failed.push({ kind: 'image', path: im.path, why: 'the image cannot be decoded' })
      continue
    }
    if (!out.used.includes(got.path)) out.used.push(got.path)
    ;(resolved.images ??= new Map()).set(im.handle, img)
  }
  return resolved
}
