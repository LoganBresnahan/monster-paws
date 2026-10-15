"""Masks for taking a leg out of a finished painting (batch 8b/8c, doc/plans/base-model-candidates.md).

Runs in the `explore` container on the CPU:

    npm run explore:legmask -- <batch> [--legs]

For each painting in the batch spec that carries a leg `box` (fractions of
the painting, drawn on a tenths grid; with --legs, the boxes legs.py found in
<batch>/legs/remove.json), SAM 2.1 is asked for the leg inside
that box and its answer is kept only within the box grown a little, so a
prompt that spills onto the body never masks the dog. The mask is widened so
no edge of the leg survives at its border: batch 8b's hand boxes left a
sliver of leg at a soft edge, and the painter continued it as a ghost leg.
Writes, under ComfyUI's input/legmask/: <stem>.seg.png (the widened SAM mask),
<stem>.box.png (the hand box, for comparison), <stem>.erased.png (the
painting with the masked leg filled from the colours around it) and
<stem>.lama.png (the leg removed by LaMa, an object-removal model that fills
from the surrounding texture and, unlike the diffusion painter, does not
invent anatomy; batch 8d), and with legs.py's masks <stem>.outlined.png (the
body's edge drawn back over LaMa's fill) and <stem>.band.png (the band around
that line) and <stem>.stump.png (the top of the hole, for klein to redraw
the healed end; batch 8h), plus a sheet per painting in the batch's explore folder.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUT = Path("/home/comfy/ComfyUI/input")
OUTPUT = Path("/home/comfy/ComfyUI/output")
EXPLORE = Path("/home/comfy/explore")
MODELS = Path("/home/comfy/ComfyUI/models/detect")
LAMA = Path("/home/comfy/ComfyUI/models/inpaint/big-lama-torchscript.pt")

GROW_BOX = 0.15   # SAM's answer is kept within the hand box grown by this share of its size
WIDEN = 0.012     # the kept mask is widened by this share of the painting's width on every side
STUMP_ROUND = 0.012  # the cut edge is rounded over this share of the painting's width, so it reads as a healed stump
LINE = 0.003      # the drawn outline's width as a share of the painting's width, about the painter's own line
BAND = 0.02       # the band around the drawn line that a light klein pass may repaint
STUMP = 0.06      # klein may redraw the hole this share of the width below the cut: a healed end, not a leg
STRIP = 0.012     # outside the drawn line, LaMa's fill is pulled toward the paper over this share of the width


def stem(painting: dict) -> str:
    return Path(painting["file"]).stem


def fill(im, m):
    """The masked pixels replaced by the colours around them (normalized convolution), so no leg is left to continue."""
    import numpy as np
    from scipy import ndimage
    a = np.asarray(im, dtype=np.float32)
    keep = (~m).astype(np.float32)
    sigma = max(a.shape[:2]) / 40
    w = ndimage.gaussian_filter(keep, sigma)
    out = a.copy()
    for c in range(3):
        blurred = ndimage.gaussian_filter(a[..., c] * keep, sigma) / np.maximum(w, 1e-3)
        out[..., c] = np.where(m, blurred, a[..., c])
    return out.clip(0, 255).astype(np.uint8)


def outline(im, removed, seg, leg, dog):
    """The body's edge drawn back where the leg was: LaMa's fill alone fades fur into paper with no line (Logan, 2026-10-15).

    The new silhouette is the dog without the part LaMa filled, opened so no sliver of the leg's edge survives (each
    sliver's two sides stroked made a black spike) and rounded where it was cut so it reads as a healed stump. Only that
    cut edge is stroked, in the ink of the dog's own outline nearby, and a thin strip outside it is pulled toward the
    paper so LaMa's fur does not smear past the line. Returns the outlined painting, the band around the new line, and the stump region for klein.
    """
    import numpy as np
    from scipy import ndimage
    w = im.size[0]
    a = np.asarray(removed, dtype=np.float32)
    orig = np.asarray(im, dtype=np.float32)
    region = ndimage.binary_dilation(seg, iterations=max(2, int(0.02 * w)))
    body = dog & ~seg
    opened = ndimage.binary_opening(body, iterations=max(2, int(0.008 * w)))
    body = np.where(region, opened, body)
    rounded = ndimage.gaussian_filter(body.astype(np.float32), STUMP_ROUND * w) > 0.5
    body_new = np.where(region, rounded & (dog | seg), body)
    cut = body_new & ~ndimage.binary_erosion(body_new, iterations=1) & ndimage.binary_dilation(seg, iterations=3)
    if not cut.any():
        return a.clip(0, 255).astype(np.uint8), cut, cut
    # just outside the cut, towards the paper: the colour of the paper around the dog, fading out over a short strip
    keep = (~dog & ~region).astype(np.float32)
    sigma = w / 60
    weight = np.maximum(ndimage.gaussian_filter(keep, sigma), 1e-3)
    bg = np.stack([ndimage.gaussian_filter(orig[..., c] * keep, sigma) / weight for c in range(3)], axis=-1)
    dist = ndimage.distance_transform_edt(~cut)
    strip = (~body_new & region & (dist < STRIP * w)).astype(np.float32) * np.clip(1 - dist / (STRIP * w), 0, 1)
    a = a * (1 - strip[..., None] * 0.85) + bg * strip[..., None] * 0.85
    # the ink: the darkest quarter of the dog's own edge near the hole
    edge = dog & ~ndimage.binary_erosion(dog, iterations=2)
    near = edge & ndimage.binary_dilation(region, iterations=int(0.08 * w)) & ~region
    lum = orig[near].mean(axis=1) if near.any() else np.array([])
    ink = orig[near][lum <= np.percentile(lum, 25)].mean(axis=0) if near.any() else np.array([90, 70, 60], np.float32)
    stroke = ndimage.gaussian_filter(ndimage.binary_dilation(cut, iterations=max(1, int(LINE * w / 2))).astype(np.float32), 0.8)
    alpha = np.clip(stroke * 1.2, 0, 0.85)[..., None]
    a = a * (1 - alpha) + ink * alpha
    band = ndimage.binary_dilation(cut, iterations=max(2, int(BAND * w)))
    # the stump for klein to redraw: the top of the hole near the cut and a sliver of body, too little room to grow a leg
    stump = (seg & (dist < STUMP * w)) | ndimage.binary_dilation(cut, iterations=max(2, int(0.01 * w)))
    return a.clip(0, 255).astype(np.uint8), band, stump


def lama(model, im, m):
    """LaMa on the CPU: the painting and the mask in, the painting with the masked part filled out (sides padded to a multiple of 8)."""
    import numpy as np
    import torch
    a = torch.from_numpy(np.asarray(im, dtype=np.float32) / 255).permute(2, 0, 1)[None]
    k = torch.from_numpy(m.astype(np.float32))[None, None]
    h, w = a.shape[2:]
    ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
    a = torch.nn.functional.pad(a, (0, pw, 0, ph), mode="reflect")
    k = torch.nn.functional.pad(k, (0, pw, 0, ph))
    with torch.no_grad():
        out = model(a, k)[0, :, :h, :w]
    return (out.permute(1, 2, 0).numpy() * 255).clip(0, 255).astype(np.uint8)


def main() -> None:
    import numpy as np
    import torch
    from PIL import Image, ImageDraw
    from scipy import ndimage
    from transformers import Sam2Model, Sam2Processor
    torch.set_num_threads(4)
    batch = sys.argv[1]
    # --legs: the boxes legs.py found on its own (batch 8f), in place of the spec's hand-drawn ones
    spec = json.loads((EXPLORE / batch / "legs" / "remove.json" if "--legs" in sys.argv else HERE / "explore" / f"{batch}.json").read_text())
    proc = Sam2Processor.from_pretrained(MODELS / "sam2.1-hiera-small")
    model = Sam2Model.from_pretrained(MODELS / "sam2.1-hiera-small").eval()
    remover = torch.jit.load(str(LAMA), map_location="cpu").eval()
    out_dir = INPUT / "legmask"
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for animal, info in spec["animals"].items():
        for p in info["paintings"]:
            im = Image.open(OUTPUT / p["file"]).convert("RGB")
            w, h = im.size
            box = [v * d for v, d in zip(p["box"], (w, h) * 2)]
            if p.get("mask"):  # legs.py's leg traced in the dog's outline: SAM re-asked with its box takes only a black leg's white sock
                m = np.asarray(Image.open(EXPLORE / p["mask"]).convert("L")) > 0
            else:
                inputs = proc(images=im, input_boxes=[[box]], return_tensors="pt")
                with torch.no_grad():
                    out = model(**inputs, multimask_output=False)
                m = proc.post_process_masks(out.pred_masks, inputs["original_sizes"])[0][0, 0].numpy().astype(bool)
            bw, bh = box[2] - box[0], box[3] - box[1]
            gx0, gy0 = int(max(0, box[0] - GROW_BOX * bw)), int(max(0, box[1] - GROW_BOX * bh))
            gx1, gy1 = int(min(w, box[2] + GROW_BOX * bw)), int(min(h, box[3] + GROW_BOX * bh))
            within = np.zeros_like(m)
            within[gy0:gy1, gx0:gx1] = True
            seg = ndimage.binary_dilation(m & within, iterations=max(2, int(WIDEN * w)))
            hand = np.zeros_like(m)
            hand[int(box[1]):int(box[3]), int(box[0]):int(box[2])] = True
            s = stem(p)
            Image.fromarray((seg * 255).astype(np.uint8)).save(out_dir / f"{s}.seg.png")
            Image.fromarray((hand * 255).astype(np.uint8)).save(out_dir / f"{s}.box.png")
            erased = Image.fromarray(fill(im, seg))
            erased.save(out_dir / f"{s}.erased.png")
            removed = Image.fromarray(lama(remover, im, seg))
            removed.save(out_dir / f"{s}.lama.png")
            outlined = None
            if p.get("dog"):
                leg = np.asarray(Image.open(EXPLORE / p["mask"]).convert("L")) > 0
                dog = np.asarray(Image.open(EXPLORE / p["dog"]).convert("L")) > 0
                drawn, band, stump = outline(im, removed, seg, leg, dog)
                outlined = Image.fromarray(drawn)
                outlined.save(out_dir / f"{s}.outlined.png")
                Image.fromarray((band * 255).astype(np.uint8)).save(out_dir / f"{s}.band.png")
                Image.fromarray((stump * 255).astype(np.uint8)).save(out_dir / f"{s}.stump.png")
            print(f"  {animal} {s[:40]}: SAM {m.mean():.3f} of the painting, kept {seg.mean():.3f}", flush=True)
            shown = im.copy()
            ImageDraw.Draw(shown).rectangle(box, outline=(240, 60, 60), width=3)
            overlay = np.asarray(im).copy()
            overlay[seg] = (overlay[seg] * 0.4 + np.array([40, 180, 80]) * 0.6).astype(np.uint8)
            rows.append([shown, Image.fromarray(overlay), erased, removed] + ([outlined] if outlined else []))
    cell = 360
    sheet = Image.new("RGB", (cell * max(len(r) for r in rows), cell * len(rows)), "white")
    for i, row in enumerate(rows):
        for j, part in enumerate(row):
            part = part.copy()
            part.thumbnail((cell - 6, cell - 6))
            sheet.paste(part, (j * cell + 3, i * cell + 3))
    (EXPLORE / batch).mkdir(parents=True, exist_ok=True)
    sheet.save(EXPLORE / batch / "legmasks.jpg", quality=85)
    print(f"sheet: {EXPLORE / batch / 'legmasks.jpg'}")


if __name__ == "__main__":
    main()
