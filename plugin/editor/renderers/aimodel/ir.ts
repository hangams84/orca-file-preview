/** ModelIR: the one description every AI-model reader produces and every view consumes.
 *
 *  Contract between readers (`aimodel/formats/<format>.ts`, each exporting
 *  `read(source: ByteSource): Promise<ModelIR>`) and the views (`aimodel/views/*`). Types only: helpers
 *  (dtype decoding, tree inference, edges) live in sibling modules (`dtype.ts`, `tree.ts`, `graph.ts`,
 *  `bytes.ts`, `zip.ts`) that readers may import.
 *
 *  Reader file names (the renderer dispatches on them):
 *    pytorch.ts      .pt .pth .ckpt .chkpt .ptl .bin .pkl (zip, legacy pickle, TorchScript, Lightning)
 *    pt2.ts          .pt2 (torch.export)
 *    safetensors.ts  .safetensors
 *    onnx.ts         .onnx
 *    tflite.ts       .tflite
 *    gguf.ts         .gguf
 *    keras.ts        .keras (zip) .h5 .hdf5 (HDF5)
 *    numpy.ts        .npy .npz
 *
 *  Rules for readers:
 *  - Never run, import or evaluate anything from the file (no eval, no new Function, no network).
 *  - Read lazily: headers/indices up front through `ByteSource.read`; tensor values only inside
 *    `TensorInfo.read`. A reader must work on a multi-GB `File` without reading it whole.
 *  - Refuse damaged or unrelated input by throwing `PreviewError` (core/types.ts) with a short code
 *    as message and a friendly hint; the shell shows it.
 *  - Put anything the reader could not recover in `notes` rather than guessing silently. */

/** Random access to the file. Backed by the editor bytes (≤ 50 MB from Orca) or by `File.slice()` in
 *  the File Preview panel (any size). */
export interface ByteSource {
  /** Total size in bytes. */
  readonly size: number
  /** Bytes [offset, offset + length), clamped to the end of the file. The result may be a view into a
   *  larger buffer: copy it if you keep it and need an exact `.buffer`. Never mutate it. */
  read(offset: number, length: number): Promise<Uint8Array>
  /** File name when known (panel), for messages only. */
  readonly name?: string
}

/** Canonical element types. Readers map their own names onto these; anything else (GGUF `Q4_K`,
 *  TFLite `INT4`, packed formats) is passed through as a free string and is shown but not decoded.
 *  f64 f32 f16 bf16 f8e4m3 f8e5m2 · i64 i32 i16 i8 · u64 u32 u16 u8 · bool · c64 c128 ·
 *  qint8 quint8 qint32 quint4x2 (PyTorch quantized; values are the integers, see `quant`) · str · object */
export type DType =
  | 'f64' | 'f32' | 'f16' | 'bf16' | 'f8e4m3' | 'f8e5m2'
  | 'i64' | 'i32' | 'i16' | 'i8'
  | 'u64' | 'u32' | 'u16' | 'u8'
  | 'bool' | 'c64' | 'c128'
  | 'qint8' | 'quint8' | 'qint32' | 'quint4x2'
  | 'str' | 'object'
  | (string & {})

/** JSON-like value for metadata and attributes. Large arrays should be truncated by the reader
 *  (keep ≤ 64 items and add `…` as a last string) so views stay fast. */
export type Value = string | number | boolean | null | bigint | Value[] | { [key: string]: Value }

/** A weight, buffer, initializer or stored array. */
export interface TensorInfo {
  /** Full dotted name, e.g. `layer1.0.conv1.weight` (PyTorch), the initializer name (ONNX), the HDF5
   *  path with `/` turned into `.` (Keras), the GGUF tensor name, the array name in an .npz. Unique. */
  name: string
  /** Dimensions, outermost first. `[]` is a scalar. Symbolic dims are not allowed here (use 0 = unknown). */
  shape: number[]
  dtype: DType
  /** Bytes the tensor occupies in the file (its own elements, not the whole shared storage); 0 when the
   *  values are not stored (e.g. a meta tensor). */
  byteLength: number
  /** What the tensor is, when the format says so. */
  kind?: 'parameter' | 'buffer' | 'constant' | 'initializer' | 'optimizer-state' | 'array' | 'other'
  /** Byte order of the stored values (default little). Readers should return little-endian from
   *  `read` when cheap; set this to 'big' otherwise (legacy big-endian PyTorch, `>f4` NumPy). */
  byteOrder?: 'little' | 'big'
  /** Quantization parameters (affine): real = (q - zeroPoint) * scale. Per-tensor → one item; per-axis
   *  → one per slice along `axis`. Truncate long lists (keep `count`). */
  quant?: { scheme?: string; scale?: number[]; zeroPoint?: number[]; axis?: number; count?: number }
  /** Storage key shared by tensors that alias the same memory (tied weights). Views use it to avoid
   *  double-counting bytes. */
  storage?: string
  /** Extra facts shown in details (strides, storage offset, requires_grad, GGUF type id, …). */
  attrs?: Record<string, Value>
  /** Raw bytes of the tensor's elements in row-major (C) order, relative to the tensor start:
   *  `read()` → all, `read({offset, length})` → that byte range (the inspector reads samples of large
   *  tensors this way). Absent when the values are not available. Must not read beyond the tensor. */
  read?(range?: { offset: number; length: number }): Promise<Uint8Array>
}

/** A node of the module hierarchy (nn.Module tree, Keras layers, ONNX/TFLite name scopes, GGUF
 *  blocks). The root has `path: ''`. */
export interface ModuleNode {
  /** Dotted path from the root (`''`, `layer1`, `layer1.0`, `layer1.0.conv1`). */
  path: string
  /** Last path segment (`conv1`), or the model class/name for the root. */
  name: string
  /** Class or layer type when known: `torch.nn.modules.conv.Conv2d`, `Conv2D`, `Dense`. */
  type?: string
  children: ModuleNode[]
  /** Names of the tensors owned directly by this module (not its children). */
  tensors: string[]
  /** Module attributes that are plain values (in_channels, kernel_size, stride, training, config…). */
  attrs?: Record<string, Value>
  /** True when the node was inferred from dotted names rather than read from the file. */
  inferred?: boolean
}

/** One value flowing between graph nodes (an SSA value / tensor edge). */
export interface GraphValue {
  /** Unique id inside its graph (often the tensor name). */
  id: string
  /** Shape when known; strings are symbolic dims (`batch`, `s0`). */
  shape?: (number | string)[]
  dtype?: DType
  /** Name of a `TensorInfo` when this value is a stored weight/initializer/constant. */
  tensor?: string
}

/** An operator invocation. Edges are implied by values: a value produced by one node's `outputs` and
 *  listed in another node's `inputs` is an edge (see graph.ts `edgesOf`). */
export interface GraphNode {
  /** Unique id inside its graph. */
  id: string
  /** Operator: `Conv`, `aten::conv2d`, `aten.linear.default`, `CONV_2D`, `Dense`, `prim::GetAttr`. */
  op: string
  /** Display name when the format has one (`/layer1/layer1.0/conv1/Conv`, `conv2d_1`). */
  name?: string
  /** Operator namespace/domain when not obvious from `op` (`ai.onnx.ml`, `aten`). */
  domain?: string
  attrs?: Record<string, Value>
  /** Value ids consumed, in order; '' for an omitted optional input. */
  inputs: string[]
  /** Value ids produced, in order. */
  outputs: string[]
  /** Module path (as in ModuleNode.path) this node belongs to, for collapsible groups. */
  module?: string
  /** Indices into `Graph.subgraphs` of graphs owned by this node (If/Loop bodies, TFLite subgraphs). */
  subgraphs?: number[]
}

export interface Graph {
  name?: string
  nodes: GraphNode[]
  /** Every value referenced by nodes, graph inputs or outputs. */
  values: GraphValue[]
  /** Value ids that enter the graph (model inputs; weights are values with `tensor` set). */
  inputs: string[]
  outputs: string[]
  /** Nested graphs (control-flow bodies, extra TFLite subgraphs, TorchScript methods). */
  subgraphs?: Graph[]
}

/** Training-checkpoint facts (Lightning .ckpt, HF trainer state, optimizer dicts). */
export interface CheckpointInfo {
  epoch?: number
  step?: number
  /** Lightning `hyper_parameters`, HF `config.json`-like dicts, Keras compile config… */
  hyperParameters?: Record<string, Value>
  optimizers?: {
    /** Class when recoverable (Lightning stores none; inferred from state keys such as exp_avg → Adam). */
    type?: string
    inferred?: boolean
    /** param_groups without the `params` lists (lr, betas, weight_decay, …) plus `params: <count>`. */
    groups: Record<string, Value>[]
    /** Number of per-parameter state tensors and their total bytes. */
    stateTensors?: number
    stateBytes?: number
  }[]
  schedulers?: Record<string, Value>[]
  /** Library versions (pytorch-lightning, torch, transformers, producer). */
  versions?: Record<string, string>
  /** Other top-level checkpoint keys and their short descriptions (callbacks, loops, …). */
  extra?: Record<string, Value>
}

/** Something the reader wants the user to know (limitations, fallbacks, warnings). */
export interface Note {
  level: 'info' | 'warn'
  en: string
  ko?: string
}

export interface ModelIR {
  /** Machine id of the container: `pytorch-zip`, `pytorch-legacy`, `torchscript`, `pt2`, `safetensors`,
   *  `onnx`, `tflite`, `gguf`, `keras`, `hdf5`, `npy`, `npz`. */
  format: string
  /** Human label with version: `PyTorch state_dict (zip, v3)`, `ONNX · opset 17 · IR 8`. */
  formatLabel: string
  /** `pytorch`, `onnx`, `tensorflow`, `keras`, `llama.cpp`, `numpy`. */
  framework?: string
  /** Producer / exporter string when stored (`pytorch 2.4.0`, `tf2onnx 1.16`). */
  producer?: string
  /** Free metadata: safetensors `__metadata__`, GGUF key-values, ONNX metadata_props, Keras config. */
  metadata: Record<string, Value>
  /** All stored tensors, in file order. Views handle 100k+. */
  tensors: TensorInfo[]
  /** Module hierarchy if the file has one; views infer it from tensor names otherwise (tree.ts). */
  modules?: ModuleNode
  /** Operator graph if the format stores one (TorchScript, pt2, ONNX, TFLite, Keras functional). */
  graph?: Graph
  checkpoint?: CheckpointInfo
  notes: Note[]
}
