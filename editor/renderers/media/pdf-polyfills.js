// Polyfills the pdf.js LEGACY build still expects from the engine (its bundled core-js covers
// Map#getOrInsertComputed, Math.sumPrecise, Uint8Array.fromBase64, ... but not these). Needed on
// iOS 16-17.3 / Safari 16 / older Android WebViews. Imported first by renderers/pdf.ts (main
// thread) and by media/pdf-worker.js (worker). Plain JS so the worker can import it as is.

if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers() {
      let resolve, reject
      const promise = new this((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }
  })
}

for (const [name, fromEnd] of [
  ['findLast', (arr, fn, self) => { for (let i = arr.length - 1; i >= 0; i--) if (fn.call(self, arr[i], i, arr)) return arr[i] }],
  ['findLastIndex', (arr, fn, self) => { for (let i = arr.length - 1; i >= 0; i--) if (fn.call(self, arr[i], i, arr)) return i; return -1 }]
]) {
  for (const proto of [Array.prototype, Object.getPrototypeOf(Int8Array.prototype)]) {
    if (typeof proto[name] !== 'function') {
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: function (fn, self) {
          return fromEnd(this, fn, self)
        }
      })
    }
  }
}

if (typeof globalThis.structuredClone !== 'function') {
  // Synchronous deep copy for the data pdf.js clones (plain objects, arrays, typed arrays,
  // ArrayBuffers, Maps, Sets, Dates, RegExps); `transfer` is accepted and ignored.
  const clone = (v, seen) => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return seen.get(v)
    let out
    if (ArrayBuffer.isView(v)) out = v instanceof DataView ? new DataView(v.buffer.slice(0)) : v.slice()
    else if (v instanceof ArrayBuffer) out = v.slice(0)
    else if (v instanceof Date) out = new Date(v.getTime())
    else if (v instanceof RegExp) out = new RegExp(v.source, v.flags)
    else if (v instanceof Map) {
      out = new Map()
      seen.set(v, out)
      for (const [k, x] of v) out.set(clone(k, seen), clone(x, seen))
      return out
    } else if (v instanceof Set) {
      out = new Set()
      seen.set(v, out)
      for (const x of v) out.add(clone(x, seen))
      return out
    } else if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) out = v
    else {
      out = Array.isArray(v) ? [] : {}
      seen.set(v, out)
      for (const k of Object.keys(v)) out[k] = clone(v[k], seen)
      return out
    }
    seen.set(v, out)
    return out
  }
  Object.defineProperty(globalThis, 'structuredClone', {
    configurable: true,
    writable: true,
    value: (value) => clone(value, new Map())
  })
}
