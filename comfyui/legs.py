"""Count a dog's legs and name each one from where its head is (batch 8e, doc/plans/base-model-candidates.md).

Runs in the `explore` container on the CPU:

    npm run explore:legs -- <batch> [--prompt <name,...>]   # count and name, and pick the leg to remove
    npm run explore:legmask -- <batch> --legs                # SAM and LaMa take that leg out
    npm run explore:legs -- <batch> --after                  # count again on LaMa's result

Reads each of the batch's Commons photos and its paintings (only those
painted with --prompt, default the three-quarter sit and stand). OWLv2 finds the dog, its
head and its tail; it cannot find single legs (asked for a leg or a paw it
boxes the whole dog), so SAM 2.1 outlines the dog and the feet are read from
the outline: each sole is a downward-facing edge low on the dog, a paw wide,
with a leg rather than the body above it, and SAM's part at each sole merges
a hock with the paw below it. The head's side of the picture names the flank
in view (head on the right: the dog's right side), the two feet nearest the
head end are the front pair, and of a pair the lower foot is the near leg.
Where four legs are named and the spec's `missing` says which leg the
animal lacks ("left front", or only "hind" when the side is not known, and
then the near one, the flank in view), the leg is traced in the outline
from its sole up to where it widens into the body; remove.json lists each
traced mask (legs/masks/) and its box for legmask.py. Writes legs.json and legs.jpg (legs-after.* with --after)
to the batch's explore folder under legs/.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUT = Path("/home/comfy/ComfyUI/input")
OUTPUT = Path("/home/comfy/ComfyUI/output")
PHOTOS = Path("/home/comfy/photos/commons")
EXPLORE = Path("/home/comfy/explore")
MODELS = Path("/home/comfy/ComfyUI/models/detect")

QUERIES = {
    "dog": "a photo of a {kind}",
    "head": "the head of a {kind}",
    "tail": "the tail of a {kind}",
}
FLOOR = {"dog": 0.1, "head": 0.02, "tail": 0.02}
LEG_ZONE = 0.3     # legs are counted in the lowest share of the dog's height; a standing dog's belly sits above it
ABOVE = 0.06       # a paw's leg is checked this share of the dog's height above its sole ...
LEG_RUN = 0.35     # ... where the outline must be narrower than this share of the dog's width: a leg, or a near and a far leg drawn together
SAME_LEG = 0.5     # two soles whose SAM parts share this much of the smaller are one leg (a hock above its paw)
MIN_FOOT = 0.04    # a sole narrower than this share of the dog's width is a tuft of fur, not a paw


def area(a) -> float:
    return max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])


def iou(a, b) -> float:
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    i = area([x0, y0, x1, y1])
    return i / (area(a) + area(b) - i) if i else 0.0


def nms(found: list[dict], limit: float = 0.4) -> list[dict]:
    kept: list[dict] = []
    for f in sorted(found, key=lambda f: -f["score"]):
        if all(iou(f["box"], k["box"]) < limit for k in kept):
            kept.append(f)
    return kept


def ask(proc, model, im, kind: str) -> dict:
    import torch
    names = list(QUERIES)
    inputs = proc(text=[[QUERIES[n].format(kind=kind) for n in names]], images=im, return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs)
    probs = out.logits[0].sigmoid()
    side = max(im.size)  # OWLv2 pads to a square at the bottom and right before resizing
    boxes = [[max(0.0, (cx - w / 2) * side), max(0.0, (cy - h / 2) * side), min(im.width, (cx + w / 2) * side), min(im.height, (cy + h / 2) * side)]
             for cx, cy, w, h in out.pred_boxes[0].tolist()]
    found = {}
    for j, n in enumerate(names):
        found[n] = nms([{"box": boxes[i], "score": float(probs[i, j])} for i in range(len(boxes)) if probs[i, j] > FLOOR[n]])
    return found


def part(found: list[dict], dog) -> dict | None:
    """The best box inside the dog and well smaller than it: OWLv2's top head is sometimes the whole dog."""
    for f in found:
        inside = area([max(f["box"][0], dog[0]), max(f["box"][1], dog[1]), min(f["box"][2], dog[2]), min(f["box"][3], dog[3])])
        if inside > 0.7 * area(f["box"]) and area(f["box"]) < 0.35 * area(dog):
            return f
    return None


def legs(m, tail) -> tuple[list[dict], int]:
    """The dog's feet: the soles in its outline, each a run of downward-facing edge in the leg zone at least a paw wide."""
    import numpy as np
    from scipy import ndimage
    ys, xs = np.nonzero(m)
    bottom, top = ys.max(), ys.min()
    height, width = bottom - top, xs.max() - xs.min()
    row = int(bottom - LEG_ZONE * height)
    # a far leg drawn against a near one is one column of outline all the way down, but its sole still ends at its own height (batch 8e)
    sole = m & ~np.vstack([m[1:], np.zeros((1, m.shape[1]), bool)])
    sole[:row] = False
    lab, n = ndimage.label(ndimage.binary_dilation(sole, iterations=2), structure=np.ones((3, 3)))
    found = []
    for i in range(1, n + 1):
        cy, cx = np.nonzero((lab == i) & sole)
        if cx.max() - cx.min() < MIN_FOOT * width:
            continue
        # a sole with the whole body just above it is the belly or the chest's fringe, not a paw
        y = int(cy.max() - ABOVE * height)
        run = ndimage.label(m[y])[0]
        here = run[int(cx.mean())]
        if not here or (run == here).sum() > LEG_RUN * width:
            continue
        if tail and tail["box"][0] <= cx.mean() <= tail["box"][2] and tail["box"][1] <= cy.max() <= tail["box"][3]:
            continue
        found.append({"x": float(cx.mean()), "foot": float(cy.max()), "x0": int(cx.min()), "x1": int(cx.max())})
    return sorted(found, key=lambda f: -f["foot"]), row


def one_per_leg(sam, sproc, im, m, found: list[dict]) -> list[dict]:
    """SAM asked for the part just above each sole: a hock and the paw below it give back the same leg, a far foot beside a near one a different leg."""
    import numpy as np
    import torch
    if len(found) < 2:
        return found
    ys = np.nonzero(m)[0]
    lift = 0.03 * (ys.max() - ys.min())
    points = [[[[f["x"], f["foot"] - lift]] for f in found]]
    inputs = sproc(images=im, input_points=points, input_labels=[[[1] for _ in found]], return_tensors="pt")
    with torch.no_grad():
        out = sam(**inputs, multimask_output=True)
    masks = sproc.post_process_masks(out.pred_masks, inputs["original_sizes"])[0].numpy().astype(bool)
    legs_ = []
    for i, f in enumerate(found):
        # the smallest of SAM's three answers that is more than a paw: the leg, not the toes nor the dog
        sizes = [(k.sum(), j) for j, k in enumerate(masks[i]) if k.sum() > 0.002 * m.size and (k & m).sum() > 0.8 * k.sum()]
        f["part"] = masks[i][min(sizes)[1]] if sizes else None
        legs_.append(f)
    feet: list[dict] = []
    for f in legs_:  # lowest sole first, so the paw is kept and its hock dropped
        def same(g):
            if f["part"] is None or g["part"] is None:
                return False
            inter = (f["part"] & g["part"]).sum()
            return inter > SAME_LEG * min(f["part"].sum(), g["part"].sum())
        if not any(same(g) for g in feet):
            feet.append(f)
    for f in feet:
        f.pop("part", None)
    return sorted(feet, key=lambda f: f["x"])


def centre(box) -> tuple[float, float]:
    return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2


def name(found: list[dict], head, tail, m) -> dict:
    """Of four feet the two nearest the head end are the front pair, of three the odd one out is alone at its end; of a pair the lower foot is the near leg; the head's side of the picture is the flank in view."""
    import itertools
    import numpy as np
    hx = centre(head["box"])[0]
    cx = float(np.nonzero(m)[1].mean())
    facing = "right" if hx > cx else "left"
    tx = centre(tail["box"])[0] if tail else 2 * cx - hx
    out = {"facing": facing, "tail_agrees": ((hx > tx) == (facing == "right")) if tail else None, "count": len(found)}
    def headward(group):
        x = sum(f["x"] for f in group) / len(group)
        return abs(x - hx) - abs(x - tx)
    def spread(group):
        return sum(abs(a["x"] - b["x"]) + abs(a["foot"] - b["foot"]) for a, b in itertools.combinations(group, 2))
    order = sorted(found, key=lambda f: -f["x"] if facing == "right" else f["x"])
    if len(found) == 4:
        # the two feet nearest the head end: a front and a hind foot can stand closer together than either pair (white dog 050)
        front, hind = order[:2], order[2:]
    elif len(found) == 3:
        pair = min(itertools.combinations(found, 2), key=spread)
        front, hind = sorted([list(pair), [f for f in found if f not in pair]], key=headward)
    else:
        for f in found:
            f["label"] = "?"
        return out
    near_flank, far_flank = facing, "left" if facing == "right" else "right"
    for group, end in ((front, "front"), (hind, "hind")):
        if len(group) == 2:
            near, far = sorted(group, key=lambda f: -f["foot"])
            near["label"], far["label"] = f"{near_flank} {end}", f"{far_flank} {end}"
        else:
            group[0]["label"] = f"{end} (side unknown)"
    out["front"], out["hind"] = len(front), len(hind)
    if len(found) == 3:
        out["missing"] = "front" if len(front) == 1 else "hind"
    return out


def target(found: list[dict], named: dict, missing: str | None) -> dict | None:
    """The painted leg the animal lacks: by name when the side is known, else the near one of the right end; none unless all four were found."""
    if not missing or named.get("count") != 4 or not named.get("facing"):
        return None
    end = "front" if "front" in missing else "hind"
    side = missing.split()[0] if " " in missing else named["facing"]
    return next((f for f in found if f.get("label") == f"{side} {end}"), None)


def leg_mask(m, f):
    """The leg above a foot, traced in the dog's outline from its sole up to where the outline widens into the body.

    SAM re-asked with the leg's box took only the white sock of a black leg (Danes 011, 018, 019 in batch 8a) and LaMa
    left the rest hanging, so the leg is cut from the outline itself, one row at a time (batch 8f).
    """
    import numpy as np
    from scipy import ndimage
    ys, xs = np.nonzero(m)
    width = xs.max() - xs.min()
    leg = np.zeros_like(m)
    x, half = int(f["x"]), (f["x1"] - f["x0"]) / 2
    for y in range(int(f["foot"]), int(ys.min()), -1):
        lab = ndimage.label(m[y])[0]
        here = lab[x]
        if not here:
            near = np.nonzero(lab)[0]
            if not len(near) or abs(near - x).min() > MIN_FOOT * width:
                break
            here = lab[near[abs(near - x).argmin()]]
        cols = np.nonzero(lab == here)[0]
        if len(cols) > LEG_RUN * width:
            break
        if len(cols) < LEG_RUN * width / 2:
            x, half = int(cols.mean()), max(half * 0.6, (cols.max() - cols.min()) / 2)
            leg[y, cols.min():cols.max() + 1] = True
        else:
            # a near and a far leg drawn together make one run twice as wide: keep to this leg's share of it
            lo, hi = max(cols.min(), int(x - half)), min(cols.max(), int(x + half))
            leg[y, lo:hi + 1] = True
    return leg


def leg_box(leg) -> list[float]:
    import numpy as np
    ys, xs = np.nonzero(leg)
    h, w = leg.shape
    return [xs.min() / w, ys.min() / h, (xs.max() + 1) / w, (ys.max() + 1) / h]


def main() -> None:
    import numpy as np
    import torch
    from PIL import Image, ImageDraw
    from transformers import Owlv2ForObjectDetection, Owlv2Processor, Sam2Model, Sam2Processor
    torch.set_num_threads(4)
    batch = sys.argv[1]
    after = "--after" in sys.argv
    prompts = (sys.argv[sys.argv.index("--prompt") + 1] if "--prompt" in sys.argv else "storybook_sit34,storybook_stand34").split(",")
    spec = json.loads((HERE / "explore" / f"{batch}.json").read_text())
    proc = Owlv2Processor.from_pretrained(MODELS / "owlv2-base-patch16-ensemble")
    model = Owlv2ForObjectDetection.from_pretrained(MODELS / "owlv2-base-patch16-ensemble").eval()
    sproc = Sam2Processor.from_pretrained(MODELS / "sam2.1-hiera-small")
    sam = Sam2Model.from_pretrained(MODELS / "sam2.1-hiera-small").eval()
    out_dir = EXPLORE / batch / "legs"
    items = []
    if after:
        removed = json.loads((out_dir / "remove.json").read_text())
        for animal, info in removed["animals"].items():
            for p in info["paintings"]:
                items.append((animal, Path(p["file"]).stem, INPUT / "legmask" / f"{Path(p['file']).stem}.lama.png", p))
    else:
        detected = json.loads((HERE / "explore" / "boxes-detected.json").read_text())
        for animal, info in spec["animals"].items():
            src = detected.get(f"{animal}/{Path(info['one'][0]).stem}", {}).get("_src", "")
            if src.startswith("commons:"):
                items.append((animal, "photo", PHOTOS / src.split(":", 1)[1], None))
        for line in (EXPLORE / batch / "runs.jsonl").read_text().splitlines():
            r = json.loads(line)
            if r.get("prompt") in prompts and r.get("output"):
                items.append((r["animal"], r["id"], OUTPUT / r["output"], None))
    remove: dict = {"animals": {}}
    records, tiles = [], []
    for animal, what, path, removed_leg in items:
        im = Image.open(path).convert("RGB")
        found = ask(proc, model, im, spec["animals"][animal]["kind"] if animal in spec["animals"] else "dog")
        dog = found["dog"][0]["box"]
        head, tail = part(found["head"], dog), part(found["tail"], dog)
        inputs = sproc(images=im, input_boxes=[[dog]], return_tensors="pt")
        with torch.no_grad():
            out = sam(**inputs, multimask_output=False)
        m = sproc.post_process_masks(out.pred_masks, inputs["original_sizes"])[0][0, 0].numpy().astype(bool)
        found_legs, row = legs(m, tail)
        found_legs = one_per_leg(sam, sproc, im, m, found_legs)
        named = name(found_legs, head, tail, m) if head else {"facing": None, "count": len(found_legs)}
        record = {"animal": animal, "what": what, "file": str(path), "dog": dog, "head": head, "tail": tail,
                  "row": row, "legs": found_legs, **named}
        leg = None
        if removed_leg:
            end = "front" if "front" in removed_leg["leg"] else "hind"
            record["removed"] = removed_leg["leg"]
            record["verdict"] = "three, the right end" if named.get("count") == 3 and named.get("missing") == end else "not three-legged as asked"
        elif what != "photo":
            missing = spec["animals"][animal].get("missing")
            leg = target(found_legs, named, missing)
            record["target"] = leg["label"] if leg else None
            record["why_not"] = None if leg or not missing else f"{named.get('count')} legs found" if named.get("count") != 4 else "no head"
            if leg:
                traced = leg_mask(m, leg)
                (out_dir / "masks").mkdir(parents=True, exist_ok=True)
                Image.fromarray((traced * 255).astype(np.uint8)).save(out_dir / "masks" / f"{path.stem}.leg.png")
                Image.fromarray((m * 255).astype(np.uint8)).save(out_dir / "masks" / f"{path.stem}.dog.png")
                remove["animals"].setdefault(animal, {"kind": spec["animals"][animal]["kind"], "paintings": []})["paintings"].append(
                    {"file": str(path.relative_to(OUTPUT)), "leg": leg["label"], "box": [round(v, 4) for v in leg_box(traced)],
                     "mask": f"{batch}/legs/masks/{path.stem}.leg.png", "dog": f"{batch}/legs/masks/{path.stem}.dog.png"})
        records.append(record)
        print(f"  {animal} {what[:44]}: {len(found_legs)} legs, facing {named.get('facing')}, tail agrees {named.get('tail_agrees')}, "
              f"front {named.get('front')} hind {named.get('hind')} missing {named.get('missing', '-')} | "
              + ", ".join(f.get("label", "?") for f in found_legs)
              + (f" | remove {leg['label']}" if leg else "") + (f" | {record['verdict']}" if removed_leg else ""), flush=True)
        a = np.asarray(im).copy()
        a[m] = (a[m] * 0.6 + np.array([90, 160, 230]) * 0.4).astype(np.uint8)
        shown = Image.fromarray(a)
        d = ImageDraw.Draw(shown)
        lw = max(2, im.width // 250)
        d.line([(dog[0], row), (dog[2], row)], fill=(250, 200, 0), width=lw)
        for b, c in ((head, (40, 110, 230)), (tail, (160, 60, 200))):
            if b:
                d.rectangle(b["box"], outline=c, width=lw)
        r_ = max(6, im.width // 90)
        for f in found_legs:
            d.ellipse([f["x"] - r_, f["foot"] - r_, f["x"] + r_, f["foot"] + r_], fill=(230, 40, 40))
        if leg:
            b = leg_box(leg_mask(m, leg))
            d.rectangle([b[0] * im.width, b[1] * im.height, b[2] * im.width, b[3] * im.height], outline=(230, 40, 40), width=lw)
        shown.thumbnail((480, 480))
        d = ImageDraw.Draw(shown)
        s = shown.width / im.width
        for f in found_legs:
            d.text((f["x"] * s - 20, f["foot"] * s + 4), f.get("label", "?"), fill=(0, 0, 0))
        d.text((4, 4), f"{len(found_legs)} legs, facing {named.get('facing')}" + (f", missing {named['missing']}" if "missing" in named else "")
               + (f", remove {leg['label']}" if leg else "") + (f" — {record['verdict']}" if removed_leg else ""), fill=(0, 0, 0))
        tiles.append(shown)
    out = out_dir
    out.mkdir(parents=True, exist_ok=True)
    stem = "legs-after" if after else "legs"
    (out / f"{stem}.json").write_text(json.dumps(records, indent=1))
    if not after:
        (out / "remove.json").write_text(json.dumps(remove, indent=1))
    cols = 4
    cell = 484
    sheet = Image.new("RGB", (cell * cols, cell * ((len(tiles) + cols - 1) // cols)), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * cell + 2, (i // cols) * cell + 2))
    sheet.save(out / f"{stem}.jpg", quality=85)
    print(f"sheet: {out / (stem + '.jpg')}")


if __name__ == "__main__":
    main()
