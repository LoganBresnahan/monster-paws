# ADR-0020: The animal story is a derived, tiered projection — never the event log

## Context
`event_log` is the ingest ledger (ADR-0003, ADR-0013, ADR-0014): every
observation the pipeline made about an animal, append-only, permanent, written
for us. It is correct and it stays as it is.

It was also, implicitly, going to be the donor feed. Roadmap item 8 generates
sponsor updates "from confirmed events", and the obvious implementation reads
`animal.updated` rows. On 2026-09-04 two new merged fields (`orgUrl`,
`listingUrl`; ADR-0015 as amended) were backfilled by replay, and the writer
did its job: 62,729 `animal.updated` rows, each true — canonical state changed
— and each about nothing that happened to an animal. With the 5,023 from the
earlier `state` correction, **93% of the log's updates are us changing, not
the animal**, and they can never be removed.

Two lessons, and this ADR is both:

1. An ingest ledger and a donor feed are different jobs. Asking one table to do
   both made every schema change a lie to sponsors.
2. The rows hurt only because they are permanent. Truth must be permanent;
   *interpretation* of truth must be disposable, or every mistake in
   interpretation is forever.

DIRECTION already names the artifact: sponsors "collect rescue stories", and a
card's history is "the story unfolding". This ADR gives that story a table.

## Decision

### 1. `animal_story` is a projection: derived, rebuildable, never authored
A new table holds the presentable history of an animal — what a sponsor may be
told. It is **derived data in the sense of ADR-0003**, like `animals` and
`animal_display`: a projector builds it from the permanent sources and can
rebuild it from scratch at any time. Consequently:

- **Nothing writes `animal_story` rows directly** — not a page, not a worker,
  not a migration. Only the projector.
- **Nothing donor-facing reads `event_log`.** The generator (item 8), the card
  timeline (item 4), notifications (item 11) read `animal_story` and nothing
  below it. `event_log` is for ingest, audit and replay.
- Every row carries `projector_version` and `projected_at`. A rebuild
  truncates and reprojects; a bug in what we chose to tell sponsors is fixed by
  a deploy and a rebuild, not by living in the corpus forever.
- Because rows are rebuilt, **story row ids are not stable and nothing external
  may reference one**. Anything that must survive a rebuild — a notification
  already sent, a card already rendered — references the *evidence* (§3), not
  the story row.

### 2. Rows are tiered by evidence, and the tier name is persisted
Two families of presentable fact exist and carry different promises. They
share the table only because every row says which it is:

| tier | meaning | evidence |
| --- | --- | --- |
| `attested` | a shelter signed it (item 7) | an attestation id |
| `reported` | a shelter-tier source's own record, not yet confirmed (item 6) | the `event_log` row |
| `observed` | our inference from an aggregator listing | the `event_log` row |

Tiers are named and ordered, most trusted first; the **name** is stored, never
a rank — the ADR-0006 rule, for the same reason (reordering must not rewrite
stored rows). This is a separate axis from the fact-trust `TIERS` in
`src/core/sources.ts`: that ranks sources for merging facts, this ranks
evidence for telling a donor something happened. Do not derive one from the
other.

The tiers decide framing, and the framing is not optional copy: `attested` —
"*Happy Tails confirmed:* …"; `reported` — "*Happy Tails' records show:* …";
`observed` — "*We noticed:* …". Generated prose (item 8) may elaborate within a
tier and never up it: the faithfulness harness is what checks that the words
never claim more than the evidence tier allows (CLAUDE.md bright line).

### 3. Every row points at its evidence
`(evidence_type, evidence_id)` — `event_log` row or attestation — is required
and unique per `kind`, which is what makes projection idempotent and a rebuild
exact. A story row with no evidence is a story row the projector may not write.

### 4. The projector holds the newsworthiness rule — not the writer
Which `animal.updated` rows become story rows is decided by an explicit list in
the projector: `status` changing is news; `orgUrl`, `listingUrl`,
`postalCode`, `listedAt` are bookkeeping and project to nothing. The writer
(ADR-0013) keeps emitting `animal.updated` for every changed field, because at
the ledger level that is the truth and the parity harness depends on it. The
list lives beside the projector because the projector is what a new merged
field must be classified for — a field missing from the list is a build
failure, not a silent choice.

### 5. Forbidden projections, named
- **`animal.disappeared` never becomes an outcome.** ADR-0014 infers
  disappearance from absence, and shelters delete listings for many reasons.
  "Rosie went home" is the most emotionally loaded sentence this product can
  produce, and it comes only from a shelter saying so — `attested`, or at
  minimum `reported` with the shelter's own status. An absence may project to
  nothing, or to an `observed` "her listing is no longer up", never more.
- **Bookkeeping fields project to nothing** (§4), including in bulk: the
  62,729 rows that prompted this ADR project to zero story rows.
- **`animal.seen` is about us, not the animal.** Meeting an animal is not part
  of its story; the listing date is already a fact on its page.

### 6. Shape (built with roadmap item 6, not now)
```
animal_story
  id                bigserial          -- unstable across rebuilds, never referenced
  animal_id         → animals.id
  kind              text               -- 'status.changed', 'listing.reappeared', care kinds land with item 6
  tier              text               -- 'attested' | 'reported' | 'observed' (name, never rank)
  occurred_at       timestamptz        -- from the evidence, never the projection clock
  evidence_type     text               -- 'event_log' | 'attestation'
  evidence_id       bigint
  data              jsonb              -- kind-specific, minimal: what the framing needs, no prose
  projector_version text
  projected_at      timestamptz
  unique (evidence_type, evidence_id, kind)
```
The vocabulary of care `kind`s waits for real care events (item 6); the two
kinds we can project today wait for a page that renders them (item 4). The
boundary in §1–§5 is decided now, because it is free to decide and costly to
discover twice.

Sponsor fan-out — who is told about which row — is not this table. It is a
join from sponsorships to `animal_story`, decided with item 11.

## Consequences
- The generator, the timeline and notifications share one input with one
  honesty contract, and the faithfulness eval joins `animal_story` → evidence
  in one hop.
- One more projector to keep in step with the writer: a new `AnimalFields`
  entry needs a line in the newsworthiness list. The build fails without it.
- A rebuild reshuffles ids. Anything that cached a story id is wrong by design.
- `event_log` keeps growing with schema-driven updates, and that is now
  harmless: it was only ever a problem as a feed.
- Two tables can tell different stories if someone writes to `animal_story` by
  hand. The rule against that is enforced by review and `/shipshape`, not by
  Postgres.

## Alternatives
- **A "news" filter on `event_log` reads** — the list from §4, applied by each
  consumer. Rejected: it relies on every future reader knowing the rule, and
  the first one written the obvious way sends 62,729 messages.
- **Suppress events on replay / backfill.** Rejected: the writer would be
  lying about whether canonical state changed, the parity harness would have a
  place for the two writers to disagree, and "did the corpus change?" would
  become unanswerable. Loud at the ledger, quiet at the feed.
- **A separate event kind for schema-driven changes.** Rejected: the writer
  cannot tell a newly-added field from a newly-populated one without a
  field-introduced-at registry; more machinery than the problem deserves, and
  the projector's list is the same knowledge in a cheaper place.
- **Attested-only story.** Rejected 2026-09-04: trivially honest, but empty
  until items 6–7 ship and no home for "her status changed to pending", which
  sponsors want. Tiering with persisted names keeps the honesty in the row
  rather than in the table's existence.
- **Story rows as first-class authored records.** Rejected: that is exactly
  the permanence that made the event-log noise a wound instead of a bruise.

## Revisit triggers
- A shelter wants to write its own story entry (a photo, a note) — that is
  authored content and needs its own table and license, not a direct write
  here.
- A rebuild takes long enough that consumers see an empty story — projection
  needs to be incremental, or rebuild into a shadow table and swap.
- A `reported` row is contradicted by a later attestation — decide whether
  attestation supersedes (likely) or both remain with the contradiction shown.
- Someone needs a stable story id (deep links, "share this update") — mint a
  stable key from the evidence instead of stabilizing rebuilds.
