/** PyTorch reader: `torch.save` zip archives (state_dict, whole nn.Module, Lightning/other training
 *  checkpoints, Hugging Face pytorch_model.bin), TorchScript archives (module tree from data.pkl and a
 *  call graph from code/), legacy non-zip pickles and plain Python pickles. Nothing is executed: the
 *  pickles go through the inert VM in ../pickle.ts and tensor values are read lazily by range. */
import { PreviewError } from '../../../core/types.ts'
import { asciiOf } from '../bytes.ts'
import { elementBytes, numel } from '../dtype.ts'
import type { ByteSource, CheckpointInfo, ModelIR, ModuleNode, Note, TensorInfo, Value } from '../ir.ts'
import { describe, isArray, isDict, isObject, isTensor, isTuple, STORAGE_DTYPES, unpickle, type PyKey, type PyStorage, type PyTensor, type PyValue } from '../pickle.ts'
import { isZip, openZip, type ZipArchive } from '../zip.ts'

/** Calls a Python loader would make that can run commands or code. */
const DANGEROUS = /^(os|nt|posix|subprocess|sys|shutil|socket|webbrowser|pty|runpy|importlib|ctypes|pickle|marshal|code|commands|platform|multiprocessing|asyncio|requests|urllib|http|builtins\.(eval|exec|compile|open|__import__|getattr|setattr|delattr|globals|apply|breakpoint|input)|torch\.(load|hub)|numpy\.load)\b/

type StorageResolver = (st: PyStorage) => Promise<ByteSource | null>

export async function read(src: ByteSource): Promise<ModelIR> {
  if (src.size < 2) throw new PreviewError('pt-empty', 'The file is too short to be a PyTorch file.')
  if (await isZip(src)) {
    const zip = await openZip(src)
    if (zip.entries.some((e) => /(^|\/)models\/[^/]+\.json$/.test(e.name) || /(^|\/)serialized_exported_program\.json$/.test(e.name))) {
      const pt2 = await import('./pt2.ts')
      return pt2.readZip(zip, src)
    }
    return readZip(zip)
  }
  const head = await src.read(0, 2)
  if (head[0] !== 0x80) throw new PreviewError('pt-not-pickle', 'The file does not start like a torch.save archive (ZIP) or a Python pickle.')
  return readLegacyOrPickle(src)
}

// ---------------------------------------------------------------------------------------------
// zip archives

async function readZip(zip: ZipArchive): Promise<ModelIR> {
  const pkl = zip.entries.find((e) => /(^|\/)data\.pkl$/.test(e.name) && !e.name.includes('/code/'))
  if (!pkl) throw new PreviewError('pt-no-data-pkl', 'This ZIP archive has no data.pkl, so it is not a PyTorch checkpoint.')
  const prefix = pkl.name.slice(0, pkl.name.length - 'data.pkl'.length)
  const text = async (n: string) => {
    const e = zip.get(prefix + n)
    return e ? asciiOf(await zip.read(e)).trim() : undefined
  }
  const byteOrder = (await text('byteorder')) === 'big' ? 'big' : 'little'
  const version = await text('version') ?? await text('.data/version')
  const isScript = zip.entries.some((e) => e.name.startsWith(prefix + 'code/'))
  const isMobile = !!zip.get(prefix + 'bytecode.pkl')
  const pickleBytes = await zip.read(pkl)
  const sources = new Map<string, Promise<ByteSource | null>>()
  const resolve: StorageResolver = (st) => {
    let p = sources.get(st.key)
    if (!p) {
      const e = zip.get(`${prefix}data/${st.key}`)
      p = e ? zip.source(e) : Promise.resolve(null)
      sources.set(st.key, p)
    }
    return p
  }
  let res
  try {
    res = unpickle(pickleBytes, 0, { persistentLoad: storageFromPid })
  } catch (e) {
    throw new PreviewError('pt-bad-pickle', `data.pkl could not be read: ${(e as Error).message}`)
  }
  const notes: Note[] = []
  const ir = interpret(res.value, resolve, byteOrder, notes)
  reportCallables(res.callables, notes)
  ir.metadata['archive'] = prefix.replace(/\/$/, '')
  if (version) ir.metadata['format version'] = version
  ir.metadata['byte order'] = byteOrder
  if (isScript) {
    ir.format = 'torchscript'
    ir.formatLabel = isMobile ? 'TorchScript (mobile / lite interpreter)' : 'TorchScript archive'
    const code = new Map<string, string>()
    for (const e of zip.entries) {
      if (e.name.startsWith(prefix + 'code/') && e.name.endsWith('.py') && e.size < 8 * 1024 * 1024) code.set(e.name.slice(prefix.length + 5), new TextDecoder().decode(await zip.read(e)))
    }
    try {
      const { scriptGraph } = await import('../torchscript.ts')
      const rootClass = isObject(res.value) ? res.value.class : ''
      const g = scriptGraph(code, rootClass, ir)
      if (g) ir.graph = g
      else notes.push({ level: 'info', en: 'The TorchScript code could not be turned into a graph; the module tree is shown.', ko: 'TorchScript 코드를 그래프로 바꾸지 못해 모듈 트리를 보여 줍니다.' })
    } catch (e) {
      notes.push({ level: 'warn', en: `TorchScript graph: ${(e as Error).message}`, ko: `TorchScript 그래프: ${(e as Error).message}` })
    }
    ir.metadata['code files'] = code.size
    const consts = zip.get(prefix + 'constants.pkl')
    if (consts) {
      try {
        const c = unpickle(await zip.read(consts), 0, { persistentLoad: storageFromPid })
        const items = Array.isArray(c.value) ? c.value : []
        ir.metadata['constants'] = items.length
        items.forEach((v, i) => {
          if (isTensor(v)) ir.tensors.push(tensorInfo(`constants.c${i}`, v, resolve, byteOrder, 'constant'))
        })
      } catch {
        // constants are optional
      }
    }
  }
  return ir
}

/** Persistent ids of torch.save: ('storage', storage_type, key, location, numel[, view_metadata]). */
function storageFromPid(pid: PyValue): PyValue {
  if (Array.isArray(pid) && pid[0] === 'storage') {
    const t = pid[1]
    const typeName = t && typeof t === 'object' && (t as { kind?: string }).kind === 'global' ? (t as { name: string }).name : String(t)
    const dtype = STORAGE_DTYPES[typeName] ?? (typeName.startsWith('torch.') ? typeName : 'u8')
    const st: PyStorage = { kind: 'storage', key: String(pid[2]), dtype, numel: Number(pid[4] ?? 0), location: String(pid[3] ?? '') }
    const view = pid[5]
    if (Array.isArray(view) && view.length >= 3) st.view = [String(view[0]), Number(view[1]), Number(view[2])]
    return st
  }
  return { kind: 'object', class: 'persistent_id', via: 'reduce', args: [pid] }
}

// ---------------------------------------------------------------------------------------------
// legacy (torch < 1.6) and plain pickles

const LEGACY_MAGIC = 0x1950a86a20f9469cfc6cn

async function readLegacyOrPickle(src: ByteSource): Promise<ModelIR> {
  // Pickles sit at the start of the file; read growing chunks until they parse.
  let chunk = Math.min(src.size, 4 * 1024 * 1024)
  for (;;) {
    const bytes = await src.read(0, chunk)
    try {
      return await parseLegacyOrPickle(bytes, src)
    } catch (e) {
      if (e instanceof RangeError && e.message === 'truncated' && chunk < src.size) {
        chunk = Math.min(src.size, chunk * 4)
        continue
      }
      if (e instanceof PreviewError) throw e
      throw new PreviewError('pickle-bad', 'The file may be truncated or not a pickle.')
    }
  }
}

async function parseLegacyOrPickle(bytes: Uint8Array, src: ByteSource): Promise<ModelIR> {
  const first = unpickle(bytes, 0)
  const notes: Note[] = []
  const magic = typeof first.value === 'bigint' ? first.value : typeof first.value === 'number' ? BigInt(first.value) : -1n
  if (magic !== LEGACY_MAGIC) {
    // A plain pickle (sklearn, a dict of numpy arrays, a pickled tensor list…).
    const ir = interpret(first.value, async () => null, 'little', notes)
    reportCallables(first.callables, notes)
    ir.format = 'pickle'
    ir.formatLabel = 'Python pickle'
    ir.framework = ir.tensors.length ? ir.framework : 'python'
    return ir
  }
  const proto = unpickle(bytes, first.end)
  const sys = unpickle(bytes, proto.end)
  const sysInfo = isDict(sys.value) ? sys.value : new Map()
  const byteOrder = sysInfo.get('little_endian') === false ? 'big' : 'little'
  const storages = new Map<string, PyStorage>()
  const body = unpickle(bytes, sys.end, {
    persistentLoad: (pid) => {
      const st = storageFromPid(pid)
      if (st && typeof st === 'object' && (st as PyStorage).kind === 'storage') {
        const s = st as PyStorage
        // View storages point at their root storage; tensors are offset accordingly.
        const key = s.key
        if (!storages.has(key)) storages.set(key, s)
      }
      return st
    }
  })
  const keys = unpickle(bytes, body.end)
  const order = Array.isArray(keys.value) ? keys.value.map(String) : []
  // Raw storages follow: for each key, an 8-byte element count then the elements.
  const offsets = new Map<string, { offset: number; size: number }>()
  let pos = keys.end
  for (const k of order) {
    const st = storages.get(k)
    const hdr = await src.read(pos, 8)
    if (hdr.length < 8) throw new PreviewError('pt-legacy-truncated', 'The legacy checkpoint is truncated.')
    const n = Number(new DataView(hdr.buffer, hdr.byteOffset, 8).getBigInt64(0, byteOrder === 'little'))
    const size = n * (elementBytes(st?.dtype ?? 'u8') || 1)
    offsets.set(k, { offset: pos + 8, size })
    pos += 8 + size
  }
  if (pos > src.size) notes.push({ level: 'warn', en: 'The file is shorter than its storages: values of some tensors are missing.', ko: '파일이 저장소보다 짧아 일부 텐서 값이 없습니다.' })
  const resolve: StorageResolver = async (st) => {
    const o = offsets.get(st.view ? st.view[0] : st.key) ?? offsets.get(st.key)
    if (!o) return null
    return { size: o.size, read: (off, len) => src.read(o.offset + off, Math.max(0, Math.min(len, o.size - off))) }
  }
  const ir = interpret(body.value, resolve, byteOrder, notes)
  reportCallables([...first.callables, ...body.callables], notes)
  ir.format = 'pytorch-legacy'
  ir.formatLabel = `PyTorch legacy pickle (protocol ${String(proto.value)}) · ${ir.formatLabel.replace(/^PyTorch /, '')}`
  ir.metadata['byte order'] = byteOrder
  if (sysInfo.get('protocol_version') !== undefined) ir.metadata['protocol version'] = Number(sysInfo.get('protocol_version'))
  return ir
}

// ---------------------------------------------------------------------------------------------
// interpretation of the unpickled object

const MAIN_KEYS = ['state_dict', 'model_state_dict', 'model', 'module', 'net', 'network', 'model_state', 'weights', 'params', 'ema', 'model_ema', 'student', 'generator']

function interpret(root: PyValue, resolve: StorageResolver, byteOrder: 'little' | 'big', notes: Note[]): ModelIR {
  const ir: ModelIR = { format: 'pytorch-zip', formatLabel: 'PyTorch', framework: 'pytorch', metadata: {}, tensors: [], notes }
  const seen = new Set<object>()
  const add = (name: string, t: PyTensor, kind?: TensorInfo['kind']) => ir.tensors.push(tensorInfo(name, t, resolve, byteOrder, kind))

  if (isModuleObject(root)) {
    ir.modules = moduleFrom(root, '', className(root), add, seen)
    ir.formatLabel = isScriptObject(root) ? 'TorchScript archive' : 'PyTorch nn.Module (pickled object)'
    if (!isScriptObject(root))
      notes.push({ level: 'info', en: 'A whole pickled nn.Module stores classes and weights but not the forward code, so no operator graph can be shown.', ko: '통째로 저장한 nn.Module에는 클래스와 가중치만 있고 forward 코드는 없어 연산 그래프를 보여 줄 수 없습니다.' })
    return ir
  }
  if (isTensor(root)) {
    add('tensor', root)
    ir.formatLabel = 'PyTorch tensor'
    return ir
  }
  if (isDict(root)) {
    const keys = [...root.keys()].map(String)
    const tensorValues = [...root.values()].filter((v) => isTensor(v)).length
    const hasMain = MAIN_KEYS.some((k) => root.has(k) && (isDict(root.get(k)) || isModuleObject(root.get(k) ?? null)))
    const dotted = keys.filter((k) => k.includes('.')).length
    // A state_dict: mostly tensors, or (quantized models) dotted names whose values are packed tuples/scalars.
    if ((tensorValues && tensorValues >= root.size * 0.5) || (!hasMain && root.size >= 2 && dotted >= root.size * 0.8)) {
      collect(root, '', add, seen, 'parameter-or-buffer')
      ir.formatLabel = 'PyTorch state_dict'
      notes.push({ level: 'info', en: 'A state_dict holds parameter names, shapes and dtypes only: the module tree is inferred from the names and there is no graph.', ko: 'state_dict에는 파라미터 이름·모양·dtype만 있어 모듈 트리는 이름에서 추론하며 그래프는 없습니다.' })
      return ir
    }
    const mainKey = MAIN_KEYS.find((k) => root.has(k) && (isDict(root.get(k)) || isModuleObject(root.get(k) ?? null)))
    const lightning = keys.some((k) => /lightning_version$/.test(k)) || (root.has('state_dict') && root.has('optimizer_states'))
    for (const [k, v] of root) {
      const key = String(k)
      if (key === mainKey) {
        if (isModuleObject(v)) ir.modules = moduleFrom(v, '', className(v), add, seen)
        else collect(v, '', add, seen, 'parameter-or-buffer')
      } else {
        collect(v, key, add, seen, /optim/i.test(key) ? 'optimizer-state' : 'other')
      }
    }
    ir.checkpoint = checkpointInfo(root, mainKey)
    if (lightning) {
      ir.formatLabel = 'PyTorch Lightning checkpoint'
      ir.framework = 'pytorch-lightning'
    } else if (mainKey) ir.formatLabel = `PyTorch checkpoint ("${mainKey}")`
    else ir.formatLabel = 'PyTorch pickled dict'
    if (mainKey && !isModuleObject(root.get(mainKey) ?? null))
      notes.push({ level: 'info', en: `Weights come from "${mainKey}" (a state_dict): the module tree is inferred from the names and there is no graph.`, ko: `가중치는 "${mainKey}"(state_dict)에서 읽었습니다. 모듈 트리는 이름에서 추론하며 그래프는 없습니다.` })
    return ir
  }
  // Lists, objects and anything else: collect what is reachable.
  collect(root, '', add, seen, 'other')
  ir.formatLabel = isObject(root) ? `Pickled ${root.class}` : 'Pickled object'
  ir.metadata['object'] = describe(root)
  if (isObject(root)) ir.modules = objectTree(root)
  return ir
}

function className(o: PyValue): string {
  return isObject(o) ? cleanClass(o.class) : ''
}

/** `__torch__.torch.nn.modules.linear.___torch_mangle_0.Linear` → `torch.nn.modules.linear.Linear`. */
export function cleanClass(c: string): string {
  return c.replace(/^__torch__\./, '').replace(/\.___torch_mangle_\d+/g, '')
}

function stateMap(o: PyValue): Map<PyKey, PyValue> | null {
  if (!isObject(o)) return null
  if (isDict(o.state)) return o.state
  // (dict, slots) state tuples
  if (Array.isArray(o.state) && isDict(o.state[0])) return o.state[0] as Map<PyKey, PyValue>
  return null
}

function isScriptObject(o: PyValue): boolean {
  return isObject(o) && o.class.startsWith('__torch__.')
}

function isModuleObject(o: PyValue): boolean {
  const s = stateMap(o)
  if (!s) return false
  return s.has('_modules') || s.has('_parameters') || (isScriptObject(o) && s.has('training'))
}

/** nn.Module (eager: _parameters/_buffers/_modules) or TorchScript object (attributes) → ModuleNode. */
function moduleFrom(o: PyValue, path: string, type: string, add: (n: string, t: PyTensor, k?: TensorInfo['kind']) => void, seen: Set<object>): ModuleNode {
  const node: ModuleNode = { path, name: path.split('.').pop() || type.split('.').pop() || 'model', type, children: [], tensors: [] }
  const s = stateMap(o)
  if (!s || seen.has(o as object)) return node
  seen.add(o as object)
  const join = (k: string) => (path ? `${path}.${k}` : k)
  const attrs: Record<string, Value> = {}
  const addT = (k: string, v: PyValue, kind: TensorInfo['kind']) => {
    if (isTensor(v)) {
      add(join(k), v, v.parameter ? 'parameter' : kind)
      node.tensors.push(join(k))
    }
  }
  if (s.has('_modules') || s.has('_parameters')) {
    const params = s.get('_parameters')
    if (isDict(params)) for (const [k, v] of params) addT(String(k), v, 'parameter')
    const bufs = s.get('_buffers')
    if (isDict(bufs)) for (const [k, v] of bufs) addT(String(k), v, 'buffer')
    const mods = s.get('_modules')
    if (isDict(mods))
      for (const [k, v] of mods) {
        if (isModuleObject(v)) node.children.push(moduleFrom(v, join(String(k)), className(v), add, seen))
        else if (v !== null) node.children.push({ path: join(String(k)), name: String(k), type: isObject(v) ? cleanClass(v.class) : describe(v), children: [], tensors: [] })
      }
    for (const [k, v] of s) {
      const key = String(k)
      if (key.startsWith('_') && key !== '_version') continue
      const val = toValue(v)
      if (val !== undefined) attrs[key] = val
    }
  } else {
    // TorchScript object: every attribute is in the state.
    for (const [k, v] of s) {
      const key = String(k)
      if (isModuleObject(v)) node.children.push(moduleFrom(v, join(key), className(v), add, seen))
      else if (isTensor(v)) addT(key, v, v.requiresGrad ? 'parameter' : 'buffer')
      else if (key !== '_is_full_backward_hook') {
        const val = toValue(v)
        if (val !== undefined) attrs[key] = val
      }
    }
  }
  if (Object.keys(attrs).length) node.attrs = attrs
  return node
}

/** A tree for arbitrary pickled objects (not modules): attributes that are objects become children. */
function objectTree(o: PyValue, path = '', depth = 0, seen = new Set<object>()): ModuleNode {
  const node: ModuleNode = { path, name: path.split('.').pop() || 'object', type: isObject(o) ? o.class : undefined, children: [], tensors: [] }
  if (!isObject(o) || depth > 12 || seen.has(o)) return node
  seen.add(o)
  const s = stateMap(o)
  const attrs: Record<string, Value> = {}
  if (o.args.length) attrs['args'] = toValue(o.args) ?? null
  if (s)
    for (const [k, v] of s) {
      const key = String(k)
      if (isObject(v)) node.children.push(objectTree(v, path ? `${path}.${key}` : key, depth + 1, seen))
      else {
        const val = toValue(v)
        if (val !== undefined) attrs[key] = val
      }
    }
  node.attrs = attrs
  return node
}

/** Every tensor reachable from a value, named by its key path. */
function collect(v: PyValue, path: string, add: (n: string, t: PyTensor, k?: TensorInfo['kind']) => void, seen: Set<object>, kind: 'parameter-or-buffer' | 'optimizer-state' | 'other', depth = 0): void {
  if (v === null || typeof v !== 'object' || v instanceof Uint8Array || depth > 64) return
  if (isTensor(v)) {
    add(path || 'tensor', v, kind === 'parameter-or-buffer' ? (v.parameter ? 'parameter' : undefined) : kind)
    return
  }
  if (seen.has(v)) return
  seen.add(v)
  const join = (k: string) => (path ? `${path}.${k}` : k)
  if (isArray(v)) {
    add(path || 'array', arrayAsTensor(v), kind === 'parameter-or-buffer' ? 'array' : kind)
    return
  }
  if (isDict(v)) {
    for (const [k, x] of v) collect(x, join(keyName(k)), add, seen, kind, depth + 1)
    return
  }
  if (Array.isArray(v)) {
    // Skip long lists of plain numbers quickly.
    if (v.length > 64 && typeof v[0] !== 'object') return
    v.forEach((x, i) => collect(x, join(String(i)), add, seen, kind, depth + 1))
    return
  }
  if (isObject(v)) {
    if (isModuleObject(v)) {
      // A module inside a dict (e.g. {'model': nn.Module}) that was not the main key.
      const s = stateMap(v)!
      for (const key of ['_parameters', '_buffers', '_modules']) {
        const m = s.get(key)
        if (isDict(m)) for (const [k, x] of m) collect(x, join(keyName(k)), add, seen, kind, depth + 1)
      }
      return
    }
    const s = stateMap(v)
    if (s) collect(s, path, add, seen, kind, depth + 1)
    if (v.dictItems) collect(v.dictItems, path, add, seen, kind, depth + 1)
    if (v.listItems) collect(v.listItems, path, add, seen, kind, depth + 1)
    v.args.forEach((x, i) => collect(x, join(`arg${i}`), add, seen, kind, depth + 1))
  }
}

function keyName(k: PyKey): string {
  if (typeof k === 'string') return k
  if (typeof k === 'number' || typeof k === 'bigint' || typeof k === 'boolean') return String(k)
  return describe(k)
}

// ---------------------------------------------------------------------------------------------
// tensors

const ARRAY_DATA = new WeakMap<PyTensor, Uint8Array>()

function arrayAsTensor(a: { shape: number[]; dtype: string; byteOrder: 'little' | 'big'; data: Uint8Array | null }): PyTensor {
  const t: PyTensor = { kind: 'tensor', storage: null, offset: 0, shape: a.shape, stride: [], dtype: a.dtype }
  if (a.data) ARRAY_DATA.set(t, a.data)
  return t
}

function rowMajorStrides(shape: readonly number[]): number[] {
  const s = new Array<number>(shape.length)
  let acc = 1
  for (let i = shape.length - 1; i >= 0; i--) {
    s[i] = acc
    acc *= shape[i]
  }
  return s
}

function tensorInfo(name: string, t: PyTensor, resolve: StorageResolver, byteOrder: 'little' | 'big', kind?: TensorInfo['kind']): TensorInfo {
  const es = elementBytes(t.dtype)
  const n = numel(t.shape)
  const info: TensorInfo = { name, shape: t.shape, dtype: t.dtype, byteLength: es ? n * es : 0, kind, byteOrder }
  const attrs: Record<string, Value> = {}
  if (t.storage) {
    info.storage = t.storage.key
    attrs['storage'] = t.storage.key
    attrs['storage_offset'] = t.offset
    if (t.storage.location && t.storage.location !== 'cpu') attrs['device'] = t.storage.location
  }
  if (t.stride.length) attrs['stride'] = t.stride
  if (t.requiresGrad !== undefined) attrs['requires_grad'] = t.requiresGrad
  if (t.quant) {
    const q = t.quant
    info.quant = { scheme: q.scheme, axis: q.axis }
    if (typeof q.scale === 'number') info.quant.scale = [q.scale]
    if (typeof q.zeroPoint === 'number') info.quant.zeroPoint = [q.zeroPoint]
    if (isTensor(q.scale)) attrs['scales'] = `tensor(${q.scale.dtype}, [${q.scale.shape.join(', ')}])`
  }
  if (!t.storage && !ARRAY_DATA.has(t)) attrs['storage'] = 'none (meta tensor)'
  info.attrs = attrs
  const inline = ARRAY_DATA.get(t)
  if (inline) {
    info.byteLength = inline.byteLength
    info.read = async (r) => (r ? inline.subarray(r.offset, r.offset + r.length) : inline)
    return info
  }
  const st = t.storage
  if (!st || !es) return info
  const contiguous = n <= 1 || !t.stride.length || t.stride.every((s, i) => s === rowMajorStrides(t.shape)[i] || t.shape[i] === 1)
  if (!contiguous) attrs['layout'] = 'strided (non-contiguous): values are gathered on read'
  info.read = async (r) => {
    const src = await resolve(st)
    if (!src) throw new PreviewError('pt-storage-missing', `Storage ${st.key} is missing.`)
    const base = (t.offset + (st.view ? st.view[1] : 0)) * es
    if (contiguous) {
      const off = r?.offset ?? 0
      const len = Math.min(r?.length ?? info.byteLength, info.byteLength - off)
      return src.read(base + off, len)
    }
    // Gather a strided tensor in row-major order (bounded).
    let span = 1
    t.shape.forEach((d, i) => (span += (d - 1) * Math.abs(t.stride[i])))
    if (span * es > 256 * 1024 * 1024) throw new PreviewError('pt-strided-large', 'This strided tensor is too large to gather.')
    const raw = await src.read(base, span * es)
    const out = new Uint8Array(n * es)
    const idx = new Array<number>(t.shape.length).fill(0)
    for (let i = 0; i < n; i++) {
      let o = 0
      for (let d = 0; d < idx.length; d++) o += idx[d] * t.stride[d]
      out.set(raw.subarray(o * es, o * es + es), i * es)
      for (let d = idx.length - 1; d >= 0; d--) {
        if (++idx[d] < t.shape[d]) break
        idx[d] = 0
      }
    }
    return r ? out.subarray(r.offset, r.offset + r.length) : out
  }
  return info
}

// ---------------------------------------------------------------------------------------------
// values and checkpoint info

/** A pickled value as a JSON-like Value (tensors summarised, long lists truncated). */
export function toValue(v: PyValue, depth = 0): Value | undefined {
  if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'bigint') return v
  if (v instanceof Uint8Array) return `bytes[${v.byteLength}]`
  if (depth > 6) return '…'
  if (Array.isArray(v)) {
    const out = v.slice(0, 64).map((x) => toValue(x, depth + 1) ?? null)
    if (v.length > 64) out.push(`… (${v.length})`)
    return out
  }
  if (isDict(v)) {
    const o: Record<string, Value> = {}
    let i = 0
    for (const [k, x] of v) {
      if (i++ >= 200) {
        o['…'] = `${v.size} keys`
        break
      }
      o[keyName(k)] = toValue(x, depth + 1) ?? null
    }
    return o
  }
  if (isTensor(v)) {
    if (!v.shape.length && v.storage === null) return `tensor(${v.dtype})`
    return `tensor(${v.dtype}, [${v.shape.join(', ')}])`
  }
  if (isObject(v)) {
    const s = stateMap(v)
    if ((v.class === 'argparse.Namespace' || v.class === 'types.SimpleNamespace') && s) return toValue(s, depth + 1)
    if (v.class.startsWith('omegaconf.') && s?.get('_content')) return toValue(s.get('_content') ?? null, depth + 1)
    return describe(v)
  }
  return describe(v)
}

function num(v: PyValue | undefined): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return undefined
}

function checkpointInfo(root: Map<PyKey, PyValue>, mainKey: string | undefined): CheckpointInfo {
  const info: CheckpointInfo = {}
  const get = (k: string) => root.get(k)
  info.epoch = num(get('epoch')) ?? num(get('epochs'))
  info.step = num(get('global_step')) ?? num(get('step')) ?? num(get('iteration')) ?? num(get('iter')) ?? num(get('steps'))
  for (const k of ['hyper_parameters', 'hparams', 'args', 'config', 'cfg', 'opt', 'train_args', 'hyperparameters']) {
    const v = get(k)
    if (v === undefined || v === null) continue
    const val = toValue(v)
    if (val && typeof val === 'object' && !Array.isArray(val)) info.hyperParameters = { ...(info.hyperParameters ?? {}), ...(val as Record<string, Value>) }
    else if (val !== undefined) info.hyperParameters = { ...(info.hyperParameters ?? {}), [k]: val }
  }
  const opts: PyValue[] = []
  const os = get('optimizer_states')
  if (Array.isArray(os)) opts.push(...os)
  for (const k of ['optimizer', 'optimizer_state_dict', 'optim', 'opt_state']) {
    const v = get(k)
    if (isDict(v)) opts.push(v)
  }
  if (opts.length) info.optimizers = opts.filter(isDict).map(optimizerInfo)
  const sch: PyValue[] = []
  const ls = get('lr_schedulers')
  if (Array.isArray(ls)) sch.push(...ls)
  for (const k of ['scheduler', 'lr_scheduler', 'scheduler_state_dict']) {
    const v = get(k)
    if (isDict(v)) sch.push(v)
  }
  if (sch.length) info.schedulers = sch.map((s) => (toValue(s) as Record<string, Value>) ?? {})
  const versions: Record<string, string> = {}
  const extra: Record<string, Value> = {}
  const used = new Set([mainKey, 'epoch', 'epochs', 'global_step', 'step', 'iteration', 'iter', 'steps', 'hyper_parameters', 'hparams', 'args', 'config', 'cfg', 'opt', 'train_args', 'hyperparameters', 'optimizer_states', 'optimizer', 'optimizer_state_dict', 'optim', 'opt_state', 'lr_schedulers', 'scheduler', 'lr_scheduler', 'scheduler_state_dict'])
  for (const [k, v] of root) {
    const key = String(k)
    if (used.has(key)) continue
    if (/version/i.test(key) && (typeof v === 'string' || typeof v === 'number')) versions[key] = String(v)
    else extra[key] = summarise(v)
  }
  if (Object.keys(versions).length) info.versions = versions
  if (Object.keys(extra).length) info.extra = extra
  return info
}

/** A short value for the "other keys" table: scalars as is, containers summarised. */
function summarise(v: PyValue): Value {
  if (v === null || typeof v !== 'object' || typeof v === 'bigint') return toValue(v) ?? null
  if (isTensor(v)) return toValue(v) ?? null
  if (isDict(v)) {
    const t = [...v.values()].filter(isTensor).length
    if (v.size > 12 || t) return `dict · ${v.size} keys${t ? ` · ${t} tensors` : ''}`
    return toValue(v) ?? null
  }
  if (Array.isArray(v)) return v.length > 12 ? `${isTuple(v) ? 'tuple' : 'list'} · ${v.length} items` : (toValue(v) ?? null)
  return describe(v)
}

/** optimizer.state_dict(): {'state': {idx: {...}}, 'param_groups': [...]} → groups and an inferred type. */
function optimizerInfo(d: Map<PyKey, PyValue>): NonNullable<CheckpointInfo['optimizers']>[number] {
  const groups = (Array.isArray(d.get('param_groups')) ? (d.get('param_groups') as PyValue[]) : []).filter(isDict).map((g) => {
    const o: Record<string, Value> = {}
    for (const [k, v] of g) {
      const key = String(k)
      if (key === 'params') o['params'] = Array.isArray(v) ? v.length : (toValue(v) ?? null)
      else o[key] = toValue(v) ?? null
    }
    return o
  })
  const state = d.get('state')
  let stateTensors = 0
  let stateBytes = 0
  const keys = new Set<string>()
  if (isDict(state))
    for (const s of state.values())
      if (isDict(s))
        for (const [k, v] of s) {
          keys.add(String(k))
          if (isTensor(v)) {
            stateTensors++
            stateBytes += numel(v.shape) * (elementBytes(v.dtype) || 0)
          }
        }
  const g0 = groups[0] ?? {}
  let type: string | undefined
  if (keys.has('exp_avg') && keys.has('exp_avg_sq')) type = g0['decoupled_weight_decay'] === true || (typeof g0['weight_decay'] === 'number' && (g0['weight_decay'] as number) >= 0.01 && !('momentum' in g0)) ? 'AdamW' : 'Adam'
  else if (keys.has('momentum_buffer') || 'nesterov' in g0) type = 'SGD'
  else if (keys.has('square_avg')) type = 'acc_delta' in g0 || keys.has('acc_delta') ? 'Adadelta' : 'RMSprop'
  else if (keys.has('sum')) type = 'Adagrad'
  else if (keys.has('exp_inf')) type = 'Adamax'
  else if ('betas' in g0) type = 'Adam'
  return { type, inferred: true, groups, stateTensors, stateBytes }
}

function reportCallables(names: string[], notes: Note[]): void {
  const danger = names.filter((n) => DANGEROUS.test(n))
  const custom = names.filter((n) => !DANGEROUS.test(n))
  if (danger.length)
    notes.unshift({
      level: 'warn',
      en: `This pickle asks a Python loader to call ${danger.join(', ')}. torch.load / pickle.load would run it; this preview did not run anything. Do not load this file in Python unless you trust it.`,
      ko: `이 pickle은 Python 로더에게 ${danger.join(', ')} 호출을 요청합니다. torch.load·pickle.load는 이를 실행하지만 이 미리보기는 아무것도 실행하지 않았습니다. 신뢰할 수 없다면 Python에서 열지 마세요.`
    })
  if (custom.length)
    notes.push({
      level: 'info',
      en: `Custom classes (a Python loader would import their modules): ${custom.slice(0, 12).join(', ')}${custom.length > 12 ? ` … (${custom.length})` : ''}`,
      ko: `사용자 정의 클래스(Python 로더가 해당 모듈을 import함): ${custom.slice(0, 12).join(', ')}${custom.length > 12 ? ` … (${custom.length})` : ''}`
    })
}
