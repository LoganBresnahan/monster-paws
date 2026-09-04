# ADR-0019: Dogfood findings land in doc/issues.md, not in the roadmap

## Context
`doc/roadmap.md` carries build order plus every dogfood finding as a carry-in
pinned to the item that will hit it. That worked while findings were few and
each one clearly belonged to a future item. Item 2's entry is now ~90 lines,
most of it carry-ins, and the first two hours of real browsing produced
findings — junk names in the feed, a 4,000px description, a missing link-back —
that either belong to no single item or are too small to earn one.

The failure mode is not lost information, it is an unreadable plan: a roadmap
where the frontier is buried under paragraphs stops being the thing anyone
reads to know what to build next.

## Decision
1. **`doc/issues.md` is the inbox.** Defects and rough edges found by using the
   product go there, grouped (data quality / UI / compliance), newest first,
   each with what was seen and when.
2. **The roadmap keeps what is load-bearing.** A finding stays in — or moves
   into — `roadmap.md` or a plan in `doc/plans/` when it changes what we build
   next or blocks a slice: those are decisions about order, and order is the
   roadmap's job. Everything else lives in issues.md only.
3. **A finding may be in both, and one of them is the authority.** A blocking
   item is pinned as a carry-in where the work is, and its issues.md entry says
   so rather than restating it — the carry-in is what gets read at build time.
4. **Entries are deleted when fixed, never ticked.** The commit is the record
   (CLAUDE.md's `ADR-NNNN` grep rule already makes the trail findable). A file
   that accumulates struck-through history stops being read, which is exactly
   what happened to the roadmap item this ADR exists to unclog.

## Consequences
- One more file to keep current, and a new way to lose a finding: something
  filed in issues.md that should have blocked a slice, and was never pinned to
  it. Decision 3 is the mitigation; `/shipshape` is where it gets checked.
- The roadmap gets shorter and the frontier stays visible.
- Issues carry no severity field and no owner. If either starts being wanted,
  that is the signal that this file wants to be a real tracker instead.

## Alternatives
- **GitHub Issues.** Rejected for now: the docs are the working surface, they
  are read by agents in-context, and a second system means findings live where
  the build plan cannot see them. Revisit when someone outside this repo needs
  to file one.
- **Keep everything in the roadmap.** Rejected: this ADR exists because that
  is what we were doing.
- **Per-plan issue lists in `doc/plans/`.** Rejected: a finding often precedes
  the plan it belongs to, and the ones that hurt are the ones spanning slices.

## Revisit triggers
- issues.md grows past what one screen can survey, or entries start needing
  priorities and owners — it wants to be a tracker.
- A finding is fixed in code but the entry is still there a release later —
  deletion is not happening, so `/shipshape` needs to check it.
- Someone outside the repo needs to report a bug.
