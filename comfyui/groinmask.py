"""Masks for repainting a painting's groin with klein Base (batch 12c, doc/plans/base-model-candidates.md).

Runs in the `explore` container on the CPU:

    npm run explore:groinmask -- <batch>

For each painting in the batch spec that carries a `groin` box (fractions of
the painting, placed by eye on a tenths grid), the ellipse inside that box is
the mask. Writes, under ComfyUI's input/groin/: <stem>.mask.png (the ellipse,
which klein Base repaints), <stem>.soft.png (the same, feathered, through
which the repaint is composited back onto the original, so no pixel outside
it changes) and <stem>.lama.png (the painting with the ellipse filled by
LaMa first, so the repaint has no shape left to complete: klein grew the
anatomy back from what it could see, batch 9d).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from legmask import INPUT, LAMA, OUTPUT, lama  # noqa: E402

WIDEN = 0.006    # the ellipse is widened by this share of the painting's width, so no edge of the anatomy survives at its rim
FEATHER = 0.006  # the composite's soft edge, as a share of the painting's width


def main() -> None:
    import numpy as np
    import torch
    from PIL import Image
    from scipy import ndimage
    torch.set_num_threads(4)
    spec = json.loads((HERE / "explore" / f"{sys.argv[1]}.json").read_text())
    remover = torch.jit.load(str(LAMA), map_location="cpu").eval()
    out_dir = INPUT / "groin"
    out_dir.mkdir(parents=True, exist_ok=True)
    for animal, info in spec["animals"].items():
        for p in info["paintings"]:
            im = Image.open(OUTPUT / p["file"]).convert("RGB")
            w, h = im.size
            x0, y0, x1, y1 = (v * d for v, d in zip(p["groin"], (w, h) * 2))
            yy, xx = np.mgrid[0:h, 0:w]
            m = ((xx - (x0 + x1) / 2) / ((x1 - x0) / 2)) ** 2 + ((yy - (y0 + y1) / 2) / ((y1 - y0) / 2)) ** 2 <= 1
            m = ndimage.binary_dilation(m, iterations=max(2, int(WIDEN * w)))
            soft = ndimage.gaussian_filter(m.astype(np.float32), FEATHER * w)
            s = Path(p["file"]).stem
            Image.fromarray((m * 255).astype(np.uint8)).save(out_dir / f"{s}.mask.png")
            Image.fromarray((soft * 255).clip(0, 255).astype(np.uint8)).save(out_dir / f"{s}.soft.png")
            Image.fromarray(lama(remover, im, m)).save(out_dir / f"{s}.lama.png")
            print(f"  {animal} {s[:48]}: ellipse {m.mean():.3f} of the painting", flush=True)


if __name__ == "__main__":
    main()
