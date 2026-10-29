"""Runs ON the rented droplet, inside the ai-toolkit image (comfyui/rental/train.sh): one training job.

    python3 /mp/train.py <name>

Writes /out/<name>.yaml from anatomy-lora.yaml beside it, with the progress
samples from /pairs/samples.tsv, and runs ai-toolkit on it.
"""
import csv
import os
import runpy
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
PAIRS, OUT, MODELS, AITK = Path("/pairs"), Path("/out"), Path("/models"), Path("/aitk")


def main() -> None:
    name = sys.argv[1]
    # Nothing reaches the hub during training: every weight is the manifest's copy (models-training.manifest).
    assert os.environ.get("HF_HUB_OFFLINE") == "1", "run with HF_HUB_OFFLINE=1"
    cfg = yaml.safe_load((HERE / "anatomy-lora.yaml").read_text())
    cfg["config"]["name"] = name
    proc = cfg["config"]["process"][0]
    samples = []
    for r in csv.DictReader((PAIRS / "samples.tsv").open(), delimiter="\t"):
        s = {"prompt": r["prompt"], "ctrl_img_1": str(PAIRS / r["subject"])}
        if r["head"]:
            s["ctrl_img_2"] = str(PAIRS / r["head"])
        samples.append(s)
    proc["sample"]["samples"] = samples
    path = OUT / f"{name}.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False))

    os.chdir(AITK)
    sys.path.insert(0, str(AITK))
    # The klein 4B class names its text encoder by hub id, not by config; point it at the manifest's copy.
    from extensions_built_in.diffusion_models.flux2.flux2_klein_model import Flux2Klein4BModel
    Flux2Klein4BModel.flux2_klein_te_path = str(MODELS / "qwen3-4b")
    sys.argv = ["run.py", str(path)]
    runpy.run_path(str(AITK / "run.py"), run_name="__main__")


if __name__ == "__main__":
    main()
