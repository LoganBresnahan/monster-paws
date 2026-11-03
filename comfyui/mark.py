"""The crew's mark, "monsterpaws.org · <year>", on a finished painting (doc/plans/base-model-candidates.md, batch 35a).

Runs in the `explore` container on the CPU, with the fonts mounted read-only at /home/comfy/fonts:

    python /home/comfy/harness/mark.py <batch> [<batch> ...] [--year 2026]

Every gift painting carries the mark the crew's portraits carry, the year it was painted (ADR-0022's open question of
2026-10-26, settled by Logan 2026-11-02: "yes to the gift paintings, they get the watermark"), measured from
public/brand/crew/*-painting.jpg. Writes <stem>.png under explore/<batch>/marked/; signname.py marks its lettered
paintings with the same function.
"""
import json
import sys
from pathlib import Path

OUTPUT = Path("/home/comfy/ComfyUI/output")
EXPLORE = Path("/home/comfy/explore")
# The mark as the crew's paintings carry it, measured on their 1216×832 files: Geist Regular (the site's face; its
# copy in next's @vercel/og, mounted read-only under /home/comfy/fonts), 214 px wide, 31 px from the right, its foot
# 30 px from the bottom, a warm light grey that multiplies to about (175, 169, 162) on the paper.
# Licence record, as a model's (ADR-0004 decision 11): SIL OFL 1.1, "Copyright (c) 2023 Vercel, in collaboration with
# basement.studio" (vercel/geist-font LICENSE.txt, read 2026-11-03, copied beside the font); the file is next
# 16.4.3's @vercel/og 1.0.1 copy, sha256 bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76.
MARK_FONT = Path("/home/comfy/fonts/geist/Geist-Regular.ttf")
MARK_WIDTH = 220 / 1216  # 214 px of ink as measured: the face's own bearings take the other 6
MARK_RIGHT, MARK_BOTTOM = 31 / 1216, 30 / 832
MARK_INK = (178, 172, 165)
SCALE = 3  # the mark is drawn this much larger, then shrunk, so its edges stay smooth


def mark(im, year: int):
    """The crew's mark, "monsterpaws.org · <year>", bottom right, where klein's own signature is taken out."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    text = f"monsterpaws.org · {year}"
    probe = ImageDraw.Draw(Image.new("L", (1, 1)))
    want = MARK_WIDTH * im.width * SCALE
    size = 40
    font = ImageFont.truetype(str(MARK_FONT), size)
    size = int(size * want / (probe.textbbox((0, 0), text, font=font)[2] - probe.textbbox((0, 0), text, font=font)[0]))
    font = ImageFont.truetype(str(MARK_FONT), size)
    x0, y0, x1, y1 = probe.textbbox((0, 0), text, font=font)
    flat = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(flat).text((-x0, -y0), text, font=font, fill=255)
    small = flat.resize((round(flat.width / SCALE), round(flat.height / SCALE)), Image.LANCZOS)
    layer = Image.new("L", im.size, 0)
    layer.paste(small, (round(im.width * (1 - MARK_RIGHT)) - small.width, round(im.height * (1 - MARK_BOTTOM)) - small.height))
    alpha = np.asarray(layer, float)[..., None] / 255
    paint = np.asarray(im, float)
    return Image.fromarray(np.clip(paint * (1 - alpha * (1 - np.array(MARK_INK) / 255)), 0, 255).astype(np.uint8))


def main() -> None:
    import datetime
    from PIL import Image
    args = sys.argv[1:]
    year = datetime.datetime.now(datetime.timezone.utc).year
    if "--year" in args:
        i = args.index("--year")
        year = int(args[i + 1])
        args = args[:i] + args[i + 2:]
    for batch in args:
        out_dir = EXPLORE / batch / "marked"
        out_dir.mkdir(parents=True, exist_ok=True)
        n = 0
        for line in (EXPLORE / batch / "runs.jsonl").read_text().splitlines():
            r = json.loads(line)
            if not r.get("output"):
                continue
            mark(Image.open(OUTPUT / r["output"]).convert("RGB"), year).save(out_dir / f"{Path(r['output']).stem}.png")
            n += 1
        print(f"{batch}: {n} marked into {out_dir}", flush=True)


if __name__ == "__main__":
    main()
