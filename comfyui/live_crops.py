"""A keepsake's crops by live detection, for the art.generate handler (src/worker/art.ts; ADR-0026).

Runs in the `explore` container on the CPU:

    DETECT_PIPELINES=owlv2 python /home/comfy/harness/live_crops.py <run>

Reads explore/<run>/detect.json, one listing in detect.py's own shape written by the handler; runs detect.py's
rules with DETECT_OUT at explore/<run>/detect and crops.py's growth on what they chose; then cuts each photo's
subject and head into input/crew/<run>/ as `explore.py prep` cuts the crew's (with no head found, a close-up's
subject stands in for it, and a photo farther off is left out), and writes explore/<run>/cut.json: the photos cut, each with whether its own head was found. DETECT_PIPELINES chooses the detector, as for the
comparison runs, so a new detector is a stage-1 function in detect.py and nothing here.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPLORE = Path("/home/comfy/explore")
CROPS = ("detsubject", "grownsubject", "dethead", "grownhead")
# The detector's subject fills at least this share of a close-up's frame: farther off, a subject chosen without its head
# can be the animal's rear half, as in 3625Pongpong-Bail-Santo-Tomas-La-Union-67 (verify, 2026-11-04). Provisional until
# Logan has looked at far-off Commons photos painted (ADR-0004 as amended 2026-11-03, later 2026-11-04).
CLOSE_UP = 0.4


def choose(found: dict) -> tuple[dict | None, float]:
    """A photo's boxes to cut, a close-up's subject standing in for a head none was chosen for, or None for a headless
    photo farther off; and the share of the frame the detector's subject fills."""
    boxes = {c: found[c] for c in CROPS if found.get(c)}
    x0, y0, x1, y1 = boxes["detsubject"]
    share = (x1 - x0) * (y1 - y0)
    if "grownhead" in boxes:
        return boxes, share
    if share < CLOSE_UP:
        return None, share
    # A close-up's own box stands in for its head (the listing rehearsal's cat, 2026-11-04): klein reads a close-up anyway.
    return {**boxes, "dethead": boxes["detsubject"], "grownhead": boxes["grownsubject"]}, share


def main() -> None:
    run = sys.argv[1]
    out = EXPLORE / run
    # Set before detect.py is imported, which reads both at import; an absolute DETECT_SPEC survives its join to explore/.
    os.environ["DETECT_OUT"] = str(out / "detect")
    os.environ["DETECT_SPEC"] = str(out / "detect.json")
    sys.path.insert(0, str(HERE))
    import crops
    import detect
    import explore
    sys.argv = sys.argv[:1]
    detect.main()
    crops.main()
    grown = json.loads((out / "detect" / "grown.json").read_text())
    asked = json.loads((out / "detect.json").read_text())["listings"][run]["photos"]
    cut, far = [], 0
    for ref in asked:
        # A detector can choose no animal in a photo (sam3 returns none): that photo is left out, by name, never guessed.
        found = grown.get(detect.key(run, ref))
        if not found or not found.get("grownsubject"):
            print(f"{run}: no animal chosen in {ref}", flush=True)
            continue
        src = detect.photo_path(ref)
        boxes, share = choose(found)
        stood_in = not found.get("grownhead")
        if boxes is None:
            far += 1
            print(f"{run}: no head chosen in {ref}, and the animal fills {share:.0%} of it, under a close-up's {CLOSE_UP:.0%}; left out", flush=True)
            continue
        if stood_in:
            print(f"{run}: no head chosen in {ref}, a close-up; its subject stands in for the head", flush=True)
        # Under the run's own name, never the pet's: the crew's batch-11 crops are kept, and a live run is never mistaken for one.
        explore.cut(run, src, {"full": None, **boxes}, f"{run}/{src.stem}")
        cut.append({"ref": ref, "file": src.name, "head": not stood_in})
    (out / "cut.json").write_text(json.dumps(cut, indent=1) + "\n")
    print(f"{run}: {len(cut)} of {len(asked)} photos cut into input/crew/{run}/, {sum(c['head'] for c in cut)} with a head", flush=True)
    if not cut and far:
        rest = f", and no animal chosen in the other {len(asked) - far}" if far < len(asked) else ""
        sys.exit(f"{run}: no head chosen in {far} of {len(asked)} photos, none a close-up{rest}; nothing to paint from")
    if not cut:
        sys.exit(f"{run}: no animal chosen in any photo; nothing to paint from")


if __name__ == "__main__":
    main()
