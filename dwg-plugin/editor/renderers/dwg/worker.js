// Reads a DWG/DWT file off the main thread with LibreDWG compiled to WebAssembly
// (@mlightcad/libredwg-web, GPL-3.0, vendor/libredwg/). Module worker; plain JavaScript, no transpile step.
// The engine file is the CSP build made by tools/build-dwg-vendor.mjs (no string evaluation), and the
// WebAssembly is fetched from the plugin's own files.
//
// in:  { buffer: ArrayBuffer }
// out: { progress: 'engine' | 'reading' | 'converting' } messages, then
//      { ok: true, db, version, error, thumbnail, layerColors, ms } | { ok: false, message, error, version }
//   error: LibreDWG's error bits (>= 128 is critical), version: { type, hdr, description }

import { LibreDwg, createModule } from '../../../vendor/libredwg/libredwg.js'

const CRITICAL = 128

let enginePromise = null
function engine() {
  enginePromise ??= (async () => {
    const res = await fetch(new URL('../../../vendor/libredwg/libredwg-web.wasm', import.meta.url))
    if (!res.ok) throw new Error(`engine download failed: HTTP ${res.status}`)
    const wasmBinary = await res.arrayBuffer()
    const quiet = () => {}
    const mod = await createModule({ wasmBinary, print: quiet, printErr: quiet })
    return LibreDwg.createByWasmInstance(mod)
  })()
  return enginePromise
}

self.onmessage = async (e) => {
  const { buffer } = e.data
  let version = null
  let error = 0
  try {
    self.postMessage({ progress: 'engine' })
    const t0 = Date.now()
    const lib = await engine()
    const tEngine = Date.now() - t0
    self.postMessage({ progress: 'reading' })
    const t1 = Date.now()
    const wasm = lib.wasmInstance
    // dwg_read_file directly (not LibreDwg.dwg_read_data) to see the error bits
    const name = 'in.dwg'
    wasm.FS.writeFile(name, new Uint8Array(buffer))
    let result
    try {
      result = wasm.dwg_read_file(name)
    } finally {
      try {
        wasm.FS.unlink(name)
      } catch {
        // ignore
      }
    }
    error = (result && result.error) || 0
    const data = result && result.data
    if (!data) {
      self.postMessage({ ok: false, message: `LibreDWG could not read the file (error ${error})`, error, version })
      return
    }
    try {
      version = lib.dwg_get_version_type(data)
    } catch {
      version = null
    }
    if (error >= CRITICAL) {
      try {
        lib.dwg_free(data)
      } catch {
        // ignore
      }
      self.postMessage({ ok: false, message: `LibreDWG could not read the file (error ${error})`, error, version })
      return
    }
    const tRead = Date.now() - t1
    self.postMessage({ progress: 'converting' })
    const t2 = Date.now()
    const { database, stats } = lib.convertEx(data)
    // raw layer colours: libredwg-web's converter misreads the colour index of some files (see
    // decodeColor in scene.ts), so the page decodes them itself
    const layerColors = {}
    try {
      for (const p of lib.dwg_getall_LAYER(data)) {
        const name = lib.dwg_dynapi_entity_data(p, 'name')
        const c = lib.dwg_dynapi_entity_data(p, 'color')
        if (typeof name === 'string' && c) layerColors[name] = { index: c.index, rgb: c.rgb, method: c.method }
      }
    } catch {
      // keep the converted colours
    }
    let thumbnail = null
    try {
      const t = lib.dwg_bmp(data)
      if (t && t.data && t.data.length) thumbnail = { type: t.type, data: t.data }
    } catch {
      // no preview image
    }
    try {
      lib.dwg_free(data)
    } catch {
      // ignore
    }
    // the database is plain data; the embedded thumbnail travels separately
    delete database.thumbnailImage
    self.postMessage({
      ok: true,
      db: database,
      version,
      error,
      thumbnail,
      layerColors,
      unknownEntities: (stats && stats.unknownEntityCount) || 0,
      ms: { engine: tEngine, read: tRead, convert: Date.now() - t2 }
    })
  } catch (err) {
    const msg = String((err && err.message) || err)
    self.postMessage({ ok: false, message: msg, error, version })
  }
}
