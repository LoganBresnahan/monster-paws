"""Fill and verify the ComfyUI models store from comfyui/models.manifest (ADR-0004 decision 11).

    models.py check            parse the manifest, no network, no store
    models.py fetch [store]    download what is missing, then verify every file
    models.py verify [store]   verify every file; nothing is downloaded

Exit status is non-zero on any mismatch, and the container's entrypoint runs
`fetch` before ComfyUI, so a store that disagrees with the manifest never
serves. The store defaults to the models directory the compose file mounts.
"""
import datetime
import hashlib
import hmac
import os
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# The GPU rental points this at models-rental.manifest, so the home store never downloads its weights (infra.md, GPU rental).
MANIFEST = Path(os.environ.get("MODELS_MANIFEST") or Path(__file__).with_name("models.manifest"))
DEFAULT_STORE = Path("/home/comfy/ComfyUI/models")
CHUNK = 8 * 2**20
# Weights we make ourselves live here, private (doc/infra.md, provisioning 5c): R2 tokens scope to buckets, not prefixes.
MODELS_BUCKET = "monsterpaws-models"


@dataclass(frozen=True)
class Entry:
    path: str
    source: str
    sha256: str
    licence: str
    checked: str

    def request(self) -> urllib.request.Request:
        headers = {"User-Agent": "monsterpaws-comfyui-models"}
        if self.source.startswith("hf:"):
            owner, repo, *rest = self.source[3:].split("/")
            return urllib.request.Request(f"https://huggingface.co/{owner}/{repo}/resolve/main/{'/'.join(rest)}", headers=headers)
        return r2_request(self.source[3:], headers)


def r2_request(key: str, headers: dict) -> urllib.request.Request:
    """A SigV4-signed GET of one object in the models bucket, with the read key the environment holds."""
    # Prod holds the read-only models key; dev reaches the bucket with its write key, which can also read.
    try:
        account, key_id, secret = (os.environ[v] for v in ("R2_ACCOUNT_ID", "R2_MODELS_ACCESS_KEY_ID", "R2_MODELS_SECRET_ACCESS_KEY"))
    except KeyError as missing:
        raise SystemExit(f"r2:{key}: {missing.args[0]} is not set, so the models bucket cannot be read")
    host = f"{account}.r2.cloudflarestorage.com"
    path = "/" + urllib.parse.quote(f"{MODELS_BUCKET}/{key}", safe="/-_.~")
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    signed = {"host": host, "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": stamp}
    names = ";".join(sorted(signed))
    canonical = "\n".join(["GET", path, "", *(f"{k}:{signed[k]}" for k in sorted(signed)), "", names, "UNSIGNED-PAYLOAD"])
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = f"AWS4{secret}".encode()
    for part in (day, "auto", "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={key_id}/{scope}, SignedHeaders={names}, Signature={sig}"
    return urllib.request.Request(f"https://{host}{path}", headers={**headers, **signed, "Authorization": auth})


def parse(text: str) -> list[Entry]:
    entries: list[Entry] = []
    seen: set[str] = set()
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        cols = line.split()
        if len(cols) != 5:
            raise ValueError(f"line {lineno}: expected 5 columns, got {len(cols)}")
        e = Entry(*cols)
        if e.path in seen or e.path.startswith("/") or ".." in e.path.split("/"):
            raise ValueError(f"line {lineno}: bad or duplicate path {e.path!r}")
        if not (e.source.startswith("hf:") and e.source.count("/") >= 2) and not e.source.startswith("r2:"):
            raise ValueError(f"line {lineno}: source must be hf:<owner>/<repo>/<path> or r2:<key>")
        if not re.fullmatch(r"[0-9a-f]{64}", e.sha256):
            raise ValueError(f"line {lineno}: sha256 must be 64 lowercase hex digits")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", e.checked):
            raise ValueError(f"line {lineno}: checked must be YYYY-MM-DD")
        seen.add(e.path)
        entries.append(e)
    if not entries:
        raise ValueError("manifest has no entries")
    return entries


# Every start verifies the whole store (66 GB on 2026-10-14). Never let that reading stay in the
# page cache: with autoMemoryReclaim off, the WSL VM keeps it until it sits at its cap, and the
# guard's floor trips during the next model load (doc/infra.md, Home GPU).
def forget(f) -> None:
    os.posix_fadvise(f.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        n = 0
        while chunk := f.read(CHUNK):
            h.update(chunk)
            n += 1
            if n % 32 == 0:
                forget(f)
        forget(f)
    return h.hexdigest()


def download(entry: Entry, dest: Path) -> None:
    # The hash is checked on the stream and the file only takes its final name
    # on a match, so a partial or wrong download can never be mistaken for a
    # verified model.
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = entry.request()
    h = hashlib.sha256()
    done = 0
    with urllib.request.urlopen(req) as resp, part.open("wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        while chunk := resp.read(CHUNK):
            out.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {entry.path}: {done / 2**30:.2f} / {total / 2**30:.2f} GiB", end="", flush=True)
        out.flush()
        os.fsync(out.fileno())
        forget(out)
    print()
    if h.hexdigest() != entry.sha256:
        part.unlink()
        raise SystemExit(f"{entry.path}: downloaded sha256 {h.hexdigest()} != manifest {entry.sha256}")
    part.replace(dest)


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "check"
    entries = parse(MANIFEST.read_text())
    if cmd == "check":
        print(f"ok: {len(entries)} entries")
        return 0
    if cmd not in ("fetch", "verify"):
        print(__doc__)
        return 2
    store = Path(argv[2]) if len(argv) > 2 else Path(os.environ.get("COMFYUI_MODELS", DEFAULT_STORE))
    failures = 0
    for e in entries:
        dest = store / e.path
        if not dest.exists():
            if cmd == "verify":
                print(f"MISSING  {e.path}")
                failures += 1
                continue
            print(f"fetch    {e.path} <- {e.source}")
            download(e, dest)
            print(f"ok       {e.path}")
            continue
        actual = digest(dest)
        if actual == e.sha256:
            print(f"ok       {e.path}")
        else:
            print(f"MISMATCH {e.path}: {actual} != {e.sha256}")
            failures += 1
    if failures:
        print(f"{failures} file(s) disagree with the manifest; refusing to serve")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
