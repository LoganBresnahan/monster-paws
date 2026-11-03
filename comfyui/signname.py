"""Letter the animal's name onto the blank sign the painter left (batch 30a, doc/plans/base-model-candidates.md).

Runs in the `explore` container on the CPU, with the font mounted read-only at /home/comfy/fonts:

    npm run explore:signname -- <batch> [<batch> ...] [--style carved|painted|deep|ink ...] [--year 2026]

klein misspells some names at every seed (batch 28a: Daisy and Emily at all four), so the sign is painted blank
and the name is set in our own type (Logan, 2026-11-02). OWLv2 finds the sign, SAM 2.1 outlines it, the board is
the outline's longest run of rows at least BOARD of its widest, and its corners are the board's extreme points;
the name is drawn flat at the board's size and cut into it: a V-groove whose depth is each pixel's distance from
the stroke's edge, lit from the top left, so one wall catches the light and the other falls in shadow, over a floor
of the board's own wood darkened, the grain showing through (Logan, 2026-11-02: printed type "doesn't look like it
belongs"). Writes <stem>.<style>.png under explore/<batch>/signname/, a sheet of the boards found, and every
board's corners in boards.json, which a later run reuses rather than finding the board again. Every lettered
painting also carries the crew's mark (mark.py).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from mark import mark  # noqa: E402

OUTPUT = Path("/home/comfy/ComfyUI/output")
EXPLORE = Path("/home/comfy/explore")
MODELS = Path("/home/comfy/ComfyUI/models/detect")
# Caveat (SIL OFL 1.1), downloaded for the prototype into var/fonts/caveat/; a font the donation path uses needs its
# licence recorded beside its hash first, as a model does (ADR-0004 decision 11).
FONT = Path("/home/comfy/fonts/caveat/Caveat-wght.ttf")

SIGN_FLOOR = 0.1     # OWLv2's score for the sign under which no board is lettered
SIGN_LOW = 0.45      # a sign's box centres below this share of the height: higher up it is the dog (batch 34a, Beetle's forehead)
BOARD = 0.75         # a row of the sign's outline is board, not post, at this share of the widest row
MIN_TEXT = (40, 14)  # the inset board's least width and height in painting pixels that can carry a name; smaller is no board
INSET = (0.10, 0.16) # the name keeps this share of the board's width and height clear on each side
INK = (70, 46, 32)   # dark brown, as the painter letters its own signs
LIGHT = (-1.0, -1.0, 1.4)  # towards the light, in the flat name's pixels (y down): the top left, above the board
SCALE = 3            # the name is drawn this much larger than the board, then warped down, so its edges stay smooth
# Each style: the groove floor's darkening (multiply colour, opacity), the walls' depth, the shadow and highlight
# opacities, a painted fill in the groove (opacity of INK, 0 for bare wood) and the edge's wobble in flat pixels.
STYLES = {
    "ink":     None,  # batch 30's first lettering: dark brown multiplied flat into the wood
    "carved":  {"floor": ((150, 112, 78), 0.55), "depth": 2.2, "shadow": 0.75, "light": 0.45, "fill": 0.0, "wobble": 0.8},
    "painted": {"floor": ((150, 112, 78), 0.35), "depth": 2.2, "shadow": 0.55, "light": 0.35, "fill": 0.6, "wobble": 0.8},
    "deep":    {"floor": ((128, 92, 62), 0.65), "depth": 3.5, "shadow": 0.9, "light": 0.6, "fill": 0.0, "wobble": 1.0},
}


def sign_box(proc, model, im) -> tuple[list[float], float]:
    import torch
    # The third query finds a small board hung on a cord, which the first two score under SIGN_FLOOR (batch 33: 26 missed); never
    # name the neck in it, or OWLv2 boxes the cord and collar above the board (0.47-0.79 on the board, tried on six).
    inputs = proc(text=[["a painting of a wooden sign", "a blank wooden signboard", "a blank rectangular wooden tag"]], images=im, return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs)
    side = max(im.size)  # OWLv2 pads to a square at the bottom and right before resizing
    scores = out.logits[0].sigmoid().max(1).values * (out.pred_boxes[0][:, 1] * side > SIGN_LOW * im.height)
    i = int(scores.argmax())
    cx, cy, w, h = out.pred_boxes[0][i].tolist()
    return [max(0.0, (cx - w / 2) * side), max(0.0, (cy - h / 2) * side), min(im.width, (cx + w / 2) * side),
            min(im.height, (cy + h / 2) * side)], float(scores[i])


def outline(sam, sproc, im, box):
    import torch
    inputs = sproc(images=im, input_boxes=[[box]], return_tensors="pt")
    with torch.no_grad():
        out = sam(**inputs, multimask_output=False)
    return sproc.post_process_masks(out.pred_masks, inputs["original_sizes"])[0][0, 0].numpy().astype(bool)


def board(mask):
    """The board's corners (top-left, top-right, bottom-right, bottom-left), or None."""
    import numpy as np
    from scipy import ndimage
    widths = mask.sum(1)
    if widths.max() == 0:
        return None
    rows = widths >= BOARD * widths.max()
    runs, n = ndimage.label(rows)
    if n == 0:
        return None
    longest = max(range(1, n + 1), key=lambda i: (runs == i).sum())
    m = mask & (runs == longest)[:, None]
    m = ndimage.binary_fill_holes(m)
    ys, xs = np.nonzero(m)
    s, d = xs + ys, xs - ys
    return [[float(xs[s.argmin()]), float(ys[s.argmin()])], [float(xs[d.argmax()]), float(ys[d.argmax()])],
            [float(xs[s.argmax()]), float(ys[s.argmax()])], [float(xs[d.argmin()]), float(ys[d.argmin()])]]


def inset(q):
    """The board's corners pulled in by INSET, along its own edges."""
    (u0, v0) = INSET
    def at(u, v):
        top = [q[0][k] + (q[1][k] - q[0][k]) * u for k in (0, 1)]
        bot = [q[3][k] + (q[2][k] - q[3][k]) * u for k in (0, 1)]
        return [top[k] + (bot[k] - top[k]) * v for k in (0, 1)]
    return [at(u0, v0), at(1 - u0, v0), at(1 - u0, 1 - v0), at(u0, 1 - v0)]


def perspective(dst, src):
    """PIL's PERSPECTIVE data mapping each output point in dst to its input point in src."""
    import numpy as np
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
        b += [u, v]
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def letter(im, q, name: str, style: str = "carved"):
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    from scipy import ndimage
    t = inset(q)
    dist = lambda p, r: ((p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2) ** 0.5
    w = int(SCALE * (dist(t[0], t[1]) + dist(t[3], t[2])) / 2)
    h = int(SCALE * (dist(t[0], t[3]) + dist(t[1], t[2])) / 2)
    if w < SCALE * MIN_TEXT[0] or h < SCALE * MIN_TEXT[1]:
        return None
    flat = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(flat)
    size = h
    while size > 8:
        font = ImageFont.truetype(str(FONT), size)
        font.set_variation_by_name("Bold")
        x0, y0, x1, y1 = draw.textbbox((0, 0), name, font=font)
        if x1 - x0 <= w and y1 - y0 <= h:
            break
        size = int(size * 0.94)
    draw.text(((w - (x1 - x0)) / 2 - x0, (h - (y1 - y0)) / 2 - y0), name, font=font, fill=255)
    coeffs = perspective(t, [[0, 0], [w, 0], [w, h], [0, h]])
    onto = lambda a: np.asarray(Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).transform(
        im.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.5)), float)[..., None] / 255
    paint = np.asarray(im, float) / 255
    st = STYLES[style]
    if st is None:
        return Image.fromarray(np.clip(255 * paint * (1 - 0.92 * onto(np.asarray(flat, float) / 255) * (1 - np.array(INK) / 255)), 0, 255).astype(np.uint8))
    # The same name always cuts the same way: the wobble's noise is seeded by the name.
    rng = np.random.default_rng(sum(map(ord, name)))
    m = np.asarray(flat, float) / 255
    if st["wobble"]:
        dy, dx = (ndimage.gaussian_filter(rng.standard_normal((h, w)), 8 * SCALE) for _ in range(2))
        norm = st["wobble"] * SCALE / max(np.abs(dx).max(), np.abs(dy).max(), 1e-6)
        yy, xx = np.mgrid[0:h, 0:w]
        m = ndimage.map_coordinates(m, [yy + dy * norm, xx + dx * norm], order=1)
    cut = m > 0.5
    dist = ndimage.distance_transform_edt(cut)
    half = max(np.percentile(dist[cut], 95), 1.0) if cut.any() else 1.0
    # Smoothed by a third of the stroke's half-width, or the whole-pixel steps of the distance show as rings on the walls.
    height = ndimage.gaussian_filter(-np.clip(dist / half, 0, 1), max(SCALE * 0.6, half / 3))
    gy, gx = np.gradient(height)
    n = np.dstack([-gx * st["depth"] * SCALE, -gy * st["depth"] * SCALE, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    lv = np.array(LIGHT) / np.linalg.norm(LIGHT)
    shade = (n @ lv) - lv[2]  # against a flat board: below 0 a wall turned from the light, above 0 one turned to it
    inside = ndimage.gaussian_filter(cut.astype(float), SCALE * 0.4)
    dark, lit = onto(np.clip(-shade, 0, 1) * inside), onto(np.clip(shade, 0, 1) * inside)
    floor = onto(inside)
    colour, f_op = st["floor"]
    out = paint * (1 - floor * f_op * (1 - np.array(colour) / 255))
    if st["fill"]:
        out = out * (1 - floor * st["fill"] * (1 - np.array(INK) / 255))
    out = out * (1 - np.clip(dark * 2.5, 0, 1) * st["shadow"] * (1 - np.array(INK) / 255))
    out = 1 - (1 - out) * (1 - np.clip(lit * 2.5, 0, 1) * st["light"] * np.array([1.0, 0.95, 0.85]))
    return Image.fromarray(np.clip(out * 255, 0, 255).astype(np.uint8))


def main() -> None:
    import torch
    from PIL import Image, ImageDraw
    from transformers import Owlv2ForObjectDetection, Owlv2Processor, Sam2Model, Sam2Processor
    torch.set_num_threads(4)
    proc = Owlv2Processor.from_pretrained(MODELS / "owlv2-base-patch16-ensemble")
    model = Owlv2ForObjectDetection.from_pretrained(MODELS / "owlv2-base-patch16-ensemble").eval()
    sproc = Sam2Processor.from_pretrained(MODELS / "sam2.1-hiera-small")
    sam = Sam2Model.from_pretrained(MODELS / "sam2.1-hiera-small").eval()
    import datetime
    args = sys.argv[1:]
    year = datetime.datetime.now(datetime.timezone.utc).year
    if "--year" in args:
        i = args.index("--year")
        year = int(args[i + 1])
        args = args[:i] + args[i + 2:]
    styles = args[args.index("--style") + 1:] if "--style" in args else ["carved"]
    batches = args[:args.index("--style")] if "--style" in args else args
    for batch in batches:
        spec = json.loads((HERE / "explore" / f"{batch}.json").read_text())
        out_dir = EXPLORE / batch / "signname"
        out_dir.mkdir(parents=True, exist_ok=True)
        found = {r["id"]: r for r in json.loads((out_dir / "boards.json").read_text())} if (out_dir / "boards.json").exists() else {}
        records, tiles = [], []
        for line in (EXPLORE / batch / "runs.jsonl").read_text().splitlines():
            r = json.loads(line)
            if not r.get("output"):
                continue
            im = Image.open(OUTPUT / r["output"]).convert("RGB")
            name = spec["animals"][r["animal"]].get("name", r["animal"])
            if found.get(r["id"], {}).get("board"):
                box, score, q = found[r["id"]]["sign"], found[r["id"]]["score"], found[r["id"]]["board"]
            else:
                box, score = sign_box(proc, model, im)
                q = board(outline(sam, sproc, im, box)) if score >= SIGN_FLOOR else None
            rec = {"id": r["id"], "file": r["output"], "name": name, "sign": box, "score": round(score, 3), "board": q}
            if q:
                rec["lettered"] = {}
                for style in styles:
                    named = letter(im, q, name, style)
                    if named is None:  # a board too small to carry a name is no board
                        q = rec["board"] = None
                        rec.pop("lettered")
                        break
                    mark(named, year).save(out_dir / f"{Path(r['output']).stem}.{style}.png")
                    rec["lettered"][style] = f"{Path(r['output']).stem}.{style}.png"
            records.append(rec)
            print(f"  {r['id'][:60]}: sign {score:.2f}{' lettered ' + name if q else ' NO BOARD'}", flush=True)
            z = im.copy()
            d = ImageDraw.Draw(z)
            d.rectangle(box, outline=(160, 160, 160), width=3)
            if q:
                d.polygon([tuple(p) for p in q], outline=(230, 40, 40), width=4)
            z.thumbnail((304, 208))
            tiles.append(z)
        (out_dir / "boards.json").write_text(json.dumps(records, indent=1))
        if tiles:
            cols = 6
            sheet = Image.new("RGB", (304 * cols, 208 * ((len(tiles) + cols - 1) // cols)), "white")
            for i, t in enumerate(tiles):
                sheet.paste(t, ((i % cols) * 304, (i // cols) * 208))
            sheet.save(out_dir / "boards.jpg", quality=85)
        print(f"{batch}: {sum(1 for r in records if r.get('lettered'))}/{len(records)} lettered ({', '.join(styles)}); sheet {out_dir}/boards.jpg")


if __name__ == "__main__":
    main()
