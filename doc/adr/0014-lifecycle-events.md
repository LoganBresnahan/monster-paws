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

## Amendment (2026-09-30): the disappearance-rate gate

Decision 3 left "the ratio gate (more than N% disappeared in one run)" to
phase 9, and ADR-0010 as amended 2026-09-28 corrected its shape: the first poll
after 24 days away legitimately disappeared 21,459 of 85,204 identities
(25.2%), and any flat N that refuses an upstream bug would also have refused
that run. The gate is a rate per day since the last complete run.

### Decisions
1. **Compounding, not linear.** `dailyDisappearanceRate` is
   `1 − (1 − share)^(1/days)`: the daily rate that, sustained, produces the
   observed share. The 2026-09-28 wave measures ~1.2%/day. Dividing the share
   by the days ignores that each day's departures come from a smaller pool,
   and so understates long gaps: 90% lost over ten days reads as 9%/day
   linearly and 20.6%/day compounded.
2. **The limit is 5%/day** (`MAX_DAILY_DISAPPEARANCE_RATE`), about four times
   the one measured rate and an order above pagination drift (~0.5% a run).
   **The floor is 100 disappearances** (`DISAPPEARANCE_GATE_FLOOR`): below it
   the gate never refuses, because for a twelve-animal shelter a single good
   adoption day is 25%.
3. **The denominator is the source's last complete run in `ingest_runs`**,
   falling back to its newest `last_seen_at` only when no run is recorded
   (every database migrated before `ingest_runs` existed). The gap is floored at
   one day, so two runs minutes apart cannot read pagination drift as collapse.
4. **The gate counts inside stage 5's transaction, before any write**, and a
   refusal writes nothing: no `disappeared_at`, no event. Stages 1–4 have already
   landed — the corpus grows either way. The run is recorded `complete: false`
   with the refusal as its `lifecycle_skipped`, which is exactly decision 2's
   "a tripped gate passes `false`".
5. **A refusal reaches a person the same day.** The worker reports it as an
   error to Better Stack; the job itself succeeds, because retrying re-fetches
   the same feed. If nothing is done, `/api/health` goes red 27 h after the last
   complete run (ADR-0010 as amended 2026-09-30).
6. **Only a person raises the gate, for one run:** `npm run ingest -- poll
   --max-daily-disappearance <rate>`. The worker never passes it. The CLI refuses
   a value outside (0, 1], because `NaN` compares false against every rate and
   would silently switch the gate off.

### Consequences (added)
- **A genuine wave clears itself.** The denominator stays at the last complete
  run, so each refused day lengthens the gap: a real 30% loss passes after about
  eight days without anyone acting. An upstream bug that persists keeps tripping,
  and health is red long before then.
- Between refusal and clearance, animals that really left stay visible for up to
  ADR-0015's eight-day window anyway; a refusal never shows a gone animal for
  longer than that window already allows.
- The runbook entry (`doc/infra.md`, Recurring ops) covers how to tell a wave
  from a bug.

### Revisit triggers (added)
- A week of production runs gives a real daily-rate distribution — set the limit
  from its tail, not from one wave.
- The gate trips on a wave that turns out to be real more than once a quarter
  → the limit is too low.
- A second source with a very different turnover (a scrape of one shelter) →
  per-source limits.

## Correction (2026-10-05): the fallback denominator is when the disappearing were last seen

Decision 3 of the 2026-09-30 amendment fell back to "the source's newest
`last_seen_at`" when no `ingest_runs` row exists. Its first real run proved that
wrong. The dev poll of 2026-10-05 came seven days after the last one, on a
database migrated before `ingest_runs` existed, and was refused at "8,483 of
72,554 over 1.0 day(s) … 11.7%/day". The true rate was about 1.8%/day. Stages
2–4 had already created that run's 8,809 new identities, each with `last_seen_at`
set to its fetch time. So the source's newest sighting was the run itself, and
the gap collapsed to the one-day floor. The fallback failed in precisely the case
it existed for.

**Corrected:** the fallback is the **median** `last_seen_at` among the
*disappearing* identities. Nearly all of them were last confirmed by the previous
complete run, so the median is that run: the window they left in.
`DisappearanceTally.newestSighting` is now `disappearingMedianLastSeen`.

The first attempt at this fix took the *newest* `last_seen_at` among the
disappearing, and the rerun was refused at the same "over 1.0 day(s)". The
refused first poll had created 8,809 identities, and a few of them were missing
from the rerun through ordinary pagination drift. Each one counted as
disappearing with a sighting from that morning, and one is enough to drag a
maximum to today. A median ignores stragglers like these. A lockstep test
reproduces both failures: no run recorded, a week's turnover, newcomers in the
same run, and stragglers a partial run created the day before.

**Clarified:** `present` counts this run's newcomers too, which dilutes the
share by about one run's new listings (~1% on a daily poll). That leans lenient,
never stricter, and was not worth threading the run's start time into stage 5.

Production was never exposed. It has `ingest_runs` from its first poll, and that
poll starts from an empty database with nothing to disappear.
