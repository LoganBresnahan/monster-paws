"""How the chosen animal is cut out for the painter: four ways side by side (ADR-0026, doc/plans/subject-detection.md).

Runs in the `explore` container on the CPU, after `npm run explore:detect`
has chosen an animal in each photo (DETECT_OUT, DETECT_SPEC as there):

    npm run explore:crops

For each chosen animal: the detector's box as it is; the box grown to its
SAM outline; that plus a margin; and SAM asked again with a looser box,
cut to the new outline. Growth never crosses into another candidate's box.
Output: crops-<n>.jpg sheets in DETECT_OUT.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import detect  # noqa: E402

MARGIN = 0.10   # share of the box's width and height added on each side
LOOSE = 0.20    # how much further SAM may look on the re-ask
TRIM = 0.02     # breathing room around the re-asked outline

METHODS = ["box", "outline", "outline + margin", "re-ask, looser box"]


def extent(mask):
    import numpy as np
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return [float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)]


def union(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def pad(box, share, w, h):
    dx, dy = (box[2] - box[0]) * share, (box[3] - box[1]) * share
    return [max(0.0, box[0] - dx), max(0.0, box[1] - dy), min(float(w), box[2] + dx), min(float(h), box[3] + dy)]


def fence(grown, chosen, others):
    """Pull each side of a grown box back to the near edge of any other animal it would now reach."""
    g = list(grown)
    for o in others:
        if detect.iou(o, chosen) > 0:
            continue  # already touching the chosen box: growth cannot avoid it
        if o[2] <= chosen[0] and o[2] > g[0]:
            g[0] = o[2]
        if o[0] >= chosen[2] and o[0] < g[2]:
            g[2] = o[0]
        if o[3] <= chosen[1] and o[3] > g[1]:
            g[1] = o[3]
        if o[1] >= chosen[3] and o[1] < g[3]:
            g[3] = o[1]
    return g


_sam = {}


def reask(im, box):
    import torch
    from transformers import Sam2Model, Sam2Processor
    if not _sam:
        _sam["proc"] = Sam2Processor.from_pretrained(detect.MODELS / "sam2.1-hiera-small")
        _sam["model"] = Sam2Model.from_pretrained(detect.MODELS / "sam2.1-hiera-small").eval()
    proc, model = _sam["proc"], _sam["model"]
    inputs = proc(images=im, input_boxes=[[box]], return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs, multimask_output=False)
    return proc.post_process_masks(out.pred_masks, inputs["original_sizes"])[0][0, 0].numpy().astype(bool)


def main() -> None:
    import torch
    from PIL import Image, ImageDraw
    torch.set_num_threads(4)
    spec = json.loads((HERE / "explore" / os.environ.get("DETECT_SPEC", "detect.json")).read_text())
    refs = {detect.key(name, ref): ref for name, listing in spec["listings"].items() for ref in listing["photos"]}
    pipeline = detect.PIPELINES[0]
    rows = []
    for line in (detect.OUT / "results.jsonl").read_text().splitlines():
        r = json.loads(line)
        if r["pipeline"] != pipeline or r["chosen"] is None:
            continue
        im = detect.load(refs[r["photo"]])
        chosen = r["candidates"][r["chosen"]]["box"]
        others = [c["box"] for i, c in enumerate(r["candidates"]) if i != r["chosen"]]
        outline = extent(detect.mask(r["photo"], chosen))
        grown = fence(union(chosen, outline), chosen, others) if outline else chosen
        margin = fence(pad(grown, MARGIN, *im.size), chosen, others)
        loose = fence(pad(chosen, LOOSE, *im.size), chosen, others)
        again = extent(reask(im, loose))
        reasked = fence(pad(again, TRIM, *im.size), chosen, others) if again else chosen
        rows.append((r["photo"], im, [chosen, grown, margin, reasked]))
        print(f"  {r['photo'][:60]}: " + " | ".join(f"{m} {[round(v) for v in b]}" for m, b in zip(METHODS, [chosen, grown, margin, reasked])), flush=True)

    cell, label, per_sheet = 300, 22, 10
    for n in range(0, len(rows), per_sheet):
        chunk = rows[n:n + per_sheet]
        sheet = Image.new("RGB", (cell * 5, label + cell * len(chunk)), "white")
        d = ImageDraw.Draw(sheet)
        for j, m in enumerate(["photo, all four"] + METHODS):
            d.text((j * cell + 6, 5), m, fill="black", font_size=14)
        colours = [(230, 60, 60), (240, 170, 30), (60, 140, 230), (40, 180, 80)]
        for i, (k, im, boxes) in enumerate(chunk):
            y = label + i * cell
            whole = im.copy()
            dw = ImageDraw.Draw(whole)
            for b, c in zip(boxes, colours):
                dw.rectangle(b, outline=c, width=max(3, im.width // 250))
            whole.thumbnail((cell - 8, cell - 8))
            sheet.paste(whole, (4, y + 4))
            d.text((6, y + cell - 18), k[:40], fill="black", font_size=11)
            for j, (b, c) in enumerate(zip(boxes, colours), 1):
                crop = im.crop(tuple(int(v) for v in b))
                crop.thumbnail((cell - 8, cell - 8))
                sheet.paste(crop, (j * cell + 4, y + 4))
                d.rectangle([j * cell + 2, y + 2, j * cell + 2 + crop.width + 3, y + 2 + crop.height + 3], outline=c, width=2)
        dst = detect.OUT / f"crops-{n // per_sheet + 1}.jpg"
        sheet.save(dst, quality=85)
        print(f"sheet: {dst} ({len(chunk)} photos)")


if __name__ == "__main__":
    main()
