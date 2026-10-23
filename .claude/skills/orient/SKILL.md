---
name: orient
description: Take a bearing at the start of a new Monster Paws context window. Read the recent commits and doc/roadmap.md to reconstruct what shipped and what's next, follow the commit trail into whichever docs it points at (doc/DIRECTION.md, ADRs), then reconcile that ground truth against remembered state (MEMORY.md, cavemem) and flag any drift. Read-only — it briefs, it does not write memory or change code. Run when opening a fresh session or whenever you've lost the thread of where the project stands.
---

# /orient — take a bearing at session start

A new context window starts blind to *where we are*. Reconstruct it from the
sources that don't auto-load — commits, roadmap, and the docs they point at —
then check that what you already remember still matches reality.

**Read-only.** The deliverable is a briefing, not actions. It does **not**
edit code and does **not** write memory. Assumes cwd = the Monster Paws repo root.

## The context sources — and which lane is orient's

| Source | Holds | Trust | Loaded |
| --- | --- | --- | --- |
| CLAUDE.md | how-to-work rules, stack, conventions | authoritative, static | auto |
| MEMORY.md + memory files | curated durable facts | *as-of-write-time* — can drift | auto |
| **cavemem** (MCP, if connected) | narrative / the *why*, cross-session | *as-of-write-time*, richer | **on-demand** |
| **git + doc/roadmap.md + doc/** | what the code *is* / the plan *says* | authoritative, **current** | **must be read** |

Rules that keep the lanes disjoint:

- **Don't re-summarize CLAUDE.md or MEMORY.md** — they're in context already.
  Report the *delta* (what changed since last session) and the
  *reconciliation* (does memory still match ground truth?).
- **git = what shipped. ADRs = what was decided. cavemem = what was
  discussed.** Reach into cavemem only for a *why* that neither commits nor
  ADRs carry.
- **orient never writes memory.**

## 0. Standing notices — read before the commits

Notices live here only while they change how a session should begin; each
names the date it expires and the doc that owns the detail.

- **Meta hackathon (ADR-0028), until 2026-11-10.** Logan is in the Meta
  Global AI Developer Hackathon for *exposure*, once: building 2026-10-26 →
  2026-11-04 21:00 ET, judging to 11-08, finals 11-09. Every Meta API call
  (SAM 3.1, Muse) lives on the **`meta` branch**; topdog never calls Meta,
  and the long-term product stays local on the A770. klein paints the demo,
  SAM 3.1 finds the animal, the demo runs on its own stack under our domain.
  The stretch — real donations on production — turns on a Chicago shelter's
  grant by **2026-10-30**. Lead the bearing with: which branch this is, how
  many days to 11-04, and whether the 10-30 decision has been made
  (`git log --grep ADR-0028`, the track row). The ten-day plan is
  `doc/plans/meta-hackathon.md` **on the branch** — read it when on `meta`,
  and say when it is missing.

## 1. What shipped — read the commits

```bash
git branch --show-current && git log --oneline -12
git status --short
gh run list --limit 5
```

On `meta`, also `git log --oneline topdog..meta` (the branch's own work) and
`git log --oneline meta..topdog` (topdog commits the branch has not rebased
onto yet — a non-empty list is the first thing to fix, ADR-0028 §1).

Read back only until the arc is coherent. Answer three things: last
known-good state, what landed most recently, uncommitted WIP on the floor.

**"Last good" is the newest commit CI passed, not the newest commit.** A red
run blocks deploys by construction — the `images` job needs `verify`
(ADR-0007) — and nothing else reports one: five consecutive red runs went
unread from 2026-09-04 to 2026-09-28 (ADR-0017 as amended). If the newest run
is red, read its failure (`gh run view <id> --log-failed`) and lead the
bearing with it. Skip cleanly if `gh` is not authenticated, and say so.

## 2. Where we meant to be — the roadmap

Read `doc/roadmap.md` (**Now** and **Next**). Map shipped commits onto
checked items. Several tracks run in parallel, so there is no single
frontier: the **Active tracks** table at the top of Now names each track,
its next step and what it waits on. Check each row against git — a next
step already shipped, or a wait since cleared, is drift — and note the
carry-ins pinned to each track's item: those are the traps on its next task.

## 3. Reconcile ground truth against memory

For every remembered claim naming a concrete artifact — a file, symbol,
roadmap item, or "decision locked" — **verify it against what git / roadmap /
code show now.** Flag drift explicitly rather than trusting memory.

Then, only for a *why* the commits don't carry (skip cleanly if cavemem MCP
isn't connected):

```
cavemem search "<topic the commit raised>" → get_observations(ids)
```

Query against a **specific question the commits raised** — never dump it.

## 4. Follow the trail into docs (on demand)

Commits and roadmap items point at docs — "ADR-0003", "DIRECTION". Read the
specific referenced doc **only when the next move touches it** (starting the
attestation pipeline → ADR-0003's rules and revisit triggers; scope change →
`doc/DIRECTION.md`). Pulled by a question, not read by default.

## 5. The bearing (report)

```
ORIENT — Monster Paws @ <branch> <sha>
  notice      <each standing notice in one line, with its clock: "hackathon: N days to 11-04, decision 10-30 open|made", or "none">
  shipped     <recent arc in one line>  · last good: <commit>
  wip         <uncommitted files, or "clean">
  ci          <green @ sha, or "RED since <date>: <failing step>">
  drift       <remembered-vs-actual mismatch, or "none">
  tracks      one line each, from Active tracks:
              <track> (item <N>) → <next step>  [ready | waits on <what>]
  next move   <a recommendation among the ready tracks, and why> — read <the one doc> first
```

Keep it to that shape — a fast "you are here" that lets work resume in one
turn, not a re-run of project history.
