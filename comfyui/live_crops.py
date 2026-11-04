"""A keepsake's crops by live detection, for the art.generate handler (src/worker/art.ts; ADR-0026).

Runs in the `explore` container on the CPU:

    DETECT_PIPELINES=owlv2 python /home/comfy/harness/live_crops.py <run>

Reads explore/<run>/detect.json, one listing in detect.py's own shape written by the handler; runs detect.py's
rules with DETECT_OUT at explore/<run>/detect and crops.py's growth on what they chose; then cuts each photo's
subject and head into input/crew/<run>/ as `explore.py prep` cuts the crew's, and writes explore/<run>/cut.json:
the photos cut, each with whether a head was found. DETECT_PIPELINES chooses the detector, as for the
comparison runs, so a new detector is a stage-1 function in detect.py and nothing here.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPLORE = Path("/home/comfy/explore")
CROPS = ("detsubject", "grownsubject", "dethead", "grownhead")


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
    cut = []
    for ref in asked:
        # A detector can choose no animal in a photo (sam3 returns none): that photo is left out, by name, never guessed.
        found = grown.get(detect.key(run, ref))
        if not found or not found.get("grownsubject"):
            print(f"{run}: no animal chosen in {ref}", flush=True)
            continue
        src = detect.photo_path(ref)
        # Under the run's own name, never the pet's: the crew's batch-11 crops are kept, and a live run is never mistaken for one.
        explore.cut(run, src, {"full": None, **{c: found[c] for c in CROPS if found.get(c)}}, f"{run}/{src.stem}")
        cut.append({"ref": ref, "file": src.name, "head": bool(found.get("grownhead"))})
    (out / "cut.json").write_text(json.dumps(cut, indent=1) + "\n")
    print(f"{run}: {len(cut)} of {len(asked)} photos cut into input/crew/{run}/, {sum(c['head'] for c in cut)} with a head", flush=True)
    if not any(c["head"] for c in cut):
        sys.exit(f"{run}: no photo with an animal and its head; nothing to paint from")


if __name__ == "__main__":
    main()
