"""How the chosen animal is cut out for the painter: four ways side by side (ADR-0026, doc/plans/subject-detection.md).

Runs in the `explore` container on the CPU, after `npm run explore:detect`
has chosen an animal in each photo (DETECT_OUT, DETECT_SPEC as there):

    npm run explore:crops

For each chosen animal: the detector's box as it is; the box grown to its
SAM outline; that plus a margin; the box grown only by outline pixels no
other candidate's outline claims; and that plus a margin only on the sides
where the animal runs into the box's edge. A looser SAM re-ask was tried
and dropped: given room it traced the whole scene. Output: crops-<n>.jpg
sheets in DETECT_OUT, and grown.json: per photo its source and the
detector's subject, grown subject, head and grown head as fractions, which
explore.py prep cuts as `detsubject`, `grownsubject`, `dethead` and
`grownhead` once copied into explore/boxes-detected.json; heads-grown.jpg
shows the two head cuts.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import detect  # noqa: E402

MARGIN = 0.10   # share of the box's width and height added on each side
GREW = 0.01     # own outline past the detector's box by this share of its size: the box cut the animal on that side
# A head box grows to its own outline on a side only when the outline ends within this share of the head's size:
# a muzzle sideways, an ear tip upward (further up is the back of a face-on animal), never down — below the chin is the
# neck and body. Tuned on set 1, checked blind on the holdout (2026-10-14, doc/plans/subject-detection.md).
REACH_SIDE = 0.5
REACH_UP = 0.15
HEAD_PAD = 0.05

METHODS = ["box", "outline", "outline + margin", "own outline", "own + margin where it grew"]


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


def own(k, chosen, others):
    """The chosen outline less every pixel another candidate's outline claims, kept only where it connects to the chosen box."""
    import numpy as np
    from scipy import ndimage
    m = detect.mask(k, chosen).copy()
    for o in others:
        m &= ~detect.mask(k, o)
    parts, _ = ndimage.label(m)
    x0, y0, x1, y1 = (int(v) for v in chosen)
    inside = np.unique(parts[y0:y1, x0:x1])
    return np.isin(parts, inside[inside > 0])


def edge_margin(k, grown, chosen, own_mask, others, share, w, h):
    """Add the margin only on a side where the own outline grew past the detector's box; stop at the first pixel of another outline."""
    import numpy as np
    ys, xs = np.nonzero(own_mask)
    if len(xs) == 0:
        return grown
    claimed = np.zeros_like(own_mask)
    for o in others:
        claimed |= detect.mask(k, o)
    bw, bh = chosen[2] - chosen[0], chosen[3] - chosen[1]
    g = [int(v) for v in grown]
    dx, dy = int(bw * share), int(bh * share)
    tx, ty = bw * GREW, bh * GREW
    if xs.min() < chosen[0] - tx:
        lo = max(0, g[0] - dx)
        cols = np.nonzero(claimed[g[1]:g[3], lo:g[0]].any(axis=0))[0]
        g[0] = lo + int(cols.max()) + 1 if len(cols) else lo
    if xs.max() + 1 > chosen[2] + tx:
        hi = min(w, g[2] + dx)
        cols = np.nonzero(claimed[g[1]:g[3], g[2]:hi].any(axis=0))[0]
        g[2] = g[2] + int(cols.min()) if len(cols) else hi
    if ys.min() < chosen[1] - ty:
        lo = max(0, g[1] - dy)
        rows = np.nonzero(claimed[lo:g[1], g[0]:g[2]].any(axis=1))[0]
        g[1] = lo + int(rows.max()) + 1 if len(rows) else lo
    if ys.max() + 1 > chosen[3] + ty:
        hi = min(h, g[3] + dy)
        rows = np.nonzero(claimed[g[3]:hi, g[0]:g[2]].any(axis=1))[0]
        g[3] = g[3] + int(rows.min()) if len(rows) else hi
    return [float(v) for v in g]


def grow_head(head, own_mask, within):
    """Grow the head box to the subject's own outline on a side where that outline ends close by (a muzzle, an ear) — never where it runs on (the body), never down."""
    import numpy as np
    x0, y0, x1, y1 = (int(v) for v in head)
    hw, hh = x1 - x0, y1 - y0
    g = [float(v) for v in head]

    def run_through(line, a, b):
        """The extent of the run of outline pixels along `line` that overlaps [a, b)."""
        idx = np.nonzero(line)[0]
        if len(idx) == 0 or not line[a:b].any():
            return None
        lo, hi = a, b - 1
        while lo > 0 and line[lo - 1]:
            lo -= 1
        while hi < len(line) - 1 and line[hi + 1]:
            hi += 1
        first = a + int(np.nonzero(line[a:b])[0][0])
        last = a + int(np.nonzero(line[a:b])[0][-1])
        if not line[a]:
            lo = first
        if not line[b - 1]:
            hi = last
        return lo, hi + 1

    cols = run_through(own_mask[y0:y1].any(axis=0), x0, x1)
    if cols:
        if 0 < x0 - cols[0] <= REACH_SIDE * hw:
            g[0] = cols[0] - HEAD_PAD * hw
        if 0 < cols[1] - x1 <= REACH_SIDE * hw:
            g[2] = cols[1] + HEAD_PAD * hw
    rows = run_through(own_mask[:, x0:x1].any(axis=1), y0, y1)
    if rows and 0 < y0 - rows[0] <= REACH_UP * hh:
        g[1] = rows[0] - HEAD_PAD * hh
    # growth stops at the grown subject, which is already fenced from every other animal; the detector's head is never cut back
    return [min(head[0], max(g[0], within[0])), min(head[1], max(g[1], within[1])),
            max(head[2], min(g[2], within[2])), max(head[3], min(g[3], within[3]))]


def main() -> None:
    import torch
    from PIL import Image, ImageDraw
    torch.set_num_threads(4)
    spec = json.loads((HERE / "explore" / os.environ.get("DETECT_SPEC", "detect.json")).read_text())
    refs = {detect.key(name, ref): ref for name, listing in spec["listings"].items() for ref in listing["photos"]}
    pipeline = detect.PIPELINES[0]
    rows, regrown, heads = [], {}, []
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
        mine = own(r["photo"], chosen, others)
        theirs = extent(mine)
        owned = union(chosen, theirs) if theirs else chosen
        edged = edge_margin(r["photo"], owned, chosen, mine, others, MARGIN, *im.size)
        boxes = [chosen, grown, margin, owned, edged]
        rows.append((r["photo"], im, boxes))
        frac = lambda b: [round(v / d, 4) for v, d in zip(b, im.size * 2)]
        head = r["head"]["box"] if r.get("head") else None
        grown_head = grow_head(head, mine, edged) if head else None
        regrown[r["photo"]] = {"ref": refs[r["photo"]], "detsubject": frac(chosen), "grownsubject": frac(edged),
                               "dethead": frac(head) if head else None, "grownhead": frac(grown_head) if head else None}
        if head:
            heads.append((r["photo"], im, head, grown_head))
        print(f"  {r['photo'][:60]}: " + " | ".join(f"{m} {[round(v) for v in b]}" for m, b in zip(METHODS, boxes)), flush=True)

    (detect.OUT / "grown.json").write_text(json.dumps(regrown, indent=1) + "\n")
    # the detector's head (yellow) and the grown head (green), each cut as the painter reads it
    hc = 260
    hs = Image.new("RGB", (hc * 3, (hc + 18) * len(heads)), "white")
    hd = ImageDraw.Draw(hs)
    for i, (k, im, hb, gb) in enumerate(heads):
        y = i * (hc + 18)
        whole = im.copy()
        dw = ImageDraw.Draw(whole)
        dw.rectangle(hb, outline=(255, 210, 0), width=max(3, im.width // 250))
        dw.rectangle(gb, outline=(40, 180, 80), width=max(3, im.width // 250))
        for j, part in enumerate([whole, im.crop(tuple(int(v) for v in hb)), im.crop(tuple(int(v) for v in gb))]):
            part.thumbnail((hc - 8, hc - 8))
            hs.paste(part, (j * hc + 4, y + 4))
        hd.text((6, y + hc), k[:60], fill="black", font_size=11)
    hs.save(detect.OUT / "heads-grown.jpg", quality=85)
    print(f"grown boxes: {detect.OUT / 'grown.json'}")
    cell, label, per_sheet = 300, 22, 10
    for n in range(0, len(rows), per_sheet):
        chunk = rows[n:n + per_sheet]
        sheet = Image.new("RGB", (cell * 6, label + cell * len(chunk)), "white")
        d = ImageDraw.Draw(sheet)
        for j, m in enumerate(["photo, all five"] + METHODS):
            d.text((j * cell + 6, 5), m, fill="black", font_size=14)
        colours = [(230, 60, 60), (240, 170, 30), (60, 140, 230), (160, 60, 200), (40, 180, 80)]
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
