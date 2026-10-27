"""Wikimedia Commons photos into the record, and the record checked against the files (ADR-0031).

Runs on the host with the standard library only — the explore container
mounts comfyui/ and var/photos read-only, so neither record can be written
from inside it:

    npm run explore:fetch -- fetch <set> File:Some_dog.jpg [File:…]
    npm run explore:fetch -- backfill
    npm run explore:fetch -- verify

`fetch` asks the imageinfo API for each title, refuses a licence outside
ADR-0031's allowlist or a file with reuse restrictions, downloads the
original into var/photos/commons/<set>/, checks the API's sha1 against the
bytes, and appends one row to both records in the same run. `backfill`
rewrites the local SOURCES.tsv from the committed record and the files on
disk. `verify` re-hashes every recorded file.
"""
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECORD = HERE / "explore" / "commons-photos.tsv"      # committed: the attribution (ADR-0031 decision 3)
PHOTOS = HERE.parent / "var" / "photos" / "commons"   # never committed
SOURCES = PHOTOS / "SOURCES.tsv"                      # local companion, rebuilt by `backfill`

API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia's User-Agent policy: a client name and version, a contact, and the word "bot";
# the python-urllib default is blocked at api.php.
USER_AGENT = "MonsterPawsCommonsFetchBot/0.1 (https://monsterpaws.org) python-urllib"
PAUSE = 1.0  # seconds between requests (ADR-0031 decision 7)

# ADR-0031 decision 2: a photo enters only under one of these, read from LicenseShortName —
# never a licence read off the page by eye. Everything else is a refusal by name.
ALLOWED = re.compile(r"^(CC0(?: 1\.0)?|Public domain|CC BY(?:-SA)? [1-4]\.[05](?: [a-z]{2}(?:-[a-z]{2})?)?)$")

RECORD_COLUMNS = ["set", "file", "sha256", "source", "author", "licence", "licence_url", "size", "fetched", "note"]
SOURCES_COLUMNS = ["file", "source", "author", "licence", "licence_url", "size", "fetched"]
META = "LicenseShortName|LicenseUrl|Artist|Credit|Attribution|AttributionRequired|Copyrighted|Restrictions|ObjectName"


def read_tsv(path: Path):
    """Rows as dicts by the file's own header; comment lines kept aside for rewriting."""
    comments, header, rows = [], None, []
    if not path.exists():
        return comments, header, rows
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        if line.startswith("#"):
            comments.append(line)
            continue
        cells = line.split("\t")
        if header is None:
            header = cells
            continue
        rows.append(dict(zip(header, cells + [""] * (len(header) - len(cells)))))
    return comments, header, rows


def write_tsv(path: Path, comments, columns, rows) -> None:
    lines = list(comments) + ["\t".join(columns)]
    lines += ["\t".join(r.get(c, "") for c in columns) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def strip_html(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def local_name(title: str) -> str:
    """File:Two_cats_sleeping_(4238436990).jpg -> Two-cats-sleeping-4238436990.jpg, as the hand-made rows were named."""
    name = title.split(":", 1)[1]
    stem, _, ext = name.rpartition(".")
    stem = re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-")[:60]
    return f"{stem}.{ext.lower()}"


def imageinfo(titles):
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "prop": "imageinfo", "titles": "|".join(titles),
        "iiprop": "extmetadata|url|sha1|size|mime", "iiextmetadatafilter": META,
    })
    data = json.loads(get(f"{API}?{q}"))
    out = {}
    for page in data["query"]["pages"].values():
        if "imageinfo" not in page:
            out[page.get("title", "?")] = None
            continue
        ii = page["imageinfo"][0]
        em = {k: v["value"] for k, v in ii.get("extmetadata", {}).items()}
        out[page["title"]] = {"url": ii["url"], "sha1": ii["sha1"], "size": f'{ii["width"]}x{ii["height"]}', "mime": ii["mime"], **em}
    return out


def refusal(info) -> str | None:
    """Why a file may not enter the set (ADR-0031 decision 2), or None."""
    short = info.get("LicenseShortName", "")
    if info.get("Restrictions"):
        return f"reuse restrictions: {info['Restrictions']}"
    if not ALLOWED.match(short):
        return f"licence not in the allowlist: {short or 'none stated'}"
    if short == "Public domain" and info.get("Copyrighted", "").lower() != "false":
        return "says public domain but Commons marks it copyrighted"
    if not info.get("mime", "").startswith("image/"):
        return f"not an image: {info.get('mime')}"
    return None


def fetch(set_name: str, titles) -> int:
    if not set_name.replace("-", "").isalnum():
        sys.exit(f"set name must be letters, digits and hyphens: {set_name!r}")
    comments, header, rows = read_tsv(RECORD)
    known_sha = {r["sha256"] for r in rows}
    known_src = {r["source"] for r in rows}
    s_comments, _, s_rows = read_tsv(SOURCES)
    (PHOTOS / set_name).mkdir(parents=True, exist_ok=True)
    titles = [t if t.startswith("File:") else f"File:{t}" for t in titles]
    titles = [t.replace(" ", "_") for t in titles]
    failures = 0
    for i in range(0, len(titles), 20):
        infos = imageinfo(titles[i:i + 20])
        time.sleep(PAUSE)
        for title, info in infos.items():
            source = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe=":()_,'")
            if info is None:
                print(f"REFUSED  {title}: no such file on Commons")
                failures += 1
                continue
            if source in known_src:
                print(f"skip     {title}: already in the record")
                continue
            why = refusal(info)
            if why:
                print(f"REFUSED  {title}: {why}  <{source}>")
                failures += 1
                continue
            data = get(info["url"])
            time.sleep(PAUSE)
            if hashlib.sha1(data).hexdigest() != info["sha1"]:
                print(f"REFUSED  {title}: downloaded bytes do not match the API's sha1")
                failures += 1
                continue
            sha = hashlib.sha256(data).hexdigest()
            if sha in known_sha:
                print(f"skip     {title}: these bytes are already in the record under another title")
                continue
            rel = f"{set_name}/{local_name(title)}"
            dest = PHOTOS / rel
            if dest.exists() and sha256_of(dest) != sha:
                print(f"REFUSED  {title}: {rel} exists with different bytes")
                failures += 1
                continue
            dest.write_bytes(data)
            author = strip_html(info.get("Attribution") or info.get("Artist") or "")
            row = {
                "set": set_name, "file": rel, "sha256": sha, "source": source, "author": author,
                "licence": info["LicenseShortName"], "licence_url": info.get("LicenseUrl", ""),
                "size": info["size"], "fetched": date.today().isoformat(), "note": "",
            }
            rows.append(row)
            known_sha.add(sha)
            known_src.add(source)
            s_rows.append({c: row[c] for c in SOURCES_COLUMNS})
            # Both records in the same run, so no file on disk is ever unrecorded (ADR-0031 decision 7).
            write_tsv(RECORD, comments, RECORD_COLUMNS, rows)
            write_tsv(SOURCES, s_comments, SOURCES_COLUMNS, s_rows)
            print(f"fetched  {title}: {rel}  {row['licence']}  {row['size']}  by {author}")
    return failures


def backfill() -> int:
    """SOURCES.tsv rebuilt from the committed record and the files on disk; a fetched date is kept where one was recorded, else the file's mtime."""
    comments, _, rows = read_tsv(RECORD)
    s_comments, _, s_rows = read_tsv(SOURCES)
    old = {r["file"]: r for r in s_rows}
    out, problems = [], 0
    for r in rows:
        p = PHOTOS / r["file"]
        if not p.exists():
            print(f"MISSING  {r['file']}: recorded, not on disk")
            problems += 1
            continue
        if sha256_of(p) != r["sha256"]:
            print(f"MISMATCH {r['file']}: bytes differ from the record")
            problems += 1
            continue
        fetched = r.get("fetched") or old.get(r["file"], {}).get("fetched") or datetime.fromtimestamp(p.stat().st_mtime).date().isoformat()
        out.append({**{c: r.get(c, "") for c in SOURCES_COLUMNS}, "fetched": fetched})
    recorded = {r["file"] for r in rows}
    for p in sorted(PHOTOS.rglob("*")):
        if p.is_file() and p.name != SOURCES.name and str(p.relative_to(PHOTOS)) not in recorded:
            print(f"UNRECORDED {p.relative_to(PHOTOS)}: on disk, not in the record")
            problems += 1
    write_tsv(SOURCES, s_comments, SOURCES_COLUMNS, out)
    print(f"{len(out)} rows written to {SOURCES}, {problems} problems")
    return problems


def verify() -> int:
    _, _, rows = read_tsv(RECORD)
    bad = 0
    for r in rows:
        p = PHOTOS / r["file"]
        if not p.exists():
            print(f"MISSING  {r['file']}")
            bad += 1
        elif sha256_of(p) != r["sha256"]:
            print(f"MISMATCH {r['file']}")
            bad += 1
    print(f"{len(rows) - bad} of {len(rows)} recorded files present and matching")
    return bad


def main() -> None:
    args = sys.argv[1:]
    if args[:1] == ["fetch"] and len(args) >= 3:
        code = fetch(args[1], args[2:])
    elif args == ["backfill"]:
        code = backfill()
    elif args == ["verify"]:
        code = verify()
    else:
        sys.exit(__doc__)
    sys.exit(1 if code else 0)


if __name__ == "__main__":
    main()
