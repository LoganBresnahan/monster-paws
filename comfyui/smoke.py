"""Does PyTorch see the GPU this container was built for, and does it tell the truth? (ADR-0004 as amended 2026-10-05)

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

# A fast kernel proves nothing: on 2026-10-07 the Arc timed 35 TFLOPS while
# every copy in either direction came back as garbage, because the image's
# compute runtime was a year older than the Windows driver it talked to
# (doc/infra.md, Home GPU). Values must survive a round trip, and so must a
# multi-GB allocation; a single one stops at 4 GiB on Level Zero, which no
# SDXL tensor approaches, so the test stays below it.
def roundtrip(label: str, a: torch.Tensor) -> None:
    b = a.to(backend)
    dev.synchronize()
    c = b.cpu()
    bad = int((c != a).sum())
    if bad:
        raise SystemExit(f"{label}: {bad} of {a.numel()} values changed on the round trip "
                         f"(e.g. {a.flatten()[:4].tolist()} -> {c.flatten()[:4].tolist()}); "
                         "on WSL2 read `dmesg | grep dxg` and see doc/infra.md, Home GPU")
    print(f"roundtrip ok {label}")

roundtrip("int64 x8", torch.arange(8))
roundtrip("int64 x77 token ids", torch.randint(0, 49408, (2, 77)))
roundtrip("fp16 x1M", torch.randn(1 << 20, dtype=torch.float16))
roundtrip("fp16 3 GiB", torch.ones(3 << 29, dtype=torch.float16))

# Descriptors leaked per allocate-and-free cycle: ~100 per image through
# /dev/dxg on 2026-10-07 (doc/infra.md, Home GPU). Reported, not failed —
# a runtime that prints 0 is the one that retires the nofile ulimit.
import os
def fds() -> int:
    return len(os.listdir("/proc/self/fd"))
before = fds()
for _ in range(20):
    t = torch.randn(1024, 1024, device=backend)
    (t @ t).sum().item()
    del t
dev.synchronize()
print(f"descriptors leaked over 20 cycles: {fds() - before} (open now: {fds()})")

x = torch.ones(4096, 4096, device=backend, dtype=torch.float16)
y = x @ x
dev.synchronize()
if float(y[0, 0]) != 4096.0 or float(y[-1, -1]) != 4096.0:
    raise SystemExit(f"ones @ ones gave {float(y[0, 0])} and {float(y[-1, -1])}, expected 4096")
print("matmul ok")
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
