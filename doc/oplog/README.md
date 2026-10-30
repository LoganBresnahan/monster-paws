# Op log — what we did to production

One entry per production operation (ADR-0023). Written **before** the work,
filled in **during** it, and **never edited after** — a correction or a
follow-up is a new entry that cites the old one.

Not this directory: how to do an operation *today* is `doc/infra.md`; *why*
is an ADR; the daily numbers brief is `doc/ops/` (ADR-0010 as amended).

## Entries

| # | Operation | Status | Run on |
| --- | --- | --- | --- |
| [0001](0001-production-launch.md) | Production launch, browse first: database, animal pages, the crew, worker, error reporting | run | 2026-10-27 |
| [0002](0002-next-security-hotfix.md) | Security hotfix: Next.js 16.2.12 → 16.3.8 on the live landing page, image tag pinned | run | 2026-09-30 |
| [0003](0003-next-16-4-3-hotfix.md) | Security hotfix: Next.js 16.3.8 → 16.4.3, the starter SVGs removed | run | 2026-10-27 |
| [0004](0004-deploy-previews-footer-outreach-schema.md) | Deploy `c45e085`: link previews, the profiles in the footer, the outreach schema (migrations 0012–0014) | run | 2026-10-27 |
| [0005](0005-poll-from-home-2026-10-28.md) | Poll from home: today's production poll through the tunnel, RescueGroups still refusing the droplet — crashed 1 h 29 min in, not rerun | run | 2026-10-28 |
| [0006](0006-poll-via-bridge-first-run.md) | Poll via the bridge, the first run by hand: the poll on the droplet, only RescueGroups' requests through home (ADR-0033) — the bridge proved, the poll out of memory at ~45k | run | 2026-10-28 |
| [0007](0007-deploy-poll-fixes-schedule-off.md) | Deploy `40cb846`: the poll fits the droplet, the droplet's schedule off (`INGEST_POLL_SCHEDULE=off`), the footer's six profiles | run | 2026-10-28 |
| [0008](0008-poll-via-bridge-on-40cb846.md) | Poll via the bridge on `40cb846`: the poll that turns health green — complete, 64,111 in 27 min | run | 2026-10-28 |
| [0009](0009-nightly-bridge-poll.md) | The nightly bridge poll: the restricted key, the droplet half, the Windows task (ADR-0033 decision 7) | run | 2026-10-28 |
| [0010](0010-arm-poll-heartbeat-and-health-monitor.md) | The first unattended night read (64,089, complete); the poll heartbeat 499765 and the health monitor 4995794 armed | run | 2026-10-29 |
| [0011](0011-models-bucket-first-objects.md) | The models bucket's first objects: the anatomy LoRA's checkpoints 1000, 1500 and 2000 to `monsterpaws-models` (ADR-0004 as amended 2026-10-29) | run | 2026-10-29 |
| [0012](0012-rerun-failed-nightly-2026-10-30.md) | A keyless check of whether RescueGroups still resets the droplet (the key now "public"); rerun the nightly that failed at 07:06 UTC with `terminated` after 131 pages; both Better Stack incidents resolved | planned | 2026-10-30 |

## Entry format

File: `NNNN-slug.md`, next free number, never reused.

```markdown
# NNNN: <operation, in words>

Status: planned | run | abandoned
Planned: YYYY-MM-DD · Run: YYYY-MM-DD HH:MM UTC (or —)
Why: <ADR-NNNN, roadmap item>
Commit deployed: <sha, or n/a>

## Prerequisites
- [ ] each thing that must be true before step 1, checked on the day

## Steps
### 1. <step>
    <exact commands — $IP never the address, $(pass show …) never a value>
Verify: <what proves it worked>
Rollback: <how to undo it, or "none — forward only" and why>

## Run
<added on the day: what happened at each step, output trimmed and redacted,
timings, anything that differed from the plan>

## Follow-ups
<new entries or roadmap carry-ins this produced>
```

Rules:
- A step with no **Verify** is not ready to run.
- Output pasted into **Run** is redacted first: no IP, no hostname of the
  database, no token, no connection string.
- Once `Status: run`, the file is frozen. Fix a mistake in a new entry.
- A procedure that appears in three entries graduates into `infra.md` or a
  skill (ADR-0023).
