# ADR-0013: Canonical merge semantics — identity, null claims, conflicts, events

## Context
ADR-0009 phase 7 (entity-resolution-merge) turns normalized claims into
`animals` rows. The kernel exists — `resolveClaim` picks a winner per field
by tier then recency (ADR-0006 as amended) — and the in-memory writer has
applied it since phase 1. Four questions were deliberately left open until
live data could inform them, and the first RescueGroups run into Postgres
(1000 animals, 2026-08-17) answered the one that mattered most: 19 animals
carry no `breedPrimary`, and the normalizer asserts `breed: null`. Under
plain tier-then-recency a fresher same-tier null wins and erases a real
breed. The phase is built now, ahead of phases 5–6, because the demo needs
canonical animals before any shelter is contacted; the RescueGroups corpus
is the only claim source that exists, so the cross-source branch is proven
by fixtures simulating two sources.

## Decision
1. **Identity v1 is exact `(source, externalId)`**, held in a new derived
   table `animal_identities (animal_id, source, external_id)` with a unique
   key on `(source, external_id)`. One canonical animal may own several
   identities; in v1 nothing creates the second one, so an animal seen by
   two sources is two canonical rows. The fuzzy cross-source matcher
   (roadmap item 10) adds identity rows — it does not change the writer.
   `animals` carries no `source`/`external_id` column: a row's sources are
   its identities, never a single stamp.
2. **Merge is per field: `resolveClaim(incoming, current)`**, in one pure
   kernel (`src/core/ingest/merge.ts`) that both the in-memory reference and
   the Postgres writer call — neither may carry its own copy. `current` is
   rebuilt from the row's value plus its `provenance` entry. Order of
   precedence: tier, then `fetchedAt`, then the **later raw row** on an
   exact `fetchedAt` tie (two rows stamped the same instant would otherwise
   flip on every replay, each flip a permanent event), then incoming — so a
   re-derivation of the *same* raw row (a fixed normalizer on replay) still
   repairs a bad value. `provenance` is
   `{ [field]: { source, fetchedAt, rawId } }` as JSONB with ISO timestamps,
   and `fetchedAt` is always the raw row's own — a deduped re-poll hands the
   existing row's `fetchedAt` back, never the poll's, so every provenance
   entry points at a row that exists. A winning claim is written whenever
   its provenance changes, not only when its value does: a same-value claim
   from a higher tier must take the field, or the next lower-tier poll
   outranks nothing and clobbers it.
3. **A null-valued claim never participates in resolution.** It neither
   wins a field nor records provenance; a field becomes non-null only by
   assertion and never returns to null through the merge. In v1 absence in
   a payload is indistinguishable from retraction, and erasing a real
   value is the costlier mistake for a donor-facing page. Normalizers may
   keep asserting `null` (absence is information within one source and is
   preserved in the raw row); the writer drops it.
4. **No `sources.conflicted` event.** A losing claim is discarded from
   canonical, but it is not lost: the raw row holds it and replay re-derives
   it. Disagreement between sources is an observation about the pipeline,
   not an event in an animal's life, and `event_log` is sacred. The writer
   instead reports the fields where an incoming claim from a **different
   tier** held a *different* value, in either direction — a shelter API
   contradicting every aggregator value must trip the gate as surely as
   the reverse; `IngestRunReport.conflicted` counts them for the phase-9
   health gates. Losing on recency within a tier is not a conflict — it is
   a stale observation, and replay meets one on every superseded row.
5. **A first observation must carry `name` and `species`, and `status` has
   no default.** Both writers refuse an unviable first observation as a
   per-observation write failure (no row, no event). `animals.status` is
   nullable with no default: a status nobody asserted is `null`, and a page
   must not show an animal whose status is unknown — the old
   `'available'` default was a donor-facing value with no provenance.
6. **The writer emits `animal.seen` for a new canonical row and
   `animal.updated` (with the changed field list) when a resolved value
   changes.** An observation that reproduces canonical emits nothing —
   replay over the whole corpus must append zero events to `event_log`.
   `animal.disappeared` stays with phase 8's set-diff.
7. **The live poll runs all four stages from this phase on.** The stage-1-
   only guard in `ingest.poll` existed because the merge did not; it comes
   off in the same commit, and the corpus collected so far is replayed
   through the new stages.

## Consequences
- Every field on `animals` can be traced to one fetch via
  `provenance[field]` → `raw_payloads` (source, fetchedAt).
- A shelter that legitimately removes a breed will not see the removal on
  our page until a non-null value replaces it — a stale value, never an
  erased one. This is the stated cost of decision 3.
- A Tier-1 fact can only be displaced by a newer Tier-1 fact. A fresher
  aggregator value loses even when it is right; correction then is a Tier-1
  re-fetch, not a manual override (a `manual` source is the lowest tier).
- Two sources describing one animal produce two rows until item 10. The
  demo shows RescueGroups animals only, so this is invisible until a
  consented scrape overlaps an aggregated listing.
- `animals` remains mutable derived data; `animal_identities` cascades on
  its deletion. **Replay is additive**: run over existing canonical it can
  only refine, so a field a normalizer *stopped* asserting keeps its last
  value and provenance. A true rebuild is truncate `animals` (identities
  cascade) then `npm run ingest -- replay <source>` — the two are not the
  same operation, and only the rebuild is guaranteed to equal
  from-empty.

## Alternatives
- **Null beats non-null within the same source (retraction).** Rejected for
  v1: RescueGroups omits fields routinely, and a Tier-1 API's null is not
  observed yet. Revisit when a Tier-1 source arrives whose omission means
  retraction.
- **Emit `sources.conflicted` to `event_log`.** Rejected: permanent rows for
  a derived, replay-recoverable fact; would fire on every poll for every
  persistent disagreement.
- **Store `source`/`external_id` on `animals`.** Rejected: it freezes the
  row as single-source and makes item 10 a schema migration instead of an
  insert.
- **Keep the poll stage-1-only until phase 8.** Rejected: `animal.seen` /
  `animal.updated` are well-defined now and the demo needs rows in
  `animals`; phase 8 adds a kind, it does not redefine these two.

## Revisit triggers
- A Tier-1 source ships and a field on a real animal must go back to null
  — decision 3 needs a per-source or per-tier retraction rule.
- A second source overlaps a RescueGroups animal in production — item 10
  is due, and the duplicate-row cost of decision 1 becomes visible.
- `conflicted` in a daily run exceeds a few percent of `normalized` —
  a normalizer is mapping a field wrong, and the health gate should trip.
