"""The painter's lines inked onto a finished groin repaint (batch 12h, doc/plans/base-model-candidates.md).

Runs in the `explore` container on the CPU:

    npm run explore:groinink -- <batch>

A line drawn before the repaint comes back as a soft brown trace, out of place
beside the painter's ink, and with no line the repainted belly runs into the
leg or the ground (Logan, 2026-10-26, batch 12g). So a line the repaint still
lacks is inked afterwards, onto the repaint itself, where nothing washes it:
crisp, in the darkest ink of the painter's own lines nearby, tapered at both
ends, its opacity broken a little as a brush line's is.

Each painting in the batch spec carries `ink` (point lists, fractions of the
painting, placed by eye on a 0.01 grid over the repaint) and `over` (the
repaints to ink, as paths under ComfyUI's output). Writes
<batch>/inked/<repaint stem>-w<width>.png at each width in WIDTHS, and a
sheet per painting.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from groinlines import catmull  # noqa: E402
from legmask import EXPLORE, OUTPUT  # noqa: E402

WIDTHS = (0.0018, 0.0026)  # the line's width as a share of the painting's width: the painter's thinnest and usual
SS = 4                     # drawn at this supersampling, so the edge is antialiased like a scanned line
TAPER = 0.15               # each end narrows to nothing over this share of the line's length
NEAR = 0.03                # the ink is read within this share of the width of the line's points
DARKEST = 3                # from the darkest this percent of pixels there: the painter's line, not the fur


def main() -> None:
    import numpy as np
    from PIL import Image, ImageDraw
    from scipy import ndimage
    batch = sys.argv[1]
    spec = json.loads((HERE / "explore" / f"{batch}.json").read_text())
    out_dir = EXPLORE / batch / "inked"
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    for animal, info in spec["animals"].items():
        for p in info["paintings"]:
            tiles = []
            for over in p["over"]:
                im = Image.open(OUTPUT / over).convert("RGB")
                w, h = im.size
                a = np.asarray(im, dtype=np.float32)
                lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
                yy, xx = np.mgrid[0:h, 0:w]
                near = np.zeros((h, w), bool)
                for line in p["ink"]:
                    for x, y in line:
                        near |= (xx - x * w) ** 2 + (yy - y * h) ** 2 <= (NEAR * w) ** 2
                ink = a[near & (lum <= np.percentile(lum[near], DARKEST))].mean(0)
                row = [im]
                for width in WIDTHS:
                    big = Image.new("L", (w * SS, h * SS), 0)
                    dr = ImageDraw.Draw(big)
                    for line in p["ink"]:
                        c = catmull([(x * w * SS, y * h * SS) for x, y in line], n=80)
                        t = np.linspace(0, 1, len(c))
                        prof = np.clip(np.minimum(t, 1 - t) / TAPER, 0, 1) ** 0.6
                        for k in range(len(c) - 1):
                            r = max(1.0, width * w * SS * prof[k] / 2)
                            dr.line([tuple(c[k]), tuple(c[k + 1])], fill=255, width=int(2 * r))
                            dr.ellipse([c[k][0] - r, c[k][1] - r, c[k][0] + r, c[k][1] + r], fill=255)
                    alpha = np.asarray(big.resize((w, h), Image.LANCZOS), np.float32) / 255
                    # a brush line's opacity breaks a little along it
                    g = ndimage.gaussian_filter(rng.random((h, w)), 1.2)
                    alpha = np.clip(alpha * np.clip(0.9 + 0.12 * (g - g.mean()) / g.std(), 0.65, 1.0), 0, 1)[..., None]
                    outp = (a * (1 - alpha) + ink * alpha).clip(0, 255).astype(np.uint8)
                    name = f"{Path(over).stem.removesuffix('_00001_')}-w{width}"
                    Image.fromarray(outp).save(out_dir / f"{name}.png")
                    row.append(Image.fromarray(outp))
                    print(f"  {animal} {name}", flush=True)
                tiles.append(row)
            xs = [x for line in p["ink"] for x, _ in line]
            ys = [y for line in p["ink"] for _, y in line]
            cx, cy, r = (min(xs) + max(xs)) / 2 * w, (min(ys) + max(ys)) / 2 * h, max(0.06 * w, (max(xs) - min(xs)) * w)
            box = tuple(int(v) for v in (max(0, cx - r), max(0, cy - r), min(w, cx + r), min(h, cy + r)))
            T = 360
            sheet = Image.new("RGB", (len(tiles[0]) * (T + 6), len(tiles) * (T + 18)), "white")
            for ri, row in enumerate(tiles):
                for ci, t in enumerate(row):
                    sheet.paste(t.crop(box).resize((T, T), Image.LANCZOS), (ci * (T + 6), ri * (T + 18) + 16))
                    lbl = Path(p["over"][ri]).stem[:40] if ci == 0 else f"inked w{WIDTHS[ci - 1]}"
                    ImageDraw.Draw(sheet).text((ci * (T + 6) + 3, ri * (T + 18) + 2), lbl, fill="black")
            sheet.save(out_dir / f"{animal}-{Path(p['file']).stem[:3]}.jpg", quality=90)


if __name__ == "__main__":
    main()
