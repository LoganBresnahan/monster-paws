# 0014: Checkpoints 1250 and 1750 of the anatomy LoRA to the models bucket

Status: planned
Planned: 2026-10-30
Why: ADR-0004 as amended 2026-10-29 (the weights we make get a bucket of
their own) and decision 11 of 2026-10-05; roadmap item 9, the anatomy LoRA.
Commit deployed: n/a — nothing on the droplet, the database or the three
other buckets changes

Logan read the home before/after test (batches 17a–17c, checkpoints 1000,
1500 and 2000) and asked for checkpoint 1250 beside them (2026-10-30): 1000
left more anatomy, and Beetle lost likeness at 1500. A checkpoint runs at
home only through a `comfyui/models-candidates.manifest` line, and
`models.py` takes a source on Hugging Face or in `monsterpaws-models` only,
so the file goes to the bucket first, the way 0011 sent the other three.
Checkpoint 1750 goes up beside it at Logan's word, so painting it later
needs no entry of its own; only 1250 is painted now. No checkpoint enters
`models.manifest` here.

Every step is one shell call from `~/monsterpaws-lora` that defines
`rclone_r2` as `doc/infra.md` provisioning step 5 gives it (the remote built
from `RCLONE_CONFIG_*` filled by `$(pass show …)`, no rclone.conf on disk)
and runs the step. Nothing prints a key, the account ID or the endpoint
host. No separation matrix: no key or token changed since 0011 ran it.

## Prerequisites
- [ ] `pass` unlocked: `pass show cloudflare/r2-endpoint >/dev/null` exits 0.
- [ ] rclone on the path (`rclone version`: v1.60.1-DEV on 2026-10-29).
- [ ] The two files on disk with these hashes (sha256, read 2026-10-30),
      each 46,223,608 bytes, in `var/explore/lora/anatomy-2026-10-29/`:

| Local file | Object key in `monsterpaws-models` | sha256 |
| --- | --- | --- |
| `anatomy-2026-10-29_000001250.safetensors` | `loras/anatomy-2026-10-29/anatomy-2026-10-29_000001250.safetensors` | `5031536d2b0e685ee1812096fff70ea0350b9137752fa429f5ecc2a6b0709a99` |
| `anatomy-2026-10-29_000001750.safetensors` | `loras/anatomy-2026-10-29/anatomy-2026-10-29_000001750.safetensors` | `293995cb800b3e7e1081b5b6326e51342318b095c9fca26b876bf7704bbc08ad` |

## Steps

### 1. Upload checkpoints 1250 and 1750

    D=var/explore/lora/anatomy-2026-10-29; K=r2:monsterpaws-models/loras/anatomy-2026-10-29
    rclone_r2 models copyto "$D/anatomy-2026-10-29_000001250.safetensors" "$K/anatomy-2026-10-29_000001250.safetensors"
    rclone_r2 models copyto "$D/anatomy-2026-10-29_000001750.safetensors" "$K/anatomy-2026-10-29_000001750.safetensors"
    rclone_r2 models lsf -R --files-only --format sp r2:monsterpaws-models
Verify: the listing shows 0011's three objects and the two new keys, each
at 46,223,608 bytes, and nothing else. rclone's exit code is not the proof:
every first attempt in 0011 got a 501 NotImplemented and passed on its own
retry (`doc/infra.md`, provisioning 5c). Step 2 is the proof.
Rollback: `rclone_r2 models deletefile "$K/<name>"` for each new key;
0011's three objects are not touched.

### 2. Read them back through the fetcher prod will use
`comfyui/models.py` fetches both from a two-line manifest into a scratch
store, signing each GET (ADR-0004 as amended 2026-10-29, decision 3) and
checking each hash on the stream. The dev write key stands in for prod's
read key, as in 0011:

    M=$(mktemp); T=$(mktemp -d)
    for n in 000001250:5031536d2b0e685ee1812096fff70ea0350b9137752fa429f5ecc2a6b0709a99 \
             000001750:293995cb800b3e7e1081b5b6326e51342318b095c9fca26b876bf7704bbc08ad; do
      echo "loras/anatomy-2026-10-29_${n%%:*}.safetensors  r2:loras/anatomy-2026-10-29/anatomy-2026-10-29_${n%%:*}.safetensors  ${n#*:}  ours  2026-10-29" >> "$M"
    done
    MODELS_MANIFEST="$M" R2_ACCOUNT_ID=$(pass show cloudflare/r2-endpoint | sed -E 's#https?://([^.]+)\..*#\1#') \
      R2_MODELS_ACCESS_KEY_ID=$(pass show cloudflare/r2-models-write-access-key-id | head -n1) \
      R2_MODELS_SECRET_ACCESS_KEY=$(pass show cloudflare/r2-models-write-secret-access-key | head -n1) \
      python3 -I comfyui/models.py fetch "$T"
    rm -rf "$M" "$T"
Verify: `ok` on both lines and exit 0. A signing fault shows as a 403, a
corrupt object as a sha256 mismatch.
Rollback: none needed — a read into a scratch directory that is removed.

## Run

## Follow-ups
- The 501 on first attempts stays open from 0011.
- The chosen checkpoint's `models.manifest` line, when Logan's read of the
  grid picks one.
