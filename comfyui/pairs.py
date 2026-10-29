"""The anatomy LoRA's training pairs, from the set Logan approved (ADR-0004 as amended 2026-10-22, decision 2).

Runs in the `explore` container on the CPU:

    npm run explore:pairs -- <set tsv, under explore/> <name>

Each row of the set (painting, dog, source, file) becomes one pair under
explore/pairs/<name>/, in the layout ai-toolkit reads an edit LoRA's dataset:

    target/<painting>.png   the approved painting, pixels only
    target/<painting>.txt   its caption: the trigger word, then the prompt klein-v1 painted it from
    subject/<painting>.png  the grown subject crop klein-v1 read, scaled as the workflow scales it
    head/<painting>.png     the grown head, likewise (absent where the painting read no head)
    pairs.tsv               where each pair came from: the batch run, the Commons file, the source
    samples/, samples.tsv   references and prompts of a few lora-holdout dogs, for the
                            trainer's progress samples (never trained on)

The references are the crops the original painting read, even where the
target is a repaint, because the LoRA has to learn to paint a clean
underside from the inputs production hands klein-v1, not from a painting.
"""
import csv
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from explore import BUCKETS, EXPLORE, INPUT, OUTPUT, bucket, input_name  # noqa: E402

# The made-up word the LoRA's captions carry (decision 2); production's prompt gains it when the LoRA ships.
TRIGGER = "mpclean"
REPAINTS = ("batch15a", "batch16a", "batch16b")
SAMPLES = 4  # holdout dogs in the trainer's progress samples, half sitting and half standing where the holdout allows


def scaled(path: Path, size: tuple[int, int]):
    """ComfyUI's ImageScale with crop "center": trim the source to the target's aspect, centred, then Lanczos."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    w, h = im.size
    old, new = w / h, size[0] / size[1]
    x = y = 0
    if old > new:
        x = round((w - w * (new / old)) / 2)
    elif old < new:
        y = round((h - h * (old / new)) / 2)
    return im.crop((x, y, w - x, h - y)).resize(size, Image.LANCZOS)


def references(run: dict) -> dict:
    """The references a klein-v1 painting read, at the sizes its graph scaled them to (explore.build_family_graph)."""
    from PIL import Image
    assert run["graph"] in ("reference", "reference2") and run["crop"] == "grownsubject" and len(run["photos"]) == 1, run["id"]
    subject = INPUT / input_name(run["animal"], run["photos"][0], "grownsubject", raw=True)
    refs = {"subject": scaled(subject, bucket(Image.open(subject).size))}
    if run["graph"] == "reference2":
        assert run["head"] == "grownhead", run["id"]
        head = INPUT / input_name(run["animal"], run["photos"][0], "grownhead", raw=True)
        bw, bh = bucket(Image.open(head).size)
        refs["head"] = scaled(head, (round(bw * 0.75 / 16) * 16, round(bh * 0.75 / 16) * 16))
    return refs


def commons_set(run: dict, boxes: dict, sets: dict) -> tuple[str, str]:
    """The Commons set and file a painting's photo came from; anything else stops the build."""
    src = boxes.get(f"{run['animal']}/{Path(run['photos'][0]).stem}", {}).get("_src", "")
    # Never a shelter or crew photo in training, so Plum, Ducky and Beetle stay a clean test (ADR-0031; ADR-0004 as amended 2026-10-28).
    if not src.startswith("commons:"):
        raise SystemExit(f"{run['id']}: its photo is not a Commons file ({src or 'no source'}) — never in a training set")
    rel = src.split(":", 1)[1]
    folder, name = rel.split("/", 1)
    # The LoRA's rows record the file under its set's folder (commons_fetch.py); the detector's earlier rows, bare.
    if folder not in (sets.get(rel), sets.get(name)):
        raise SystemExit(f"{run['id']}: {name} is not in commons-photos.tsv under {folder}")
    return folder, name


def pixels_only(im):
    """A copy with no metadata: ComfyUI's PNGs carry the whole workflow in their text chunks."""
    from PIL import Image
    clean = Image.new("RGB", im.size)
    clean.paste(im.convert("RGB"))
    return clean


def main() -> None:
    from PIL import Image
    if len(sys.argv) != 3:
        raise SystemExit("usage: pairs.py <set tsv, under explore/> <name>")
    rows = [r for r in csv.DictReader((l for l in (EXPLORE / sys.argv[1]).open() if not l.startswith("#")), delimiter="\t")]
    final = EXPLORE / "pairs" / sys.argv[2]
    if final.exists():
        raise SystemExit(f"{final} exists: a set's pairs are written once, so a new set gets a new name")
    # Built aside and renamed at the end, so a failed build never leaves a set that looks whole.
    out = final.with_name(final.name + ".part")
    if out.exists():
        shutil.rmtree(out)

    runs = {}
    for b in sorted(p.parent.name for p in EXPLORE.glob("batch13*/runs.jsonl")) + list(REPAINTS):
        runs[b] = [json.loads(l) for l in (EXPLORE / b / "runs.jsonl").open()]
    boxes = json.loads((HERE / "explore" / "boxes-detected.json").read_text())
    sets = {r["file"]: r["set"] for r in csv.DictReader((l for l in (HERE / "explore" / "commons-photos.tsv").open() if not l.startswith("#")), delimiter="\t")}

    def original(tag: str) -> dict:
        batch, n = re.fullmatch(r"(13[a-d])-(\d{3})", tag).groups()
        found = [r for r in runs[f"batch{batch}"] if r["id"].startswith(f"{n}-")]
        assert len(found) == 1, tag
        return found[0]

    for d in ("target", "subject", "head", "samples"):
        (out / d).mkdir(parents=True)
    record = [("painting", "dog", "source", "photo", "set", "graph", "prompt", "target_from")]
    for row in rows:
        run = original(row["painting"])
        folder, photo = commons_set(run, boxes, sets)
        if folder != "lora-train":
            raise SystemExit(f"{row['painting']}: {photo} is in {folder}, not lora-train")
        src = row["file"]
        path = (OUTPUT / src.removeprefix("var/comfyui/output/")) if src.startswith("var/comfyui/output/") else (EXPLORE / src.removeprefix("var/explore/"))
        if not row["source"].startswith("original"):
            # A repaint must be of this very painting: its run names the painting it repainted.
            stem = re.sub(r"(_\d{5}_|-w0\.\d+)$", "", path.stem)
            rep = [r for b in REPAINTS for r in runs[b] if r["id"] == stem]
            assert len(rep) == 1 and rep[0]["painting"]["from"] == f"batch{row['painting'][:3]} {row['painting'][4:]}", (row, stem)
        target = Image.open(path)
        assert target.size == (1216, 832), (row["painting"], target.size)
        pixels_only(target).save(out / "target" / f"{row['painting']}.png")
        (out / "target" / f"{row['painting']}.txt").write_text(f"{TRIGGER}, {run['prompt_text']}\n")
        for kind, im in references(run).items():
            assert im.size in BUCKETS or kind == "head", (row["painting"], im.size)
            im.save(out / kind / f"{row['painting']}.png")
        record.append((row["painting"], row["dog"], row["source"], photo, folder, run["graph"], run["prompt"], src))

    # Progress samples from dogs the LoRA never sees: their first painting each, sitting and standing alternated.
    held = {}
    for b in sorted(runs):
        for r in runs[b]:
            if b.startswith("batch13") and r["animal"] not in held:
                try:
                    if commons_set(r, boxes, sets)[0] == "lora-holdout":
                        held[r["animal"]] = r
                except SystemExit:
                    pass
    trained = {r["dog"] for r in rows}
    assert not trained & set(held), trained & set(held)
    sit = [r for r in held.values() if "sit" in r["prompt"]]
    stand = [r for r in held.values() if "stand" in r["prompt"]]
    picked = [r for pair in zip(sit, stand) for r in pair][:SAMPLES]
    picked += [r for r in sit + stand if r not in picked][: SAMPLES - len(picked)]
    samples = [("dog", "prompt", "subject", "head")]
    for r in picked:
        refs = references(r)
        for kind, im in refs.items():
            im.save(out / "samples" / f"{r['animal']}.{kind}.png")
        samples.append((r["animal"], f"{TRIGGER}, {r['prompt_text']}", f"samples/{r['animal']}.subject.png", f"samples/{r['animal']}.head.png" if "head" in refs else ""))

    for name, table in (("pairs.tsv", record), ("samples.tsv", samples)):
        with (out / name).open("w", newline="") as f:
            csv.writer(f, delimiter="\t", lineterminator="\n").writerows(table)
    heads = len(list((out / "head").glob("*.png")))
    out.rename(final)
    print(f"pairs: {len(rows)} in {final} ({heads} with a head), {len(picked)} holdout samples ({', '.join(r['animal'] for r in picked)})")


if __name__ == "__main__":
    main()
