"""Clean copies of crew photos, for Meta's Model API and anything shown on camera (ADR-0028).

Runs in the `explore` container with no model loaded:

    docker compose -f comfyui/compose.yml run --rm --no-deps --entrypoint python explore /home/comfy/harness/clean_crew.py

Writes var/explore/crew-clean/<pet>/<file>: each photo upright at full size, with the shapes below painted over and no
metadata. Originals are only ever read. Never move these under var/crew/: explore.py's prep reads every `*/*` there.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import detect

OUT = Path("/home/comfy/explore/crew-clean")

# Fractions of the upright photo, so a cover survives a resize. A copy with no cover is still worth writing: pixels only.
# Cover opaquely, because a blur can sometimes be read back. The tag's words stay out of this file, and any doc.
COVERS = {
    "Plum/PXL_20250410_144425752.jpg": [],
    "Plum/PXL_20250422_224206531.jpg": [("ellipse", (0.4469, 0.5553, 0.0224, 0.01875), (48, 48, 50))],
    "Plum/PXL_20250422_224209397.jpg": [],
    "Plum/PXL_20250423_185424061.PORTRAIT.jpg": [("ellipse", (0.2473, 0.5688, 0.0456, 0.0363), (22, 24, 26))],
    "Plum/PXL_20250423_185435181.PORTRAIT.jpg": [],
    "Stacey/IMG_3110.jpg": [
        ("polygon", [(0.0, 0.0567), (0.4175, 0.0933), (0.4188, 0.38), (0.0, 0.3967)], (18, 19, 23)),
        ("polygon", [(0.575, 0.0967), (0.9413, 0.0483), (0.9431, 0.3417), (0.5775, 0.3633)], (18, 19, 23)),
        ("polygon", [(0.3769, 0.3133), (0.57, 0.3033), (0.5738, 0.4633), (0.5563, 0.45), (0.5188, 0.43), (0.4688, 0.4267),
                     (0.4313, 0.4367), (0.4, 0.4567), (0.3825, 0.4767)], (18, 19, 23)),
    ],
}


def clean(rel: str, shapes: list) -> Path:
    from PIL import Image, ImageDraw, ImageOps
    with Image.open(detect.CREW / rel) as opened:
        upright = ImageOps.exif_transpose(opened).convert("RGB")
    # Rebuilt from raw bytes, because Pillow carries a JPEG comment over from `info`.
    copy = Image.frombytes("RGB", upright.size, upright.tobytes())
    w, h = copy.size
    draw = ImageDraw.Draw(copy)
    for kind, where, colour in shapes:
        if kind == "ellipse":
            cx, cy, rx, ry = where
            draw.ellipse([(cx - rx) * w, (cy - ry) * h, (cx + rx) * w, (cy + ry) * h], fill=colour)
        else:
            draw.polygon([(x * w, y * h) for x, y in where], fill=colour)
    dst = OUT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    copy.save(dst, "JPEG", quality=95, subsampling=0)
    return dst


def main() -> None:
    for rel, shapes in COVERS.items():
        print(f"{clean(rel, shapes)}: {len(shapes)} covers", flush=True)


if __name__ == "__main__":
    main()
