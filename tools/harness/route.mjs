// How Orca hands a file to this plugin (Orca 1.4.277: src/shared/file-preview/binary-buffer.ts,
// src/renderer/src/components/editor/panel/editor-panel-render-model.ts):
// - a file is binary when its first 8 KB hold a NUL byte; only then are `bytes` editors offered, and the
//   document carries `fileType` (the matched suffix);
// - otherwise only `text` editors are offered, and the document is the UTF-8 text without a fileType;
// - a file no editor of the right kind matches stays in Orca's own Source view (no plugin at all).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const BINARY_PROBE_BYTES = 8192
/** Suffixes Orca reads as images/PDF by MIME type: always binary, whatever the content
 *  (src/shared/file-preview/image-mime-types.ts, file-preview-kind.ts). */
export const MIME_BINARY = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.pdf']

export function isBinaryBuffer(buf) {
  const n = Math.min(buf.length, BINARY_PROBE_BYTES)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

const manifests = new Map()
function editorsOf(root, plugin) {
  if (!manifests.has(plugin)) {
    manifests.set(plugin, JSON.parse(readFileSync(join(root, plugin, 'orca-plugin.json'), 'utf8')).contributes.customEditors)
  }
  return manifests.get(plugin)
}

/** { kind: 'bytes' | 'text', entry } for the editor Orca would open, or null when Orca keeps the file in Source. */
export function orcaRoute(root, plugin, file) {
  const bytes = readFileSync(join(root, file))
  const name = file.toLowerCase().split(/[\\/]/).pop()
  const kind = MIME_BINARY.some((x) => name.endsWith(x)) || isBinaryBuffer(bytes) ? 'bytes' : 'text'
  const editor = editorsOf(root, plugin).find(
    (e) => (e.contentKind ?? 'text') === kind && e.extensions.some((x) => name.endsWith(x.toLowerCase()))
  )
  return editor ? { kind, entry: editor.entry } : null
}

/** Query string for the harness page: the editor entry and how the mock host sends the document. */
export function routeQuery(route) {
  return route ? `&kind=${route.kind}&entry=${encodeURIComponent(route.entry)}` : ''
}
