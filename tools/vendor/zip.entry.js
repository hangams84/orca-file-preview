// fflate (MIT): synchronous unzip for the PPTX renderer; inflateSync for legacy/zip.ts when the
// browser has no DecompressionStream('deflate-raw') (Safari before 16.4).
export { unzipSync, strFromU8, inflateSync } from 'fflate'
