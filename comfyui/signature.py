"""Find the signature the painter sometimes adds, and take it out (batches 9a–9c, doc/plans/base-model-candidates.md).

Runs in the `explore` container on the CPU:

    npm run explore:signature -- <batch>           # find, and write the review sheet
    npm run explore:signature -- <batch> --fix     # LaMa takes each found signature out

The signature is pale ink that OWLv2 scores near zero even enlarged, so it
is read from the pixels: OWLv2 finds the dog, SAM 2.1 outlines it, and the
signature is the largest word of ink on the paper outside that outline in
the bottom-right corner (see the constants). Every pick is kept with its
ink count in signatures.json, so the rule is checked against a person's
labels (labels.json beside it: {"001": ["sig"]}, keyed by the run's
number), never by eye on the sheet alone. --fix writes
<stem>.unsigned.png (LaMa's fill) under input/signature/.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

INPUT = Path("/home/comfy/ComfyUI/input")
OUTPUT = Path("/home/comfy/ComfyUI/output")
EXPLORE = Path("/home/comfy/explore")
MODELS = Path("/home/comfy/ComfyUI/models/detect")
LAMA = Path("/home/comfy/ComfyUI/models/inpaint/big-lama-torchscript.pt")

# A signature is pale ink (batch 9b: 0.65-0.75 grey on a 0.93 wash): strokes darker than their surroundings, grey-brown
# not green, on the paper outside the dog's outline, joined into one word in the bottom-right corner where the painter
# signs. Set on batches 9a and 9b, every signature 120-607 px of ink against 96 at most for grass and shadow there;
# batch 9c, fresh: its one signature found (525), one false find on grass in a goat's corner (139).
INK = 0.12         # a stroke is this much darker than the median of its 21-px neighbourhood
SIG_INK = 100      # px of ink in one word
SIG_X, SIG_Y = 0.65, 0.80  # the word's centre lies right of and below these shares of the painting
GROW = 0.35        # the word's box grows by this share of its size before LaMa, so no stroke's edge is left behind


def dog_box(proc, model, im, kind: str) -> list[float]:
    import torch
    inputs = proc(text=[[f"a painting of a {kind}"]], images=im, return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs)
    i = int(out.logits[0][:, 0].argmax())
    side = max(im.size)  # OWLv2 pads to a square at the bottom and right before resizing
    cx, cy, w, h = out.pred_boxes[0][i].tolist()
    return [max(0.0, (cx - w / 2) * side), max(0.0, (cy - h / 2) * side), min(im.width, (cx + w / 2) * side), min(im.height, (cy + h / 2) * side)]


def outline(sam, sproc, im, dog):
    import torch
    inputs = sproc(images=im, input_boxes=[[dog]], return_tensors="pt")
    with torch.no_grad():
        out = sam(**inputs, multimask_output=False)
    return sproc.post_process_masks(out.pred_masks, inputs["original_sizes"])[0][0, 0].numpy().astype(bool)


def signature(im, dog_mask) -> dict | None:
    """The largest word of ink on the paper in the bottom-right corner, or None."""
    import numpy as np
    from scipy import ndimage
    w, h = im.size
    a = np.asarray(im, dtype=float) / 255
    lum, sat = a.mean(2), a.max(2) - a.min(2)
    ink = (ndimage.median_filter(lum, size=21) - lum > INK) & (sat < 0.3) & (a[..., 1] <= a[..., 0] + 0.02)
    ink &= ~ndimage.binary_dilation(dog_mask, iterations=int(0.015 * w))
    ink[: int(h * 0.6)] = False
    words, _ = ndimage.label(ndimage.binary_dilation(ink, iterations=4))
    best = None
    for i, sl in enumerate(ndimage.find_objects(words), 1):
        px = int((ink[sl] & (words[sl] == i)).sum())
        box = [sl[1].start, sl[0].start, sl[1].stop, sl[0].stop]
        if (box[2] - box[0] >= 1.3 * (box[3] - box[1]) and box[2] - box[0] <= 0.15 * w
                and (box[0] + box[2]) / 2 > SIG_X * w and (box[1] + box[3]) / 2 > SIG_Y * h and (best is None or px > best["ink"])):
            best = {"box": box, "ink": px}
    return best


def grown(b, w, h, by=GROW) -> list[int]:
    bw, bh = b[2] - b[0], b[3] - b[1]
    return [int(max(0, b[0] - by * bw)), int(max(0, b[1] - by * bh)), int(min(w, b[2] + by * bw)), int(min(h, b[3] + by * bh))]


def main() -> None:
    import torch
    from PIL import Image, ImageDraw
    from transformers import Owlv2ForObjectDetection, Owlv2Processor, Sam2Model, Sam2Processor
    torch.set_num_threads(4)
    batch = sys.argv[1]
    out_dir = EXPLORE / batch / "signature"
    out_dir.mkdir(parents=True, exist_ok=True)
    if "--fix" in sys.argv:
        fix(json.loads((out_dir / "signatures.json").read_text()))
        return
    spec = json.loads((HERE / "explore" / f"{batch}.json").read_text())
    proc = Owlv2Processor.from_pretrained(MODELS / "owlv2-base-patch16-ensemble")
    model = Owlv2ForObjectDetection.from_pretrained(MODELS / "owlv2-base-patch16-ensemble").eval()
    sproc = Sam2Processor.from_pretrained(MODELS / "sam2.1-hiera-small")
    sam = Sam2Model.from_pretrained(MODELS / "sam2.1-hiera-small").eval()
    labels_path = out_dir / "labels.json"
    labels = json.loads(labels_path.read_text()) if labels_path.exists() else None
    records, tiles = [], []
    for line in (EXPLORE / batch / "runs.jsonl").read_text().splitlines():
        r = json.loads(line)
        if not r.get("output"):
            continue
        im = Image.open(OUTPUT / r["output"]).convert("RGB")
        sig = signature(im, outline(sam, sproc, im, dog_box(proc, model, im, spec["animals"][r["animal"]]["kind"])))
        found = bool(sig and sig["ink"] >= SIG_INK)
        rec = {"id": r["id"], "file": r["output"], "sig": sig, "found": found}
        if labels is not None and r["id"][:3] in labels:
            rec["right"] = found == ("sig" in labels[r["id"][:3]])
        records.append(rec)
        print(f"  {r['id'][:60]}: ink {sig['ink'] if sig else 0}{' FOUND' if found else ''}"
              + ("" if "right" not in rec else " right" if rec["right"] else " WRONG"), flush=True)
        if sig:
            x0, y0, x1, y1 = grown(sig["box"], im.width, im.height, by=1.5)
            z = im.crop((x0, y0, x1, y1))
            ImageDraw.Draw(z).rectangle([sig["box"][0] - x0, sig["box"][1] - y0, sig["box"][2] - x0, sig["box"][3] - y0],
                                        outline=(230, 40, 40) if found else (160, 160, 160), width=2)
            z.thumbnail((240, 120))
            tile = Image.new("RGB", (244, 140), "white")
            tile.paste(z, (2, 2))
            ImageDraw.Draw(tile).text((2, 126), f"{r['id'][:3]} ink {sig['ink']}", fill=(0, 0, 0))
            tiles.append(tile)
    (out_dir / "signatures.json").write_text(json.dumps(records, indent=1))
    if tiles:
        cols = 6
        sheet = Image.new("RGB", (244 * cols, 140 * ((len(tiles) + cols - 1) // cols)), "white")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 244, (i // cols) * 140))
        sheet.save(out_dir / "signatures.jpg", quality=85)
    if labels is not None:
        judged = [r for r in records if "right" in r]
        wrong = [r["id"][:3] for r in judged if not r["right"]]
        print(f"signatures: {len(judged) - len(wrong)}/{len(judged)} right; wrong {wrong}")
    print(f"sheet: {out_dir}/signatures.jpg")


def fix(records: list[dict]) -> None:
    import numpy as np
    import torch
    from PIL import Image
    from legmask import lama
    remover = torch.jit.load(str(LAMA), map_location="cpu").eval()
    out_dir = INPUT / "signature"
    out_dir.mkdir(parents=True, exist_ok=True)
    for r in records:
        if not r["found"]:
            continue
        im = Image.open(OUTPUT / r["file"]).convert("RGB")
        w, h = im.size
        m = np.zeros((h, w), bool)
        x0, y0, x1, y1 = grown(r["sig"]["box"], w, h)
        m[y0:y1, x0:x1] = True
        Image.fromarray(lama(remover, im, m)).save(out_dir / f"{Path(r['file']).stem}.unsigned.png")
        print(f"  {r['id'][:60]}: signature out", flush=True)


if __name__ == "__main__":
    main()
