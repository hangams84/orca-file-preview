// Parses geometry-only 3D formats (STL, OBJ, PLY, OFF) off the main thread, so a model with
// millions of triangles never freezes the page. Plain JavaScript (module worker).
//
// in:  { kind: ModelKind, buffer: ArrayBuffer }
// out: { loaded: true } first, then { ok: true, parts, notes } | { ok: false, message }
import { parseGeometry, transferables } from './parse.js'

self.postMessage({ loaded: true })

self.onmessage = (e) => {
  const { kind, buffer } = e.data
  try {
    const { parts, notes } = parseGeometry(kind, buffer)
    self.postMessage({ ok: true, parts, notes }, transferables(parts))
  } catch (err) {
    self.postMessage({ ok: false, message: String((err && err.message) || err) })
  }
}
