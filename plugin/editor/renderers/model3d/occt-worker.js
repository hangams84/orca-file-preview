// STEP / IGES / BREP import off the main thread: OpenCascade compiled to WebAssembly
// (occt-import-js, LGPL-2.1, loaded unmodified from vendor/occt/) reads the B-rep and tessellates
// it; the result is converted to typed arrays and transferred to the page. Classic worker (the
// library is a classic script loaded with importScripts). Plain JavaScript, no transpile step.
//
// in:  { format: 'step' | 'iges' | 'brep', buffer: ArrayBuffer, params, base: URL of vendor/occt/ }
// out: { progress: 'engine' | 'reading' | 'converting' } messages, then
//      { ok: true, meshes, root, stats } | { ok: false, message }
//   meshes[i] = { name, position: Float32Array, normal?: Float32Array, index: Uint32Array,
//                 color: [r, g, b] | null (sRGB 0-1), vcolor?: Float32Array (linear RGB per vertex) }
//   root = { name, meshes: number[], children: [...] }

self.onmessage = async (e) => {
  const { format, buffer, params, base } = e.data
  try {
    self.postMessage({ progress: 'engine' })
    const t0 = Date.now()
    await loadEngineScript(base + 'occt-import-js.js')
    // Fetch the WebAssembly ourselves (from the plugin's own files) so the server's MIME type
    // does not matter, then hand the bytes to the Emscripten module.
    const res = await fetch(base + 'occt-import-js.wasm')
    if (!res.ok) throw new Error(`engine download failed: HTTP ${res.status}`)
    const wasmBinary = await res.arrayBuffer()
    const occt = await self.occtimportjs({ wasmBinary, locateFile: (p) => base + p })
    const tEngine = Date.now() - t0
    self.postMessage({ progress: 'reading' })
    const t1 = Date.now()
    const r = occt.ReadFile(format, new Uint8Array(buffer), params)
    const tRead = Date.now() - t1
    if (!r || !r.success) {
      self.postMessage({ ok: false, message: 'OpenCascade could not read the file' })
      return
    }
    self.postMessage({ progress: 'converting' })
    const transfer = []
    const meshes = r.meshes.map((m, i) => {
      const position = Float32Array.from(m.attributes.position.array)
      const normal = m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : undefined
      const index = Uint32Array.from(m.index.array)
      const out = { name: m.name || '', position, index, color: m.color || null }
      if (normal && normal.length === position.length) out.normal = normal
      const faces = m.brep_faces || []
      if (faces.some((f) => f.color)) {
        // per-face colours → per-vertex colours; faces without one keep the mesh colour (or grey)
        const vcolor = new Float32Array(position.length)
        const base3 = (m.color || [0.71, 0.73, 0.77]).map(toLinear)
        for (let k = 0; k < vcolor.length; k += 3) vcolor.set(base3, k)
        for (const f of faces) {
          if (!f.color) continue
          const c = f.color.map(toLinear)
          for (let t = f.first; t <= f.last; t++) for (let k = 0; k < 3; k++) vcolor.set(c, index[t * 3 + k] * 3)
        }
        out.vcolor = vcolor
        transfer.push(vcolor.buffer)
      }
      transfer.push(position.buffer, index.buffer)
      if (out.normal) transfer.push(out.normal.buffer)
      void i
      return out
    })
    const root = slimNode(r.root)
    self.postMessage({ ok: true, meshes, root, stats: { engineMs: tEngine, readMs: tRead } }, transfer)
  } catch (err) {
    self.postMessage({ ok: false, message: String((err && err.message) || err) })
  }
}

function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function slimNode(n) {
  return { name: (n && n.name) || '', meshes: (n && n.meshes) || [], children: ((n && n.children) || []).map(slimNode) }
}

// The Emscripten glue in occt-import-js 0.0.23 (embind) builds two kinds of small wrapper functions
// from source text with `new Function`, which a Content Security Policy without 'unsafe-eval' (Orca's
// plugin frames, the harness) refuses. The library file in vendor/occt/ stays unmodified (LGPL: a
// separate, replaceable file); here its text is loaded and those two spots are swapped for the
// closure-based equivalents Emscripten itself emits when built with -sDYNAMIC_EXECUTION=0. The
// patched text runs from a blob: URL (allowed by script-src blob:). When a future version no longer
// contains the patterns, the text is loaded as it is.
const EVAL_PATCHES = [
  [
    'var invokerFn=newFunc(Function,args)(...closureArgs);',
    'var invokerFn=function(...a){var destructors=needsDestructorStack?[]:null;var wired=[cppTargetFunc];var thisWired;' +
      "if(isClassMethodFunc){thisWired=argTypes[1]['toWireType'](destructors,this);wired.push(thisWired)}" +
      "var argWired=[];for(var k=0;k<argCount-2;++k){var w=argTypes[k+2]['toWireType'](destructors,a[k]);argWired.push(w);wired.push(w)}" +
      'var rv=cppInvokerFunc(...wired);' +
      'if(needsDestructorStack){runDestructors(destructors)}else{for(var k=isClassMethodFunc?1:2;k<argTypes.length;++k){' +
      'if(argTypes[k].destructorFunction!==null){argTypes[k].destructorFunction(k===1?thisWired:argWired[k-2])}}}' +
      "if(returns){return argTypes[0]['fromWireType'](rv)}};"
  ],
  [
    'var invokerFunction=newFunc(Function,params)(...args);',
    'var invokerFunction=function(obj,func,destructorsRef,argsPtr){var off=0;var vals=[];' +
      'for(var k=0;k<argCount;++k){vals.push(types[k].readValueFromPointer(argsPtr+off));off+=types[k].argPackAdvance}' +
      'var rv=kind===1?Reflect.construct(func,vals):kind===0?func.apply(obj,vals):func.call(...vals);' +
      'return retType.isVoid?undefined:emval_returnValue(retType,destructorsRef,rv)};'
  ]
]

async function loadEngineScript(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`engine script download failed: HTTP ${res.status}`)
  let text = await res.text()
  for (const [from, to] of EVAL_PATCHES) text = text.split(from).join(to)
  const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
  try {
    self.importScripts(blobUrl)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}
