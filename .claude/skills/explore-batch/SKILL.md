---
name: explore-batch
description: Run one batch of the look exploration end to end on the home GPU and read it — confirm the card is idle, write or check the spec under comfyui/explore/, dry-run and count, run under comfyui/guard.sh in the background with a log and an early check, build the grids, score likeness, write the first read into doc/plans/the-look-exploration.md, and record Logan's picks when they arrive. Encodes the rules learned by breaking them. Use when a batch is to be run or a finished batch is to be read.
---

# /explore-batch — run a batch and read it

The exploration's loop (`doc/plans/the-look-exploration.md`) is the same
every time and has bitten in the same places every time. This is that loop
with the bites taken out. Assumes cwd = the repo root, and that the facts
in `doc/infra.md`, Home GPU, have been read once in this session.

## Before

1. **Nothing else on the card.** `docker ps` shows no comfyui container and
   `pgrep -fa 'guard.sh|leak_probe|explore.py'` nothing of ours; `comfyui/guard.sh mem`
   reads dedicated 0 and pool ≈ 1 GB. If the box was changed since the last
   batch (driver, BIOS, WSL), `/gpu-health` first.
2. **The spec** is `comfyui/explore/<batch>.json`: animals with `kind`,
   `describe` and photo files under `var/crew/<Animal>/`; axes as lists.
   Hold everything still except the one or two axes the batch asks about,
   and say so in its `_` line. Subject boxes come from
   `comfyui/explore/boxes.json`; a new photo needs its boxes drawn on a
   tenths grid first, companion outside every box.
3. **Dry-run:** `npm run explore -- run <batch> --dry-run` — the count and
   the first ids. A spec that explodes past ~200 images is two batches.
4. **Model changes** go through `comfyui/models.manifest` (hash, licence,
   date), then `npm run comfy:build` **before** `npm run comfy:models` —
   the image bakes the manifest.

## Run

```
comfyui/guard.sh batch <batch> 16 2>&1 | tee -a var/explore/<batch>.log
```

in the background. Then one waiter for the first two successes or a failure
line, and look at the log from the **restart marker** (`N done, 16 to go`),
never the tail of an appended log. The guard restarts ComfyUI between chunks
and kills it when the driver pool passes 4 GB; a kill is a finding, not a
retry. Runs are grouped by LoRA by the harness; keep it that way. Stop a
batch by pid (`pgrep -f 'guard.sh ba[t]ch'`), never `pkill -f` with a
pattern that matches your own shell, then `comfyui/guard.sh down` and
remove any `comfyui-explore-run-*` container.

## Read

1. `npm run explore -- grid <batch> --rows animal,photo,seed --cols <the axes> [--where k=v]`
   — one JPEG per question; look at it before the sheet.
2. `npm run explore:score -- <batch>` — likeness per image into the sheet
   (CPU, bounded container). Remember what it measures: cosine to the
   photo rewards photocopies; among same-workflow siblings it is a coin
   flip against Logan's eye until the style-invariant form lands (plan,
   Step 2).
3. Write **"Batch N — first read"** in the plan: what each axis did, in
   bullets that name images; Logan's picks decide, so say "yours to
   overrule". Update the plan's status line and, if a production rule
   changed (crop, aspect, photo choice, description), the roadmap item 4
   carry-in that holds it.
4. Give Logan the Windows paths:
   `\\wsl.localhost\monsterpaws-dev\home\oof\monsterpaws\var\explore\<batch>\index.html`
   and the grid JPEGs. When his picks come back, save them as
   `var/explore/<batch>/picks.txt`, rerun the score with `--picks`, and
   record the picks and his words in the plan under "Batch N — Logan's picks".

## Never

- Pad a crop to square (bands); render the box at its own aspect.
- Switch LoRA per image, or run `--gpu-only` / `--highvram` on the Arc.
- Run `npm run explore -- run` against a long-lived server outside the guard.
- Leave a finding in chat: the plan, the issues inbox, or the runbook.
