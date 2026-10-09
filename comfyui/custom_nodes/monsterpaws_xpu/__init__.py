"""Keep PyTorch's XPU cache across prompts (ADR-0004 as amended 2026-10-05; doc/infra.md, Home GPU).

ComfyUI empties the allocator cache after every prompt. Under WSL2 GPU
paravirtualisation the Intel driver retains freed allocations it cannot
reuse, so that churn fills the card and then host memory, image by image
(2026-10-08, the look's batch 1). With MONSTERPAWS_KEEP_XPU_CACHE=1 the
cache is never emptied, the driver never sees the frees, and PyTorch reuses
its own blocks. Loaded as a custom node so it runs before any prompt; it
registers no nodes.
"""
import os

import torch

if os.environ.get("MONSTERPAWS_KEEP_XPU_CACHE") == "1" and hasattr(torch, "xpu"):
    torch.xpu.empty_cache = lambda: None
    print("[monsterpaws_xpu] torch.xpu.empty_cache disabled: the allocator cache is kept across prompts")

NODE_CLASS_MAPPINGS = {}
