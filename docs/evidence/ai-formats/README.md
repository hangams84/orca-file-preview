# AI model format readers: ONNX, TFLite, GGUF, Keras/HDF5, NumPy

The readers in `plugin/editor/renderers/aimodel/formats/` turn each file into the lead's `ModelIR`
(`aimodel/ir.ts`). Each one exports `read(source: ByteSource)` and `detect(head)`. They read the
file lazily, so values are fetched only through `TensorInfo.read`. Any failure, whether during the
parse or a later tensor read, becomes a `PreviewError` with the code `<format>-damaged`.

## How this was measured

- **Samples:** `tools/make-ai-format-samples.py` generates them in `samples/ai-formats/` (45 files,
  582 KB) with fixed seeds, using onnx 1.23, torch 2.15 (`torch.onnx.export`), TensorFlow 2.21 and
  Keras 3.15, gguf-py 0.19, h5py 3.14 and NumPy 2.5. The same script reads every file back with
  those libraries into `samples/ai-formats/truth.json`.
- **Fidelity:** `node --experimental-transform-types tools/ai-formats/fidelity.mjs` runs each
  reader on every sample and compares the result with the truth file.
- **Robustness:** the same script truncates every sample at about 35 points and damages it 40 times
  with random bytes and `FF FF FF FF` runs. Each run must end in either a result or a
  `PreviewError`, never a raw exception or a hang (10 s limit). For runs that parse, up to 200
  tensors are also read.
- **Laziness:** `tools/ai-formats/laziness.mjs` counts the bytes a reader requests to open about
  40 MB files generated locally, which are not committed.
- **Unit tests:** `formats/formats.test.ts` runs 14 tests under `orca plugin test`. Its inputs are
  11 small samples plus their truth, packed by `tools/ai-formats/make-unit-fixtures.mjs` into
  `formats/fixtures.ts` (zlib + base64, 38 KB).
- **Real Orca:** a throwaway dev copy (id `file-preview-ai-formats`) used a debug renderer that
  dumps the IR as text, since the lead's views have not landed yet. The `orca-*.png` captures
  come from `plugin open` + `plugin shot --window`, with the left 285 px cropped. That renderer is
  not committed.

## Fidelity against the Python libraries

| Format | Checks | Result | What is compared |
|---|---:|---:|---|
| NumPy (.npy/.npz) | 73 | 73 ✓ | shape, dtype, byte length, first values (incl. big-endian, Fortran order, f16, `U`/`S`/structured/object, stored + deflated npz) |
| GGUF | 193 | 193 ✓ | tensor names/order, shape, ggml type, byte size, absolute offset, alignment, data offset, every KV (all 13 types, arrays, nested arrays), dequantized values for F32/F16/BF16/Q4_0/Q4_1/Q5_0/Q5_1/Q8_0/Q2_K/Q3_K/Q4_K/Q5_K/Q6_K/IQ4_NL/IQ4_XS vs `gguf.quants.dequantize`; blk.N → attn/ffn tree |
| ONNX | 286 | 286 ✓ | IR version, opsets, producer, metadata_props, node count and op histogram per (sub)graph, node names, attribute names, graph inputs/outputs, If/Loop/Scan subgraphs, local functions, initializer shapes, dtypes, values (raw_data, float_data, int64_data, int32_data f16, double, bf16, strings), external-data flags, parameter totals |
| TFLite | 313 | 313 ✓ | schema version, subgraph names, op sequence per subgraph (also against `Interpreter._get_ops_details`), every tensor's shape/dtype/stored flag, buffer sizes, quantization scales and zero points, constant values, signature defs, metadata names; the generated op table against `schema_py_generated` |
| HDF5 | 426 | 426 ✓ | superblock v0/v2/v3: every dataset path, shape, dtype, chunk shape, values (contiguous; chunked over B-tree v1, fixed array, single chunk, extensible array; gzip, shuffle), dataset/group attributes, root attribute values (strings, vlen UTF-8, arrays), dense link storage (20-link group) |
| Keras | 206 | 206 ✓ | `.keras` and legacy `.h5`, Sequential and Functional: parameter totals (= `count_params`), layer order/classes/names, per-layer weight shapes and variable names, Functional edges (concat ← gap, gmp; aux ← gap), graph inputs/outputs, optimizer state, all weight datasets |
| Robustness | 2596 runs | 0 raw, 0 hangs | 1137 parsed (partial damage), 1459 friendly `PreviewError`s, 0 raw tensor-read errors; all `broken.*` samples refuse with a friendly message |

## Laziness (bytes read to open a file)

| file | size | read to open | % | open time |
|---|---:|---:|---:|---:|
| big.gguf (50k-token vocab, 10 × 4 MB tensors) | 40.7 MB | 1.00 MB | 2.5% | 47 ms |
| big.onnx (10 × 4 MB initializers) | 40.0 MB | 0.75 MB | 1.9% | 4 ms |
| big.tflite | 40.0 MB | 0.63 MB | 1.6% | 3 ms |
| big.h5 (Keras legacy) | 40.1 MB | 0.78 MB | 1.9% | 5 ms |
| big.keras | 40.1 MB | 0.83 MB | 2.1% | 5 ms |
| big.npz | 40.0 MB | 1.31 MB | 3.3% | 2 ms |

Sampling 64 bytes of the last tensor reads exactly 64 bytes. The opening reads are dominated by the
64 KiB page cache and the read-ahead windows (64 KiB for protobuf, 1 MiB for GGUF headers).

## Real Orca (debug dump renderer, not the lead's views)

`orca-onnx-control-flow.onnx.png`, `orca-tflite-int8.tflite.png`, `orca-gguf-tiny-llama.gguf.png`,
`orca-keras-functional.keras.png`, `orca-hdf5-v3.h5.png` and `orca-np-compressed.npz.png` show
each reader working inside the Orca frame (CSP, transpiled TS, DecompressionStream). Parsing takes
about 3–21 ms. `orca-broken.onnx.png` shows the shell's friendly refusal; Orca logs it as
`preview refused: onnx-damaged`.

## Coverage

| Format | Read | Not read / limits |
|---|---|---|
| ONNX | ModelProto fields; graph nodes and every attribute type (float, int, string, tensor, graph, sparse tensor, type proto, and their lists, `ref_attr_name`); initializers (raw_data and all typed fields, lazy offsets); sparse initializers (noted); value_info incl. sequence/map/optional types and symbolic dims; opset imports; metadata_props; If/Loop/Scan subgraphs at any depth (depth limit 32); local functions linked from the nodes that call them; torch node names → `module` | External data: location, offset and length are shown, but values are not read because the side file is not available (see questions). training_info is counted only. |
| TFLite | All subgraphs; operators with the complete builtin table (210 codes) and every builtin-options table (151, generated from TF's schema), custom op names; tensors with shape, shape_signature, type, quantization (scale, zero point, axis, min/max), sparsity flag; buffers (inline or the offset/size form of >2 GB files, lazy); signature defs; metadata (short strings are decoded); WHILE/IF/CALL_ONCE links | Nested union tables inside options; sparse tensors are shown as stored (not densified); the `CONVERSION_METADATA` flatbuffer is reported by size only. |
| GGUF | v1–v3, little- and big-endian; every KV type including nested arrays (arrays are clipped to 64 items, the full length is kept in `gguf.kv_types`); tensor infos; alignment; all 42 ggml types with block layouts; `dequantize()` for F32/F16/BF16/F64/I8–I64, Q4_0/Q4_1/Q5_0/Q5_1/Q8_0, Q2_K–Q8_K, IQ4_NL, IQ4_XS; tree blk.N → attn/ffn | IQ1/IQ2/IQ3, TQ, MXFP4, NVFP4, Q1_0 and Q8_1 are reported as "quantized, not decoded". |
| HDF5 | Superblock v0–v3 (with userblock); object headers v1/v2 with continuations; groups: symbol table (B-tree v1 + local heap), compact links, dense links (fractal heap + B-tree v2); compact and dense attributes, vlen strings from the global heap; datasets: compact, contiguous, chunked (B-tree v1, single chunk, implicit, fixed array, B-tree v2, extensible array when all chunks are in the index block); deflate, shuffle, fletcher32, LZF; ints, floats incl. f16/bf16, fixed strings, enum/bool, compound, array, vlen types; committed datatypes | Soft and external links are noted, not followed. Huge fractal-heap objects, paged fixed arrays, extensible arrays beyond the index block, szip/blosc and filtered fractal heaps: the dataset is listed without values and with a reason. Virtual datasets. |
| Keras | `.keras`: config.json, metadata.json, model.weights.h5 (stored entries are read in place); legacy `.h5`: model_config, training_config, model_weights / optimizer_weights; graph for Sequential and Functional (Keras 2 and Keras 3 inbound_nodes, multiple calls, multi-output, nested models as subgraphs), Keras-tensor shapes; module tree with layer configs; Keras 3 `vars/N` mapped to layers through the `name` attribute, with variable names for common layers; optimizer and compile config as checkpoint info | Subclassed models without a functional config give only layers and weights. Weight-only `.weights.h5` files have no graph. |
| NumPy | `.npy` v1–v3: dict header (a literal parser, never evaluated), every dtype kind, big-endian, Fortran order (served in C order), structured dtypes with sub-arrays; `.npz` stored members (ranged) and deflated members (only the header is inflated until a value is read) | Object arrays: pickled values are never read. Deflated members larger than 1 GiB, or claiming more than deflate can produce, are skipped. |

## Why our own HDF5 reader

jsfive (BSD-3) and h5wasm (MIT, about 3.5 MB of WASM) both need the whole file in memory: jsfive
takes an ArrayBuffer, and h5wasm needs the file in its Emscripten filesystem. That breaks the
lazy-read rule for files of any size, and h5wasm alone would add more than all of these readers
together. The reader here is 46 KB of TS, reads only the metadata it walks, and bounds every
address by the file size.

## Sizes added to `plugin/`

235 KB of TypeScript in `aimodel/formats/`. Of that, 38 KB is test fixtures and 13 KB is tests, so
184 KB ships as code. That includes the 15 KB generated TFLite schema. No new vendor library.
