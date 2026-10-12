"""Generate a settings matrix through a running ComfyUI and lay the results out for a person to pick from.

Runs inside the ComfyUI image via the `explore` compose service (it needs
Pillow and ComfyUI's input/output mounts, not the GPU):

    npm run explore -- prep                 # crew photos → input/crew/, EXIF stripped, subject crops from explore/boxes.json (by hand) and boxes-detected.json (ADR-0026)
    npm run explore -- run batch1           # every run the spec expands to; resumable
    npm run explore -- run batch1 --limit 4 # a taste
    npm run explore -- sheet batch1         # rebuild index.html from runs.jsonl
    npm run explore -- grid batch1d --rows animal,photo,seed --cols control_strength,control_end --where lora=tinies
                                            # one JPEG, a cell per (row, col): a batch read at a glance

The plan behind the batches is doc/plans/the-look-exploration.md. A run's
record in runs.jsonl is enough to rebuild its graph exactly.
"""
import argparse
import html
import itertools
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
CREW = Path("/home/comfy/crew")
INPUT = Path("/home/comfy/ComfyUI/input")
OUTPUT = Path("/home/comfy/ComfyUI/output")
EXPLORE = Path("/home/comfy/explore")
HOST = "http://comfyui:8188"
NEGATIVE = "blurry, text, watermark, extra limbs, deformed, two animals"
# stylised families also push away from the photograph the adapter is copying (batch 1b)
NEGATIVE_STYLED = NEGATIVE + ", photograph, photorealistic"
# style LoRAs beside the adapter — stand-ins for our own (roadmap item 9), licensed in models.manifest
LORAS = {"watercolor": "watercolor_v1_sdxl.safetensors", "tinies": "Little_Tinies.safetensors"}
CONTROLNET = "xinsir-canny-sdxl-1.0-v2.safetensors"
# SDXL's native buckets near the box aspects we meet (batch 1d): render a tall box tall, never pad it
BUCKETS = [(1024, 1024), (896, 1152), (832, 1216), (1152, 896), (1216, 832)]
PROMPTS = {
    "photo": "a photo of a {kind}, soft natural light, shallow depth of field",
    "storybook": "a gentle storybook illustration of a {kind}, soft watercolor, warm pastel palette, plain background",
    "storybook_sit": "a gentle storybook illustration of a {kind} sitting upright and facing the viewer, soft watercolor, warm pastel palette, plain background",
    "storybook_sit34": "a gentle storybook illustration of a {kind} sitting in three-quarter view, looking toward the viewer, soft watercolor, warm pastel palette, plain background",
    "storybook_stand34": "a gentle storybook illustration of a {kind} standing in three-quarter view, looking toward the viewer, soft watercolor, warm pastel palette, plain background",
    "cartoon": "a cel-shaded cartoon of a {kind}, bold clean outlines, flat colors, friendly expression",
    "anime": "an anime illustration of a {kind}, soft shading, expressive eyes, clean lineart",
    "clay": "a claymation {kind}, stop-motion figure, fingerprints in the clay, studio lighting",
    "oil": "a painterly oil portrait of a {kind}, visible brushstrokes, warm light",
    "plush": "a plush toy {kind}, soft felt and fleece, button eyes, sitting on a shelf",
}


# ---------------------------------------------------------------- photos

def prep() -> None:
    """Copy every crew photo into input/crew/ as an upright PNG with no metadata at all, plus one PNG per subject box."""
    from PIL import Image, ImageOps
    boxes = json.loads((HERE / "explore" / "boxes.json").read_text())
    for key, found in json.loads((HERE / "explore" / "boxes-detected.json").read_text()).items():
        if not key.startswith("_"):
            boxes.setdefault(key, {}).update(found)
    for src in sorted(CREW.glob("*/*")):
        if src.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        key = f"{src.parent.name}/{src.stem}"
        wanted = {"full": None, **{k: v for k, v in boxes.get(key, {}).items() if not k.startswith("_")}}
        outs = {crop: INPUT / input_name(src.parent.name, src.name, crop) for crop in wanted}
        raws = [INPUT / input_name(src.parent.name, src.name, crop, raw=True) for crop in wanted if crop != "full"]
        if all(o.exists() for o in list(outs.values()) + raws):
            continue
        outs["full"].parent.mkdir(parents=True, exist_ok=True)
        # ImageOps.exif_transpose bakes the orientation in; `convert` then
        # drops the info dict, so no EXIF, GPS or XMP survives into the PNG.
        im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        im.thumbnail((1536, 1536), Image.LANCZOS)
        for crop, box in wanted.items():
            variants = {outs[crop]: None if box is None else squared(im, box)}
            if box is not None:
                variants[INPUT / input_name(src.parent.name, src.name, crop, raw=True)] = im.crop(tuple(round(b * d) for b, d in zip(box, im.size * 2)))
            for dst, part in variants.items():
                if dst.exists():
                    continue
                part = im if part is None else part
                clean = Image.new("RGB", part.size)
                clean.paste(part)
                clean.save(dst, "PNG")
                print(f"prep  {key} -> {dst.relative_to(INPUT)} {clean.size}")


def squared(im, box: list[float]):
    """The box (fractions of the photo) cut out and set on a square whose margins are the crop itself, stretched and blurred."""
    from PIL import Image, ImageFilter
    # Never grow the box into the photo to square it (the companion animal gets
    # back in), and never pad with a flat colour: the adapter copied that as
    # grey bands down both sides of every image (2026-10-08).
    w, h = im.size
    part = im.crop((round(box[0] * w), round(box[1] * h), round(box[2] * w), round(box[3] * h)))
    side = max(part.size)
    if part.size == (side, side):
        return part
    out = part.resize((side, side), Image.LANCZOS).filter(ImageFilter.GaussianBlur(side / 16))
    out.paste(part, ((side - part.width) // 2, (side - part.height) // 2))
    return out


def input_name(animal: str, photo: str, crop: str = "full", raw: bool = False) -> str:
    return f"crew/{animal}/{Path(photo).stem}{'' if crop == 'full' else '.' + crop}{'.raw' if raw else ''}.png"


def bucket(size: tuple[int, int]) -> tuple[int, int]:
    """The SDXL resolution whose aspect is nearest the image's."""
    w, h = size
    return min(BUCKETS, key=lambda b: abs(b[0] / b[1] - w / h))


# ---------------------------------------------------------------- graphs

# Base-model bake-off (doc/plans/base-model-candidates.md, Experiment B): the
# three shippable candidates beside SDXL, each with the sampler settings its
# own release notes give. Unaided (txt2img), helped by the photo in the
# latent (img2img), or — klein only — the photo as a reference the model
# reads (reference). No adapter, ControlNet or LoRA exists for them yet.
ZIMAGE_CONTROL = "z-image-turbo-fun-controlnet-union.safetensors"
FAMILIES = {
    # fp8 weights and the fp8 encoder for both: in bf16 either transformer beside the 7.5 GB Qwen3 encoder spilled the card (pool 4.4 GB, 2026-10-11)
    "zimage": {"unet": "z_image_turbo_bf16.safetensors", "dtype": "fp8_e4m3fn", "clip": ("qwen_3_4b_fp8_mixed.safetensors", "lumina2"), "vae": "ae.safetensors",
               "steps": 8, "cfg": 1.0, "sampler": "euler", "scheduler": "simple", "shift": 3.0},
    "klein":  {"unet": "flux-2-klein-4b.safetensors", "dtype": "fp8_e4m3fn", "clip": ("qwen_3_4b_fp8_mixed.safetensors", "flux2"), "vae": "flux2-vae.safetensors",
               "steps": 4, "cfg": 1.0, "sampler": "euler", "scheduler": "simple"},
    "chroma": {"unet": "chroma1-hd-fp8mixed.safetensors", "clip": ("t5xxl_fp8_e4m3fn_scaled.safetensors", "chroma"), "vae": "ae.safetensors",
               "steps": 26, "cfg": 4.0, "sampler": "euler", "scheduler": "beta"},
}


def build_family_graph(run: dict, prefix: str) -> dict:
    f = FAMILIES[run["family"]]
    dtype = run.get("dtype") or f.get("dtype", "default")
    steps = run.get("steps") or f["steps"]
    raw = run.get("crop", "full") != "full"
    photo = input_name(run["animal"], run["photos"][0], run.get("crop", "full"), raw=raw)
    width, height = (1024, 1024)
    if raw:
        from PIL import Image
        width, height = bucket(Image.open(INPUT / photo).size)
    g = {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": f["unet"], "weight_dtype": dtype}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": f["clip"][0], "type": f["clip"][1]}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": f["vae"]}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["clip", 0], "text": run["prompt_text"]}},
        "img0": {"class_type": "LoadImage", "inputs": {"image": photo}},
        "scale": {"class_type": "ImageScale", "inputs": {"image": ["img0", 0], "upscale_method": "lanczos", "width": width, "height": height, "crop": "center"}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": prefix}},
    }
    model = ["unet", 0]
    if "shift" in f:
        g["shift"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": model, "shift": f["shift"]}}
        model = ["shift", 0]
    if run["family"] == "zimage" and run.get("control_strength"):
        # the outline from the same crop, through Z-Image's own control patch (a model patch, not a ControlNet node)
        g["canny"] = {"class_type": "Canny", "inputs": {"image": ["scale", 0], "low_threshold": 0.3, "high_threshold": 0.7}}
        g["patch"] = {"class_type": "ModelPatchLoader", "inputs": {"name": ZIMAGE_CONTROL}}
        g["ctl"] = {"class_type": "ZImageFunControlnet", "inputs": {"model": model, "model_patch": ["patch", 0], "vae": ["vae", 0], "strength": run["control_strength"],
                                                                     "image": ["canny", 0], "start_percent": 0.0, "end_percent": run["control_end"]}}
        model = ["ctl", 0]
    if f["cfg"] > 1.0:
        g["neg"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": ["clip", 0], "text": run["negative"]}}
    else:  # distilled models take no negative; a zeroed conditioning is the documented stand-in
        g["neg"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}}
    pos = ["pos", 0]
    empty = "EmptyFlux2LatentImage" if run["family"] == "klein" else "EmptySD3LatentImage"
    if run["graph"] == "img2img":
        g["latent"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": ["vae", 0]}}
        denoise = run["denoise"]
    else:
        g["latent"] = {"class_type": empty, "inputs": {"width": width, "height": height, "batch_size": 1}}
        denoise = 1.0
        if run["graph"] in ("reference", "reference2"):
            g["ref"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": ["vae", 0]}}
            g["refcond"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": pos, "latent": ["ref", 0]}}
            pos = ["refcond", 0]
            for i, extra in enumerate(run["photos"][1:], 1):  # a listing's other photos, each a further reference
                from PIL import Image
                name = input_name(run["animal"], extra, run.get("crop", "full"), raw=raw)
                w, h = bucket(Image.open(INPUT / name).size) if raw else (1024, 1024)
                g[f"img{i}"] = {"class_type": "LoadImage", "inputs": {"image": name}}
                g[f"scale{i}"] = {"class_type": "ImageScale", "inputs": {"image": [f"img{i}", 0], "upscale_method": "lanczos", "width": w, "height": h, "crop": "center"}}
                g[f"ref{i}"] = {"class_type": "VAEEncode", "inputs": {"pixels": [f"scale{i}", 0], "vae": ["vae", 0]}}
                g[f"refcond{i}"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": pos, "latent": [f"ref{i}", 0]}}
                pos = [f"refcond{i}", 0]
        if run["graph"] == "reference2":  # the head crop as a second reference the model reads after the subject
            # A detector-cut subject reads the detector's head too, so a batch never mixes hand and detector boxes (ADR-0026).
            head = "dethead" if run.get("crop") == "detsubject" else "head"
            g["head"] = {"class_type": "LoadImage", "inputs": {"image": input_name(run["animal"], run["photos"][0], head, raw=True)}}
            g["head_scale"] = {"class_type": "ImageScale", "inputs": {"image": ["head", 0], "upscale_method": "lanczos", "width": 768, "height": 768, "crop": "center"}}
            g["head_ref"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["head_scale", 0], "vae": ["vae", 0]}}
            g["head_cond"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": pos, "latent": ["head_ref", 0]}}
            pos = ["head_cond", 0]
    g["sampler"] = {"class_type": "KSampler", "inputs": {
        "model": model, "positive": pos, "negative": ["neg", 0], "latent_image": ["latent", 0],
        "seed": run["seed"], "steps": steps, "cfg": f["cfg"], "sampler_name": f["sampler"], "scheduler": f["scheduler"], "denoise": denoise}}
    return g


def build_graph(run: dict, prefix: str) -> dict:
    """One API-format ComfyUI graph from a run record. The record is the contract."""
    if run.get("family", "sdxl") != "sdxl":
        return build_family_graph(run, prefix)
    g = {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": prefix}},
    }
    model, clip = ["ckpt", 0], ["ckpt", 1]
    if run.get("lora"):
        g["lora"] = {"class_type": "LoraLoader", "inputs": {"model": model, "clip": clip, "lora_name": LORAS[run["lora"]], "strength_model": 1.0, "strength_clip": 1.0}}
        model, clip = ["lora", 0], ["lora", 1]
    g["pos"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": run["prompt_text"]}}
    g["neg"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": run["negative"]}}
    # the crop is what the encoder sees; the latent (img2img) always starts from the whole photo
    raw = run.get("aspect") == "box" and run.get("crop", "full") != "full"
    photos = [input_name(run["animal"], p, run.get("crop", "full"), raw=raw) for p in run["photos"]]
    for i, name in enumerate(photos):
        g[f"img{i}"] = {"class_type": "LoadImage", "inputs": {"image": name}}
    width, height = (1024, 1024)
    if raw:
        from PIL import Image
        width, height = bucket(Image.open(INPUT / photos[0]).size)

    # latent: noise, or the first photo encoded (img2img)
    if run["graph"] == "adapter":
        g["latent"] = {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}}
        denoise = 1.0
    else:
        g["img_full"] = {"class_type": "LoadImage", "inputs": {"image": input_name(run["animal"], run["photos"][0])}}
        g["scale"] = {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": ["img_full", 0], "upscale_method": "lanczos", "megapixels": 1.0, "resolution_steps": 8}}
        g["latent"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": ["ckpt", 2]}}
        denoise = run["denoise"]

    # model: through the adapter, or plain
    if run["graph"] in ("adapter", "both"):
        g["clipvision"] = {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"}}
        g["ipa_model"] = {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": "ip-adapter-plus_sdxl_vit-h.safetensors"}}
        for i in range(len(photos)):
            g[f"prep{i}"] = {"class_type": "PrepImageForClipVision", "inputs": {"image": [f"img{i}", 0], "interpolation": "LANCZOS", "crop_position": "top" if height > width else "center", "sharpening": 0.0}}
        if run.get("multi", "batch") == "encoder":
            for i in range(len(photos)):
                g[f"enc{i}"] = {"class_type": "IPAdapterEncoder", "inputs": {"ipadapter": ["ipa_model", 0], "image": [f"prep{i}", 0], "weight": 1.0, "clip_vision": ["clipvision", 0]}}
            embed = ["enc0", 0]
            if len(photos) > 1:
                combine = {"embed1": ["enc0", 0], "method": run.get("combine", "concat")}
                for i in range(1, len(photos)):
                    combine[f"embed{i + 1}"] = [f"enc{i}", 0]
                g["combine"] = {"class_type": "IPAdapterCombineEmbeds", "inputs": combine}
                embed = ["combine", 0]
            g["ipa"] = {"class_type": "IPAdapterEmbeds", "inputs": {
                "model": model, "ipadapter": ["ipa_model", 0], "pos_embed": embed, "clip_vision": ["clipvision", 0],
                "weight": run["weight"], "weight_type": run["weight_type"], "start_at": 0.0, "end_at": run["end_at"], "embeds_scaling": "V only"}}
        else:
            image = ["prep0", 0]
            for i in range(1, len(photos)):
                g[f"batch{i}"] = {"class_type": "ImageBatch", "inputs": {"image1": image, "image2": [f"prep{i}", 0]}}
                image = [f"batch{i}", 0]
            g["ipa"] = {"class_type": "IPAdapterAdvanced", "inputs": {
                "model": model, "ipadapter": ["ipa_model", 0], "image": image, "clip_vision": ["clipvision", 0],
                "weight": run["weight"], "weight_type": run["weight_type"], "combine_embeds": run.get("combine", "concat"),
                "start_at": 0.0, "end_at": run["end_at"], "embeds_scaling": "V only"}}
        model = ["ipa", 0]

    pos, neg = ["pos", 0], ["neg", 0]
    if run.get("control_strength"):
        # the outline comes from the same picture the encoder sees, so pose and crop agree (batch 1c)
        g["cn_scale"] = {"class_type": "ImageScale", "inputs": {"image": ["img0", 0], "upscale_method": "lanczos", "width": width, "height": height, "crop": "center"}}
        g["canny"] = {"class_type": "Canny", "inputs": {"image": ["cn_scale", 0], "low_threshold": 0.3, "high_threshold": 0.7}}
        g["cn_model"] = {"class_type": "ControlNetLoader", "inputs": {"control_net_name": CONTROLNET}}
        g["cn"] = {"class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": pos, "negative": neg, "control_net": ["cn_model", 0], "image": ["canny", 0], "vae": ["ckpt", 2],
            "strength": run["control_strength"], "start_percent": 0.0, "end_percent": run["control_end"]}}
        pos, neg = ["cn", 0], ["cn", 1]
    g["sampler"] = {"class_type": "KSampler", "inputs": {
        "model": model, "positive": pos, "negative": neg, "latent_image": ["latent", 0],
        "seed": run["seed"], "steps": run.get("steps", 25), "cfg": 6.0, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": denoise}}
    return g


# ---------------------------------------------------------------- batches

def expand(spec: dict) -> list[dict]:
    """The cartesian product of a batch spec's axes, minus knobs a graph does not have."""
    runs = []
    for animal, info in spec["animals"].items():
        for photo_key, crop, describe, aspect, family in itertools.product(spec["photos"], spec.get("crops", ["full"]), spec.get("describe", ["generic"]), spec.get("aspect", ["square"]), spec.get("families", ["sdxl"])):
            photos = info[photo_key] if isinstance(info[photo_key], list) else [info[photo_key]]
            subject = info["kind"] if describe == "generic" else info["describe" if describe == "listing" else describe]
            for graph, prompt, seed in itertools.product(spec["graphs"], spec["prompts"], spec["seeds"]):
                base = {"animal": animal, "kind": info["kind"], "photo": photo_key, "photos": photos, "crop": crop, "describe": describe, "aspect": aspect, "family": family,
                        "graph": graph, "prompt": prompt, "prompt_text": PROMPTS[prompt].format(kind=subject),
                        "negative": NEGATIVE if prompt == "photo" else NEGATIVE_STYLED, "seed": seed}
                controls = [(st, en) for st in spec.get("control_strength", [0]) for en in (spec.get("control_end", [1.0]) if st else [None])]
                if family != "sdxl":
                    if graph not in ("txt2img", "img2img", "reference", "reference2") or (graph.startswith("reference") and family != "klein"):
                        continue
                    fam_controls = controls if family == "zimage" else [(0, None)]
                    for denoise, dtype, steps, (cs, ce) in itertools.product(spec["denoise"] if graph == "img2img" else [None], spec.get("dtypes", [None]), spec.get("steps", [None]), fam_controls):
                        runs.append({**base, "lora": None, "dtype": dtype, "steps": steps, "control_strength": cs, "control_end": ce, "denoise": denoise, "weight": None, "weight_type": None, "end_at": None})
                    continue
                if graph in ("txt2img", "reference", "reference2"):
                    continue
                loras = [None] if prompt == "photo" else spec.get("loras", [None])
                if graph == "img2img":
                    for denoise, lora, (cs, ce) in itertools.product(spec["denoise"], loras, controls):
                        runs.append({**base, "lora": lora, "control_strength": cs, "control_end": ce, "denoise": denoise, "weight": None, "weight_type": None, "end_at": None})
                    continue
                denoises = spec["denoise"] if graph == "both" else [None]
                multis = spec.get("multi", ["batch"]) if len(photos) > 1 else ["batch"]
                combines = spec.get("combine", ["concat"]) if len(photos) > 1 else ["concat"]
                for weight, wtype, end_at, denoise, multi, combine, lora, (cs, ce) in itertools.product(
                        spec["weights"], spec["weight_types"], spec["end_at"], denoises, multis, combines, loras, controls):
                    runs.append({**base, "lora": lora, "control_strength": cs, "control_end": ce, "weight": weight, "weight_type": wtype, "end_at": end_at, "denoise": denoise, "multi": multi, "combine": combine})
    for i, r in enumerate(runs):
        bits = [r["animal"], r["photo"], r["graph"], r["prompt"], f"s{r['seed']}"]
        if r.get("family", "sdxl") != "sdxl":
            bits.insert(2, r["family"])
            bits += [b for b in ({"fp8_e4m3fn": "fp8", "default": "bf16"}.get(r.get("dtype") or "", ""), f"st{r['steps']}" if r.get("steps") else "") if b]
        bits += [b for b in (r["crop"], r["describe"], r["lora"], r.get("aspect")) if b and b not in ("full", "generic", "square")]
        if r.get("control_strength"):
            bits.append(f"cn{r['control_strength']}e{r['control_end']}")
        if r["weight"] is not None:
            bits += [f"w{r['weight']}", r["weight_type"].replace(" ", "-"), f"e{r['end_at']}"]
        if r["denoise"] is not None:
            bits.append(f"d{r['denoise']}")
        if len(r["photos"]) > 1:
            bits += [r["multi"], r["combine"]] if r.get("multi") else [f"{len(r['photos'])}photos"]
        r["id"] = f"{i:03d}-" + "-".join(bits)
    return runs


# ---------------------------------------------------------------- comfy

def post(path: str, data: dict) -> dict:
    req = urllib.request.Request(f"{HOST}{path}", data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:  # a 400 carries ComfyUI's validation report; keep it, it names the bad node
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='replace')[:1500]}") from None


def run_one(batch: str, run: dict) -> str:
    prefix = f"explore/{batch}/{run['id']}"
    queued = post("/prompt", {"prompt": build_graph(run, prefix), "client_id": uuid.uuid4().hex})
    if "error" in queued:
        raise RuntimeError(json.dumps(queued, indent=2))
    pid = queued["prompt_id"]
    while True:
        time.sleep(1.5)
        with urllib.request.urlopen(f"{HOST}/history/{pid}") as r:
            hist = json.load(r).get(pid)
        if not hist:
            continue
        status = hist.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(json.dumps(status, indent=2)[:2000])
        if status.get("completed"):
            im = hist["outputs"]["save"]["images"][0]
            return f"{im['subfolder']}/{im['filename']}"


def run_batch(batch: str, limit: int | None, dry: bool, only: str | None = None) -> None:
    spec = json.loads((HERE / "explore" / f"{batch}.json").read_text())
    runs = expand(spec)
    out = EXPLORE / batch
    out.mkdir(parents=True, exist_ok=True)
    log = out / "runs.jsonl"
    done = {json.loads(l)["id"] for l in log.read_text().splitlines() if "output" in json.loads(l)} if log.exists() else set()
    todo = [r for r in runs if r["id"] not in done and (not only or only in r["id"])]
    # Grouped by LoRA so the model is patched once per chunk: every switch
    # re-patches the UNet, and on the Arc that cost host memory (2026-10-08).
    todo = sorted(todo, key=lambda r: (r.get("family", "sdxl"), r.get("dtype") or "", r.get("lora") or ""))[: limit or None]
    print(f"{batch}: {len(runs)} runs in spec, {len(done)} done, {len(todo)} to go")
    if dry:
        for r in todo:
            print(" ", r["id"])
        return
    for n, r in enumerate(todo, 1):
        t0 = time.time()
        try:
            r["output"] = run_one(batch, r)
            r["seconds"] = round(time.time() - t0, 1)
            print(f"[{n}/{len(todo)}] {r['id']}  {r['seconds']}s")
        except Exception as e:  # one bad graph must not end an hour's batch
            r["error"] = str(e)[:500]
            print(f"[{n}/{len(todo)}] {r['id']}  FAILED {r['error'][:120]}", file=sys.stderr)
        with log.open("a") as f:
            f.write(json.dumps(r) + "\n")
    sheet(batch)


# ---------------------------------------------------------------- sheet

AXES = ["animal", "photo", "family", "dtype", "steps", "graph", "prompt", "crop", "describe", "aspect", "lora", "control_strength", "control_end", "weight", "weight_type", "end_at", "denoise", "seed", "multi", "combine"]


def sheet(batch: str) -> None:
    from PIL import Image
    out = EXPLORE / batch
    runs = list({json.loads(l)["id"]: json.loads(l) for l in (out / "runs.jsonl").read_text().splitlines()}.values())
    scores = {json.loads(l)["id"]: json.loads(l)["likeness"] for l in (out / "scores.jsonl").read_text().splitlines()} if (out / "scores.jsonl").exists() else {}
    thumbs = out / "thumbs"
    thumbs.mkdir(exist_ok=True)
    cards = []
    values: dict[str, set] = {a: set() for a in AXES}
    for r in runs:
        if "output" not in r:
            continue
        src = OUTPUT / r["output"]
        thumb = thumbs / (r["id"] + ".jpg")
        if not thumb.exists() and src.exists():
            im = Image.open(src)
            im.thumbnail((384, 384))
            im.convert("RGB").save(thumb, "JPEG", quality=85)
        attrs = " ".join(f'data-{a}="{html.escape(str(r.get(a)))}"' for a in AXES)
        for a in AXES:
            values[a].add(str(r.get(a)))
        caption = " · ".join(f"{a} {r[a]}" for a in AXES if r.get(a) is not None and a not in ("animal",))
        if r["id"] in scores:
            caption = f"likeness {scores[r['id']]:.3f} · " + caption
        full = "../../comfyui/output/" + r["output"]
        cards.append(
            f'<figure class="card" {attrs} data-id="{r["id"]}" data-likeness="{scores.get(r["id"], 0)}">'
            f'<a href="{html.escape(full)}" target="_blank"><img src="thumbs/{r["id"]}.jpg" alt="{html.escape(r["id"])}" loading="lazy"></a>'
            f'<figcaption><b>{html.escape(r["animal"])}</b> <label><input type="checkbox" class="pick"> pick</label><br><small>{html.escape(caption)}</small></figcaption></figure>')
    filters = []
    for a in AXES:
        vals = sorted(v for v in values[a] if v != "None")
        if len(vals) > 1:
            opts = "".join(f'<option value="{html.escape(v)}">{html.escape(v)}</option>' for v in vals)
            filters.append(f'<label>{a} <select data-axis="{a}"><option value="">all</option>{opts}</select></label>')
    page = f"""<!doctype html><meta charset="utf-8"><title>{batch} — the look</title>
<style>
body{{font:14px system-ui;margin:0;background:#faf4e8;color:#4a3728}}
header{{position:sticky;top:0;background:#fffbf2;border-bottom:1px solid #e2d3bd;padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;z-index:1}}
select{{margin-left:4px}} .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:16px}}
.card{{margin:0;background:#fffbf2;border:1px solid #e2d3bd;border-radius:12px;overflow:hidden}} .card img{{display:block;width:100%;aspect-ratio:1;object-fit:cover}}
.card.picked{{outline:3px solid #6a994e}} figcaption{{padding:6px 8px}} small{{color:#8a715c;line-height:1.3}}
textarea{{width:100%;height:80px;font:12px monospace}} .hidden{{display:none}}
</style>
<header><b>{batch}</b> <span id="count"></span> {"".join(filters)} {"<button id=\"sort\">sort by likeness</button>" if scores else ""} <button id="copy">picks → text</button></header>
<div class="grid">{"".join(cards)}</div>
<div style="padding:16px"><textarea id="picks" placeholder="your picks appear here — paste them back to Claude"></textarea></div>
<script>
const cards=[...document.querySelectorAll('.card')], sels=[...document.querySelectorAll('select')];
function apply(){{let n=0;for(const c of cards){{const show=sels.every(s=>!s.value||c.dataset[s.dataset.axis.replace(/_/g,'')]===s.value||c.getAttribute('data-'+s.dataset.axis)===s.value);c.classList.toggle('hidden',!show);if(show)n++;}}document.getElementById('count').textContent=n+' shown';}}
sels.forEach(s=>s.addEventListener('change',apply));apply();
const key='picks:{batch}';let picks=new Set();try{{picks=new Set(JSON.parse(localStorage.getItem(key)||'[]'))}}catch(e){{}}
function paint(){{for(const c of cards){{const on=picks.has(c.dataset.id);c.classList.toggle('picked',on);c.querySelector('.pick').checked=on;}}document.getElementById('picks').value=[...picks].join('\\n');try{{localStorage.setItem(key,JSON.stringify([...picks]))}}catch(e){{}}}}
cards.forEach(c=>c.querySelector('.pick').addEventListener('change',e=>{{e.target.checked?picks.add(c.dataset.id):picks.delete(c.dataset.id);paint();}}));paint();
const sb=document.getElementById('sort');if(sb)sb.onclick=()=>{{const g=document.querySelector('.grid');[...g.children].sort((a,b)=>b.dataset.likeness-a.dataset.likeness).forEach(c=>g.appendChild(c));}};
document.getElementById('copy').onclick=()=>{{const t=document.getElementById('picks');t.select();try{{navigator.clipboard.writeText(t.value)}}catch(e){{}}}};
</script>"""
    (out / "index.html").write_text(page)
    print(f"sheet: {out / 'index.html'} ({len(cards)} images)")


def grid(batch: str, rows: list[str], cols: list[str], where: dict[str, str], size: int, name: str | None) -> Path:
    """One image per (row, col) cell of the batch, labelled, so a read of forty images is one look."""
    from PIL import Image, ImageDraw
    out = EXPLORE / batch
    runs = [json.loads(l) for l in (out / "runs.jsonl").read_text().splitlines()]
    runs = [r for r in runs if "output" in r and all(str(r.get(k)) == v for k, v in where.items())]
    def key(r, axes):
        return tuple(r.get(a) for a in axes)
    def order(vals):
        return sorted(vals, key=lambda t: tuple((0, v) if isinstance(v, (int, float)) and v is not None else (1, str(v)) for v in t))
    rkeys = order({key(r, rows) for r in runs})
    ckeys = order({key(r, cols) for r in runs})
    cell = {}
    for r in runs:
        cell.setdefault((key(r, rows), key(r, cols)), r)
    def label(axes, k):
        return " ".join(f"{v}" if a in ("animal", "photo", "lora", "crop") else f"{a.replace('control_', 'cn ').replace('_', ' ')} {v}" for a, v in zip(axes, k) if v is not None)
    sheet = Image.new("RGB", (size * len(ckeys), size * len(rkeys)), "white")
    d = ImageDraw.Draw(sheet)
    for i, rk in enumerate(rkeys):
        for j, ck in enumerate(ckeys):
            r = cell.get((rk, ck))
            if not r:
                continue
            im = Image.open(OUTPUT / r["output"]).convert("RGB")
            im.thumbnail((size, size))
            sheet.paste(im, (j * size + (size - im.width) // 2, i * size + (size - im.height) // 2))
            d.text((j * size + 3, i * size + 3), f"{label(rows, rk)} | {label(cols, ck)}", fill="red")
    dst = out / f"grid-{name or ('-'.join(rows) + '-x-' + '-'.join(cols))}.jpg"
    sheet.save(dst, "JPEG", quality=82)
    print(f"grid: {dst} ({len(rkeys)} rows × {len(ckeys)} cols, {len(cell)} cells)")
    return dst


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prep")
    r = sub.add_parser("run"); r.add_argument("batch"); r.add_argument("--limit", type=int); r.add_argument("--dry-run", action="store_true"); r.add_argument("--only", help="run only ids containing this text")
    s = sub.add_parser("sheet"); s.add_argument("batch")
    g = sub.add_parser("grid"); g.add_argument("batch"); g.add_argument("--rows", required=True); g.add_argument("--cols", required=True)
    g.add_argument("--where", action="append", default=[], help="axis=value, repeatable"); g.add_argument("--size", type=int, default=230); g.add_argument("--name")
    a = ap.parse_args()
    if a.cmd == "prep":
        prep()
    elif a.cmd == "run":
        prep()
        run_batch(a.batch, a.limit, a.dry_run, a.only)
    elif a.cmd == "grid":
        grid(a.batch, a.rows.split(","), a.cols.split(","), dict(w.split("=", 1) for w in a.where), a.size, a.name)
    else:
        sheet(a.batch)
    return 0


if __name__ == "__main__":
    sys.exit(main())
