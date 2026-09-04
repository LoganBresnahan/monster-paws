# ADR-0014: Lifecycle events — disappearance inferred from a complete run

## Context
`animal.disappeared` has been in the pipeline contract since ADR-0009 phase 1
with one rule attached: it is inferred from absence, never read from a
payload. RescueGroups does not say "adopted" — an adopted animal is simply
not in tomorrow's `search/available/` results. The event is the adoption
signal DIRECTION's graduation moment fires on, and the thing that keeps a
browse page from offering a dog nobody has seen for a week.

The plan's ⚠ verify note names three ways a naive set-diff writes permanent,
wrong rows into `event_log`: disappearance must be scoped per source; a
partial, failed or gate-tripped run must never mass-emit; and reappearance
must be coherent. ADR-0013 gave us the piece this needs — `animal_identities`
is the per-source list of what canonical knows about.

## Decision
1. **Disappearance is a per-source set-diff at the end of a complete run.**
   After stages 1–4, `runIngest` hands the run's observed `externalId`s to
   a fifth stage, `LifecycleStore.reconcile(source, seen, at)`. An identity
   of that source that is present and not in `seen` becomes disappeared. An
   identity of another source is never consulted — an animal missing from
   the aggregator but present in a shelter's own feed has not gone anywhere.
2. **Only the caller can say a run was complete, and it must say so
   explicitly.** `runIngest(adapter, stages, { complete })` runs stage 5
   only when `complete` is true. The worker passes `true`. The one-shot CLI
   passes `maxPages === undefined` — a smoke run over two pages is
   deliberately partial and must not disappear the other 800 animals. A
   fetch that throws mid-way never reaches stage 5 at all (`runIngest`
   propagates the adapter error rather than reporting a short batch).
   Phase 9's health gates plug in here: a tripped gate passes `false`.
3. **A run that saw nothing reconciles nothing.** An empty `seen` set with
   existing identities is an outage, not a mass adoption; stage 5 skips
   with a stated reason on the report. This is the floor; the ratio gate
   ("more than N% disappeared in one run") is phase 9's.
4. **State lives on `animal_identities`**: `last_seen_at` (the newest
   run that observed it) and `disappeared_at` (null while present). Both
   derived and mutable, like the table. `event_log` holds the record —
   `animal.disappeared { externalId, lastSeenAt }` and
   `animal.reappeared { externalId, disappearedAt }` — but state is read
   from the identity row, never reconstructed from the log on every run.
5. **Reappearance is its own kind.** `seen → disappeared → reappeared →
   disappeared …` is the coherent sequence; reusing `animal.seen` would
   make a returned animal indistinguishable from a first sight, and the
   graduation moment must not fire twice for one adoption that fell
   through. `IngestEventKind` gains `animal.reappeared`.
6. **`occurredAt` for both kinds is the run's reconcile time**, not the
   identity's `last_seen_at` — the fact established is "absent as of this
   run"; when it actually left is unknowable from a daily poll and is not
   asserted.
7. **Replay never runs stage 5.** Absence is a property of a fetch, and
   replay does not fetch. A new identity takes `last_seen_at` from its raw
   row's `last_seen` (never the writer's clock), so a rebuild from empty
   comes back with true last sightings and `disappeared_at` null; the next
   complete run re-establishes each disappearance with a **second**
   `animal.disappeared` row whose `lastSeenAt` is correct. A rebuild is
   therefore visible in the log as a repeated disappearance — acceptable,
   because rebuilds are rare and deliberate, and never a wrong date.
8. **Completeness is verified by the adapter, not assumed.** The
   RescueGroups adapter reads `meta.pages` and `meta.count` from page 1
   only, throws on any page without `data`/`meta`, and throws if the run
   fetched more than 1% fewer records than page 1 promised. A silently
   short batch is the one input that turns decision 1 into a mass adoption.
9. **A run may not predate the newest sighting of its source.** Both
   stores refuse a reconcile whose `at` is older than the source's max
   `last_seen_at`, and stage-5 events are emitted in one order everywhere:
   reappearances, then disappearances, each by `externalId`.

## Consequences
- Canonical `animals.status` is untouched by disappearance; a page decides
  visibility from the identity's `disappeared_at` (roadmap item 3), and a
  Tier-1 status claim keeps meaning what the shelter said.
- A daily cron means an animal adopted Monday morning disappears Tuesday
  07:00. The event's `occurredAt` says Tuesday; that is what we know.
- One outage cannot fire false adoptions: a throw skips the stage, an
  empty run skips it, a partial CLI run skips it, a short batch throws.
  The residual risk is **pagination drift**: pages are fetched in sequence
  without a cursor, so an adoption between page 1 and page k shifts later
  records back by one and the last record of each following page is
  skipped — a routine trickle of false `disappeared` followed by
  `reappeared` the next day, invisible to a 1% count check. Phase 9 owns
  it: a reappear-rate metric, and sorting the search if the API allows.
- Stage 5 binds `seen` as one array parameter; at ~65k animals the
  nationwide feed already sits at Postgres's 65,535-parameter ceiling.
- `animal.seen` is still emitted by the writer at first sight; stage 5
  touches `last_seen_at` for every seen identity, including the deduped
  ones the writer never sees change.

## Alternatives
- **Derive present/absent from `event_log` on every run.** Rejected: an
  O(events) scan per poll to answer a question one nullable column
  answers, and it makes the sacred log a hot read path.
- **Derive from `raw_payloads.last_seen`.** Rejected: raw rows exist for
  observations whose write failed and whose identity does not; the diff
  belongs to the identity table, which is what canonical actually knows.
- **Let the adapter declare completeness.** Rejected: the adapter knows
  it truncated on `maxPages` but not that a health gate tripped; the
  caller is the only party that sees both.
- **Reuse `animal.seen` for reappearance.** Rejected (decision 5).
- **Mark `animals.status = 'unavailable'` on disappearance.** Rejected:
  a status is a claim with a source, and absence is not a source.

## Revisit triggers
- A source with an explicit adoption signal (Shelterluv's outcome events,
  item 6) — its payload-borne status should take precedence over inferred
  absence for that source's identities.
- Item 10 gives one animal several identities — "disappeared" for the
  animal becomes "all identities disappeared", a query, not a new event.
- Sponsors exist and the graduation moment is wired — the daily lag and
  the ratio gate both become user-visible and should be revisited together.

## Amendment (2026-09-04): the reconcile clock is ordered by the data, not by the wall clock

The original decision refuses any run whose `at` predates the source's newest
sighting, to stop a disappearance being dated before a presence. The rule is
right; the refusal was the wrong instrument.

### The machine

Observed here, and already characterised in a sibling project on the same box
(`captAInHook/doc/platform.md`, measured 2026-08-11): WSL2's wall clock steps by
tens of seconds **in both directions** — a +86.4s step while the monotonic clock
advanced 101ms, and −86.7s back a minute later. The mechanism is a dual-boot
machine whose two operating systems disagree about the RTC; Windows resyncs
against time.windows.com to correct the accumulated drift, WSL2's guest clock
follows through Hyper-V time sync, and each correction lands in the guest as a
step. Nothing in the workload provokes it.

This ADR was amended earlier the same day with a five-minute tolerance, chosen
from a single ~105s observation. That was wrong, and the reason matters: **the
step size is the accumulated drift**, so it grows with the time between the
host's resyncs — 86.7s in August, 105s in September. Any fixed bound is a number
waiting to be exceeded, and exceeding it discards a complete 64k poll for a
machine's bookkeeping.

The bidirectional part also corrects the earlier diagnosis. A *forward* step is
what lets Postgres stamp `created_at` ahead of true time; the backward
correction is merely when the damage becomes visible.

### 1. Always clamp forward

`resolveReconcileAt(at, newest)` returns `max(at, newest)`, with no threshold.
The clamp is not a concession to a broken clock — it is this ADR's invariant
written as an expression, and it holds at any magnitude.

### 2. The refusal is withdrawn

It protected nothing the clamp does not. A run the caller declared **complete**
that did not contain an animal means that animal is gone; only the *date* of
the event was ever in question, and the clamp answers it. Replay never
reconciles, a partial run never reconciles, and an empty feed is already
skipped — so no path reaches here where "the clock looks wrong" implies "the
data is wrong".

### 3. A corrected run says so

`IngestRunReport.clockSteppedBackMs` carries the correction and the ingest CLI
prints it. This is now the only signal, which makes it the important one:
a step is reported, never silently absorbed.

### Consequences (added)

- A stepped run dates its lifecycle events at the previous sighting rather than
  at the true present. Unbounded in principle, bounded in practice by how far
  the host's clock has drifted.
- `clockSteppedBackMs` appearing routinely is an infrastructure fact about the
  host, not a property of the feed. On the droplet it would mean NTP needs
  fixing; a tolerance was never a substitute for a machine that keeps time.
- Nothing here helps a *forward* step, which writes a future `last_seen_at` and
  so widens the ADR-0015 visibility window until real time catches up. Pinned as
  a roadmap carry-in rather than solved: it needs a reference clock, and this
  ADR only has the data's own ordering.

### Revisit triggers (added)

- The droplet reports steps — fix NTP there; do not widen anything.
- A reference clock becomes available (a monotonic-anchored source, or trusting
  Postgres as the single clock for both sighting and reconcile) — the forward
  step becomes addressable and this decision can be revisited whole.
