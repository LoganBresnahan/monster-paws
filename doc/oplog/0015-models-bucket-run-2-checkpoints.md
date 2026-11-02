# 0015: Checkpoints 1500, 2000, 2500 and 3000 of the anatomy LoRA's run 2 to the models bucket

Status: run
Planned: 2026-11-01 · Run: 2026-11-01 23:59 UTC
Why: ADR-0004 as amended 2026-10-29 (the weights we make get a bucket of
their own) and decision 11 of 2026-10-05; roadmap item 9, the anatomy LoRA.
Commit deployed: n/a — nothing on the droplet, the database or the three
other buckets changes

The anatomy LoRA's second training run (`anatomy-2026-11-01b`: 168 pairs,
3,000 steps, on a rented H200 on 2026-11-01, from commit 161c602;
`doc/plans/base-model-candidates.md`, Training run 2) is to be tested at home the way run 1 was (batches
17a–17d): Plum, Ducky and Beetle's 48 befores painted again at checkpoints
1500, 2000, 2500 and 3000, strength 1.0 (Logan, 2026-11-01). A checkpoint
runs at home only through a `comfyui/models-candidates.manifest` line, and
`models.py` takes a source on Hugging Face or in `monsterpaws-models` only,
so the four files go to the bucket first, as 0011 and 0014 sent run 1's. No
checkpoint enters `models.manifest` here.

Every step is one shell call from `~/monsterpaws-lora` that defines
`rclone_r2` as `doc/infra.md` provisioning step 5 gives it (the remote built
from `RCLONE_CONFIG_*` filled by `$(pass show …)`, no rclone.conf on disk)
and runs the step. Nothing prints a key, the account ID or the endpoint
host. No separation matrix: no key or token changed since 0011 ran it.

## Prerequisites
- [ ] `pass` unlocked: `pass show cloudflare/r2-endpoint >/dev/null` exits 0.
- [ ] rclone on the path (`rclone version`: v1.60.1-DEV on 2026-10-29).
- [ ] The four files on disk with these hashes (sha256, read 2026-11-01),
      each 46,223,608 bytes, in `var/explore/lora/anatomy-2026-11-01b/`. The
      final checkpoint is saved without a step number and takes one in the
      bucket, as run 1's did in 0011:

| Local file | Object key in `monsterpaws-models` | sha256 |
| --- | --- | --- |
| `anatomy-2026-11-01b_000001500.safetensors` | `loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000001500.safetensors` | `a303ff78dbe3f0fc6e6513fe6b1062af084fcbcc775b988a8cfddcb34dad89d1` |
| `anatomy-2026-11-01b_000002000.safetensors` | `loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000002000.safetensors` | `feb5b92a47449778777d2d5b7d30429254b8f5ad4ed80042332dcbe1c454a077` |
| `anatomy-2026-11-01b_000002500.safetensors` | `loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000002500.safetensors` | `7f38ba9814bff6865df63d922e97a21e67e0eaecbaa3ca8984d9cdf75a35b178` |
| `anatomy-2026-11-01b.safetensors` (the final, step 3000) | `loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000003000.safetensors` | `23a7b48971202867aa610a29fa3c23bbde9508312491761c780684197f93cc8f` |

## Steps

### 1. Upload the four checkpoints

    D=var/explore/lora/anatomy-2026-11-01b; K=r2:monsterpaws-models/loras/anatomy-2026-11-01b
    for s in 000001500 000002000 000002500; do
      rclone_r2 models copyto "$D/anatomy-2026-11-01b_$s.safetensors" "$K/anatomy-2026-11-01b_$s.safetensors"
    done
    rclone_r2 models copyto "$D/anatomy-2026-11-01b.safetensors" "$K/anatomy-2026-11-01b_000003000.safetensors"
    rclone_r2 models lsf -R --files-only --format sp r2:monsterpaws-models
Verify: the listing shows 0011's and 0014's five objects under
`loras/anatomy-2026-10-29/` and the four new keys under
`loras/anatomy-2026-11-01b/`, each at 46,223,608 bytes, and nothing else.
rclone's exit code is not the proof: every first attempt in 0011 and 0014
got a 501 NotImplemented and passed on its own retry (`doc/infra.md`,
provisioning 5c). Step 2 is the proof.
Rollback: `rclone_r2 models deletefile "$K/<name>"` for each new key;
run 1's five objects are not touched.

### 2. Read them back through the fetcher prod will use
`comfyui/models.py` fetches all four from a four-line manifest into a
scratch store, signing each GET (ADR-0004 as amended 2026-10-29, decision
3) and checking each hash on the stream. The dev write key stands in for
prod's read key, as in 0011 and 0014:

    M=$(mktemp); T=$(mktemp -d)
    for n in 000001500:a303ff78dbe3f0fc6e6513fe6b1062af084fcbcc775b988a8cfddcb34dad89d1 \
             000002000:feb5b92a47449778777d2d5b7d30429254b8f5ad4ed80042332dcbe1c454a077 \
             000002500:7f38ba9814bff6865df63d922e97a21e67e0eaecbaa3ca8984d9cdf75a35b178 \
             000003000:23a7b48971202867aa610a29fa3c23bbde9508312491761c780684197f93cc8f; do
      echo "loras/anatomy-2026-11-01b_${n%%:*}.safetensors  r2:loras/anatomy-2026-11-01b/anatomy-2026-11-01b_${n%%:*}.safetensors  ${n#*:}  ours  2026-11-01" >> "$M"
    done
    MODELS_MANIFEST="$M" R2_ACCOUNT_ID=$(pass show cloudflare/r2-endpoint | sed -E 's#https?://([^.]+)\..*#\1#') \
      R2_MODELS_ACCESS_KEY_ID=$(pass show cloudflare/r2-models-write-access-key-id | head -n1) \
      R2_MODELS_SECRET_ACCESS_KEY=$(pass show cloudflare/r2-models-write-secret-access-key | head -n1) \
      python3 -I comfyui/models.py fetch "$T"
    rm -rf "$M" "$T"
Verify: `ok` on all four lines and exit 0. A signing fault shows as a 403, a
corrupt object as a sha256 mismatch.
Rollback: none needed — a read into a scratch directory that is removed.

## Run

Prerequisites, 23:59: `pass` unlocked; rclone v1.60.1-DEV; all four files
re-hashed, each matching the table above at 46,223,608 bytes.

1. **Upload**, 23:59:20 – 23:59:35. Each `copyto`'s first attempt failed
   with `NotImplemented` (501), as every one did in 0011 and 0014, and
   rclone's own retry succeeded (`Attempt 2/3 succeeded`, exit 0, on all
   four). `lsf -R --files-only --format sp`:

       46223608;loras/anatomy-2026-10-29/anatomy-2026-10-29_000001000.safetensors
       46223608;loras/anatomy-2026-10-29/anatomy-2026-10-29_000001250.safetensors
       46223608;loras/anatomy-2026-10-29/anatomy-2026-10-29_000001500.safetensors
       46223608;loras/anatomy-2026-10-29/anatomy-2026-10-29_000001750.safetensors
       46223608;loras/anatomy-2026-10-29/anatomy-2026-10-29_000002000.safetensors
       46223608;loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000001500.safetensors
       46223608;loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000002000.safetensors
       46223608;loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000002500.safetensors
       46223608;loras/anatomy-2026-11-01b/anatomy-2026-11-01b_000003000.safetensors

   Run 1's five and the four new keys, nothing else.
2. **Read back**, 23:59:46 – 23:59:53: `models.py fetch` signed each GET
   and checked each hash on the stream — `ok` on all four, exit 0. Scratch
   store and manifest removed.

## Follow-ups
- The 501 on first attempts stays open from 0011: nine uploads out of
  nine now.
- The four checkpoints' `models-candidates.manifest` lines, with the home
  test (batch 21a) that paints them.
