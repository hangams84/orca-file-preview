// meshoptimizer decoder (MIT, shipped with three.js) for glTF EXT_meshopt_compression. A separate
// bundle loaded only for such files: it compiles WebAssembly as soon as it is imported, which a
// frame without 'wasm-unsafe-eval' refuses (the preview then explains that instead of failing).
export { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
