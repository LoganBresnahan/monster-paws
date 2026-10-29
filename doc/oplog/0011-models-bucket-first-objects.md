# 0011: The models bucket's first objects: the anatomy LoRA's checkpoints to R2

Status: planned
Planned: 2026-10-29 · Run: —
Why: ADR-0004 as amended 2026-10-29 (the weights we make get a bucket of
their own) and decision 11 of 2026-10-05; roadmap item 9, the anatomy LoRA.
Commit deployed: n/a — nothing on the droplet, the database or the three
existing buckets changes

The anatomy LoRA trained 2026-10-29 (`doc/plans/base-model-candidates.md`,
training run 1). Its checkpoints 1000, 1500 and 2000 are the three the ship
bar reads (decision 5 of 2026-10-22); they go to `monsterpaws-models`, which
Logan created in the dashboard the same day, with the dev write key
(`cloudflare/r2-models-write-*`, Object Read & Write, that bucket only). No
checkpoint enters `models.manifest` here: one does when it is chosen to run,
with the hash recorded below.

Every step is one shell call from `~/monsterpaws-lora` that defines
`rclone_r2` as `doc/infra.md` provisioning step 5 gives it (the remote built
from `RCLONE_CONFIG_*` filled by `$(pass show …)`, no rclone.conf on disk)
and runs the step. Nothing prints a key, the account ID or the endpoint
host: the separation reads print only the outcome.

## Prerequisites
- [ ] `pass` unlocked: `pass show cloudflare/r2-endpoint >/dev/null` exits 0.
- [ ] rclone on the path (`rclone version`: v1.60.1 on 2026-10-29).
- [ ] The three files on disk with these hashes (sha256, read 2026-10-29),
      each 46,223,608 bytes, in `var/explore/lora/anatomy-2026-10-29/`:

| Local file | Object key in `monsterpaws-models` | sha256 |
| --- | --- | --- |
| `anatomy-2026-10-29_000001000.safetensors` | `loras/anatomy-2026-10-29/anatomy-2026-10-29_000001000.safetensors` | `ed0e95c853331c958ce970287875b434c6040982f6568ee0c613cf2a67d182d8` |
| `anatomy-2026-10-29_000001500.safetensors` | `loras/anatomy-2026-10-29/anatomy-2026-10-29_000001500.safetensors` | `522a5def9e58e45117bf7933105b13928314a2edbfe45a12ebb623efb601867e` |
| `anatomy-2026-10-29.safetensors` (the final, step 2000) | `loras/anatomy-2026-10-29/anatomy-2026-10-29_000002000.safetensors` | `fffc88210c272055830a22cde6a54434cd4fbe1ef8a0097983bdae784c1bcb93` |

## Steps

### 1. The bucket is private
In the dashboard (Logan): R2 › `monsterpaws-models` › Settings — Public
Development URL (r2.dev) disabled, no custom domain connected.
Verify: the dashboard shows both — that read is the proof. An unsigned
request to the S3 endpoint proves nothing here: it is refused whether the
bucket is public or not.
Rollback: none needed — a read.

### 2. The separation matrix, before anything is written
Reads only. The worker and vault keys make no write attempt on the models
bucket, only `lsf`:

    for pair in "models monsterpaws-models" "models monsterpaws-media" "models monsterpaws-vault" \
                "models monsterpaws-corpus" "worker monsterpaws-models" "vault monsterpaws-models"; do
      set -- $pair
      if rclone_r2 "$1" lsf "r2:$2" >/dev/null 2>&1; then echo "$1 → $2: read"; else echo "$1 → $2: refused"; fi
    done
Verify: exactly `models → monsterpaws-models: read`, and `refused` on the
other five rows. Any other row stops the entry: a key reaches more than it
should, and the token is fixed in the dashboard before step 3.
Rollback: none needed — reads.

### 3. Upload the three checkpoints

    D=var/explore/lora/anatomy-2026-10-29; K=r2:monsterpaws-models/loras/anatomy-2026-10-29
    rclone_r2 models copyto "$D/anatomy-2026-10-29_000001000.safetensors" "$K/anatomy-2026-10-29_000001000.safetensors"
    rclone_r2 models copyto "$D/anatomy-2026-10-29_000001500.safetensors" "$K/anatomy-2026-10-29_000001500.safetensors"
    rclone_r2 models copyto "$D/anatomy-2026-10-29.safetensors"           "$K/anatomy-2026-10-29_000002000.safetensors"
    rclone_r2 models lsf -l "$K/"
Verify: `lsf -l` lists the three keys at 46,223,608 bytes each, and
nothing else is in the bucket.
Rollback: `rclone_r2 models deletefile "$K/<name>"` for each; the bucket
was empty before this entry.

### 4. Read them back through the fetcher prod will use
`comfyui/models.py` fetches each from a manifest of the three lines below
into a scratch store, signing the GET (ADR-0004 as amended 2026-10-29,
decision 3) and checking each hash on the stream. The dev write key stands in
for prod's read key, which does not exist yet (`doc/infra.md`, provisioning
step 8):

    M=$(mktemp); T=$(mktemp -d)
    for n in 000001000:ed0e95c853331c958ce970287875b434c6040982f6568ee0c613cf2a67d182d8 \
             000001500:522a5def9e58e45117bf7933105b13928314a2edbfe45a12ebb623efb601867e \
             000002000:fffc88210c272055830a22cde6a54434cd4fbe1ef8a0097983bdae784c1bcb93; do
      echo "loras/anatomy-2026-10-29_${n%%:*}.safetensors  r2:loras/anatomy-2026-10-29/anatomy-2026-10-29_${n%%:*}.safetensors  ${n#*:}  ours  2026-10-29" >> "$M"
    done
    MODELS_MANIFEST="$M" R2_ACCOUNT_ID=$(pass show cloudflare/r2-endpoint | sed -E 's#https?://([^.]+)\..*#\1#') \
      R2_MODELS_ACCESS_KEY_ID=$(pass show cloudflare/r2-models-write-access-key-id | head -n1) \
      R2_MODELS_SECRET_ACCESS_KEY=$(pass show cloudflare/r2-models-write-secret-access-key | head -n1) \
      python3 -I comfyui/models.py fetch "$T"
    rm -rf "$M" "$T"
Verify: `ok` on all three lines and exit 0. A signing fault shows as a 403
on the first download, a corrupt object as a sha256 mismatch.
Rollback: none needed — reads into a scratch directory that is removed.

## Run

## Follow-ups
- The chosen checkpoint's `models.manifest` line (`loras/…`, `r2:` source,
  its hash above, licence `ours`), when the home test picks one.
- The prod read key at provisioning step 8, and the separation matrix re-run
  with it.
