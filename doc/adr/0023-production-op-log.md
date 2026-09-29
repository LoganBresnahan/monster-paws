# ADR-0023: Production operations are written down before they run, and never edited after

## Context
Every other document says what is true now or what we decided: ADRs record
why, `doc/infra.md` is the always-current runbook, `doc/flows.md` draws what
moves through the system, the roadmap says what is next. None of them says
**what we actually did to production, when, and what happened**. `infra.md`
is rewritten as the shape changes, so its history is overwritten; git records
file changes, but a command run on the droplet never passes through git.

The first production launch (roadmap item 3b) is a sequence of one-off
operations — provision Managed Postgres, run migrations, fill `.env`, run the
first poll by hand, unpause the Better Stack heartbeat — spread over weeks of
prerequisite work. Two failure modes follow: a step forgotten on the day, and
no record afterwards of what was done if something later looks wrong.

## Decision
1. **An op log in `doc/oplog/`**, one entry per production operation:
   `NNNN-slug.md`, numbered in order, format defined in `doc/oplog/README.md`.
2. **Planned first.** An entry is written, reviewed and committed *before* the
   work: why (ADR and roadmap links), prerequisites, the exact commands in
   order, how each step is verified, and how it is rolled back. Reviewing the
   entry is reviewing the operation.
3. **Append-only once run.** During the work the entry gains what actually
   happened — output (redacted), timings, surprises — and its status becomes
   `run`. After that it is never edited; a correction or a follow-up is a new
   entry that cites the old one. The same rule as the corpus (ADR-0003), for
   the same reason: history you can rewrite is not history.
4. **Markdown, not scripts.** Database migrations are scripts because they run
   on every database; production operations mostly run once, and a script
   invites re-running what must not be. **A procedure that starts repeating
   graduates** — into `infra.md` or a skill such as `/deploy` — and the op log
   keeps how it was first done.
5. **The public-repo rules hold** (`infra.md` RULES): no droplet IP (`$IP`),
   no secret value (`$(pass show …)`), and output trimmed of anything
   identifying.
6. **`/deploy` writes an entry for every production deploy**, so the log is
   complete without anyone remembering to add to it.

## Consequences
- The launch is planned in `doc/oplog/0001-production-launch.md` weeks before
  it runs, and becomes its own record once it does.
- `doc/ops/` stays reserved for the daily ops brief (ADR-0010 as amended
  2026-09-28); the two never share a directory — one is written by people
  about actions, the other by a routine about numbers.
- One more place a step can be written wrongly; the `planned` review is the
  check, and the `run` section is where the discrepancy shows.

## Alternatives
- **Executable scripts per operation (`ops/NNNN.sh`).** Rejected for v1: most
  operations need judgement between steps (read the output, then decide), and
  a re-runnable one-off is a hazard. A step that is pure mechanism can still
  be a script the entry calls.
- **Keep it in `infra.md`.** Rejected: that file is present tense, and
  folding dated history into it makes it neither a runbook nor a log.
- **Commit messages alone.** Rejected: nothing done on the droplet produces a
  commit.

## Revisit triggers
- The same kind of entry appears three times → that procedure graduates into
  `infra.md` or a skill.
- A second person operates production → entries gain an operator field and
  the review becomes a second person's approval.
