"""A photo's look in words, read on the CPU by a local photo reader (doc/plans/base-model-candidates.md, "A local photo reader").

Runs in the `explore` container, never beside a painting run:

    python /home/comfy/harness/read.py <out.json> <species> <photo ref> [<photo ref> …]

A photo ref is detect.py's: `commons:<set>/<file>` or `held:<run>/photos/<file>`. Each photo is asked one structured
question, and out.json gets, per ref, the reader's raw answer, the fields it parsed, the phrase built from them and the
seconds it took. Its weights are verified against models.manifest and read from the models store offline: nothing here
sends a photo anywhere (ADR-0004 as amended 2026-11-04).
"""
import json
import os
import re
import sys
import time
from pathlib import Path

# READER names the model, its files listed in models.manifest, the licence record: a model with no line there never runs.
STORE = Path("/home/comfy/ComfyUI/models")
MODEL = STORE / "read" / os.environ.get("READER", "qwen3-vl-4b-instruct")
PHOTOS, EXPLORE, CREW = Path("/home/comfy/photos"), Path("/home/comfy/explore"), Path("/home/comfy/crew")
# The long side the reader sees: its image tokens grow with the square of it, and the CPU pays for each.
SIDE = 768
# Choices, not examples: a small reader copies an example's colours into every answer. Logan judged exactly these words on
# batch 40b, and two rewordings read worse (batches 40c-40d): any change here goes back in front of his eye.
EARS = ["tall upright pointed", "upright with folded tips", "folded-over", "long hanging", "short floppy", "cropped upright"]
# The head, face and ears only: words for the paws or tail made klein paint the whole dog, and a chest's colour reads to it
# as clothing (batch 40a, Logan, 2026-11-04).
QUESTION = (
    "Describe the {species} in this photo for a painter who cannot see it. Reply with JSON only, with these keys: "
    '"coat": the fur colours of its head, face and ears only and where each falls, in at most 10 words, the fur only and never anything it wears, '
    'and never its neck, chest, body, legs, paws or tail; '
    '"length": its fur, one of "short", "medium" or "long"; '
    f'"ears": how this {{species}}\'s own ears look in this photo, not how its breed\'s usually do, exactly one of {json.dumps(EARS)}; '
    '"eyes": their colour. Describe only what you can see in the photo.'
)


def photo_path(ref: str) -> Path:
    kind, rel = ref.split(":", 1)
    return {"commons": PHOTOS / "commons", "held": EXPLORE, "crew": CREW}[kind] / rel


def parse(answer: str) -> dict:
    m = re.search(r"\{.*\}", answer, re.S)
    try:
        return json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        return {}


def phrase(fields: dict) -> str | None:
    """The reader's look as words after the listing's: "with <coat>, <length> fur and <ears> ears"."""
    coat, length, ears = (str(fields.get(k, "")).strip().rstrip(".").lower() for k in ("coat", "length", "ears"))
    # a reader can run past its choice ("long hanging with soft, drooping edges"): the choice it starts with is the answer
    ears = next((e for e in EARS if ears.startswith(e)), ears)
    if not coat or length not in ("short", "medium", "long") or ears not in EARS:
        return None
    return f"with {coat}, {length} fur and {ears} ears"


def verify(model: Path) -> None:
    """The reader's files against models.manifest, as ComfyUI's start checks its own: a file that disagrees never loads."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import models
    rel = model.relative_to(STORE).as_posix()
    entries = [e for e in models.parse((Path(__file__).resolve().parent / "models.manifest").read_text()) if e.path.startswith(f"{rel}/")]
    if not entries:
        sys.exit(f"{rel} has no line in models.manifest; it never runs")
    for e in entries:
        if not (STORE / e.path).exists() or models.digest(STORE / e.path) != e.sha256:
            sys.exit(f"{e.path} disagrees with models.manifest; refusing to read")


def main() -> None:
    out, species, refs = Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
    import torch
    from PIL import Image, ImageOps
    from transformers import AutoProcessor, Qwen3VLForConditionalGeneration
    torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "4")))
    t0 = time.time()
    verify(MODEL)
    proc = AutoProcessor.from_pretrained(MODEL, local_files_only=True)
    model = Qwen3VLForConditionalGeneration.from_pretrained(MODEL, dtype=torch.bfloat16, local_files_only=True).eval()
    print(f"reader verified and loaded in {time.time() - t0:.0f}s", flush=True)
    results = json.loads(out.read_text()) if out.exists() else {}
    for ref in refs:
        if ref in results:
            continue
        im = ImageOps.exif_transpose(Image.open(photo_path(ref))).convert("RGB")
        im.thumbnail((SIDE, SIDE), Image.LANCZOS)
        messages = [{"role": "user", "content": [{"type": "image", "image": im}, {"type": "text", "text": QUESTION.format(species=species)}]}]
        inputs = proc.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors="pt")
        t = time.time()
        with torch.no_grad():
            ids = model.generate(**inputs, max_new_tokens=120, do_sample=False)
        answer = proc.batch_decode(ids[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()
        fields = parse(answer)
        results[ref] = {"answer": answer, "fields": fields, "phrase": phrase(fields), "seconds": round(time.time() - t, 1)}
        out.write_text(json.dumps(results, indent=1) + "\n")
        # A listing's words stay out of its log: they're read from a shelter's photo, and only the prompt may carry them.
        said = ("read" if results[ref]["phrase"] else "unparsed") if ref.startswith("held:") else (results[ref]["phrase"] or "UNPARSED: " + answer[:120])
        print(f"{ref}: {results[ref]['seconds']}s {said}", flush=True)


if __name__ == "__main__":
    main()
