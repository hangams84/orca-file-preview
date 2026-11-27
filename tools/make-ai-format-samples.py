"""Writes the small AI-model samples for the ONNX / TFLite / GGUF / Keras-HDF5 / NumPy readers into
samples/ai-formats/ and their ground truth (read back with the reference Python libraries) into
samples/ai-formats/truth.json. Everything is generated here from fixed seeds: public-safe.

  python -m venv .orca/venv && .orca/venv/Scripts/pip install numpy onnx onnxscript gguf h5py tensorflow-cpu torch
  .orca/venv/Scripts/python tools/make-ai-format-samples.py

The reader checks are in tools/ai-formats/fidelity.mjs (node), which compares every reader against
truth.json. Truncated copies (broken.*) must end in a friendly PreviewError."""

import json
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples" / "ai-formats"
TRUTH = {}


def fl(a, n=6):
    """First n values as plain floats (or ints) for value checks."""
    a = np.asarray(a).reshape(-1)[:n]
    if a.dtype.kind in "fc":
        return [float(np.real(x)) for x in a]
    if a.dtype.kind == "b":
        return [int(x) for x in a]
    if a.dtype.kind in "iu":
        return [int(x) for x in a]
    return [str(x) for x in a]


# ---------------------------------------------------------------- NumPy
def numpy_samples():
    rng = np.random.default_rng(1)
    arrays = {
        "f32": rng.standard_normal((3, 4)).astype("<f4"),
        "f64": rng.standard_normal(5),
        "f16": rng.standard_normal((2, 3)).astype(np.float16),
        "i8": np.arange(-4, 4, dtype=np.int8),
        "u8": np.arange(10, dtype=np.uint8).reshape(2, 5),
        "bool": np.array([True, False, True]),
        "i64be": np.arange(6, dtype=">i8").reshape(3, 2),
        "c64": (np.arange(3) + 1j * np.arange(3)).astype(np.complex64),
        "unicode": np.array(["alpha", "beta", "γ"]),
        "bytes": np.array([b"ab", b"cde"]),
        "scalar": np.array(3.5, dtype=np.float32),
        "empty": np.zeros((0, 3), dtype=np.float32),
        "fortran": np.asfortranarray(np.arange(12, dtype=np.int32).reshape(3, 4)),
        "struct": np.array([(1.5, 2, (3, 4)), (5.5, 6, (7, 8))], dtype=[("x", "<f4"), ("y", "<i4"), ("z", "<i2", (2,))]),
    }
    truth = {}
    for k, a in arrays.items():
        p = OUT / f"np-{k}.npy"
        np.save(p, a)
        truth[p.name] = {"shape": list(a.shape), "descr": np.lib.format.dtype_to_descr(a.dtype), "fortran": bool(a.flags.f_contiguous and not a.flags.c_contiguous),
                         "head": fl(np.ascontiguousarray(a)) if a.dtype.names is None else None,
                         "itemsize": a.dtype.itemsize}
    obj = np.array([{"a": 1}, [2, 3]], dtype=object)
    np.save(OUT / "np-object.npy", obj, allow_pickle=True)
    truth["np-object.npy"] = {"shape": [2], "descr": "|O", "fortran": False, "head": None, "itemsize": 8}
    big = {"weights": rng.standard_normal((16, 8)).astype(np.float32), "bias": np.zeros(8, np.float32), "ids": np.arange(20, dtype=np.int64), "names": np.array(["a", "bb"])}
    np.savez(OUT / "np-stored.npz", **big)
    np.savez_compressed(OUT / "np-compressed.npz", **big)
    for n in ("np-stored.npz", "np-compressed.npz"):
        truth[n] = {k: {"shape": list(v.shape), "descr": np.lib.format.dtype_to_descr(v.dtype), "head": fl(v)} for k, v in big.items()}
    TRUTH["numpy"] = truth


# ---------------------------------------------------------------- ONNX
def onnx_truth(path, external=False):
    import onnx
    from onnx import numpy_helper

    m = onnx.load(str(path), load_external_data=False)

    def graph_t(g, depth=0):
        ops = {}
        for n in g.node:
            ops[n.op_type] = ops.get(n.op_type, 0) + 1
        subs = []
        for n in g.node:
            for a in n.attribute:
                if a.type == onnx.AttributeProto.GRAPH:
                    subs.append({"node": n.name, "attr": a.name, **graph_t(a.g, depth + 1)})
                for sg in a.graphs:
                    subs.append({"node": n.name, "attr": a.name, **graph_t(sg, depth + 1)})
        inits = []
        for t in g.initializer:
            ent = {"name": t.name, "dims": list(t.dims), "data_type": onnx.helper.tensor_dtype_to_np_dtype(t.data_type).name if t.data_type != onnx.TensorProto.BFLOAT16 else "bfloat16", "external": t.data_location == onnx.TensorProto.EXTERNAL}
            if True:
                try:
                    a = numpy_helper.to_array(t, base_dir=str(path.parent))
                    ent["head"] = fl(a.astype(np.float32) if a.dtype.kind == "V" else a)
                except Exception as e:  # noqa
                    ent["head"] = None
            inits.append(ent)
        return {"name": g.name, "nodes": len(g.node), "ops": ops, "inputs": [i.name for i in g.input], "outputs": [o.name for o in g.output],
                "initializers": inits, "value_info": len(g.value_info), "subgraphs": subs,
                "node_names": [n.name for n in g.node][:20], "attrs": {n.name: sorted(a.name for a in n.attribute) for n in g.node if n.attribute}}

    t = {"ir_version": m.ir_version, "producer": m.producer_name, "producer_version": m.producer_version,
         "opsets": {o.domain or "ai.onnx": o.version for o in m.opset_import},
         "metadata": {p.key: p.value for p in m.metadata_props}, "functions": [f.name for f in m.functions],
         "doc": m.doc_string, **graph_t(m.graph)}
    t["params"] = int(sum(int(np.prod(i["dims"])) for i in t["initializers"]))
    return t


def onnx_samples():
    import onnx
    import torch
    from onnx import TensorProto, helper, numpy_helper

    torch.manual_seed(0)
    truth = {}

    class MLP(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.fc1 = torch.nn.Linear(16, 32)
            self.act = torch.nn.ReLU()
            self.fc2 = torch.nn.Linear(32, 4)

        def forward(self, x):
            return self.fc2(self.act(self.fc1(x)))

    class CNN(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.conv1 = torch.nn.Conv2d(3, 8, 3, padding=1)
            self.bn = torch.nn.BatchNorm2d(8)
            self.conv2 = torch.nn.Conv2d(8, 8, 3, stride=2)
            self.pool = torch.nn.AdaptiveAvgPool2d(1)
            self.head = torch.nn.Linear(8, 10)

        def forward(self, x):
            x = torch.relu(self.bn(self.conv1(x)))
            x = torch.relu(self.conv2(x))
            return self.head(self.pool(x).flatten(1))

    class Tiny(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.emb = torch.nn.Embedding(50, 32)
            self.enc = torch.nn.TransformerEncoderLayer(32, 4, 64, batch_first=True, dropout=0.0)
            self.out = torch.nn.Linear(32, 50)

        def forward(self, ids):
            return self.out(self.enc(self.emb(ids)))

    exports = [("onnx-mlp.onnx", MLP(), (torch.randn(2, 16),), ["x"], {"x": {0: "batch"}}),
               ("onnx-cnn.onnx", CNN().eval(), (torch.randn(1, 3, 16, 16),), ["image"], None),
               ("onnx-transformer.onnx", Tiny().eval(), (torch.randint(0, 50, (1, 7)),), ["ids"], None)]
    for name, model, args, inputs, dyn in exports:
        p = OUT / name
        try:
            torch.onnx.export(model, args, str(p), input_names=inputs, dynamic_axes=dyn, dynamo=False, opset_version=17)
        except TypeError:
            torch.onnx.export(model, args, str(p), input_names=inputs, dynamic_axes=dyn, opset_version=17)
        m = onnx.load(str(p))
        m.metadata_props.add(key="sample", value=name)
        onnx.save(m, str(p))
        truth[name] = onnx_truth(p)

    # external data: every initializer in a side file
    m = onnx.load(str(OUT / "onnx-mlp.onnx"))
    ext = OUT / "onnx-external.onnx"
    for f in (ext, OUT / "onnx-external.onnx.data"):
        f.unlink(missing_ok=True)
    onnx.save_model(m, str(ext), save_as_external_data=True, all_tensors_to_one_file=True, location="onnx-external.onnx.data", size_threshold=0)
    truth[ext.name] = onnx_truth(ext, external=True)

    # control flow, every attribute type, typed tensor fields, functions, metadata
    X = helper.make_tensor_value_info("x", TensorProto.FLOAT, ["N", 4])
    cond = helper.make_tensor_value_info("cond", TensorProto.BOOL, [])
    Y = helper.make_tensor_value_info("y", TensorProto.FLOAT, None)
    then_g = helper.make_graph([helper.make_node("Relu", ["x"], ["t_out"], name="then_relu")], "then_branch", [], [helper.make_tensor_value_info("t_out", TensorProto.FLOAT, None)])
    else_g = helper.make_graph([helper.make_node("Neg", ["x"], ["e_out"], name="else_neg")], "else_branch", [], [helper.make_tensor_value_info("e_out", TensorProto.FLOAT, None)])
    body = helper.make_graph(
        [helper.make_node("Identity", ["cond_in"], ["cond_out"], name="body_cond"), helper.make_node("Add", ["acc_in", "one"], ["acc_out"], name="body_add")],
        "loop_body",
        [helper.make_tensor_value_info("iter", TensorProto.INT64, []), helper.make_tensor_value_info("cond_in", TensorProto.BOOL, []), helper.make_tensor_value_info("acc_in", TensorProto.FLOAT, [4])],
        [helper.make_tensor_value_info("cond_out", TensorProto.BOOL, []), helper.make_tensor_value_info("acc_out", TensorProto.FLOAT, [4])],
        initializer=[numpy_helper.from_array(np.ones(4, np.float32), "one")],
    )
    scan_body = helper.make_graph([helper.make_node("Add", ["s_in", "s_x"], ["s_out"], name="scan_add"), helper.make_node("Identity", ["s_out"], ["s_y"], name="scan_id")], "scan_body",
                                  [helper.make_tensor_value_info("s_in", TensorProto.FLOAT, [4]), helper.make_tensor_value_info("s_x", TensorProto.FLOAT, [4])],
                                  [helper.make_tensor_value_info("s_out", TensorProto.FLOAT, [4]), helper.make_tensor_value_info("s_y", TensorProto.FLOAT, [4])])
    t_float = helper.make_tensor("w_float_data", TensorProto.FLOAT, [2, 2], [1.0, 2.0, 3.0, 4.0])  # float_data field
    t_i64 = helper.make_tensor("w_int64_data", TensorProto.INT64, [3], [7, -8, 9])
    t_f16 = helper.make_tensor("w_f16", TensorProto.FLOAT16, [2], np.array([1.5, -2.25], np.float16).view(np.uint16).tolist())  # int32_data
    t_str = helper.make_tensor("w_str", TensorProto.STRING, [2], [b"hello", b"world"])
    t_raw = numpy_helper.from_array(np.arange(6, dtype=np.float64).reshape(2, 3), "w_raw_f64")
    t_bf16 = helper.make_tensor("w_bf16", TensorProto.BFLOAT16, [2], [np.float32(1.0).view(np.uint32) >> 16, np.float32(-3.0).view(np.uint32) >> 16])
    t_u8 = numpy_helper.from_array(np.arange(5, dtype=np.uint8), "w_u8")
    sparse = helper.make_sparse_tensor(helper.make_tensor("sv", TensorProto.FLOAT, [2], [5.0, 6.0]), helper.make_tensor("si", TensorProto.INT64, [2], [1, 3]), [4])
    allattrs = helper.make_node(
        "AllAttrs", ["x"], ["aa_out"], name="all_attrs", domain="custom.test",
        f=0.5, i=3, s="text", t=t_float, g=then_g, floats=[1.0, 2.5], ints=[1, 2, 3], strings=["a", "b"], tensors=[t_i64, t_u8], graphs=[else_g],
        sparse_tensor=sparse, tp=helper.make_tensor_type_proto(TensorProto.FLOAT, [1, "D"]),
    )
    nodes = [
        helper.make_node("If", ["cond"], ["if_out"], name="branch", then_branch=then_g, else_branch=else_g),
        helper.make_node("Constant", [], ["trip"], name="trip_count", value=helper.make_tensor("tc", TensorProto.INT64, [], [3])),
        helper.make_node("Constant", [], ["acc0"], name="acc_init", value_floats=[0.0, 0.0, 0.0, 0.0]),
        helper.make_node("Loop", ["trip", "cond", "acc0"], ["loop_out"], name="loop", body=body),
        helper.make_node("Scan", ["acc0", "x"], ["scan_state", "scan_ys"], name="scan", body=scan_body, num_scan_inputs=1),
        helper.make_node("MyScale", ["if_out", "w_float_data"], ["scaled"], name="fn_call", domain="local.fn"),
        allattrs,
        helper.make_node("Add", ["scaled", "loop_out"], ["y"], name="final_add"),
    ]
    graph = helper.make_graph(nodes, "control_flow", [X, cond], [Y, helper.make_tensor_value_info("aa_out", TensorProto.FLOAT, None), helper.make_tensor_value_info("scan_ys", TensorProto.FLOAT, None)],
                              initializer=[t_float, t_i64, t_f16, t_str, t_raw, t_bf16, t_u8],
                              value_info=[helper.make_tensor_value_info("if_out", TensorProto.FLOAT, ["N", 4])], doc_string="control-flow sample")
    fn = helper.make_function("local.fn", "MyScale", ["a", "b"], ["c"], [helper.make_node("Mul", ["a", "b"], ["c"])], [helper.make_opsetid("", 17)], attributes=[])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17), helper.make_opsetid("local.fn", 1), helper.make_opsetid("custom.test", 1)], functions=[fn],
                              producer_name="make-ai-format-samples", producer_version="1", doc_string="If/Loop/Scan, functions and every attribute type")
    model.ir_version = 8
    helper.set_model_props(model, {"author": "fp-ai-formats", "license": "MIT"})
    p = OUT / "onnx-control-flow.onnx"
    onnx.save(model, str(p))
    truth[p.name] = onnx_truth(p)
    TRUTH["onnx"] = truth


# ---------------------------------------------------------------- Keras / HDF5 / TFLite
def keras_models():
    import keras
    from keras import layers

    keras.utils.set_random_seed(0)
    seq = keras.Sequential([keras.Input((16,)), layers.Dense(128, activation="relu", name="hidden"), layers.Dropout(0.1), layers.Dense(3, activation="softmax", name="probs")], name="tiny_seq")
    inp = keras.Input((12, 12, 1), name="image")
    x = layers.Conv2D(4, 3, activation="relu", name="conv")(inp)
    x = layers.BatchNormalization(name="bn")(x)
    a = layers.GlobalAveragePooling2D(name="gap")(x)
    b = layers.GlobalMaxPooling2D(name="gmp")(x)
    x = layers.Concatenate(name="concat")([a, b])
    out = layers.Dense(5, name="logits")(x)
    aux = layers.Dense(1, activation="sigmoid", name="aux")(a)
    fun = keras.Model(inp, [out, aux], name="tiny_functional")
    fun.compile(optimizer="adam", loss=["mse", "mse"])
    return seq, fun


def h5_truth(path):
    import h5py

    t = {"datasets": {}, "groups": [], "attrs": {}}
    with h5py.File(path, "r") as f:
        t["superblock"] = f.id.get_create_plist().get_version()[0] if hasattr(f.id.get_create_plist(), "get_version") else None

        def visit(name, obj):
            if isinstance(obj, h5py.Dataset):
                d = {"shape": list(obj.shape), "dtype": obj.dtype.str if obj.dtype.names is None else "struct", "chunks": list(obj.chunks) if obj.chunks else None,
                     "compression": obj.compression, "shuffle": bool(obj.shuffle), "layout": obj.id.get_create_plist().get_layout()}
                if obj.dtype.kind in "fiub" and obj.size:
                    d["head"] = fl(obj[()])
                elif obj.dtype.kind in "SO" and obj.size:
                    d["head"] = [v.decode() if isinstance(v, bytes) else str(v) for v in np.asarray(obj[()]).reshape(-1)[:4]]
                d["attrs"] = sorted(obj.attrs.keys())
                t["datasets"][name] = d
            else:
                t["groups"].append(name)
                if obj.attrs:
                    t["attrs"][name] = sorted(obj.attrs.keys())

        f.visititems(visit)
        t["attrs"]["/"] = sorted(f.attrs.keys())
        root_vals = {}
        for k, v in f.attrs.items():
            if isinstance(v, bytes):
                v = v.decode()
            if isinstance(v, str):
                root_vals[k] = v if len(v) < 200 else {"len": len(v), "start": v[:60]}
            elif isinstance(v, np.ndarray):
                root_vals[k] = fl(v, 8) if v.dtype.kind != "S" and v.dtype.kind != "O" else [x.decode() if isinstance(x, bytes) else str(x) for x in v.reshape(-1)[:8]]
            else:
                root_vals[k] = v.item() if hasattr(v, "item") else v
        t["root_attr_values"] = root_vals
    return t


def keras_samples():
    seq, fun = keras_models()
    truth = {}
    for m, base in ((seq, "keras-sequential"), (fun, "keras-functional")):
        layers_t = [{"name": l.name, "class": l.__class__.__name__, "weights": [[w.path, list(w.shape)] for w in l.weights], "params": int(l.count_params())} for l in m.layers]
        common = {"name": m.name, "class": m.__class__.__name__, "params": int(m.count_params()), "layers": layers_t}
        k = OUT / f"{base}.keras"
        m.save(k)
        with zipfile.ZipFile(k) as z, tempfile.TemporaryDirectory() as td:
            names = z.namelist()
            z.extract("model.weights.h5", td)
            truth[k.name] = {**common, "zip": names, "weights_h5": h5_truth(Path(td) / "model.weights.h5"), "methods": [(i.filename, i.compress_type) for i in z.infolist()]}
        h = OUT / f"{base}.h5"
        m.save(h)
        truth[h.name] = {**common, "h5": h5_truth(h)}
    TRUTH["keras"] = truth
    return seq, fun


def hdf5_samples():
    import h5py

    truth = {}
    rng = np.random.default_rng(3)
    for libver, name in ((("earliest", "latest"), "hdf5-v0.h5"), (("v108", "v108"), "hdf5-v2.h5"), (("latest", "latest"), "hdf5-v3.h5")):
        p = OUT / name
        with h5py.File(p, "w", libver=libver) as f:
            f.attrs["title"] = "hdf5 features"
            f.attrs["version"] = np.int32(3)
            f.attrs["scales"] = np.array([0.5, 1.5, 2.5])
            f.attrs["tags"] = np.array([b"a", b"bc"])
            f.attrs["utf8"] = "χαίρετε"
            g = f.create_group("group/nested")
            g.attrs["depth"] = 2
            f.create_dataset("contiguous", data=np.arange(24, dtype="<f4").reshape(4, 6))
            f.create_dataset("chunked", data=rng.standard_normal((40, 30)).astype(np.float32), chunks=(16, 16))
            f.create_dataset("gzip_shuffle", data=np.arange(1000, dtype=np.int32).reshape(25, 40), chunks=(10, 10), compression="gzip", shuffle=True)
            f.create_dataset("single_chunk", data=np.arange(16, dtype=np.float64), chunks=(16,), compression="gzip")
            f.create_dataset("resizable", data=np.arange(10, dtype=np.int16), chunks=(4,), maxshape=(None,))
            f.create_dataset("group/nested/compact", data=np.arange(4, dtype=np.uint8))
            f.create_dataset("scalar", data=np.float64(2.5))
            f.create_dataset("big_endian", data=np.arange(6, dtype=">i4"))
            f.create_dataset("f16", data=np.array([0.5, -1.0, 65504], dtype=np.float16))
            f.create_dataset("strings", data=np.array([b"one", b"three"]))
            f.create_dataset("vlen_str", data=["alpha", "beta"], dtype=h5py.string_dtype())
            f.create_dataset("compound", data=np.array([(1, 2.0)], dtype=[("a", "<i4"), ("b", "<f8")]))
            f.create_dataset("empty", shape=(0,), dtype=np.float32)
            many = f.create_group("many")  # > 8 links: dense (fractal heap) storage in the latest format
            for i in range(20):
                many.create_dataset(f"d{i:02d}", data=np.array([i], dtype=np.int64))
        truth[name] = h5_truth(p)
    TRUTH["hdf5"] = truth


def tflite_samples(seq, fun):
    import tensorflow as tf
    from tensorflow.lite.python import schema_py_generated as schema

    names = {v: k for k, v in vars(schema.BuiltinOperator).items() if not k.startswith("_") and isinstance(v, int)}
    ttypes = {v: k for k, v in vars(schema.TensorType).items() if not k.startswith("_") and isinstance(v, int)}
    truth = {"__ops__": names, "__types__": ttypes}
    rng = np.random.default_rng(5)

    def rep():
        for _ in range(8):
            yield [rng.standard_normal((1, 12, 12, 1)).astype(np.float32)]

    @tf.function(input_signature=[tf.TensorSpec([4], tf.float32), tf.TensorSpec([], tf.int32)])
    def loop(x, n):
        i = tf.constant(0)
        _, y = tf.while_loop(lambda i, y: i < n, lambda i, y: (i + 1, y * 2.0 + 1.0), (i, x))
        return {"y": tf.cond(tf.reduce_sum(y) > 0, lambda: y, lambda: -y)}

    def conv(make):
        c = make()
        return c.convert()

    jobs = {
        "tflite-sequential.tflite": lambda: tf.lite.TFLiteConverter.from_keras_model(seq),
        "tflite-functional.tflite": lambda: tf.lite.TFLiteConverter.from_keras_model(fun),
        "tflite-control-flow.tflite": lambda: tf.lite.TFLiteConverter.from_concrete_functions([loop.get_concrete_function()], loop),
    }
    blobs = {k: conv(v) for k, v in jobs.items()}
    c = tf.lite.TFLiteConverter.from_keras_model(seq)
    c.optimizations = [tf.lite.Optimize.DEFAULT]
    blobs["tflite-dynamic-range.tflite"] = c.convert()
    c = tf.lite.TFLiteConverter.from_keras_model(fun)
    c.optimizations = [tf.lite.Optimize.DEFAULT]
    c.representative_dataset = rep
    c.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    c.inference_input_type = tf.int8
    c.inference_output_type = tf.int8
    blobs["tflite-int8.tflite"] = c.convert()
    for name, blob in blobs.items():
        (OUT / name).write_bytes(blob)
        m = schema.ModelT.InitFromObj(schema.Model.GetRootAsModel(blob, 0))
        subs = []
        for sg in m.subgraphs:
            tens = []
            for t in sg.tensors:
                q = t.quantization
                tens.append({"name": t.name.decode(), "shape": [int(x) for x in (t.shape if t.shape is not None else [])], "type": ttypes[t.type], "buffer": t.buffer,
                             "scale": [float(x) for x in q.scale][:4] if q is not None and q.scale is not None else None,
                             "zero_point": [int(x) for x in q.zeroPoint][:4] if q is not None and q.zeroPoint is not None else None})
            ops = []
            for o in sg.operators:
                code = m.operatorCodes[o.opcodeIndex]
                b = max(code.builtinCode, code.deprecatedBuiltinCode)
                ops.append(names.get(b, str(b)) if b != schema.BuiltinOperator.CUSTOM else "CUSTOM:" + (code.customCode or b"").decode())
            subs.append({"name": (sg.name or b"").decode(), "tensors": tens, "ops": ops, "inputs": [int(x) for x in sg.inputs], "outputs": [int(x) for x in sg.outputs]})
        sigs = []
        for s in m.signatureDefs or []:
            sigs.append({"key": s.signatureKey.decode(), "subgraph": s.subgraphIndex, "inputs": sorted(i.name.decode() for i in s.inputs), "outputs": sorted(o.name.decode() for o in s.outputs)})
        meta = {md.name.decode(): len(m.buffers[md.buffer].data) if m.buffers[md.buffer].data is not None else 0 for md in (m.metadata or [])}
        bufs = [len(b.data) if b.data is not None else 0 for b in m.buffers]
        truth[name] = {"version": m.version, "description": (m.description or b"").decode(), "subgraphs": subs, "signatures": sigs, "metadata": meta, "buffers": bufs}
        interp = tf.lite.Interpreter(model_content=blob)
        try:
            truth[name]["interp_ops"] = [d["op_name"] for d in interp._get_ops_details()]
        except Exception:
            pass
        # values of a few constant tensors, via the flatbuffer buffers
        vals = {}
        for t in subs[0]["tensors"]:
            data = m.buffers[t["buffer"]].data
            if data is not None and len(data) and t["type"] in ("FLOAT32", "INT8", "INT32"):
                dt = {"FLOAT32": np.float32, "INT8": np.int8, "INT32": np.int32}[t["type"]]
                vals[t["name"]] = fl(np.frombuffer(bytes(bytearray(data)), dtype=dt), 4)
        truth[name]["values"] = vals
    TRUTH["tflite"] = truth


# ---------------------------------------------------------------- GGUF
def gguf_samples():
    import gguf
    from gguf import GGMLQuantizationType as Q

    rng = np.random.default_rng(7)
    p = OUT / "gguf-tiny-llama.gguf"
    w = gguf.GGUFWriter(str(p), "llama")
    w.add_name("tiny-llama-sample")
    w.add_context_length(64)
    w.add_embedding_length(32)
    w.add_block_count(2)
    w.add_feed_forward_length(64)
    w.add_head_count(4)
    w.add_head_count_kv(2)
    w.add_layer_norm_rms_eps(1e-5)
    w.add_file_type(7)
    w.add_tokenizer_model("llama")
    w.add_token_list(["<unk>", "<s>", "</s>"] + [f"tok{i}" for i in range(61)])
    w.add_token_scores([float(-i) for i in range(64)])
    w.add_token_types([1] * 64)
    w.add_bos_token_id(1)
    w.add_eos_token_id(2)
    w.add_uint8("test.u8", 200)
    w.add_int8("test.i8", -100)
    w.add_uint16("test.u16", 60000)
    w.add_int16("test.i16", -30000)
    w.add_uint32("test.u32", 4000000000)
    w.add_int32("test.i32", -2000000000)
    w.add_uint64("test.u64", 2**40 + 3)
    w.add_int64("test.i64", -(2**40))
    w.add_float32("test.f32", 0.25)
    w.add_float64("test.f64", 1.0 / 3.0)
    w.add_bool("test.bool", True)
    w.add_string("test.str", "héllo")
    w.add_array("test.arr_i32", [1, -2, 3])
    w.add_array("test.arr_str", ["x", "yy"])
    w.add_array("test.arr_nested", [[1, 2], [3]])

    types = {}
    E, F, NB = 32, 64, 2

    def add(name, shape, qt):
        data = rng.standard_normal(shape).astype(np.float32)
        types[name] = qt.name
        if qt == Q.F32:
            w.add_tensor(name, data)
        elif qt == Q.F16:
            w.add_tensor(name, data.astype(np.float16))
        else:
            try:
                q = gguf.quants.quantize(data, qt)
            except (NotImplementedError, Exception):
                bs, ts = gguf.GGML_QUANT_SIZES[qt]
                # random quants with sane scales: write the block's fp16 scale fields (d, dmin)
                q = rng.integers(0, 256, size=(int(np.prod(shape)) // bs, ts), dtype=np.uint8)
                d = np.frombuffer(np.float16(0.01).tobytes(), np.uint8)
                for off in {"Q4_K": (0, 2), "Q5_K": (0, 2), "Q6_K": (208,), "Q2_K": (80, 82), "Q3_K": (108,), "IQ4_NL": (0,), "IQ4_XS": (0,), "IQ2_XXS": (0,)}.get(qt.name, ()):
                    q[:, off:off + 2] = d
                q = q.reshape(*shape[:-1], shape[-1] // bs * ts)
            w.add_tensor(name, q, raw_dtype=qt)

    add("token_embd.weight", (64, E), Q.Q8_0)
    for b in range(NB):
        add(f"blk.{b}.attn_norm.weight", (E,), Q.F32)
        add(f"blk.{b}.attn_q.weight", (E, E), Q.Q4_0)
        add(f"blk.{b}.attn_k.weight", (E // 2, E), Q.Q5_1 if b else Q.Q4_1)
        add(f"blk.{b}.attn_v.weight", (E // 2, E), Q.Q5_0)
        add(f"blk.{b}.attn_output.weight", (E, E), Q.F16)
        add(f"blk.{b}.ffn_norm.weight", (E,), Q.F32)
        add(f"blk.{b}.ffn_gate.weight", (F, 256), Q.Q4_K if b == 0 else Q.Q5_K)
        add(f"blk.{b}.ffn_up.weight", (F, 256), Q.Q6_K if b == 0 else Q.Q2_K)
        add(f"blk.{b}.ffn_down.weight", (E, 256), Q.Q3_K if b == 0 else Q.IQ4_NL)
        add(f"blk.{b}.ffn_gate_inp.weight", (8, 256), Q.IQ2_XXS if b == 0 else Q.IQ4_XS)
    add("output_norm.weight", (E,), Q.F32)
    add("output.weight", (64, E), Q.BF16)
    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()

    # a small one for the plugin's unit tests: a few blocks of each decoded kind plus one undecoded
    u = OUT / "gguf-unit.gguf"
    wu = gguf.GGUFWriter(str(u), "gpt2")
    wu.add_name("unit")
    wu.add_block_count(1)
    wu.add_array("test.arr_str", ["a", "bb", "ccc"])
    wu.add_array("test.arr_f32", [0.5, 1.5])
    wu.add_uint64("test.u64", 2**60)
    for name, shape, qt in (("blk.0.attn_qkv.weight", (2, 32), Q.Q8_0), ("blk.0.ffn_up.weight", (1, 256), Q.Q4_K), ("blk.0.ffn_down.weight", (1, 256), Q.Q6_K),
                            ("blk.0.attn_norm.weight", (8,), Q.F16), ("output.weight", (4,), Q.BF16), ("token_embd.weight", (1, 256), Q.IQ2_XXS)):
        data = rng.standard_normal(shape).astype(np.float32)
        if qt == Q.F16:
            wu.add_tensor(name, data.astype(np.float16))
        elif qt in (Q.Q8_0, Q.BF16):
            wu.add_tensor(name, gguf.quants.quantize(data, qt), raw_dtype=qt)
        else:
            bs, ts = gguf.GGML_QUANT_SIZES[qt]
            q = rng.integers(0, 256, size=(int(np.prod(shape)) // bs, ts), dtype=np.uint8)
            d = np.frombuffer(np.float16(0.01).tobytes(), np.uint8)
            for off in {"Q4_K": (0, 2), "Q6_K": (208,), "IQ2_XXS": (0,)}[qt.name]:
                q[:, off:off + 2] = d
            wu.add_tensor(name, q.reshape(*shape[:-1], shape[-1] // bs * ts), raw_dtype=qt)
    wu.write_header_to_file()
    wu.write_kv_data_to_file()
    wu.write_tensors_to_file()
    wu.close()
    gguf_t = {}
    for path in (p, u):
        gguf_t[path.name] = gguf_truth(path)
    TRUTH["gguf"] = gguf_t


def gguf_truth(p):
    import gguf

    r = gguf.GGUFReader(str(p))
    kv = {}
    for f in r.fields.values():
        if f.name.startswith("GGUF."):
            continue
        try:
            v = f.contents()
        except Exception:
            v = None
        if isinstance(v, list) and len(v) > 8:
            v = {"len": len(v), "head": v[:4]}
        kv[f.name] = {"type": [t.name for t in f.types], "value": v}
    tens = []
    for t in r.tensors:
        ent = {"name": t.name, "shape": [int(x) for x in t.shape], "type": t.tensor_type.name, "n_bytes": int(t.n_bytes), "offset": int(t.data_offset)}
        try:
            deq = gguf.quants.dequantize(t.data, t.tensor_type)
            ent["head"] = fl(deq, 6)
        except Exception:
            ent["head"] = None
        tens.append(ent)
    return {"version": 3, "alignment": r.alignment, "data_offset": r.data_offset, "kv": kv, "tensors": tens}


def broken():
    """Truncated or damaged copies that must end in a friendly error."""
    for src, dst, n in (("onnx-cnn.onnx", "broken.onnx", 3000), ("tflite-sequential.tflite", "broken.tflite", 600), ("gguf-tiny-llama.gguf", "broken.gguf", 900),
                        ("keras-sequential.h5", "broken.h5", 1500), ("keras-functional.keras", "broken.keras", 2000), ("np-f32.npy", "broken.npy", 70), ("np-stored.npz", "broken.npz", 500)):
        (OUT / dst).write_bytes((OUT / src).read_bytes()[:n])


def main():
    only = set(sys.argv[1:])
    if OUT.exists() and not only:
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    if only and (OUT / "truth.json").exists():
        TRUTH.update(json.loads((OUT / "truth.json").read_text(encoding="utf-8")))
    run = lambda k: not only or k in only  # noqa
    if run("numpy"):
        numpy_samples()
    if run("onnx"):
        onnx_samples()
    if run("gguf"):
        gguf_samples()
    if run("hdf5"):
        hdf5_samples()
    if run("keras") or run("tflite"):
        seq, fun = keras_samples()
        tflite_samples(seq, fun)
    if not only:
        broken()
    (OUT / "truth.json").write_text(json.dumps(TRUTH, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.iterdir())
    print(f"{len(list(OUT.iterdir()))} files, {total/1024:.0f} KiB")


if __name__ == "__main__":
    main()
