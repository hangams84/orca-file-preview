// pdf.js (Apache-2.0) display layer, LEGACY build: it carries polyfills (Promise.withResolvers, Map#getOrInsertComputed,
// Math.sumPrecise, Uint8Array.fromBase64, ...) so PDFs work on iOS 16-17.3, Safari 16 and older Android WebViews.
// The worker (vendor/pdf.worker.min.js, also legacy) and the cMaps, standard
// fonts and image decoders (vendor/pdf-assets/) are copied by tools/build-vendor.mjs.
export { getDocument, GlobalWorkerOptions, PasswordResponses, TextLayer, version } from 'pdfjs-dist/legacy/build/pdf.mjs'
