| File | Kind | Reader label | Params (PyTorch) | Params (preview) | Tensors | Shapes+dtypes | Graph ops | Open (ms) | Bytes read | Result |
|---|---|---|---:|---:|---|---|---|---:|---|---|
| mlp.state_dict.pth | state_dict | PyTorch state_dict | 5,018 | 5,018 | 6/6 | 6/6 | — | 3.0 | 9 reads, 0.02 MB of 0.0 MB | ✅ |
| mlp.module.pt | module | PyTorch nn.Module (pickled object) | 5,018 | 5,018 | 6/6 | 6/6 | — | 1.8 | 9 reads, 0.03 MB of 0.0 MB | ✅ |
| mlp.torchscript.pt | torchscript | TorchScript archive | 5,018 | 5,018 | 6/6 | 6/6 | 6 | 11.0 | 23 reads, 0.03 MB of 0.0 MB | ✅ |
| mlp.export.pt2 | pt2 | torch.export ExportedProgram (torch 2.15.0) | 5,018 | 5,018 | 6/6 | 6/6 | 6 (torch.export: 6) | 1.8 | 6 reads, 0.05 MB of 0.0 MB | ✅ |
| mlp.lightning.ckpt | lightning | PyTorch Lightning checkpoint | 5,018 | 5,018 | 6/6 | 6/6 | — | 1.5 | 9 reads, 0.07 MB of 0.1 MB | ✅ |
| mlp.legacy.pt | legacy | PyTorch legacy pickle (protocol 1001) · state_dict | 5,018 | 5,018 | 6/6 | 6/6 | — | 0.6 | 9 reads, 0.02 MB of 0.0 MB | ✅ |
| mlp.f16.pth | state_dict-f16 | PyTorch state_dict | 5,018 | 5,018 | 6/6 | 6/6 | — | 0.3 | 9 reads, 0.01 MB of 0.0 MB | ✅ |
| mlp.bf16.pth | state_dict-bf16 | PyTorch state_dict | 5,018 | 5,018 | 6/6 | 6/6 | — | 0.6 | 9 reads, 0.01 MB of 0.0 MB | ✅ |
| cnn.state_dict.pth | state_dict | PyTorch state_dict | 8,842 | 8,842 | 20/20 | 20/20 | — | 0.4 | 9 reads, 0.04 MB of 0.0 MB | ✅ |
| cnn.module.pt | module | PyTorch nn.Module (pickled object) | 8,842 | 8,842 | 20/20 | 20/20 | — | 0.9 | 9 reads, 0.05 MB of 0.0 MB | ✅ |
| cnn.torchscript.pt | torchscript | TorchScript archive | 8,842 | 8,842 | 20/20 | 20/20 | 15 | 3.4 | 39 reads, 0.08 MB of 0.1 MB | ✅ |
| cnn.export.pt2 | pt2 | torch.export ExportedProgram (torch 2.15.0) | 8,842 | 8,842 | 20/20 | 20/20 | 15 (torch.export: 15) | 0.8 | 6 reads, 0.10 MB of 0.1 MB | ✅ |
| cnn.lightning.ckpt | lightning | PyTorch Lightning checkpoint | 8,842 | 8,842 | 20/20 | 20/20 | — | 1.1 | 9 reads, 0.07 MB of 0.1 MB | ✅ |
| cnn.legacy.pt | legacy | PyTorch legacy pickle (protocol 1001) · state_dict | 8,842 | 8,842 | 20/20 | 20/20 | — | 0.7 | 23 reads, 0.04 MB of 0.0 MB | ✅ |
| cnn.f16.pth | state_dict-f16 | PyTorch state_dict | 8,842 | 8,842 | 20/20 | 20/20 | — | 0.4 | 9 reads, 0.03 MB of 0.0 MB | ✅ |
| cnn.bf16.pth | state_dict-bf16 | PyTorch state_dict | 8,842 | 8,842 | 20/20 | 20/20 | — | 0.4 | 9 reads, 0.03 MB of 0.0 MB | ✅ |
| gpt.state_dict.pth | state_dict | PyTorch state_dict | 64,320 | 64,320 | 29/29 | 29/29 | — | 0.9 | 9 reads, 0.07 MB of 0.3 MB | ✅ |
| gpt.module.pt | module | PyTorch nn.Module (pickled object) | 64,320 | 64,320 | 29/29 | 29/29 | — | 1.6 | 9 reads, 0.07 MB of 0.3 MB | ✅ |
| gpt.torchscript.pt | torchscript | TorchScript archive | 64,320 | 64,320 | 29/29 | 29/29 | 27 | 2.8 | 37 reads, 0.08 MB of 0.3 MB | ✅ |
| gpt.export.pt2 | pt2 | torch.export ExportedProgram (torch 2.15.0) | 64,320 | 64,320 | 29/29 | 29/29 | 71 (torch.export: 71) | 1.8 | 6 reads, 0.17 MB of 0.4 MB | ✅ |
| gpt.lightning.ckpt | lightning | PyTorch Lightning checkpoint | 64,320 | 64,320 | 29/29 | 29/29 | — | 1.1 | 9 reads, 0.08 MB of 0.8 MB | ✅ |
| gpt.legacy.pt | legacy | PyTorch legacy pickle (protocol 1001) · state_dict | 64,320 | 64,320 | 29/29 | 29/29 | — | 0.6 | 31 reads, 0.25 MB of 0.2 MB | ✅ |
| gpt.f16.pth | state_dict-f16 | PyTorch state_dict | 64,320 | 64,320 | 29/29 | 29/29 | — | 0.4 | 9 reads, 0.07 MB of 0.1 MB | ✅ |
| gpt.bf16.pth | state_dict-bf16 | PyTorch state_dict | 64,320 | 64,320 | 29/29 | 29/29 | — | 0.4 | 9 reads, 0.07 MB of 0.1 MB | ✅ |
| mlp.int8-dynamic.pth | quantized-dynamic | PyTorch state_dict | 5,018 | 5,018 | 12/? | — | — | 0.5 | 9 reads, 0.01 MB of 0.0 MB | ✅ |
| gpt.bf16.safetensors | safetensors | safetensors |  | 64,320 | 28/28 | 28/28 | — | 0.4 | 2 reads, 0.00 MB of 0.1 MB | ✅ |
| cnn.safetensors | safetensors | safetensors |  | 8,842 | 20/20 | — | — | 0.1 | 2 reads, 0.00 MB of 0.0 MB | ✅ |
| pytorch_model.bin | hf-bin | PyTorch state_dict | 64,320 | 64,320 | 29/29 | 29/29 | — | 0.6 | 9 reads, 0.07 MB of 0.3 MB | ✅ |
| resnet18.pth | state_dict | PyTorch state_dict | 11,689,512 | 11,689,512 | 122/122 | — | — | 1.7 | 9 reads, 0.08 MB of 44.7 MB | ✅ |
| resnet18.module.pt | module | PyTorch nn.Module (pickled object) | 11,689,512 | 11,689,512 | 122/122 | — | — | 5.4 | 9 reads, 0.10 MB of 44.7 MB | ✅ |
| resnet18.torchscript.pt | torchscript | TorchScript archive | 11,689,512 | 11,689,512 | 122/122 | — | 69 (torch.export: 69) | 7.2 | 77 reads, 0.10 MB of 44.7 MB | ✅ |
| resnet18.export.pt2 | export | torch.export ExportedProgram (torch 2.15.0) | 11,689,512 | 11,689,512 | 122/122 | — | 69 (torch.export: 69) | 3.1 | 6 reads, 0.27 MB of 45.4 MB | ✅ |
| resnet18.safetensors | safetensors | safetensors | 11,689,512 | 11,689,512 | 122/122 | — | — | 0.3 | 2 reads, 0.01 MB of 44.6 MB | ✅ |
| resnet50.pth | state_dict | PyTorch state_dict | 25,557,032 | 25,557,032 | 320/320 | — | — | 2.5 | 9 reads, 0.12 MB of 97.8 MB | ✅ |
| resnet50.module.pt | module | PyTorch nn.Module (pickled object) | 25,557,032 | 25,557,032 | 320/320 | — | — | 5.9 | 9 reads, 0.15 MB of 97.8 MB | ✅ |
| resnet50.torchscript.pt | torchscript | TorchScript archive | 25,557,032 | 25,557,032 | 320/320 | — | 175 (torch.export: 175) | 12.9 | 111 reads, 0.15 MB of 97.9 MB | ✅ |
| resnet50.export.pt2 | export | torch.export ExportedProgram (torch 2.15.0) | 25,557,032 | 25,557,032 | 320/320 | — | 175 (torch.export: 175) | 7.5 | 6 reads, 0.59 MB of 98.8 MB | ✅ |
| resnet50.safetensors | safetensors | safetensors | 25,557,032 | 25,557,032 | 320/320 | — | — | 0.6 | 2 reads, 0.03 MB of 97.7 MB | ✅ |
| gpt-large.pth | state_dict | PyTorch state_dict | 459,251,200 | 459,251,200 | 245/245 | — | — | 1.8 | 9 reads, 0.11 MB of 1752.0 MB | ✅ |

PyTorch 2.15.0+cpu; 39/39 match.
