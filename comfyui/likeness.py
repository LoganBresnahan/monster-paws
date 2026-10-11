"""Image likeness: how close a generated image is to the animal's photo, by CLIP ViT-H cosine (ADR-0004 auto-QC).

    npm run explore:score -- batch1c            # scores every run in var/explore/batch1c → scores.jsonl, rebuilds the sheet
    npm run explore:score -- batch1c --picks    # also compares Logan's picks (picks.txt in the batch dir) against the rest
    python3 -I comfyui/likeness.py rank < vectors.json   # pure math, no model: rank candidates by cosine to a reference

Runs in the ComfyUI image via the `explore` compose service, on the CPU,
with the same image encoder the IP-Adapter conditions through. The
reference is the subject crop the encoder saw (its unpadded box when one
exists), so the score asks "does the output look like what we showed the
model", not "does it look like the whole photo".
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import explore  # noqa: E402

CLIP_VISION = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def rank(reference: list[float], candidates: dict[str, list[float]]) -> list[tuple[str, float]]:
    """Candidates by cosine to the reference, best first; ties keep input order."""
    return sorted(((k, cosine(reference, v)) for k, v in candidates.items()), key=lambda kv: -kv[1])


def encoder():
    """The ViT-H/14 image tower and projection, straight from the manifest's file — not through ComfyUI's loader, which stalled the VM on the CPU (2026-10-10)."""
    import torch
    from safetensors.torch import load_file
    from transformers import CLIPVisionConfig, CLIPVisionModelWithProjection
    torch.set_num_threads(4)
    config = CLIPVisionConfig(hidden_size=1280, intermediate_size=5120, num_hidden_layers=32, num_attention_heads=16,
                              image_size=224, patch_size=14, projection_dim=1024, hidden_act="gelu", layer_norm_eps=1e-5)
    model = CLIPVisionModelWithProjection(config)
    missing, unexpected = model.load_state_dict(load_file(f"/home/comfy/ComfyUI/models/clip_vision/{CLIP_VISION}"), strict=False)
    missing = [k for k in missing if "position_ids" not in k]
    unexpected = [k for k in unexpected if "position_ids" not in k]
    if missing or unexpected:
        raise RuntimeError(f"encoder weights do not match ViT-H/14: missing {missing[:3]} unexpected {unexpected[:3]}")
    return model.eval()


def embed(clip, path: Path) -> list[float]:
    import torch
    from PIL import Image
    from transformers import CLIPImageProcessor
    proc = CLIPImageProcessor(size={"shortest_edge": 224}, crop_size={"height": 224, "width": 224}, do_center_crop=True,
                              image_mean=[0.48145466, 0.4578275, 0.40821073], image_std=[0.26862954, 0.26130258, 0.27577711])
    with torch.no_grad():
        v = clip(**proc(images=Image.open(path).convert("RGB"), return_tensors="pt")).image_embeds[0]
    return (v / v.norm()).tolist()


def reference_for(run: dict) -> Path:
    animal, photo = run["animal"], run["photos"][0]
    for crop, raw in (("subject", True), ("subject", False), ("full", False)):
        p = explore.INPUT / explore.input_name(animal, photo, crop, raw=raw)
        if p.exists():
            return p
    raise FileNotFoundError(p)


def score(batch: str, picks: bool) -> None:
    out = explore.EXPLORE / batch
    runs = [json.loads(l) for l in (out / "runs.jsonl").read_text().splitlines()]
    runs = [r for r in runs if "output" in r]
    clip = encoder()
    refs: dict[Path, list[float]] = {}
    rows = []
    for r in runs:
        ref = reference_for(r)
        if ref not in refs:
            refs[ref] = embed(clip, ref)
        v = embed(clip, explore.OUTPUT / r["output"])
        rows.append({"id": r["id"], "reference": str(ref.relative_to(explore.INPUT)), "likeness": round(cosine(refs[ref], v), 4), "embedding": [round(x, 5) for x in v]})
        print(f"{rows[-1]['likeness']:.3f}  {r['id']}")
    (out / "scores.jsonl").write_text("".join(json.dumps(x) + "\n" for x in rows))
    vals = [x["likeness"] for x in rows]
    print(f"{batch}: {len(rows)} scored, median {statistics.median(vals):.3f}, min {min(vals):.3f}, max {max(vals):.3f}")
    if picks:
        chosen = {l.strip() for l in (out / "picks.txt").read_text().splitlines() if l.strip()}
        a = [x["likeness"] for x in rows if x["id"] in chosen]
        b = [x["likeness"] for x in rows if x["id"] not in chosen]
        order = [x["id"] for x in sorted(rows, key=lambda x: -x["likeness"])]
        ranks = [order.index(i) + 1 for i in chosen if i in order]
        print(f"picks: {len(a)} picked mean {statistics.mean(a):.3f} vs {len(b)} others mean {statistics.mean(b):.3f}; picks rank {sorted(ranks)} of {len(order)}")
    explore.sheet(batch)


def siblings(runs: list[dict]) -> dict[tuple, list[dict]]:
    """Candidates of one workflow for one photo: everything equal but the seed — what production chooses among."""
    groups: dict[tuple, list[dict]] = {}
    for r in runs:
        k = tuple((a, r.get(a)) for a in explore.AXES if a != "seed")
        groups.setdefault(k, []).append(r)
    return groups


def consensus(batch: str) -> None:
    """Rank each workflow's candidates by closeness to the others (the artefact is the outlier), and report where Logan's picks land."""
    out = explore.EXPLORE / batch
    runs = {json.loads(l)["id"]: json.loads(l) for l in (out / "runs.jsonl").read_text().splitlines() if '"output"' in l}
    emb = {json.loads(l)["id"]: json.loads(l)["embedding"] for l in (out / "scores.jsonl").read_text().splitlines()}
    picks = {l.strip() for l in (out / "picks.txt").read_text().splitlines() if l.strip()} if (out / "picks.txt").exists() else set()
    results = []
    for key, members in siblings(list(runs.values())).items():
        if len(members) < 2:
            continue
        ids = [m["id"] for m in members]
        central = {i: statistics.mean(cosine(emb[i], emb[j]) for j in ids if j != i) for i in ids}
        order = sorted(ids, key=lambda i: -central[i])
        for i in ids:
            if i in picks:
                results.append((order.index(i) + 1, len(ids), i))
    for rank, n, i in sorted(results):
        print(f"  consensus rank {rank} of {n}  {i[:70]}")
    if results:
        print(f"{batch}: {len(results)} picks, mean rank {statistics.mean(r for r, _, _ in results):.1f} of {statistics.mean(n for _, n, _ in results):.1f}; first {sum(r == 1 for r, _, _ in results)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("score"); s.add_argument("batch"); s.add_argument("--picks", action="store_true")
    sub.add_parser("rank")
    c = sub.add_parser("consensus"); c.add_argument("batch")
    a = ap.parse_args()
    if a.cmd == "rank":
        data = json.load(sys.stdin)
        for k, v in rank(data["reference"], data["candidates"]):
            print(f"{v:.4f} {k}")
        return 0
    if a.cmd == "consensus":
        consensus(a.batch)
        return 0
    score(a.batch, a.picks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
