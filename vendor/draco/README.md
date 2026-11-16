# Draco decoder

`draco_decoder.js` is the asm.js (pure JavaScript, no WebAssembly) glTF build of Google's
[Draco](https://github.com/google/draco) decoder, copied unchanged from three.js 0.179.1
(`examples/jsm/libs/draco/gltf/`) by `tools/build-vendor.mjs`. Licensed under the Apache License 2.0
(https://www.apache.org/licenses/LICENSE-2.0). three.js' DRACOLoader fetches it from this folder and
runs it in a blob Worker when a glTF uses `KHR_draco_mesh_compression`.
