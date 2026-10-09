"""Queue an API-format workflow on a running ComfyUI and wait for its images (ADR-0004 decision 1).

    python3 comfyui/run_workflow.py comfyui/workflows/sdxl-txt2img.api.json \
        --prompt "a photo of a scruffy terrier" --seed 7
    python3 comfyui/run_workflow.py comfyui/workflows/sdxl-ipadapter-v0.api.json \
        --image var/comfyui/output/monsterpaws/txt2img_00001_.png --prompt "..." --seed 7

The committed workflow is the contract; this script only fills the few
inputs a run varies (prompt, negative, seed, identity image) by node id, and
is the same call the worker will make from Node later (roadmap item 4).
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
    ap.add_argument("--image", type=Path, help="identity photo for workflows with a LoadImage node 'img'")
    ap.add_argument("--timeout", type=float, default=900)
    a = ap.parse_args()

    wf = json.loads(a.workflow.read_text())
    wf["pos"]["inputs"]["text"] = a.prompt
    wf["neg"]["inputs"]["text"] = a.negative
    wf["sampler"]["inputs"]["seed"] = a.seed
    if "img" in wf:
        if not a.image:
            ap.error("this workflow needs --image")
        wf["img"]["inputs"]["image"] = upload_image(a.host, a.image)

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
