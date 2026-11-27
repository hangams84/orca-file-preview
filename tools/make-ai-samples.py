"""Writes the AI-model fixtures for the AI Model Preview. Every model is built here with random
weights (no downloads), so the files carry this repository's licence (MIT).

    python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    python -m pip install safetensors torchinfo
    python tools/make-ai-samples.py            small samples → samples/aimodel/ (committed)
    python tools/make-ai-samples.py --big DIR  ResNet-18/50 and a ~1.6 GB GPT checkpoint → DIR (not committed)

Outputs (samples/aimodel/):
    mlp.state_dict.pth          OrderedDict of tensors (zip format)
    mlp.module.pt               the whole nn.Module pickled (class tree, no graph)
    mlp.torchscript.pt          torch.jit.script archive (code/ + data.pkl + constants.pkl)
    mlp.export.pt2              torch.export ExportedProgram
    mlp.lightning.ckpt          Lightning-style dict: state_dict, epoch, global_step, optimizer_states,
                                lr_schedulers, hyper_parameters, versions
    mlp.legacy.pt               legacy non-zip pickle (_use_new_zipfile_serialization=False)
    mlp.int8-dynamic.pth        dynamic-quantized state_dict (qint8 packed Linear weights)
    cnn.*                       small CNN, same set
    gpt.*                       tiny GPT (2 blocks), same set; gpt.bf16.safetensors with __metadata__
    *.f16.pth / *.bf16.pth      half-precision state_dicts
    pytorch_model.bin           Hugging Face-style weights file (a state_dict)
    malicious.pkl / malicious.pt  pickles whose REDUCE would call os.system: must stay inert
    broken.pt / broken.safetensors / broken.pt2  truncated files: must end in a friendly error

Also writes tools/aimodel/truth.json (ground truth from PyTorch: tensor counts, parameter totals,
shapes) and plugin/editor/renderers/aimodel/testdata.ts (tiny models, base64, for the unit tests).
"""
import io
import json
import os
import pickle
import sys
import types
import zipfile
from collections import OrderedDict

import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'samples', 'aimodel')

# Classes live in a fake importable module so whole-module pickles name them `fp_demo.<Class>`.
fp_demo = types.ModuleType('fp_demo')
sys.modules['fp_demo'] = fp_demo


def register(cls):
    cls.__module__ = 'fp_demo'
    setattr(fp_demo, cls.__name__, cls)
    return cls


@register
class MLP(nn.Module):
    def __init__(self, d_in=64, hidden=(48, 32), d_out=10):
        super().__init__()
        self.fc1 = nn.Linear(d_in, hidden[0])
        self.fc2 = nn.Linear(hidden[0], hidden[1])
        self.head = nn.Linear(hidden[1], d_out)
        self.drop = nn.Dropout(0.1)

    def forward(self, x):
        x = F.relu(self.fc1(x))
        x = self.drop(F.relu(self.fc2(x)))
        return self.head(x)


@register
class SmallCNN(nn.Module):
    def __init__(self, classes=10):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 8, 3, padding=1), nn.BatchNorm2d(8), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(8, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.AdaptiveAvgPool2d(1),
        )
        self.classifier = nn.Sequential(nn.Flatten(), nn.Linear(32, 64), nn.ReLU(), nn.Linear(64, classes))

    def forward(self, x):
        return self.classifier(self.features(x))


@register
class Block(nn.Module):
    def __init__(self, d, heads):
        super().__init__()
        self.ln_1 = nn.LayerNorm(d)
        self.attn = nn.MultiheadAttention(d, heads, batch_first=True)
        self.ln_2 = nn.LayerNorm(d)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))

    def forward(self, x):
        h = self.ln_1(x)
        a, _ = self.attn(h, h, h, need_weights=False)
        x = x + a
        return x + self.mlp(self.ln_2(x))


@register
class TinyGPT(nn.Module):
    def __init__(self, vocab=128, d=48, layers=2, heads=4, ctx=32):
        super().__init__()
        self.wte = nn.Embedding(vocab, d)
        self.wpe = nn.Embedding(ctx, d)
        self.h = nn.ModuleList([Block(d, heads) for _ in range(layers)])
        self.ln_f = nn.LayerNorm(d)
        self.lm_head = nn.Linear(d, vocab, bias=False)
        self.lm_head.weight = self.wte.weight  # tied, as in GPT-2

    def forward(self, idx):
        pos = torch.arange(idx.shape[1], device=idx.device).unsqueeze(0)
        x = self.wte(idx) + self.wpe(pos)
        for b in self.h:
            x = b(x)
        return self.lm_head(self.ln_f(x))


MODELS = {
    'mlp': (lambda: MLP(), lambda: torch.randn(2, 64)),
    'cnn': (lambda: SmallCNN(), lambda: torch.randn(2, 3, 32, 32)),
    'gpt': (lambda: TinyGPT(), lambda: torch.randint(0, 128, (2, 16))),
}


def truth_of(model, sd, path, extra=None):
    """What PyTorch itself says: parameters (unique, as torchinfo counts), state_dict tensors."""
    uniq = {id(p): p for p in model.parameters()}
    t = {
        'file': os.path.basename(path),
        'parameters': sum(p.numel() for p in uniq.values()),
        'parameterTensors': len(list(model.named_parameters())),
        'stateTensors': len(sd),
        'stateElements': sum(v.numel() for v in sd.values() if torch.is_tensor(v)),
        'tensors': {k: {'shape': list(v.shape), 'dtype': str(v.dtype).replace('torch.', '')} for k, v in sd.items() if torch.is_tensor(v)},
    }
    try:
        import torchinfo
        t['torchinfo'] = torchinfo.summary(model, verbose=0).total_params
    except Exception as e:  # torchinfo needs an input for some models; totals still come from parameters()
        t['torchinfo'] = None
    if extra:
        t.update(extra)
    return t


def save_set(name, truth):
    make, example = MODELS[name]
    torch.manual_seed({'mlp': 1, 'cnn': 2, 'gpt': 3}[name])
    model = make().eval()
    sd = model.state_dict()
    base = os.path.join(OUT, name)

    p = f'{base}.state_dict.pth'
    torch.save(sd, p)
    truth.append(truth_of(model, sd, p, {'kind': 'state_dict'}))

    p = f'{base}.module.pt'
    torch.save(model, p)
    truth.append(truth_of(model, sd, p, {'kind': 'module'}))

    p = f'{base}.torchscript.pt'
    try:
        ts = torch.jit.script(model)
    except Exception:
        ts = torch.jit.trace(model, example())
    ts.save(p)
    truth.append(truth_of(model, sd, p, {'kind': 'torchscript'}))

    p = f'{base}.export.pt2'
    try:
        ep = torch.export.export(model, (example(),))
        torch.export.save(ep, p)
        truth.append(truth_of(model, sd, p, {'kind': 'pt2', 'graphNodes': len(list(ep.graph.nodes)),
                                             'callFunctions': sum(1 for n in ep.graph.nodes if n.op == 'call_function')}))
    except Exception as e:
        print(f'  export failed for {name}: {e}')

    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, betas=(0.9, 0.95), weight_decay=0.1)
    sched = torch.optim.lr_scheduler.StepLR(opt, step_size=10, gamma=0.5)
    model.train()
    out = model(example())
    out.float().mean().backward()
    opt.step()
    sched.step()
    model.eval()
    sd = model.state_dict()
    ckpt = {
        'epoch': 7,
        'global_step': 1234,
        'pytorch-lightning_version': '2.4.0',
        'state_dict': OrderedDict((f'model.{k}', v) for k, v in sd.items()),
        'loops': {'fit_loop': {'epoch_progress': {'total': {'ready': 8, 'completed': 7}}}},
        'callbacks': {"ModelCheckpoint{'monitor': 'val_loss', 'mode': 'min'}": {'best_model_score': torch.tensor(0.4213), 'best_model_path': 'checkpoints/best.ckpt'}},
        'optimizer_states': [opt.state_dict()],
        'lr_schedulers': [sched.state_dict()],
        'hparams_name': 'kwargs',
        'hyper_parameters': {'model': name, 'lr': 3e-4, 'batch_size': 64, 'max_epochs': 20, 'optimizer': 'AdamW', 'note': '한국어 메모'},
    }
    p = f'{base}.lightning.ckpt'
    torch.save(ckpt, p)
    truth.append(truth_of(model, ckpt['state_dict'], p, {'kind': 'lightning', 'epoch': 7, 'global_step': 1234,
                                                       'optimizerStateTensors': sum(1 for s in opt.state.values() for v in s.values() if torch.is_tensor(v))}))

    p = f'{base}.legacy.pt'
    torch.save(sd, p, _use_new_zipfile_serialization=False)
    truth.append(truth_of(model, sd, p, {'kind': 'legacy'}))

    for dt, tag in ((torch.float16, 'f16'), (torch.bfloat16, 'bf16')):
        m2 = make()
        m2.load_state_dict(sd)
        m2 = m2.to(dt)
        sd2 = m2.state_dict()
        p = f'{base}.{tag}.pth'
        torch.save(sd2, p)
        truth.append(truth_of(m2, sd2, p, {'kind': f'state_dict-{tag}'}))
    return model


def save_quantized(truth):
    torch.manual_seed(1)
    model = MLP().eval()
    q = torch.ao.quantization.quantize_dynamic(model, {nn.Linear}, dtype=torch.qint8)
    sd = q.state_dict()
    p = os.path.join(OUT, 'mlp.int8-dynamic.pth')
    torch.save(sd, p)
    # Packed params are (weight qint8, bias f32) tuples, not tensors: count the weights from the float model.
    truth.append({'file': os.path.basename(p), 'kind': 'quantized-dynamic', 'parameters': sum(p_.numel() for p_ in model.parameters()),
                  'stateKeys': list(sd.keys())})


def save_safetensors(truth):
    from safetensors.torch import save_file
    torch.manual_seed(3)
    model = TinyGPT().eval()
    sd = {k: v.to(torch.bfloat16).contiguous() for k, v in model.state_dict().items() if k != 'lm_head.weight'}
    p = os.path.join(OUT, 'gpt.bf16.safetensors')
    save_file(sd, p, metadata={'format': 'pt', 'model': 'TinyGPT', 'd_model': '48', 'license': 'MIT', 'source': 'tools/make-ai-samples.py'})
    truth.append({'file': os.path.basename(p), 'kind': 'safetensors', 'stateTensors': len(sd), 'stateElements': sum(v.numel() for v in sd.values()),
                  'tensors': {k: {'shape': list(v.shape), 'dtype': 'bfloat16'} for k, v in sd.items()}})
    torch.manual_seed(2)
    cnn = SmallCNN().eval()
    sd = {k: v.contiguous() for k, v in cnn.state_dict().items()}
    p = os.path.join(OUT, 'cnn.safetensors')
    save_file(sd, p)
    truth.append({'file': os.path.basename(p), 'kind': 'safetensors', 'stateTensors': len(sd), 'stateElements': sum(v.numel() for v in sd.values())})


def save_hf_bin(truth):
    torch.manual_seed(3)
    model = TinyGPT().eval()
    sd = model.state_dict()
    p = os.path.join(OUT, 'pytorch_model.bin')
    torch.save(sd, p)
    truth.append(truth_of(model, sd, p, {'kind': 'hf-bin'}))


class Evil:
    def __reduce__(self):
        return (os.system, ('echo fp-test-pickle-must-not-run',))


def save_malicious():
    payload = {'state_dict': OrderedDict(w=torch.zeros(2, 2)), 'evil': Evil()}
    with open(os.path.join(OUT, 'malicious.pkl'), 'wb') as f:
        pickle.dump(payload['evil'], f, protocol=2)
    # The same REDUCE inside a PyTorch zip, next to a real tensor.
    torch.save(payload, os.path.join(OUT, 'malicious.pt'))


def save_broken():
    def trunc(src, dst, keep):
        with open(os.path.join(OUT, src), 'rb') as f:
            b = f.read()
        with open(os.path.join(OUT, dst), 'wb') as f:
            f.write(b[:keep] if keep > 0 else b[:len(b) + keep])
    trunc('mlp.state_dict.pth', 'broken.pt', 900)
    trunc('gpt.bf16.safetensors', 'broken.safetensors', 300)
    trunc('mlp.export.pt2', 'broken.pt2', -400)


@register
class Tiny(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(1, 2, 3)
        self.bn = nn.BatchNorm2d(2)
        self.fc = nn.Linear(8, 3)

    def forward(self, x):
        x = F.relu(self.bn(self.conv(x)))
        return self.fc(x.flatten(1))


def save_testdata():
    """Tiny models embedded (base64) in plugin/editor/renderers/aimodel/testdata.ts for unit tests."""
    import base64
    from safetensors.torch import save as st_save
    torch.manual_seed(5)
    m = Tiny().eval()
    m.fc.weight.data = torch.arange(24, dtype=torch.float32).reshape(3, 8) / 10  # known values for decoding tests
    sd = m.state_dict()
    blobs = {}

    def saved(obj, **kw):
        b = io.BytesIO()
        torch.save(obj, b, **kw)
        return b.getvalue()
    blobs['stateDict'] = saved(sd)
    blobs['legacy'] = saved(sd, _use_new_zipfile_serialization=False)
    blobs['module'] = saved(m)
    b = io.BytesIO()
    torch.jit.save(torch.jit.script(m), b)
    blobs['torchscript'] = b.getvalue()
    blobs['safetensors'] = st_save({k: v.contiguous() for k, v in sd.items()}, metadata={'format': 'pt', 'note': 'tiny'})
    opt = torch.optim.SGD(m.parameters(), lr=0.1, momentum=0.9)
    m.train()
    m(torch.randn(2, 1, 4, 4)).sum().backward()
    opt.step()
    m.eval()
    blobs['lightning'] = saved({'epoch': 3, 'global_step': 42, 'pytorch-lightning_version': '2.4.0', 'state_dict': {f'model.{k}': v for k, v in m.state_dict().items()},
                                'optimizer_states': [opt.state_dict()], 'lr_schedulers': [], 'hyper_parameters': {'lr': 0.1}})
    blobs['malicious'] = pickle.dumps(Evil(), protocol=2)
    blobs['malicious0'] = pickle.dumps(Evil(), protocol=0)
    b = io.BytesIO()
    torch.export.save(torch.export.export(m, (torch.randn(1, 1, 4, 4),)), b)
    blobs['pt2'] = b.getvalue()
    params = sum(p.numel() for p in m.parameters())
    lines = ['// Generated by tools/make-ai-samples.py: tiny PyTorch files (base64) for the AI model unit tests.',
             '// Tiny = Conv2d(1, 2, 3) → BatchNorm2d(2) → ReLU → Linear(8, 3); fc.weight = arange(24) / 10.',
             f'export const TINY_PARAMS = {params}',
             f'export const TINY_TENSORS = {len(sd)}',
             f'export const TINY_KEYS = {json.dumps(list(sd.keys()))}',
             'export const B64: Record<string, string> = {']
    for k, v in blobs.items():
        lines.append(f"  {k}: '{base64.b64encode(v).decode()}',")
    lines.append('}')
    lines.append('')
    lines.append('export function bytesOf(name: string): Uint8Array {')
    lines.append('  const s = atob(B64[name])')
    lines.append('  const out = new Uint8Array(s.length)')
    lines.append('  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)')
    lines.append('  return out')
    lines.append('}')
    path = os.path.join(ROOT, 'plugin', 'editor', 'renderers', 'aimodel', 'testdata.ts')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    print('testdata', {k: len(v) for k, v in blobs.items()}, os.path.getsize(path))


def save_big(dst):
    import torchvision
    os.makedirs(dst, exist_ok=True)
    truth = []
    for name, ctor in (('resnet18', torchvision.models.resnet18), ('resnet50', torchvision.models.resnet50)):
        torch.manual_seed(0)
        m = ctor(weights=None).eval()
        sd = m.state_dict()
        p = os.path.join(dst, f'{name}.pth')
        torch.save(sd, p)
        truth.append(truth_of(m, sd, p, {'kind': 'state_dict'}))
        p = os.path.join(dst, f'{name}.module.pt')
        torch.save(m, p)
        p = os.path.join(dst, f'{name}.torchscript.pt')
        torch.jit.script(m).save(p)
        try:
            ep = torch.export.export(m, (torch.randn(1, 3, 224, 224),))
            torch.export.save(ep, os.path.join(dst, f'{name}.export.pt2'))
            truth[-1]['callFunctions'] = sum(1 for n in ep.graph.nodes if n.op == 'call_function')
        except Exception as e:
            print('export', name, e)
        from safetensors.torch import save_file
        save_file({k: v.contiguous() for k, v in sd.items()}, os.path.join(dst, f'{name}.safetensors'))
    # ~1.6 GB GPT-style checkpoint (24 blocks, d=1280 ≈ 0.47 B parameters, f32 + optimizer-free).
    torch.manual_seed(0)
    g = TinyGPT(vocab=50304, d=1280, layers=20, heads=20, ctx=1024).eval()
    sd = g.state_dict()
    p = os.path.join(dst, 'gpt-large.pth')
    torch.save(sd, p)
    truth.append(truth_of(g, sd, p, {'kind': 'state_dict'}))
    for t in truth:
        t.pop('tensors', None)
    with open(os.path.join(dst, 'truth.json'), 'w', encoding='utf-8') as f:
        json.dump(truth, f, indent=1)
    print('big samples →', dst)


def main():
    if '--big' in sys.argv:
        save_big(sys.argv[sys.argv.index('--big') + 1])
        return
    os.makedirs(OUT, exist_ok=True)
    truth = []
    for name in MODELS:
        save_set(name, truth)
    save_quantized(truth)
    save_safetensors(truth)
    save_hf_bin(truth)
    save_malicious()
    save_broken()
    with open(os.path.join(ROOT, 'tools', 'aimodel', 'truth.json'), 'w', encoding='utf-8') as f:
        json.dump({'torch': torch.__version__, 'samples': truth}, f, indent=1, ensure_ascii=False)
    save_testdata()
    total = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
    print(f'wrote {len(os.listdir(OUT))} files, {total / 1e6:.2f} MB → {OUT}')


if __name__ == '__main__':
    main()
