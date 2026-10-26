"""The anatomy taken out by a hand-traced outline and the painter's lines drawn back, before klein repaints it (batch 12g, doc/plans/base-model-candidates.md).

Runs in the `explore` container on the CPU:

    npm run explore:groinlines -- <batch>

The groin ellipse (groinmask.py) erased belly and thigh with the anatomy, and
the painter's lines with them: the repaint read as blur (12d, Logan). Lines
found automatically joined the wrong strokes or punched paper into the hole
(12f). So both are placed by eye, as fractions of the painting on a 0.01 grid,
in each painting's spec entry:

- `sheath`: a polygon round the anatomy alone. The hole is that, widened so
  none of its own outline survives at the rim.
- `sam` (optional): `pos` and `neg` points; SAM 2.1's answer to them, kept
  within the polygon grown by GROW, is the other candidate hole, and `use`
  ("poly", the default, or "sam") picks the one that is erased.
- `lines`: point lists, each a painter's line the hole cut (most often the
  belly underline where the sheath hung from it), drawn through by a
  Catmull-Rom curve in the ink of the dog's own outline nearby.

Writes, under ComfyUI's input/sheath/: <stem>.mask.png and <stem>.soft.png
(the hole, and the same feathered for the composite back onto the original),
<stem>.lama.png and <stem>.lined.png (LaMa's fill, then the lines drawn on
it); and a sheet per painting under the batch's explore folder, to be read
before any repaint.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from legmask import EXPLORE, INPUT, LAMA, LINE, MODELS, OUTPUT, lama  # noqa: E402

WIDEN = 0.004    # the hole is widened by this share of the painting's width, so the anatomy's own outline goes with it
GROW = 0.02      # SAM's answer is kept within the polygon grown by this share of the width
FEATHER = 0.004  # the composite's soft edge, as a share of the width
INK = 0.75       # the drawn line's strongest opacity: the painter's lines are washed, never solid


def catmull(pts, n=40):
    """A smooth curve through every point, ends included."""
    import numpy as np
    p = np.asarray(pts, dtype=np.float64)
    if len(p) == 2:
        t = np.linspace(0, 1, n)[:, None]
        return p[0] * (1 - t) + p[1] * t
    p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(p) - 2):
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        a, b, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
        out.append(0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t ** 2 + (3 * b - a - 3 * c + d) * t ** 3))
    out.append(p[-2][None])
    return np.vstack(out)


def main() -> None:
    import numpy as np
    import torch
    from PIL import Image, ImageDraw
    from scipy import ndimage
    from transformers import Owlv2ForObjectDetection, Owlv2Processor, Sam2Model, Sam2Processor
    import signature as sg
    torch.set_num_threads(4)
    batch = sys.argv[1]
    spec = json.loads((HERE / "explore" / f"{batch}.json").read_text())
    proc = Owlv2Processor.from_pretrained(MODELS / "owlv2-base-patch16-ensemble")
    owl = Owlv2ForObjectDetection.from_pretrained(MODELS / "owlv2-base-patch16-ensemble").eval()
    sproc = Sam2Processor.from_pretrained(MODELS / "sam2.1-hiera-small")
    sam = Sam2Model.from_pretrained(MODELS / "sam2.1-hiera-small").eval()
    remover = torch.jit.load(str(LAMA), map_location="cpu").eval()
    out_dir = INPUT / "sheath"
    out_dir.mkdir(parents=True, exist_ok=True)
    diag_dir = EXPLORE / batch / "lines"
    diag_dir.mkdir(parents=True, exist_ok=True)
    for animal, info in spec["animals"].items():
        for p in info["paintings"]:
            s = Path(p["file"]).stem
            im = Image.open(OUTPUT / p["file"]).convert("RGB")
            w, h = im.size
            orig = np.asarray(im, dtype=np.float32)
            px = lambda pts: [(x * w, y * h) for x, y in pts]  # noqa: E731
            poly_img = Image.new("L", (w, h), 0)
            ImageDraw.Draw(poly_img).polygon(px(p["sheath"]), fill=255)
            poly = np.asarray(poly_img) > 0
            widen = max(2, int(WIDEN * w))
            holes = {"poly": ndimage.binary_dilation(poly, iterations=widen)}
            if "sam" in p:
                pts = px(p["sam"]["pos"] + p["sam"]["neg"])
                labels = [1] * len(p["sam"]["pos"]) + [0] * len(p["sam"]["neg"])
                inputs = sproc(images=im, input_points=[[[list(q) for q in pts]]], input_labels=[[labels]], return_tensors="pt")
                with torch.no_grad():
                    res = sam(**inputs, multimask_output=False)
                seg = sproc.post_process_masks(res.pred_masks, inputs["original_sizes"])[0][0, 0].numpy().astype(bool)
                seg &= ndimage.binary_dilation(poly, iterations=max(2, int(GROW * w)))
                holes["sam"] = ndimage.binary_dilation(seg, iterations=widen)
            hole = holes[p.get("use", "poly")]
            soft = ndimage.gaussian_filter(hole.astype(np.float32), FEATHER * w)
            soft = np.maximum(soft, hole * 1.0)
            fill = np.asarray(lama(remover, im, hole), dtype=np.float32)
            # the ink: the darkest quarter of the dog's own outline near the hole, as legmask.py's outline
            dog = sg.outline(sam, sproc, im, sg.dog_box(proc, owl, im, info["kind"]))
            near = dog & ~ndimage.binary_erosion(dog, iterations=2) & ndimage.binary_dilation(hole, iterations=int(0.08 * w)) & ~hole
            lum = orig[near] @ np.array([0.299, 0.587, 0.114], np.float32) if near.any() else np.array([])
            ink = orig[near][lum <= np.percentile(lum, 25)].mean(0) if near.any() else np.array([90, 70, 60], np.float32)
            stroke = Image.new("L", (w, h), 0)
            for line in p.get("lines", []):
                ImageDraw.Draw(stroke).line([tuple(q) for q in catmull(px(line))], fill=255, width=max(2, int(round(LINE * w))), joint="curve")
            alpha = (ndimage.gaussian_filter(np.asarray(stroke, np.float32) / 255, 0.8) * INK)[..., None]
            lined = (fill * (1 - alpha) + ink * alpha).clip(0, 255).astype(np.uint8)
            Image.fromarray((hole * 255).astype(np.uint8)).save(out_dir / f"{s}.mask.png")
            Image.fromarray((soft * 255).clip(0, 255).astype(np.uint8)).save(out_dir / f"{s}.soft.png")
            Image.fromarray(fill.clip(0, 255).astype(np.uint8)).save(out_dir / f"{s}.lama.png")
            Image.fromarray(lined).save(out_dir / f"{s}.lined.png")
            # sheet: the original with the polygon (blue), SAM's hole (green), the lines (red); LaMa; the lines back
            ov = orig.copy()
            for name, col in (("poly", [0, 90, 255]), ("sam", [0, 180, 60])):
                if name in holes:
                    m = holes[name]
                    ov[m & ~ndimage.binary_erosion(m, iterations=2)] = col
            ov[np.asarray(stroke) > 0] = [230, 40, 0]
            ys, xs = np.nonzero(hole)
            size = max(xs.max() - xs.min(), ys.max() - ys.min(), int(0.08 * w))
            pad = int(0.9 * size)
            box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + pad), min(h, ys.max() + pad))
            tiles = [im, Image.fromarray(ov.astype(np.uint8)), Image.fromarray(fill.clip(0, 255).astype(np.uint8)), Image.fromarray(lined)]
            tw = 400
            th = int(tw * (box[3] - box[1]) / (box[2] - box[0]))
            sheet = Image.new("RGB", (tw * 4 + 30, th + 20), "white")
            for k, (t, lbl) in enumerate(zip(tiles, ["original", f"polygon (blue), SAM (green), lines (red); erasing {p.get('use', 'poly')}", "LaMa", "lines back"])):
                sheet.paste(t.crop(box).resize((tw, th), Image.LANCZOS), (k * (tw + 10), 20))
                ImageDraw.Draw(sheet).text((k * (tw + 10) + 4, 4), lbl, fill="black")
            sheet.save(diag_dir / f"{animal}-{s[:3]}.jpg", quality=90)
            print(f"  {animal} {s[:44]}: hole {hole.mean():.4f} of the painting"
                  + (f" (polygon {holes['poly'].mean():.4f}, SAM {holes['sam'].mean():.4f})" if "sam" in holes else "")
                  + f", {len(p.get('lines', []))} lines", flush=True)


if __name__ == "__main__":
    main()
