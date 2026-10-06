"""Does PyTorch see the GPU this container was built for? (ADR-0004 as amended 2026-10-05)

Run: docker compose -f comfyui/compose.yml run --rm comfyui python /home/comfy/smoke.py
"""
import time

import torch

print("torch", torch.__version__)
backend = "xpu" if torch.xpu.is_available() else "cuda" if torch.cuda.is_available() else None
if backend is None:
    raise SystemExit("no GPU backend available — on WSL2 check /dev/dxg and the /usr/lib/wsl mount")
dev = getattr(torch, backend)
for i in range(dev.device_count()):
    props = dev.get_device_properties(i)
    print(backend, i, dev.get_device_name(i), props.total_memory // 2**20, "MiB")
x = torch.randn(4096, 4096, device=backend, dtype=torch.float16)
x @ x  # warm-up: the first kernel includes JIT compilation
dev.synchronize()
t = time.time()
for _ in range(10):
    x @ x
dev.synchronize()
dt = time.time() - t
print(f"fp16 matmul 4096^3 x10: {dt:.2f}s (~{10 * 2 * 4096**3 / dt / 1e12:.1f} TFLOPS)")
print("ok")
