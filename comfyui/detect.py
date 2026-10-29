"""Which animal in a listing's photos is the listing's animal: the subject-detection experiment and its evaluation (ADR-0026).

Runs in the ComfyUI image via the `explore` compose service, on the CPU,
with the detector models from comfyui/models.manifest (`detect/`) and the
listings in explore/detect.json (or DETECT_SPEC, beside it):

    npm run explore:detect               # every stage; detector boxes, masks and embeddings are cached
    npm run explore:detect -- --fresh    # recompute every stage
    DETECT_PIPELINES=owlv2,grounding-dino,pooled   # the comparison runs; OWLv2 alone is the default

Stages: OWLv2 is asked for the listing's species, its colour, its head and
the other common species, and its raw boxes are cached at a low floor so
rules can change without a rerun. Every box that clears the floor is
outlined with SAM 2.1; then boxes that look more like another species go,
then group boxes (two separate animals in one box — separate by their
outlines), then duplicates, then parts. Survivors are embedded with the
judge's ViT-H and scored on the votes below; a close call (margin under
CLOSE) gets a second, closer look on crops, and the top scorer is always
chosen, with the margin recorded. doc/plans/subject-detection.md has the
runs and the photo sets.
RT-DETR (COCO) runs beside them as a yardstick and never votes. Output in
DETECT_OUT (default var/explore/detect/): an overlay per photo per
pipeline, a sheet per pipeline, a head-crop sheet, results.jsonl.
"""
import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

MODELS = Path("/home/comfy/ComfyUI/models/detect")
CREW = Path("/home/comfy/crew")
PHOTOS = Path("/home/comfy/photos")
OUT = Path(os.environ.get("DETECT_OUT", "/home/comfy/explore/detect"))
PIPELINES = os.environ.get("DETECT_PIPELINES", "owlv2").split(",")
LONG_SIDE = 1600

# A box is a candidate only at this score and at RELATIVE of the photo's best box, or a leaf can outscore the animal (ADR-0026).
FLOOR = {"owlv2": 0.06, "grounding-dino": 0.18}
RELATIVE = 0.3

# Dog and cat listings are checked against each other, never other species: OWLv2 calls a chinchilla a cat (ADR-0026).
COMMON = ("dog", "cat")

# Never rescale an ABSOLUTE vote: stretching a near-zero colour gap chose a cat for a dog listing (ADR-0026).
WEIGHTS = {"species": 0.5, "colour_prompt": 0.5, "colour_measured": 1.5, "recurrence": 1.5, "size_centre": 0.5,
           "species_margin": 1.0}
ABSOLUTE = {"colour_measured", "species_margin"}
STRETCHED = {"recurrence"}

# Under this margin the top two get a second look on crops; one is still always chosen (ADR-0026).
CLOSE = 0.1

# The measured-colour vote: each mask pixel takes its nearest palette colour
# (CIELAB distance), and a listing's colour word names the palette entries
# that count for it. "A and B" scores the smaller share of its two parts.
PALETTE = {
    "black": (25, 25, 25), "charcoal": (60, 60, 65), "grey": (110, 110, 115), "silver": (170, 170, 175),
    "white": (240, 240, 240), "cream": (225, 210, 180), "tan": (195, 150, 105), "fawn": (170, 120, 80),
    "orange": (220, 130, 55), "brown": (110, 75, 50), "darkbrown": (70, 50, 35),
    "green": (90, 150, 60), "darkgreen": (50, 90, 40), "pink": (220, 160, 160),
}
COLOUR_SETS = {
    "black": {"black", "charcoal"},
    "grey": {"charcoal", "grey", "silver"},
    "white": {"white", "cream", "silver"},
    "tan": {"tan", "fawn", "cream"},
    "orange": {"orange", "tan", "fawn"},
    "brown": {"brown", "darkbrown", "fawn", "tan", "orange"},
    "brown tabby": {"brown", "darkbrown", "grey", "charcoal", "black", "fawn"},
    "green": {"green", "darkgreen"},
}


# ---------------------------------------------------------------- photos

def photo_path(ref: str) -> Path:
    kind, rel = ref.split(":", 1)
    return (CREW if kind == "crew" else PHOTOS / "commons") / rel


def load(ref: str):
    from PIL import Image, ImageOps
    im = Image.open(photo_path(ref))
    # A Commons JPEG can carry an EXIF block Pillow cannot parse (two of the LoRA set's, 2026-10-27); it is then read as it lies.
    try:
        im = ImageOps.exif_transpose(im)
    except (SyntaxError, ValueError):
        pass
    im = im.convert("RGB")
    im.thumbnail((LONG_SIDE, LONG_SIDE))
    return im


def key(listing: str, ref: str) -> str:
    return f"{listing}__{Path(ref.split(':', 1)[1]).stem}"


def box_id(box) -> str:
    return hashlib.sha1(",".join(str(round(v)) for v in box).encode()).hexdigest()[:12]


def others(species: str) -> list[str]:
    return [s for s in COMMON if s != species]


# ---------------------------------------------------------------- geometry

def area(a) -> float:
    return max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0


def inside(a, b) -> float:
    """Share of box a's area that lies inside box b."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    return ix * iy / area(a) if area(a) > 0 else 0.0


def prefilter(raw: list[dict], floor: float) -> list[dict]:
    best = max([c["species"] for c in raw], default=0.0)
    return [c for c in raw if c["species"] >= floor and c["species"] >= RELATIVE * best]


def candidates(pool: list[dict], overlap, species: str) -> tuple[list[dict], list[dict]]:
    """Other species, then groups, then duplicates, then parts; returns (kept, dropped-with-reason).

    A group box (two inner boxes apart, whose outlines share under half the
    smaller, per `overlap`) must never win — it hands the painter two animals
    — and goes before duplicates, or it swallows its animal's own box
    (ADR-0026).
    """
    dropped = []
    if species in COMMON:
        mistaken = [c for c in pool if c.get("other", 0.0) > c["species"]]
        # Never empties the pool: "always choose one" outranks the check.
        if len(mistaken) < len(pool):
            pool = [c for c in pool if c not in mistaken]
            dropped = [{**c, "why": "other-species"} for c in mistaken]
    groups = set()
    for i, big in enumerate(pool):
        kids = [j for j, small in enumerate(pool)
                if j != i and inside(small["box"], big["box"]) > 0.8 and area(small["box"]) > 0.15 * area(big["box"])]
        if any(iou(pool[a]["box"], pool[b]["box"]) < 0.3 and inside(pool[a]["box"], pool[b]["box"]) < 0.5
               and inside(pool[b]["box"], pool[a]["box"]) < 0.5 and overlap(pool[a]["box"], pool[b]["box"]) < 0.5
               for a in kids for b in kids if a < b):
            groups.add(i)
    dropped += [{**pool[i], "why": "group"} for i in groups]
    dedup: list[dict] = []
    for c in sorted((c for i, c in enumerate(pool) if i not in groups), key=lambda c: -c["species"]):
        if all(iou(c["box"], k["box"]) < 0.5 for k in dedup):
            dedup.append(c)
    marked: dict[int, str] = {}
    for o, outer in enumerate(dedup):
        for n, inner in enumerate(dedup):
            if o != n and area(inner["box"]) < area(outer["box"]) and inside(inner["box"], outer["box"]) > 0.8:
                if outer["species"] >= 0.5 * inner["species"]:
                    marked.setdefault(n, "part")
                else:
                    marked.setdefault(o, "loose")
    dropped += [{**dedup[i], "why": why} for i, why in marked.items()]
    kept = [c for i, c in enumerate(dedup) if i not in marked]
    return sorted(kept, key=lambda c: -c["species"])[:10], dropped


# ---------------------------------------------------------------- stage 1: detectors (raw, cached)

_owl = {}


def owl():
    if not _owl:
        from transformers import Owlv2ForObjectDetection, Owlv2Processor
        _owl["proc"] = Owlv2Processor.from_pretrained(MODELS / "owlv2-base-patch16-ensemble")
        _owl["model"] = Owlv2ForObjectDetection.from_pretrained(MODELS / "owlv2-base-patch16-ensemble").eval()
    return _owl["proc"], _owl["model"]


def owl_ask(im, species: str, colour: str, floor: float) -> dict:
    """One OWLv2 pass: per box, the species, colour, head and other-species scores, boxes in the image's pixels."""
    import torch
    proc, model = owl()
    queries = [f"a photo of a {species}", f"a photo of a {colour} {species}", f"a photo of the head of a {species}"]
    queries += [f"a photo of a {o}" for o in others(species)]
    inputs = proc(text=[queries], images=im, return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs)
    probs = out.logits[0].sigmoid()
    side = max(im.size)  # OWLv2 pads to a square at the bottom and right before resizing
    boxes = [[max(0.0, (cx - w / 2) * side), max(0.0, (cy - h / 2) * side), min(im.width, (cx + w / 2) * side), min(im.height, (cy + h / 2) * side)]
             for cx, cy, w, h in out.pred_boxes[0].tolist()]
    return {
        "species": [{"box": boxes[i], "species": float(probs[i, 0]), "colour_prompt": float(probs[i, 1]),
                     "other": float(probs[i, 3:].max()) if probs.shape[1] > 3 else 0.0}
                    for i in range(len(boxes)) if probs[i, 0] > floor],
        "heads": sorted([{"box": boxes[i], "score": float(probs[i, 2])} for i in range(len(boxes)) if probs[i, 2] > 0.05],
                        key=lambda h: -h["score"])[:30],
    }


def owlv2(photos: dict) -> dict:
    found = {}
    for k, (listing, ref, im) in photos.items():
        found[k] = owl_ask(im, listing["species"], listing["colour"], 0.03)
        print(f"  owlv2 {k}: {len(found[k]['species'])} raw boxes", flush=True)
    return found


def grounding_dino(photos: dict) -> dict:
    import torch
    from transformers import AutoProcessor, GroundingDinoForObjectDetection
    proc = AutoProcessor.from_pretrained(MODELS / "grounding-dino-tiny")
    model = GroundingDinoForObjectDetection.from_pretrained(MODELS / "grounding-dino-tiny").eval()

    def ask(im, text: str, threshold: float) -> list[dict]:
        inputs = proc(images=im, text=text, return_tensors="pt")
        with torch.no_grad():
            out = model(**inputs)
        res = proc.post_process_grounded_object_detection(out, inputs.input_ids, threshold=threshold, text_threshold=threshold,
                                                          target_sizes=[(im.height, im.width)])[0]
        return [{"box": b, "score": float(s)} for b, s in zip(res["boxes"].tolist(), res["scores"].tolist())]

    found = {}
    for k, (listing, ref, im) in photos.items():
        sp, colour = listing["species"], listing["colour"]
        species = ask(im, f"a {sp}.", 0.12)
        coloured = ask(im, f"a {colour} {sp}.", 0.1)
        found[k] = {
            "species": [{"box": s["box"], "species": s["score"],
                         "colour_prompt": max([c["score"] for c in coloured if iou(c["box"], s["box"]) >= 0.5], default=0.0)}
                        for s in species],
            "heads": sorted(ask(im, f"the head of a {sp}.", 0.12), key=lambda h: -h["score"])[:30],
        }
        print(f"  grounding-dino {k}: {len(found[k]['species'])} raw boxes", flush=True)
    return found


def rtdetr(photos: dict) -> dict:
    import torch
    from transformers import AutoImageProcessor, RTDetrV2ForObjectDetection
    proc = AutoImageProcessor.from_pretrained(MODELS / "rtdetr_v2_r18vd")
    model = RTDetrV2ForObjectDetection.from_pretrained(MODELS / "rtdetr_v2_r18vd").eval()
    found = {}
    for k, (listing, ref, im) in photos.items():
        inputs = proc(images=im, return_tensors="pt")
        with torch.no_grad():
            out = model(**inputs)
        res = proc.post_process_object_detection(out, threshold=0.4, target_sizes=[(im.height, im.width)])[0]
        found[k] = [{"box": b, "score": float(s), "label": model.config.id2label[int(l)]}
                    for b, s, l in zip(res["boxes"].tolist(), res["scores"].tolist(), res["labels"].tolist())]
        print(f"  rtdetr {k}: {', '.join(d['label'] for d in found[k]) or 'nothing'}", flush=True)
    return found


# ---------------------------------------------------------------- stage 2: pools per pipeline

def pools(raw: dict, photos: dict) -> dict:
    """{pipeline: {photo: {"pool", "heads"}}}: each detector's boxes past the floors, and both pooled."""
    out = {}
    for name in PIPELINES:
        out[name] = {}
        for k in photos:
            if name != "pooled":
                r = raw[name][k]
                out[name][k] = {"pool": [dict(c, source=name) for c in prefilter(r["species"], FLOOR[name])],
                                "heads": [dict(h, source=name) for h in r["heads"]]}
                continue
            pool, heads = [], []
            for det in ("owlv2", "grounding-dino"):
                r = raw[det][k]
                # The two detectors score on different scales; each is divided by its own best box in the photo.
                top = max([c["species"] for c in r["species"]], default=1.0) or 1.0
                ctop = max([c["colour_prompt"] for c in r["species"]], default=1.0) or 1.0
                pool += [dict(c, source=det, species=c["species"] / top, colour_prompt=c["colour_prompt"] / ctop,
                              other=c.get("other", 0.0) / top)
                         for c in r["species"] if c["species"] >= FLOOR[det]]
                htop = max([h["score"] for h in r["heads"]], default=1.0) or 1.0
                heads += [dict(h, source=det, score=h["score"] / htop) for h in r["heads"]]
            out[name][k] = {"pool": prefilter(pool, 0.0), "heads": sorted(heads, key=lambda h: -h["score"])}
    return out


# ---------------------------------------------------------------- stage 3: outlines and colour (cached per box)

def to_lab(rgb):
    import numpy as np
    c = rgb.astype("float64") / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    xyz = c @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def shares(im, mask) -> dict:
    """The share of the mask's pixels nearest each palette colour."""
    import numpy as np
    px = np.asarray(im)[mask]
    if len(px) == 0:
        return {}
    if len(px) > 60000:
        px = px[np.random.default_rng(0).choice(len(px), 60000, replace=False)]
    names = list(PALETTE)
    pal = to_lab(np.array([PALETTE[n] for n in names]))
    nearest = np.argmin(((to_lab(px)[:, None, :] - pal[None, :, :]) ** 2).sum(-1), axis=1)
    counts = np.bincount(nearest, minlength=len(names)) / len(px)
    return {n: round(float(c), 4) for n, c in zip(names, counts) if c > 0}


def colour_score(colour: str, share: dict) -> float:
    parts = colour.split(" and ")
    got = [sum(share.get(p, 0.0) for p in COLOUR_SETS[part]) for part in parts]
    return min(got) * len(parts) if len(parts) > 1 else got[0]


def outline(photos: dict, wanted: dict, cache: dict) -> dict:
    import numpy as np
    import torch
    from PIL import Image
    from transformers import Sam2Model, Sam2Processor
    todo = {k: [b for b in boxes if box_id(b) not in cache.get(k, {})] for k, boxes in wanted.items()}
    if not any(todo.values()):
        return cache
    proc = Sam2Processor.from_pretrained(MODELS / "sam2.1-hiera-small")
    model = Sam2Model.from_pretrained(MODELS / "sam2.1-hiera-small").eval()
    (OUT / "masks").mkdir(parents=True, exist_ok=True)
    for k, boxes in todo.items():
        if not boxes:
            continue
        listing, ref, im = photos[k]
        for start in range(0, len(boxes), 16):
            chunk = boxes[start:start + 16]
            inputs = proc(images=im, input_boxes=[chunk], return_tensors="pt")
            with torch.no_grad():
                out = model(**inputs, multimask_output=False)
            masks = proc.post_process_masks(out.pred_masks, inputs["original_sizes"])[0]
            for i, b in enumerate(chunk):
                m = masks[i, 0].numpy().astype(bool)
                Image.fromarray((m * 255).astype(np.uint8)).save(OUT / "masks" / f"{k}__{box_id(b)}.png")
                cache.setdefault(k, {})[box_id(b)] = {"area": float(m.mean()), "shares": shares(im, m)}
        print(f"  sam2 {k}: {len(boxes)} masks", flush=True)
    return cache


_masks: dict = {}


def mask(k: str, box):
    import numpy as np
    from PIL import Image
    mid = (k, box_id(box))
    if mid not in _masks:
        _masks[mid] = np.asarray(Image.open(OUT / "masks" / f"{k}__{box_id(box)}.png")) > 0
    return _masks[mid]


def mask_overlap(k: str):
    def overlap(a, b) -> float:
        ma, mb = mask(k, a), mask(k, b)
        smaller = min(ma.sum(), mb.sum())
        return float((ma & mb).sum() / smaller) if smaller else 0.0
    return overlap


# ---------------------------------------------------------------- stage 4: embeddings (cached per box)

def embed(photos: dict, wanted: dict, cache: dict) -> dict:
    import torch
    from transformers import CLIPImageProcessor
    todo = {k: [b for b in boxes if box_id(b) not in cache.get(k, {})] for k, boxes in wanted.items()
            if len(photos[k][0]["photos"]) > 1}
    if not any(todo.values()):
        return cache
    import likeness
    clip = likeness.encoder()
    proc = CLIPImageProcessor(size={"shortest_edge": 224}, crop_size={"height": 224, "width": 224}, do_center_crop=True,
                              image_mean=[0.48145466, 0.4578275, 0.40821073], image_std=[0.26862954, 0.26130258, 0.27577711])
    for k, boxes in todo.items():
        listing, ref, im = photos[k]
        for x0, y0, x1, y1 in boxes:
            with torch.no_grad():
                v = clip(**proc(images=im.crop((int(x0), int(y0), int(x1), int(y1))), return_tensors="pt")).image_embeds[0]
            cache.setdefault(k, {})[box_id([x0, y0, x1, y1])] = (v / v.norm()).tolist()
        print(f"  vit-h {k}: {len(boxes)} crops", flush=True)
    return cache


# ---------------------------------------------------------------- stage 5: votes

def minmax(vals: list[float]) -> list[float]:
    lo, hi = min(vals), max(vals)
    return [0.5] * len(vals) if hi - lo < 1e-9 else [(v - lo) / (hi - lo) for v in vals]


def to_best(vals: list[float]) -> list[float]:
    hi = max(vals)
    return [1.0] * len(vals) if hi <= 0 else [v / hi for v in vals]


def scale(vote: str, vals: list[float]) -> list[float]:
    return vals if vote in ABSOLUTE else (minmax if vote in STRETCHED else to_best)(vals)


def totals(cands: list[dict]) -> None:
    votes = [v for v in WEIGHTS if all(c.get(v) is not None for c in cands)]
    norm = {v: scale(v, [c[v] for c in cands]) for v in votes}
    for i, c in enumerate(cands):
        c["total"] = sum(WEIGHTS[v] * norm[v][i] for v in votes) / sum(WEIGHTS[v] for v in votes)


def closer_look(im, listing: dict, box) -> dict:
    """OWLv2 again on the candidate's own crop, where the colour words have fewer pixels to bind to:
    the best box covering most of the crop gives the candidate's species, colour and other-species scores."""
    pad = 0.1 * max(box[2] - box[0], box[3] - box[1])
    x0, y0 = max(0, int(box[0] - pad)), max(0, int(box[1] - pad))
    x1, y1 = min(im.width, int(box[2] + pad)), min(im.height, int(box[3] + pad))
    crop = im.crop((x0, y0, x1, y1))
    found = owl_ask(crop, listing["species"], listing["colour"], 0.0)["species"]
    whole = [c for c in found if area(c["box"]) > 0.4 * crop.width * crop.height] or found
    best = max(whole, key=lambda c: c["species"])
    return {"species": best["species"], "colour_prompt": best["colour_prompt"], "other": best["other"]}


def score(listings: dict, photos: dict, cands_by: dict, sam: dict, emb: dict, truth: dict, looks: dict) -> list[dict]:
    import numpy as np
    records = []
    for name, per_photo in cands_by.items():
        for k, (listing, ref, im) in photos.items():
            found = per_photo[k]
            cands = [dict(c) for c in found["candidates"]]
            rec = {"pipeline": name, "photo": k, "listing": next(l for l, v in listings.items() if v is listing),
                   "colour": listing["colour"], "species": listing["species"], "subject": listing["subject"],
                   "candidates": cands, "dropped": found["dropped"]}
            records.append(rec)
            if not cands:
                rec["chosen"] = None
                continue
            siblings = [o for o in photos if o != k and photos[o][0] is listing]
            for c in cands:
                bid = box_id(c["box"])
                c["shares"] = sam[k][bid]["shares"]
                c["colour_measured"] = colour_score(listing["colour"], c["shares"])
                c["species_margin"] = c["species"] / (c["species"] + c.get("other", 0.0)) if c["species"] > 0 else 0.0
                cx, cy = (c["box"][0] + c["box"][2]) / 2 / im.width, (c["box"][1] + c["box"][3]) / 2 / im.height
                c["size_centre"] = area(c["box"]) / (im.width * im.height) * (1 - min(1.0, 2 * ((cx - 0.5) ** 2 + (cy - 0.5) ** 2) ** 0.5))
                if siblings and k in emb:
                    v = np.array(emb[k][bid])
                    sims = [max(float(v @ np.array(emb[o][box_id(d["box"])])) for d in per_photo[o]["candidates"])
                            for o in siblings if per_photo[o]["candidates"]]
                    c["recurrence"] = float(np.mean(sims)) if sims else None
            totals(cands)
            order = sorted(range(len(cands)), key=lambda i: -cands[i]["total"])
            margin = cands[order[0]]["total"] - cands[order[1]]["total"] if len(cands) > 1 else None
            if margin is not None and margin < CLOSE and name != "grounding-dino":
                before = order[0]
                for i in order[:2]:
                    lk = f"{k}|{box_id(cands[i]['box'])}"
                    if lk not in looks:
                        looks[lk] = closer_look(im, listing, cands[i]["box"])
                    cands[i].update(looks[lk])
                    cands[i]["species_margin"] = cands[i]["species"] / (cands[i]["species"] + cands[i]["other"]) if cands[i]["species"] > 0 else 0.0
                pair = [cands[i] for i in order[:2]]
                totals(pair)
                if pair[1]["total"] > pair[0]["total"]:
                    order[0], order[1] = order[1], order[0]
                rec["second_look"] = {"margin_before": margin, "changed": order[0] != before}
                margin = abs(pair[0]["total"] - pair[1]["total"])
            # Always one: an unclear subject is never the framed photo (ADR-0026).
            chosen = cands[order[0]]
            rec["chosen"] = order[0]
            rec["margin"] = margin
            b = chosen["box"]
            heads = [h for h in found["heads"] if inside(h["box"], b) > 0.8 and area(h["box"]) < 0.7 * area(b)]
            rec["head"] = max(heads, key=lambda h: h["score"]) if heads else None
            if k in truth:
                t = truth[k]
                rec["iou_truth"] = iou([b[0] / im.width, b[1] / im.height, b[2] / im.width, b[3] / im.height], t)
    return records


# ---------------------------------------------------------------- overlays

def overlays(records: list[dict], photos: dict, rt: dict) -> None:
    import numpy as np
    from PIL import Image, ImageDraw
    heads = []
    for rec in records:
        listing, ref, im = photos[rec["photo"]]
        canvas = im.copy()
        if rec["chosen"] is not None:
            c = rec["candidates"][rec["chosen"]]
            m = mask(rec["photo"], c["box"])
            arr = np.asarray(canvas).copy()
            arr[m] = (0.6 * arr[m] + 0.4 * np.array([60, 200, 90])).astype("uint8")
            canvas = Image.fromarray(arr)
        d = ImageDraw.Draw(canvas)
        w = max(2, im.width // 300)
        fs = max(14, im.width // 45)
        for c in rec["dropped"]:
            if c["why"] in ("group", "loose", "other-species"):
                d.rectangle(c["box"], outline=(170, 90, 255), width=w)
                d.text((c["box"][0] + 6, c["box"][3] - fs - 6), c["why"], fill=(200, 140, 255), font_size=fs)
        for i, c in enumerate(rec["candidates"]):
            chosen = i == rec["chosen"]
            d.rectangle(c["box"], outline=(40, 220, 80) if chosen else (230, 60, 60), width=w * (2 if chosen else 1))
            d.text((c["box"][0] + 6, c["box"][1] + 6), f"#{i} {c['total']:.2f}", fill=(255, 255, 0), font_size=fs)
        if rec.get("head"):
            d.rectangle(rec["head"]["box"], outline=(255, 210, 0), width=w)
            hb = rec["head"]["box"]
            if rec["pipeline"] == PIPELINES[0]:
                heads.append((rec["photo"], im.crop((int(hb[0]), int(hb[1]), int(hb[2]), int(hb[3])))))
        margin = f"{rec['margin']:.2f}" if rec.get("margin") is not None else ("only one" if rec["chosen"] is not None else "-")
        look = " | second look" + (", changed" if rec["second_look"]["changed"] else "") if rec.get("second_look") else ""
        d.rectangle([0, 0, im.width, max(28, im.width // 32)], fill=(0, 0, 0))
        d.text((8, 4), f"{rec['listing']}: {rec['colour']} {rec['species']} | margin {margin}{look}", fill="white", font_size=max(14, im.width // 50))
        dst = OUT / rec["pipeline"] / f"{rec['photo']}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        canvas.thumbnail((900, 900))
        canvas.save(dst, quality=85)
    for k, dets in rt.items():
        listing, ref, im = photos[k]
        canvas = im.copy()
        d = ImageDraw.Draw(canvas)
        for det in dets:
            d.rectangle(det["box"], outline=(80, 160, 255), width=max(2, im.width // 300))
            d.text((det["box"][0] + 6, det["box"][1] + 6), f"{det['label']} {det['score']:.2f}", fill=(255, 255, 0), font_size=max(14, im.width // 45))
        dst = OUT / "rtdetr" / f"{k}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        canvas.thumbnail((900, 900))
        canvas.save(dst, quality=85)
    cell, cols = 240, 6
    sheet = Image.new("RGB", (cell * cols, (cell + 16) * max(1, (len(heads) + cols - 1) // cols)), "white")
    d = ImageDraw.Draw(sheet)
    for i, (k, crop) in enumerate(heads):
        crop.thumbnail((cell, cell))
        x, y = (i % cols) * cell, (i // cols) * (cell + 16)
        sheet.paste(crop, (x, y))
        d.text((x + 3, y + cell + 2), k[:34], fill="black")
    sheet.save(OUT / "sheet-heads.jpg", quality=85)


def sheets() -> None:
    from PIL import Image, ImageDraw
    for sub in PIPELINES + ["rtdetr"]:
        files = sorted((OUT / sub).glob("*.jpg"))
        cell, cols = 450, 4
        sheet = Image.new("RGB", (cell * cols, (cell + 18) * max(1, (len(files) + cols - 1) // cols)), "white")
        d = ImageDraw.Draw(sheet)
        for i, f in enumerate(files):
            im = Image.open(f)
            im.thumbnail((cell, cell))
            x, y = (i % cols) * cell, (i // cols) * (cell + 18)
            sheet.paste(im, (x, y))
            d.text((x + 4, y + cell + 3), f.stem[:60], fill="black")
        sheet.save(OUT / f"sheet-{sub}.jpg", quality=82)
        print(f"sheet: {OUT / f'sheet-{sub}.jpg'} ({len(files)} photos)")


# ---------------------------------------------------------------- main

def cached(name: str, fresh: bool, fn):
    path = OUT / "cache" / f"{name}.json"
    if path.exists() and not fresh:
        return json.loads(path.read_text())
    t = time.time()
    print(f"{name} …", flush=True)
    value = fn()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    print(f"{name}: {time.time() - t:.0f}s", flush=True)
    return value


def grow(name: str, fresh: bool, fn):
    """A per-box cache that only computes the boxes it has not seen."""
    path = OUT / "cache" / f"{name}.json"
    have = {} if fresh or not path.exists() else json.loads(path.read_text())
    t = time.time()
    value = fn(have)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    print(f"{name}: {time.time() - t:.0f}s", flush=True)
    return value


def main() -> None:
    import torch
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true")
    args = ap.parse_args()
    torch.set_num_threads(4)
    spec = json.loads((HERE / "explore" / os.environ.get("DETECT_SPEC", "detect.json")).read_text())
    listings = spec["listings"]
    boxes = json.loads((HERE / "explore" / "boxes.json").read_text())
    photos, truth = {}, {}
    for name, listing in listings.items():
        for ref in listing["photos"]:
            k = key(name, ref)
            photos[k] = (listing, ref, load(ref))
            box = boxes.get(str(Path(ref.split(":", 1)[1]).with_suffix("")))
            if ref.startswith("crew:") and box:
                truth[k] = box["subject"]
    print(f"{len(photos)} photos, {len(listings)} listings, {len(truth)} with a hand-drawn subject box; pipelines {PIPELINES}", flush=True)

    raw = {"owlv2": cached("owlv2-raw-v4", args.fresh, lambda: owlv2(photos))}
    if any(p in PIPELINES for p in ("grounding-dino", "pooled")):
        raw["grounding-dino"] = cached("grounding-dino-raw", args.fresh, lambda: grounding_dino(photos))
    rt = cached("rtdetr", args.fresh, lambda: rtdetr(photos))
    pooled = pools(raw, photos)
    wanted = {k: [] for k in photos}
    for per_photo in pooled.values():
        for k, f in per_photo.items():
            for c in f["pool"]:
                if box_id(c["box"]) not in {box_id(b) for b in wanted[k]}:
                    wanted[k].append(c["box"])
    sam = grow("sam2-boxes", args.fresh, lambda have: outline(photos, wanted, have))
    cands_by = {name: {} for name in pooled}
    for name, per_photo in pooled.items():
        for k, f in per_photo.items():
            kept, dropped = candidates(f["pool"], mask_overlap(k), photos[k][0]["species"])
            cands_by[name][k] = {"candidates": kept, "dropped": dropped, "heads": f["heads"]}
    chosen_boxes = {k: [c["box"] for per in cands_by.values() for c in per[k]["candidates"]] for k in photos}
    emb = grow("vith-boxes", args.fresh, lambda have: embed(photos, chosen_boxes, have))
    looks_path = OUT / "cache" / "owlv2-looks.json"
    looks = {} if args.fresh or not looks_path.exists() else json.loads(looks_path.read_text())
    records = score(listings, photos, cands_by, sam, emb, truth, looks)
    looks_path.write_text(json.dumps(looks))
    with (OUT / "results.jsonl").open("w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    overlays(records, photos, rt)
    sheets()
    for r in records:
        margin = "-" if r.get("margin") is None else f"{r['margin']:.2f}"
        t = f" iou-truth {r['iou_truth']:.2f}" if "iou_truth" in r else ""
        why = {}
        for c in r["dropped"]:
            why[c["why"]] = why.get(c["why"], 0) + 1
        look = f" second-look(before {r['second_look']['margin_before']:.2f}{', changed' if r['second_look']['changed'] else ''})" if r.get("second_look") else ""
        print(f"{r['pipeline']:15} {r['photo'][:58]:58} cands {len(r['candidates'])} dropped {why} chose #{r['chosen']} margin {margin}{look}{t}")


if __name__ == "__main__":
    main()
