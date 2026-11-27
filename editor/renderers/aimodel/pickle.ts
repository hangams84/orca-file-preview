/** A safe pickle reader: a pickle VM (protocols 0–5) that never imports or calls anything.
 *
 *  `GLOBAL`/`STACK_GLOBAL` push an inert `PyGlobal {module, name}`; `REDUCE`, `NEWOBJ`, `NEWOBJ_EX`,
 *  `OBJ`, `INST` and `BUILD` produce inert `PyObject` records (`class`, `args`, `state`, items) unless
 *  the callable is on a short list of known *pure* reconstructors (OrderedDict, set, torch tensor
 *  rebuilds, numpy arrays…), which are interpreted here as data. Persistent ids (PyTorch storages) go
 *  to a caller hook. Nothing in the file can make this code run anything: e.g. a REDUCE of
 *  `posix.system` stays `{class: 'posix.system', args: ['…']}` and is reported in `callables`. */

/** A Python value as read. Lists and tuples are arrays (tuples are listed in `TUPLES`), dicts are
 *  Maps (insertion ordered, like OrderedDict), bytes are Uint8Array (views into the input). */
export type PyValue = null | boolean | number | bigint | string | Uint8Array | PyValue[] | Map<PyKey, PyValue> | PyGlobal | PyObject | PyTensor | PyStorage | PyArray | PyExt

export type PyKey = PyValue

export interface PyGlobal {
  kind: 'global'
  module: string
  name: string
}

/** Something a real unpickler would construct by calling `class` (never done here). */
export interface PyObject {
  kind: 'object'
  /** Dotted name of the callable/class, e.g. `torch.nn.modules.conv.Conv2d`, `posix.system`. */
  class: string
  /** How it was made: reduce (callable(*args)), newobj (cls.__new__(cls, *args)), build-only. */
  via: 'reduce' | 'newobj' | 'inst'
  args: PyValue[]
  /** Set by BUILD (usually the instance __dict__ as a Map, or a (dict, slots) tuple). */
  state?: PyValue
  /** Items added by APPEND(S) / SETITEM(S) to an object that is not a list/dict. */
  listItems?: PyValue[]
  dictItems?: Map<PyKey, PyValue>
}

/** A storage descriptor returned by the persistent-id hook (PyTorch). */
export interface PyStorage {
  kind: 'storage'
  key: string
  dtype: string
  /** Element count of the storage (typed storages) or bytes (untyped), as stored. */
  numel: number
  location: string
  /** Legacy view storages: [view key, offset, size]. */
  view?: [string, number, number]
}

/** A tensor rebuilt from `torch._utils._rebuild_tensor*` (metadata only; values stay in the storage). */
export interface PyTensor {
  kind: 'tensor'
  storage: PyStorage | null
  /** Offset in elements. */
  offset: number
  shape: number[]
  stride: number[]
  dtype: string
  requiresGrad?: boolean
  parameter?: boolean
  /** Quantizer: per-tensor (scale, zeroPoint) or per-channel (tensors, axis). */
  quant?: { scheme: string; scale?: number | PyTensor; zeroPoint?: number | PyTensor; axis?: number }
}

/** A numpy array rebuilt from `numpy.core.multiarray._reconstruct` + BUILD (data inline). */
export interface PyArray {
  kind: 'ndarray'
  shape: number[]
  dtype: string
  byteOrder: 'little' | 'big'
  fortran: boolean
  data: Uint8Array | null
}

/** Protocol-2 extension code (copyreg registry): unknown here. */
export interface PyExt {
  kind: 'ext'
  code: number
}

export const TUPLES = new WeakSet<object>()

export interface PickleOptions {
  /** Resolves a persistent id (PERSID/BINPERSID); default returns an inert object. */
  persistentLoad?: (pid: PyValue) => PyValue
  /** Stop after this many opcodes (guards against pathological input). */
  maxOps?: number
}

export interface PickleResult {
  value: PyValue
  /** Offset just after STOP (legacy PyTorch files hold several pickles back to back). */
  end: number
  /** Callables the pickle asked for that are not known pure reconstructors (e.g. `posix.system`). */
  callables: string[]
}

class Mark {}
const MARK = new Mark()

export const isTuple = (v: unknown): v is PyValue[] => Array.isArray(v) && TUPLES.has(v)
const tuple = (items: PyValue[]): PyValue[] => {
  TUPLES.add(items)
  return items
}
export const isObject = (v: unknown, cls?: string): v is PyObject => !!v && typeof v === 'object' && (v as PyObject).kind === 'object' && (cls === undefined || (v as PyObject).class === cls)
export const isTensor = (v: unknown): v is PyTensor => !!v && typeof v === 'object' && (v as PyTensor).kind === 'tensor'
export const isArray = (v: unknown): v is PyArray => !!v && typeof v === 'object' && (v as PyArray).kind === 'ndarray'
export const isDict = (v: unknown): v is Map<PyKey, PyValue> => v instanceof Map

/** PyTorch typed-storage class names → canonical dtype. */
export const STORAGE_DTYPES: Record<string, string> = {
  DoubleStorage: 'f64', FloatStorage: 'f32', HalfStorage: 'f16', BFloat16Storage: 'bf16',
  LongStorage: 'i64', IntStorage: 'i32', ShortStorage: 'i16', CharStorage: 'i8', ByteStorage: 'u8', BoolStorage: 'bool',
  ComplexFloatStorage: 'c64', ComplexDoubleStorage: 'c128', ComplexHalfStorage: 'c32',
  QInt8Storage: 'qint8', QUInt8Storage: 'quint8', QInt32Storage: 'qint32', QUInt4x2Storage: 'quint4x2', QUInt2x4Storage: 'quint2x4',
  Float8_e4m3fnStorage: 'f8e4m3', Float8_e5m2Storage: 'f8e5m2', UInt16Storage: 'u16', UInt32Storage: 'u32', UInt64Storage: 'u64',
  UntypedStorage: 'u8'
}

/** `torch.<name>` dtype globals → canonical dtype. */
export const TORCH_DTYPES: Record<string, string> = {
  float64: 'f64', double: 'f64', float32: 'f32', float: 'f32', float16: 'f16', half: 'f16', bfloat16: 'bf16',
  int64: 'i64', long: 'i64', int32: 'i32', int: 'i32', int16: 'i16', short: 'i16', int8: 'i8', uint8: 'u8', bool: 'bool',
  uint16: 'u16', uint32: 'u32', uint64: 'u64', complex64: 'c64', cfloat: 'c64', complex128: 'c128', cdouble: 'c128', complex32: 'c32',
  qint8: 'qint8', quint8: 'quint8', qint32: 'qint32', quint4x2: 'quint4x2', quint2x4: 'quint2x4',
  float8_e4m3fn: 'f8e4m3', float8_e5m2: 'f8e5m2', float8_e4m3fnuz: 'f8e4m3fnuz', float8_e5m2fnuz: 'f8e5m2fnuz'
}

/** Globals that are plain data constructors or well-known type references: never reported. */
function isKnownSafe(name: string): boolean {
  return (
    /^(torch|__torch__|collections|numpy|_codecs|copyreg|builtins|argparse|pathlib|datetime|decimal|fractions|enum|typing|functools\.partial$|transformers|pytorch_lightning|lightning|omegaconf|torchvision|timm)\b/.test(name) &&
    !/^builtins\.(eval|exec|compile|open|__import__|getattr|setattr|delattr|globals|locals|input|breakpoint|apply)$/.test(name) &&
    !/^torch\.(load|hub|_C\._|serialization\.load|jit\.load|ops)/.test(name) &&
    !/^(numpy\.(load|testing|f2py|distutils)|copyreg\._reconstructor$)/.test(name)
  )
}

const dec = new TextDecoder()
const latin1 = new TextDecoder('latin1')

export function unpickle(bytes: Uint8Array, start = 0, opts: PickleOptions = {}): PickleResult {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = start
  const stack: (PyValue | Mark)[] = []
  const marks: number[] = []
  const memo = new Map<number, PyValue>()
  const callables = new Set<string>()
  const maxOps = opts.maxOps ?? 50_000_000
  let ops = 0

  const need = (n: number) => {
    if (n < 0 || pos + n > bytes.byteLength) throw new RangeError('truncated')
  }
  const u8 = () => (need(1), bytes[pos++])
  const u16 = () => (need(2), (pos += 2), dv.getUint16(pos - 2, true))
  const i32 = () => (need(4), (pos += 4), dv.getInt32(pos - 4, true))
  const u32 = () => (need(4), (pos += 4), dv.getUint32(pos - 4, true))
  const u64 = () => {
    need(8)
    const v = dv.getBigUint64(pos, true)
    pos += 8
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('length too large')
    return Number(v)
  }
  const take = (n: number) => (need(n), (pos += n), bytes.subarray(pos - n, pos))
  const line = () => {
    const e = bytes.indexOf(0x0a, pos)
    if (e < 0) throw new RangeError('truncated')
    const s = latin1.decode(bytes.subarray(pos, e))
    pos = e + 1
    return s
  }
  const pop = (): PyValue => {
    if (!stack.length) throw new Error('pickle stack underflow')
    const v = stack.pop()!
    if (v instanceof Mark) throw new Error('unexpected mark')
    return v
  }
  const top = (): PyValue => {
    const v = stack[stack.length - 1]
    if (v === undefined || v instanceof Mark) throw new Error('pickle stack underflow')
    return v
  }
  const popMark = (): PyValue[] => {
    const m = marks.pop()
    if (m === undefined) throw new Error('no mark')
    const items = stack.splice(m) as PyValue[]
    items.shift() // the mark itself
    return items
  }
  const longFrom = (b: Uint8Array): number | bigint => {
    if (!b.length) return 0
    let v = 0n
    for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i])
    if (b[b.length - 1] & 0x80) v -= 1n << BigInt(8 * b.length)
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v
  }
  const pyStr = (s: string): string => {
    // Protocol-0 STRING: a Python repr of str/bytes ('...' or "..."), with escapes.
    const q = s[0]
    if ((q === "'" || q === '"') && s.endsWith(q)) s = s.slice(1, -1)
    return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_m, e: string) => {
      if (e[0] === 'x' || e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16))
      return ({ n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', "'": "'", '"': '"' } as Record<string, string>)[e] ?? e
    })
  }

  function globalOf(module: string, name: string): PyGlobal {
    // Python 2 module names written by protocols 0–2.
    if (module === '__builtin__') module = 'builtins'
    else if (module === 'copy_reg') module = 'copyreg'
    return { kind: 'global', module, name }
  }

  /** Interprets a call of a known pure reconstructor, else returns an inert object. */
  function call(fn: PyValue, args: PyValue[], via: PyObject['via']): PyValue {
    const g = fn && typeof fn === 'object' && (fn as PyGlobal).kind === 'global' ? (fn as PyGlobal) : null
    const name = g ? `${g.module}.${g.name}` : isObject(fn) ? fn.class : '?'
    if (g && via === 'reduce') {
      const v = known(name, args)
      if (v !== undefined) return v
    }
    if (g && via === 'newobj' && (name === 'collections.OrderedDict' || name === 'builtins.dict')) return new Map()
    if (!isKnownSafe(name)) callables.add(name)
    return { kind: 'object', class: name, via, args }
  }

  function known(name: string, a: PyValue[]): PyValue | undefined {
    switch (name) {
      case 'collections.OrderedDict':
      case 'builtins.dict':
        return a.length && Array.isArray(a[0]) ? new Map((a[0] as PyValue[]).map((kv) => [(kv as PyValue[])[0], (kv as PyValue[])[1]])) : new Map()
      case 'collections.defaultdict':
        return new Map()
      case 'builtins.set':
      case 'builtins.frozenset':
      case 'builtins.list':
        return Array.isArray(a[0]) ? (a[0] as PyValue[]).slice() : []
      case 'builtins.tuple':
        return tuple(Array.isArray(a[0]) ? (a[0] as PyValue[]).slice() : [])
      case 'builtins.bytearray':
      case 'builtins.bytes':
        return a[0] instanceof Uint8Array ? a[0] : typeof a[0] === 'string' ? new TextEncoder().encode(a[0]) : new Uint8Array(0)
      case '_codecs.encode':
        // Protocol 2 writes bytes as _codecs.encode(<latin-1 str>, 'latin1').
        if (typeof a[0] === 'string') return Uint8Array.from(a[0], (c) => c.charCodeAt(0) & 0xff)
        return undefined
      case 'torch.jit._pickle.build_intlist':
      case 'torch.jit._pickle.build_doublelist':
      case 'torch.jit._pickle.build_boollist':
      case 'torch.jit._pickle.build_tensorlist':
      case 'torch.jit._pickle.build_strlist':
      case 'torch.jit._pickle.restore_type_tag':
        return a[0] ?? null
      case 'torch.Size':
        return tuple(Array.isArray(a[0]) ? (a[0] as PyValue[]).slice() : [])
      case 'torch.device':
        return a.map(String).join(':')
      case 'torch._utils._rebuild_tensor':
        return tensorOf(a[0], a[1], a[2], a[3])
      case 'torch._utils._rebuild_tensor_v2': {
        const t = tensorOf(a[0], a[1], a[2], a[3])
        if (isTensor(t)) t.requiresGrad = a[4] === true
        return t
      }
      case 'torch._utils._rebuild_tensor_v3': {
        const t = tensorOf(a[0], a[1], a[2], a[3])
        if (isTensor(t)) {
          t.requiresGrad = a[4] === true
          const dt = dtypeOfGlobal(a[6])
          if (dt) t.dtype = dt
        }
        return t
      }
      case 'torch._utils._rebuild_parameter':
      case 'torch._utils._rebuild_parameter_with_state':
        if (isTensor(a[0])) {
          a[0].parameter = true
          a[0].requiresGrad = a[1] === true
          return a[0]
        }
        return undefined
      case 'torch._utils._rebuild_qtensor': {
        const t = tensorOf(a[0], a[1], a[2], a[3])
        const q = a[4]
        if (isTensor(t) && Array.isArray(q)) {
          const scheme = String(dtypeOfGlobal(q[0]) ?? (isObject(q[0]) ? q[0].class : q[0]))
          if (q.length >= 4) t.quant = { scheme, scale: q[1] as PyTensor, zeroPoint: q[2] as PyTensor, axis: Number(q[3]) }
          else t.quant = { scheme, scale: Number(q[1]), zeroPoint: Number(q[2]) }
          t.requiresGrad = a[5] === true
        }
        return t
      }
      case 'torch._utils._rebuild_meta_tensor_no_storage':
        return { kind: 'tensor', storage: null, offset: 0, shape: numList(a[1]), stride: numList(a[2]), dtype: dtypeOfGlobal(a[0]) ?? '?' }
      case 'torch._tensor._rebuild_from_type_v2':
      case 'torch._tensor._rebuild_from_type':
        // (func, new_type, args, state): the tensor is func(*args), retyped (e.g. Parameter subclasses).
        if (Array.isArray(a[2])) return call(a[0], a[2] as PyValue[], 'reduce')
        return undefined
      case 'numpy.core.multiarray._reconstruct':
      case 'numpy._core.multiarray._reconstruct':
        return { kind: 'ndarray', shape: [], dtype: 'u8', byteOrder: 'little', fortran: false, data: null }
      case 'numpy.dtype':
        return { kind: 'object', class: 'numpy.dtype', via: 'reduce', args: a }
      case 'numpy.core.multiarray.scalar':
      case 'numpy._core.multiarray.scalar':
        return npScalar(a[0], a[1])
      case 'argparse.Namespace':
      case 'types.SimpleNamespace':
        return { kind: 'object', class: name, via: 'reduce', args: a }
    }
    return undefined
  }

  function tensorOf(storage: PyValue, offset: PyValue, size: PyValue, stride: PyValue): PyValue {
    const st = storage && typeof storage === 'object' && (storage as PyStorage).kind === 'storage' ? (storage as PyStorage) : null
    return { kind: 'tensor', storage: st, offset: Number(offset ?? 0), shape: numList(size), stride: numList(stride), dtype: st?.dtype ?? '?' }
  }

  function build(obj: PyValue, state: PyValue): void {
    if (isArray(obj) && Array.isArray(state)) {
      // ndarray.__setstate__((version, shape, dtype, is_fortran, rawdata))
      const s = state.length === 5 ? state : [0, ...state]
      obj.shape = numList(s[1])
      const d = npDtype(s[2])
      obj.dtype = d.dtype
      obj.byteOrder = d.byteOrder
      obj.fortran = s[3] === true
      obj.data = s[4] instanceof Uint8Array ? s[4] : null
      if (!obj.data && Array.isArray(s[4])) obj.dtype = 'object'
      return
    }
    if (isObject(obj)) {
      if (obj.state instanceof Map && state instanceof Map) for (const [k, v] of state) obj.state.set(k, v)
      else obj.state = state
      return
    }
    if (obj instanceof Map && state instanceof Map) for (const [k, v] of state) obj.set(k, v)
    // BUILD on tensors (Parameter state, backward hooks) or other values: ignored.
  }

  function setItems(target: PyValue, kv: PyValue[]): void {
    if (target instanceof Map) {
      for (let i = 0; i + 1 < kv.length; i += 2) target.set(kv[i], kv[i + 1])
    } else if (isObject(target)) {
      target.dictItems ??= new Map()
      for (let i = 0; i + 1 < kv.length; i += 2) target.dictItems.set(kv[i], kv[i + 1])
    }
  }
  function appendItems(target: PyValue, items: PyValue[]): void {
    if (Array.isArray(target)) target.push(...items)
    else if (isObject(target)) (target.listItems ??= []).push(...items)
  }

  for (;;) {
    if (++ops > maxOps) throw new Error('pickle too complex')
    const op = u8()
    switch (op) {
      case 0x80: // PROTO
        u8()
        break
      case 0x95: // FRAME
        u64()
        break
      case 0x2e: // STOP
        return { value: pop(), end: pos, callables: [...callables] }
      case 0x28: // MARK
        marks.push(stack.length)
        stack.push(MARK)
        break
      case 0x30: // POP
        if (stack[stack.length - 1] instanceof Mark) popMark()
        else pop()
        break
      case 0x31: // POP_MARK
        popMark()
        break
      case 0x32: // DUP
        stack.push(top())
        break
      // Numbers
      case 0x4a: // BININT
        stack.push(i32())
        break
      case 0x4b: // BININT1
        stack.push(u8())
        break
      case 0x4d: // BININT2
        stack.push(u16())
        break
      case 0x49: {
        // INT (also True/False as I01/I00)
        const s = line()
        stack.push(s === '01' ? true : s === '00' ? false : intOf(s))
        break
      }
      case 0x4c: // LONG
        stack.push(intOf(line().replace(/L$/, '')))
        break
      case 0x8a: // LONG1
        stack.push(longFrom(take(u8())))
        break
      case 0x8b: // LONG4
        stack.push(longFrom(take(u32())))
        break
      case 0x46: // FLOAT
        stack.push(parseFloat(line()))
        break
      case 0x47: // BINFLOAT (big-endian)
        need(8)
        stack.push(dv.getFloat64(pos, false))
        pos += 8
        break
      case 0x4e: // NONE
        stack.push(null)
        break
      case 0x88:
        stack.push(true)
        break
      case 0x89:
        stack.push(false)
        break
      // Strings and bytes
      case 0x53: // STRING
        stack.push(pyStr(line()))
        break
      case 0x54: // BINSTRING
        stack.push(latin1.decode(take(i32())))
        break
      case 0x55: // SHORT_BINSTRING
        stack.push(latin1.decode(take(u8())))
        break
      case 0x56: // UNICODE (raw-unicode-escape)
        stack.push(line().replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))))
        break
      case 0x58: // BINUNICODE
        stack.push(dec.decode(take(u32())))
        break
      case 0x8c: // SHORT_BINUNICODE
        stack.push(dec.decode(take(u8())))
        break
      case 0x8d: // BINUNICODE8
        stack.push(dec.decode(take(u64())))
        break
      case 0x42: // BINBYTES
        stack.push(take(u32()))
        break
      case 0x43: // SHORT_BINBYTES
        stack.push(take(u8()))
        break
      case 0x8e: // BINBYTES8
        stack.push(take(u64()))
        break
      case 0x96: // BYTEARRAY8
        stack.push(take(u64()))
        break
      case 0x97: // NEXT_BUFFER (out-of-band): not available
        stack.push(null)
        break
      case 0x98: // READONLY_BUFFER
        break
      // Containers
      case 0x29: // EMPTY_TUPLE
        stack.push(tuple([]))
        break
      case 0x74: // TUPLE
        stack.push(tuple(popMark()))
        break
      case 0x85: // TUPLE1
        stack.push(tuple([pop()]))
        break
      case 0x86: {
        const b = pop()
        const a = pop()
        stack.push(tuple([a, b]))
        break
      }
      case 0x87: {
        const c = pop()
        const b = pop()
        const a = pop()
        stack.push(tuple([a, b, c]))
        break
      }
      case 0x5d: // EMPTY_LIST
        stack.push([])
        break
      case 0x6c: // LIST
        stack.push(popMark())
        break
      case 0x61: {
        // APPEND
        const v = pop()
        appendItems(top(), [v])
        break
      }
      case 0x65: {
        // APPENDS
        const items = popMark()
        appendItems(top(), items)
        break
      }
      case 0x7d: // EMPTY_DICT
        stack.push(new Map())
        break
      case 0x64: {
        // DICT
        const kv = popMark()
        const m = new Map<PyKey, PyValue>()
        for (let i = 0; i + 1 < kv.length; i += 2) m.set(kv[i], kv[i + 1])
        stack.push(m)
        break
      }
      case 0x73: {
        // SETITEM
        const v = pop()
        const k = pop()
        setItems(top(), [k, v])
        break
      }
      case 0x75: {
        // SETITEMS
        const kv = popMark()
        setItems(top(), kv)
        break
      }
      case 0x8f: // EMPTY_SET
        stack.push([])
        break
      case 0x90: {
        // ADDITEMS
        const items = popMark()
        appendItems(top(), items)
        break
      }
      case 0x91: // FROZENSET
        stack.push(popMark())
        break
      // Memo
      case 0x70: // PUT
        memo.set(parseInt(line(), 10), top())
        break
      case 0x71: // BINPUT
        memo.set(u8(), top())
        break
      case 0x72: // LONG_BINPUT
        memo.set(u32(), top())
        break
      case 0x94: // MEMOIZE
        memo.set(memo.size, top())
        break
      case 0x67: // GET
      case 0x68: // BINGET
      case 0x6a: {
        // LONG_BINGET
        const k = op === 0x67 ? parseInt(line(), 10) : op === 0x68 ? u8() : u32()
        if (!memo.has(k)) throw new Error(`pickle memo ${k} missing`)
        stack.push(memo.get(k)!)
        break
      }
      // Globals and objects (all inert)
      case 0x63: {
        // GLOBAL
        const module = line()
        const name = line()
        stack.push(globalOf(module, name))
        break
      }
      case 0x93: {
        // STACK_GLOBAL
        const name = pop()
        const module = pop()
        stack.push(globalOf(String(module), String(name)))
        break
      }
      case 0x82:
      case 0x83:
      case 0x84: {
        // EXT1/2/4
        const code = op === 0x82 ? u8() : op === 0x83 ? u16() : i32()
        stack.push({ kind: 'ext', code })
        break
      }
      case 0x52: {
        // REDUCE
        const args = pop()
        const fn = pop()
        stack.push(call(fn, Array.isArray(args) ? args : [args], 'reduce'))
        break
      }
      case 0x81: {
        // NEWOBJ
        const args = pop()
        const cls = pop()
        stack.push(call(cls, Array.isArray(args) ? args : [args], 'newobj'))
        break
      }
      case 0x92: {
        // NEWOBJ_EX
        const kwargs = pop()
        const args = pop()
        const cls = pop()
        const o = call(cls, Array.isArray(args) ? args : [args], 'newobj')
        if (isObject(o) && kwargs instanceof Map && kwargs.size) o.state = kwargs
        stack.push(o)
        break
      }
      case 0x6f: {
        // OBJ: MARK cls args… OBJ
        const items = popMark()
        const cls = items.shift() ?? null
        stack.push(call(cls, items, 'inst'))
        break
      }
      case 0x69: {
        // INST module\n name\n, MARK args…
        const module = line()
        const name = line()
        stack.push(call(globalOf(module, name), popMark(), 'inst'))
        break
      }
      case 0x62: {
        // BUILD
        const state = pop()
        build(top(), state)
        break
      }
      case 0x50: {
        // PERSID
        const pid = line()
        stack.push(opts.persistentLoad ? opts.persistentLoad(pid) : { kind: 'object', class: 'persistent_id', via: 'reduce', args: [pid] })
        break
      }
      case 0x51: {
        // BINPERSID
        const pid = pop()
        stack.push(opts.persistentLoad ? opts.persistentLoad(pid) : { kind: 'object', class: 'persistent_id', via: 'reduce', args: [pid] })
        break
      }
      default:
        throw new Error(`unknown pickle opcode 0x${op.toString(16)} at ${pos - 1}`)
    }
  }
}

function intOf(s: string): number | bigint {
  const b = BigInt(s.trim())
  return b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b
}

export function numList(v: PyValue): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)) : []
}

/** `torch.float32` global (or a `torch.dtype` string) → canonical dtype. */
export function dtypeOfGlobal(v: PyValue): string | undefined {
  if (v && typeof v === 'object' && (v as PyGlobal).kind === 'global') {
    const g = v as PyGlobal
    if (g.module === 'torch') return TORCH_DTYPES[g.name] ?? g.name
    return undefined
  }
  if (typeof v === 'string') return TORCH_DTYPES[v.replace(/^torch\./, '')]
  return undefined
}

/** numpy.dtype('f4', False, True) + BUILD (3, '<', …) → canonical dtype and byte order. */
function npDtype(v: PyValue): { dtype: string; byteOrder: 'little' | 'big' } {
  if (isObject(v, 'numpy.dtype')) {
    const code = String(v.args[0] ?? 'u1')
    const st = Array.isArray(v.state) ? v.state : []
    const order = typeof st[1] === 'string' ? st[1] : '<'
    return { dtype: npCode(code), byteOrder: order === '>' ? 'big' : 'little' }
  }
  return { dtype: 'u8', byteOrder: 'little' }
}

/** NumPy type code (`f4`, `<i8`, `float32`, `b1`) → canonical dtype. */
export function npCode(code: string): string {
  const c = code.replace(/^[<>|=]/, '')
  const map: Record<string, string> = {
    f8: 'f64', f4: 'f32', f2: 'f16', i8: 'i64', i4: 'i32', i2: 'i16', i1: 'i8', u8: 'u64', u4: 'u32', u2: 'u16', u1: 'u8', b1: 'bool', c8: 'c64', c16: 'c128',
    float64: 'f64', float32: 'f32', float16: 'f16', int64: 'i64', int32: 'i32', int16: 'i16', int8: 'i8', uint64: 'u64', uint32: 'u32', uint16: 'u16', uint8: 'u8', bool: 'bool', complex64: 'c64', complex128: 'c128', O8: 'object', O: 'object'
  }
  return map[c] ?? c
}

function npScalar(dtype: PyValue, data: PyValue): PyValue {
  const { dtype: dt, byteOrder } = npDtype(dtype)
  if (!(data instanceof Uint8Array)) return null
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const le = byteOrder === 'little'
  try {
    switch (dt) {
      case 'f64': return v.getFloat64(0, le)
      case 'f32': return v.getFloat32(0, le)
      case 'i64': return Number(v.getBigInt64(0, le))
      case 'u64': return Number(v.getBigUint64(0, le))
      case 'i32': return v.getInt32(0, le)
      case 'u32': return v.getUint32(0, le)
      case 'i16': return v.getInt16(0, le)
      case 'u16': return v.getUint16(0, le)
      case 'i8': return v.getInt8(0)
      case 'u8': return v.getUint8(0)
      case 'bool': return v.getUint8(0) !== 0
    }
  } catch {
    // short data
  }
  return null
}

/** Short human-readable rendering of a value (for attribute tables and notes). */
export function describe(v: PyValue, depth = 0, seen = new Set<object>()): string {
  if (v === null) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(6))
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'string') return JSON.stringify(v.length > 120 ? v.slice(0, 117) + '…' : v)
  if (v instanceof Uint8Array) return `bytes[${v.byteLength}]`
  if (typeof v === 'object') {
    if (seen.has(v)) return '…'
    seen.add(v)
    try {
      if (depth > 3) return '…'
      if (Array.isArray(v)) {
        const inner = v.slice(0, 8).map((x) => describe(x, depth + 1, seen)).join(', ') + (v.length > 8 ? `, … (${v.length})` : '')
        return isTuple(v) ? `(${inner}${v.length === 1 ? ',' : ''})` : `[${inner}]`
      }
      if (v instanceof Map) {
        const parts: string[] = []
        for (const [k, x] of v) {
          if (parts.length >= 8) {
            parts.push(`… (${v.size})`)
            break
          }
          parts.push(`${describe(k, depth + 1, seen)}: ${describe(x, depth + 1, seen)}`)
        }
        return `{${parts.join(', ')}}`
      }
      switch (v.kind) {
        case 'global': return `${v.module}.${v.name}`
        case 'tensor': return `tensor(${v.dtype}, [${v.shape.join(', ')}])`
        case 'ndarray': return `ndarray(${v.dtype}, [${v.shape.join(', ')}])`
        case 'storage': return `storage(${v.dtype}, ${v.numel})`
        case 'ext': return `ext(${v.code})`
        case 'object': return `${v.class}(${v.args.slice(0, 4).map((x) => describe(x, depth + 1, seen)).join(', ')}${v.args.length > 4 ? ', …' : ''})`
      }
    } finally {
      seen.delete(v)
    }
  }
  return String(v)
}
