---
name: gpu-health
description: Take a bearing on the home GPU box (the Arc A770 under WSL2) — Windows crash and WHEA events, memory, BIOS and RAM speed, the WSL cap, the driver pool, and the PyTorch smoke, read against the numbers in doc/infra.md's Home GPU section. Run after any driver, BIOS, WSL or kernel change, after the box has frozen, and before a long batch. Read-only apart from the smoke's few seconds on the card; it never starts a batch.
---

# /gpu-health — is the home box fit to generate?

Every failure on this machine has looked like something else first (a model
bug, a wedge, a leak, a kernel), and the facts that told them apart are
spread over the Windows event log, the WSL VM, the driver's counters and the
smoke. This skill reads all four in one pass and compares them with
`doc/infra.md`, Home GPU, which is the source of truth for what the numbers
should be. Assumes cwd = the repo root.

## Run

```
scripts/gpu-health.sh [hours] [--no-smoke]
```

Default 48 hours of event log. `--no-smoke` when the card must stay idle
(someone else is using it, or a batch is running — never run the smoke
beside a batch).

## Read it against the runbook

| line | healthy | act when |
| --- | --- | --- |
| events | none | any 6008/41 since the last check → a new crash: add its time to the freeze entry in `doc/issues.md`, Ops; a WHEA 1 at boot confirms the firmware record; a 130 within minutes before a crash is the S3 pattern |
| compression | ~0 GB | several GB on an idle box preceded the October freezes |
| ram | 2666 during the stability week | 3600 means XMP came back — say so |
| arc driver | the version `comfyui/Dockerfile`'s runtime pins were chosen for | newer → re-read the pairing bullet and run the smoke before anything else |
| .wslconfig | `memory=32GB`, `autoMemoryReclaim=disabled` | anything else → the sizing bullet in infra.md explains both |
| guard | pool ≈ 1 GB, dedicated 0 with nothing running | pool > 4 GB at idle means a process is holding the leak — find it with `docker ps`, never raise the floor |
| smoke | every roundtrip ok, 0 leaked, warm ≥ ~70 TFLOPS | a wrong roundtrip is the runtime pairing (garbage at full speed); a leak count > 0 is the cache fix disabled; a slow warm run with everything else fine is worth one more run before it means anything |

## Deliver

A short verdict: fit / not fit, the one or two lines that decide it, and
what changed since the last bearing. Record only facts that are new to the
docs — a new crash time goes in the issues entry; a changed version or
setting goes in infra.md's bullet for it. Never start a batch from here;
`comfyui/guard.sh` is the only way the card does work, and `/explore-batch`
is the way a batch is run and read.
