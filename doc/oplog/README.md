# Op log — what we did to production

One entry per production operation (ADR-0023). Written **before** the work,
filled in **during** it, and **never edited after** — a correction or a
follow-up is a new entry that cites the old one.

Not this directory: how to do an operation *today* is `doc/infra.md`; *why*
is an ADR; the daily numbers brief is `doc/ops/` (ADR-0010 as amended).

## Entries

| # | Operation | Status | Run on |
| --- | --- | --- | --- |
| [0001](0001-production-launch.md) | Production launch: database, animal pages, worker, error reporting | planned | — |
| [0002](0002-next-security-hotfix.md) | Security hotfix: Next.js 16.2.12 → 16.3.8 on the live landing page, image tag pinned | planned | — |

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
