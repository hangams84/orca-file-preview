// pdf.js worker entry. pdf.js 6.5 prefetches page dictionaries (Catalog.getPageDict:
// `pageDictCache.put(kid, xref.fetchAsync(kid))`) and never handles the ones that fail, so a damaged
// file leaves unhandled FormatError/XRef* rejections in the worker even though the document itself
// loads (and the affected pages report their error when they are drawn). Report those as warnings
// instead of uncaught errors. Plain JS (not .ts) because it is loaded as a module Worker; when the
// worker cannot start, pdf.js imports this same module on the main thread as its "fake worker".
import './pdf-polyfills.js'
import '../../../vendor/pdf.worker.min.js'

const PDFJS_ERRORS = new Set([
  'FormatError',
  'XRefEntryException',
  'XRefParseException',
  'InvalidPDFException',
  'MissingDataException',
  'ParserEOFException',
  'UnknownErrorException',
  'AbortException'
])

self.addEventListener('unhandledrejection', (e) => {
  const name = e.reason && e.reason.name
  if (!PDFJS_ERRORS.has(name)) return
  e.preventDefault()
  console.warn(`pdf.js: ignored ${name}: ${e.reason.message}`)
})
