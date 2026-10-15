"""Queue an API-format workflow on a running ComfyUI and wait for its images (ADR-0004 decision 1).

    python3 comfyui/run_workflow.py comfyui/workflows/sdxl-txt2img.api.json \
        --prompt "a photo of a scruffy terrier" --seed 7
    python3 comfyui/run_workflow.py comfyui/workflows/sdxl-ipadapter-v0.api.json \
        --image var/comfyui/output/monsterpaws/txt2img_00001_.png --prompt "..." --seed 7
    python3 comfyui/run_workflow.py comfyui/workflows/klein-v1.api.json \
        --image subject1.png --size 1216x832 --image2 subject2.png --size2 1152x896 \
        --head head.png --head-size 768x768 --prompt "..." --seed 7

The committed workflow is the contract; this script only fills the few
inputs a run varies (prompt, negative, seed, identity images and the sizes
they are read at) by node id, and is the same call the worker will make from
Node later (roadmap item 4). Crops and sizes come from the detector and the
harness (`comfyui/crops.py`, `explore.py bucket`); this script takes them as given.
"""
import argparse
import json
import mimetypes
import sys
import time
import urllib.request
import uuid
from pathlib import Path


def post(host: str, path: str, data: bytes, content_type: str):
    req = urllib.request.Request(f"{host}{path}", data=data, headers={"Content-Type": content_type})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def upload_image(host: str, image: Path) -> str:
    boundary = uuid.uuid4().hex
    ctype = mimetypes.guess_type(image.name)[0] or "application/octet-stream"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{image.name}\"\r\n"
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode() + image.read_bytes() + f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n".encode()
    return post(host, "/upload/image", body, f"multipart/form-data; boundary={boundary}")["name"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("workflow", type=Path)
    ap.add_argument("--host", default="http://127.0.0.1:8188")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--negative", default="")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--image", type=Path, help="identity photo: node 'img' (SDXL) or the first subject crop 'img0' (klein)")
    ap.add_argument("--size", help="WxH the first subject crop is read at, and the canvas (klein)")
    ap.add_argument("--image2", type=Path, help="the second photo's subject crop (klein); without it that reference is dropped")
    ap.add_argument("--size2", help="WxH the second crop is read at (klein)")
    ap.add_argument("--head", type=Path, help="the head crop (klein)")
    ap.add_argument("--head-size", help="WxH the head crop is read at (klein)")
    ap.add_argument("--timeout", type=float, default=900)
    a = ap.parse_args()

    wf = json.loads(a.workflow.read_text())
    wf["pos"]["inputs"]["text"] = a.prompt
    if "text" in wf["neg"]["inputs"]:  # a distilled model's negative is a zeroed conditioning, not text
        wf["neg"]["inputs"]["text"] = a.negative
    wf["sampler"]["inputs"]["seed"] = a.seed
    if "img" in wf:
        if not a.image:
            ap.error("this workflow needs --image")
        wf["img"]["inputs"]["image"] = upload_image(a.host, a.image)

    def size(text, flag):
        try:
            w, h = (int(v) for v in text.lower().split("x"))
        except (AttributeError, ValueError):
            ap.error(f"this workflow needs {flag} WxH")
        return {"width": w, "height": h}

    if "img0" in wf:
        if not (a.image and a.head):
            ap.error("this workflow needs --image and --head")
        wf["img0"]["inputs"]["image"] = upload_image(a.host, a.image)
        wf["scale"]["inputs"].update(size(a.size, "--size"))
        wf["latent"]["inputs"].update(size(a.size, "--size"))
        wf["head"]["inputs"]["image"] = upload_image(a.host, a.head)
        wf["head_scale"]["inputs"].update(size(a.head_size, "--head-size"))
        if a.image2:
            wf["img1"]["inputs"]["image"] = upload_image(a.host, a.image2)
            wf["scale1"]["inputs"].update(size(a.size2, "--size2"))
        else:
            for node in ("img1", "scale1", "ref1", "refcond1"):
                del wf[node]
            wf["head_cond"]["inputs"]["conditioning"] = ["refcond", 0]

    client_id = uuid.uuid4().hex
    queued = post(a.host, "/prompt", json.dumps({"prompt": wf, "client_id": client_id}).encode(), "application/json")
    if "error" in queued:
        print(json.dumps(queued, indent=2), file=sys.stderr)
        return 1
    pid = queued["prompt_id"]
    print(f"queued {pid}")
    t0 = time.time()
    while time.time() - t0 < a.timeout:
        time.sleep(2)
        with urllib.request.urlopen(f"{a.host}/history/{pid}") as r:
            hist = json.load(r).get(pid)
        if not hist:
            continue
        status = hist.get("status", {})
        if status.get("status_str") == "error":
            print(json.dumps(status, indent=2), file=sys.stderr)
            return 1
        if status.get("completed"):
            for node in hist["outputs"].values():
                for im in node.get("images", []):
                    print(f"{im['type']}/{im.get('subfolder', '')}/{im['filename']}".replace("//", "/"))
            print(f"done in {time.time() - t0:.0f}s")
            return 0
    print("timed out", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
