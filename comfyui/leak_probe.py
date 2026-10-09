"""Where does the IP-Adapter path leak host memory? Small experiments behind comfyui/guard.sh.

    python3 comfyui/leak_probe.py            # all experiments
    python3 comfyui/leak_probe.py steps5     # one

Each experiment starts a fresh ComfyUI (so leaks never accumulate across
experiments), generates N images of the same graph with different seeds,
and reads Windows' host free memory and the driver's shared GPU pool after
every image. Results append to var/explore/leak/probe.jsonl and print as a
table. The explore harness builds the graphs, so a graph here is exactly a
graph the batches run. Background: doc/infra.md, Home GPU, 2026-10-07.
"""
import json
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import explore  # noqa: E402

HOST = "http://127.0.0.1:8188"
GUARD = str(Path(__file__).with_name("guard.sh"))
OUT = Path("var/explore/leak")
PHOTO = {"animal": "Plum", "kind": "dog", "photo": "clean", "photos": ["downloadfile.jpg"]}
BASE = {**PHOTO, "prompt": "photo", "prompt_text": explore.PROMPTS["photo"].format(kind="dog"), "negative": explore.NEGATIVE,
        "weight": 0.8, "weight_type": "linear", "end_at": 1.0, "denoise": None, "multi": "batch", "combine": "concat"}

EXPERIMENTS = {
    # name: (server flags, run overrides, images[, "ENV=V ENV=V" for GPU_ENV])
    "txt2img":   ("", {"graph": "txt2img"}, 3),
    "adapter":   ("", {"graph": "adapter"}, 3),
    "steps5":    ("", {"graph": "adapter", "steps": 5}, 3),
    "gpu-only":  ("--gpu-only", {"graph": "adapter"}, 3),
    "encoder":   ("", {"graph": "adapter", "multi": "encoder"}, 3),
    # VRAM-spill hunt (2026-10-08): the process slows 7× after ~3 images as
    # allocations spill into the driver's shared pool; which flag keeps it
    # inside VRAM?
    "base6":     ("", {"graph": "adapter"}, 6),
    # --disable-smart-memory (offload after every run) leaked 18 GB in two
    # images and tripped the watchdog: the leak is the GPU↔host weight
    # shuffle itself. So the candidates are the modes that never offload.
    "nosmart6":  ("--disable-smart-memory", {"graph": "adapter"}, 6),
    "gpuonly6":  ("--gpu-only", {"graph": "adapter"}, 6),
    "highvram6": ("--highvram", {"graph": "adapter"}, 6),
    "gpuonly12": ("--gpu-only", {"graph": "adapter"}, 12),
    "txt2img6":  ("", {"graph": "txt2img"}, 6),
    # 2026-10-08 afternoon: torch's reserved is flat while the driver's shared
    # pool grows — retained frees below torch. Three ways to stop the churn.
    "keepcache6": ("", {"graph": "adapter"}, 6, "MONSTERPAWS_KEEP_XPU_CACHE=1"),
    "neocache6":  ("", {"graph": "adapter"}, 6, "NEOReadDebugKeys=1 ExperimentalEnableDeviceAllocationCache=0 ExperimentalEnableHostAllocationCache=0 ExperimentalEnableSharedAllocationCache=0"),
    "urpool6":    ("", {"graph": "adapter"}, 6, "UR_L0_DISABLE_USM_ALLOCATOR=1"),
    # 2026-10-08 evening, batch 1b: host free fell 12 GB between images 8 and
    # 10 of a chunk that switched LoRA every image; batch 1 (no LoRA) ran
    # 136 flat. One LoRA held, versus a switch every image.
    "lora6":       ("", {"graph": "adapter", "lora": "watercolor"}, 6),
    "loraswitch6": ("", {"graph": "adapter", "lora_cycle": [None, "watercolor", "tinies"]}, 6),
}


def guard(*args: str) -> str:
    return subprocess.run([GUARD, *args], capture_output=True, text=True, check=True).stdout.strip()


def mem() -> dict:
    kv = dict(p.split("=") for p in guard("mem").split())
    m = {"host_free": float(kv["host_free"].rstrip("GB")), "shared": float(kv["shared"].rstrip("GB")), "fds": kv["fds"]}
    try:  # PyTorch's own view from inside the server: reserved (cached) vs free, in GiB
        with urllib.request.urlopen(f"{HOST}/system_stats", timeout=10) as r:
            d = json.load(r)["devices"][0]
        m["torch_reserved"] = round((d["torch_vram_total"]) / 2**30, 1)
        m["torch_free"] = round(d["torch_vram_free"] / 2**30, 1)
        m["vram_free"] = round(d["vram_free"] / 2**30, 1)
    except Exception:
        pass
    return m


def graph(run: dict, prefix: str) -> dict:
    if run["graph"] == "txt2img":
        g = explore.build_graph({**run, "graph": "adapter"}, prefix)
        g["sampler"]["inputs"]["model"] = ["ckpt", 0]
        for k in ("clipvision", "ipa_model", "prep0", "ipa", "img0"):
            g.pop(k, None)
        return g
    return explore.build_graph(run, prefix)


def generate(run: dict, prefix: str) -> float:
    g = graph(run, prefix)
    req = urllib.request.Request(f"{HOST}/prompt", data=json.dumps({"prompt": g, "client_id": uuid.uuid4().hex}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        pid = json.load(r)["prompt_id"]
    t0 = time.time()
    while True:
        time.sleep(1)
        with urllib.request.urlopen(f"{HOST}/history/{pid}") as r:
            h = json.load(r).get(pid)
        if h and h.get("status", {}).get("completed"):
            return round(time.time() - t0, 1)
        if h and h.get("status", {}).get("status_str") == "error":
            raise RuntimeError(json.dumps(h["status"])[:500])


def experiment(name: str) -> None:
    flags, overrides, n, *rest = EXPERIMENTS[name]
    env = rest[0] if rest else ""
    run = {**BASE, **overrides}
    print(f"=== {name}  flags={flags or '-'}  env={env or '-'}  {overrides}")
    import os
    os.environ["GPU_ENV"] = env
    print(guard("up", *flags.split()))
    watch = subprocess.Popen([GUARD, "watch"])
    try:
        before = mem()
        rows = []
        print(f"  fresh      host_free={before['host_free']:5.1f}  shared={before['shared']:4.1f}  fds={before['fds']}")
        for i in range(n):
            try:
                cycle = run.get("lora_cycle")
                secs = generate({**run, "seed": 100 + i, **({"lora": cycle[i % len(cycle)]} if cycle else {})}, f"explore/leak/{name}")
            except Exception as e:  # the watchdog killed the server, or the graph errored — record and move on
                print(f"  image {i + 1}  FAILED {type(e).__name__}: {str(e)[:160]}")
                rows.append({"experiment": name, "flags": flags, "image": i + 1, "error": str(e)[:300]})
                break
            now = mem()
            rows.append({"experiment": name, "flags": flags, **{k: v for k, v in run.items() if k not in ("prompt_text", "negative", "photos")},
                         "image": i + 1, "seconds": secs, "host_free": now["host_free"], "shared": now["shared"], "fds": now["fds"],
                         "d_shared": round(now["shared"] - before["shared"], 1), "d_host": round(before["host_free"] - now["host_free"], 1)})
            print(f"  image {i + 1}  {('lora=' + str(run.get('lora_cycle', [run.get('lora')])[i % len(run.get('lora_cycle', [1]))])):18} {secs:6.1f}s  host_free={now['host_free']:5.1f}  shared={now['shared']:4.1f} (+{rows[-1]['d_shared']})  fds={now['fds']}  torch_reserved={now.get('torch_reserved')}  torch_free={now.get('torch_free')}  vram_free={now.get('vram_free')}")
            before = now
        OUT.mkdir(parents=True, exist_ok=True)
        with (OUT / "probe.jsonl").open("a") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    finally:
        watch.kill()
        print(guard("down") or "  down")
        print(f"  after down: {mem()}")


def main() -> int:
    names = sys.argv[1:] or list(EXPERIMENTS)
    for name in names:
        experiment(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
