# ADR-0015 build plan — animal pages

Derived from `doc/adr/0015-animal-pages.md` by the `adr-plan` workflow on
2026-08-25 (15 slices, 17 agents); phase order and batching edited by hand.
Phase 1 shipped 2026-08-25; its `visible-animals-predicate` verify pass ran the
same day (two adversarial agents, mutation-tested — three coverage holes found
and closed, two carry-ins pinned below).

Every slice is opus-grade — no Fable slice in this ADR. Three slices carry an
adversarial verify pass (⚠). Check items off as they ship.

## Phases

1. **foundations — schema, contracts, predicate, contact route**
   - [x] `animal-location-facts` — medium, moderate
   - [x] `animal-display-table` — low, mechanical
   - [x] `normalizer-display-output` — low, mechanical
   - [x] `visible-animals-predicate` — medium, moderate ⚠ verify
   - [x] `claim-or-optout-contact-route` — low, mechanical

2. **ingest wiring + read-side helpers** — shipped 2026-08-25 (migration 0005)
   - [x] `animal-listing-dates` — medium, moderate — **added 2026-09-03**
     (ADR-0015 amendment decisions 2–3), and it reopens phase 2 ahead of the
     pages: the browse sort column does not exist yet. Promote RG's
     `createdDate` → `listedAt` (a merged claim on `animals`) and
     `updatedDate` → `sourceUpdatedAt` (a column on `animal_identities`, never
     a claim — it is per-source like `last_seen_at`); extend `visibleAnimals`
     with the 24-month upkeep bound on the SAME identity row as the other two
     conditions; replace `animals_status_created_idx` with
     `(status, listed_at, id)`. Medium because `MERGED_FIELDS` grows — the
     first replay after the migration fires `changed` for every animal
     (sequencing risk (b)), which the parity test must assert once, not per
     re-poll. Do the EXPLAIN on a real-size corpus before trusting the index
     shape. Verification is the existing writer-parity harness plus a
     visibility test per boundary; no adversarial pass, since a wrong version
     fails loudly.
     - shipped 2026-09-03 (migration 0006). The EXPLAIN ran on a 64k synthetic
       corpus (throwaway db, dropped after): browse page 1 is 0.98 ms and a
       deep filtered keyset page 0.61 ms, both an ordered index scan with no
       sort node, and the four-column identity index measures the same as the
       three-column one at this size — it is kept for the index-only probe,
       which is what grows with the table, and the numbers are in
       `src/db/schema.ts`.
     - decided here, not by the ADR: a null `source_updated_at` HIDES the
       animal. Default-deny matches the null-status rule, but it means the
       existing 64k corpus is invisible until a poll or
       `npm run ingest -- replay rescuegroups` repopulates the column — do
       that before judging a browse page as empty.
     - carry-in → phase 3: the upkeep gate rejects ~5.8 rows per visible one at
       the HEAD of the sort, where the stale tail lives (measured on the
       synthetic corpus). Sub-millisecond at 64k, but it is the one number that
       degrades if the tail grows; re-EXPLAIN if browse slows.
   - [x] `stage4-display-upsert` — medium, moderate ⚠ verify
   - [x] `rescuegroups-display-promotion` — medium, moderate
   - [x] `licensed-display-picker` — medium, moderate ⚠ verify
   - [x] `browse-indexes` — low, mechanical
     - carry-in (phase-1 verify pass): the correlated EXISTS is driven by
       `animal_id` first, so the useful index is
       `animal_identities(animal_id, disappeared_at, last_seen_at)` — not the
       two-column order ADR-0015 Consequences names. EXPLAIN it against the
       64k corpus before choosing.
       **Settled 2026-08-25**: EXPLAIN ANALYZE on a 64k synthetic corpus
       (throwaway db, dropped after). `animal_id` first turns the browse query
       into a nested-loop semi join over an index-only scan — 0.66 ms filtered
       by species+state, 0.10 ms unfiltered. The ADR's column order can only
       seq-scan `animal_identities` and hash-join it: 15.7 ms and 22.6 ms, and
       both degrade with the table, not the page. The single-column
       `animal_identities_animal_idx` is dropped as a prefix of the new one.
     - decided here, not by the ADR: `?width=500` is applied at **promotion**,
       not render. RescueGroups publishes the 500px variant's URL in the
       payload (`pictures[].large.url`); appending the query ourselves would
       synthesize a URL, the trap `trackerUrlOf` already names. The plan's
       default (render-time) is overridden for that reason and the detail page
       renders `photo_urls` as given.
     - both ⚠ passes ran adversarially (two subagents, mutation-tested,
       2026-08-25). The implementations held on all eight checklist
       properties; three coverage holes and one live bug were found and
       closed. **The bug**: `isActive` failed OPEN on an unparseable date —
       `Date.parse` returns NaN and every NaN comparison is false, so a
       typo'd `grantedAt` licensed a shelter at every instant in history.
       Fixed in `shelters.ts`, with ISO-format validation now shared by the
       registry and the new `licenseProblems` check. **The holes**: a writer
       emitting `animal.updated` on any display-bearing change passed all 157
       tests (one permanent event_log row per animal per upstream copy edit);
       the omitted-`registry` call shape — the one every page will use — was
       unasserted; and both `isActive` date boundaries were unpinned. Each is
       now pinned by a test that fails when the mutation is reapplied.
       Carry-ins raised but out of this slice's scope are on roadmap item 2.

3. **pages (styled with brand tokens)**
   - [x] `animal-detail-page` — medium, moderate — shipped 2026-09-04
     - `src/app/animals/[id]/page.tsx` reaches the database only through
       `loadAnimalDetail` (`src/core/animals.ts`), which composes
       `visibleAnimalById`; a non-visible id, a nonexistent one and a
       non-numeric one are all 404. Shared primitives (`AnimalPhoto`,
       `TrackerPixel`) live in `src/ui/animal.tsx` and `/design` renders those,
       per the ADR-0016 amendment above.
     - the tracker pixel is driven by the `rescuegroups` display row itself,
       never by whichever row won `pickLicensedDisplay` precedence — a
       shelter's own display row outranking RG's must not silently drop a pixel
       the API terms owe (ADR-0006 decision 2).
     - **ADR-0018 came out of the first real render**: 72% of stored
       descriptions are HTML-entity-encoded, so the page showed
       `I&#39;m a chill girl.&nbsp;`. Decoding happens at render, never at
       promotion, and unknown entities stand verbatim.
     - the link-back decision 5 owes is **closed 2026-09-04** (ADR-0015 as
       amended, migration 0009). It was briefly filed as blocking on the belief
       that RG publishes no org URL — a conclusion drawn from ONE payload, and
       wrong: `orgs.url` covers 97.7% of animals and 18.6% carry their own
       listing page. Both are claims, validated, never assembled. The lesson is
       the cheaper one: measure a field's coverage across the corpus before
       concluding a source does not publish it.
     - dogfooding 2026-09-04 moved two decisions earlier, both amendments:
       **ADR-0015 decision 7** — the hero photo loaded last and shoved the page
       down, so photos are a fixed aspect box, and thumbnails that look
       clickable now are (`AnimalGallery`, the one client island, `useState`
       only, no state library). **ADR-0018** — `tidyWhitespace` after
       `decodeEntities`, in that order, because one listing rendered ~4,000px
       tall and its blank lines were decoded `&nbsp;`.
     - **ADR-0015 amended again 2026-09-04** after `object-cover` was seen
       cutting a dog's head off: `animal_display.photo_urls` became `photos`
       (`{url,width,height}`, migrations 0007/0008), the RG normalizer reads
       each variant's own `resolutionX/Y`, and the frame takes the photo's own
       ratio. Corpus replayed: 64,133 display rows, 62,121 with photos, none
       malformed. A photo whose size the source omits is dropped.
     - carry-in → phase 4: `isBirthDateExact` renders as "Born <date>" and the
       estimate as "About N years old (estimated)" — e2e should pin both, since
       a flipped flag states an age a shelter would have to defend.
   - [ ] `animal-browse-page` — medium, moderate
     - carry-in, seen 2026-09-04 on the dev-only stub index: the head of the
       longest-listed sort is not animals. The first rows are administrative
       listings a rescue parked in the feed years ago — "ADOPTION-Read First"
       (listed 2006), "Kittens!!!!" (2006), "OK Fosters Needed" (2008), "One by
       One cats" — all `available`, all maintained recently enough to clear the
       24-month upkeep bound. The bound filters abandonment, not
       not-an-animalness, and the sort points straight at these. Decide it
       before browse ships: it is the first page a donor sees.
   - [ ] `brand-tokens-in-pages` — low, mechanical
     - **amended 2026-09-03 (ADR-0016)**: the cycle resolution under "Why this
       order" — fold the styling in, no shared component — is superseded now
       that `/design` exists. A pattern both pages use (the animal card, the
       photo block, the "last updated" line) is proposed as a section on
       `/design` and lands as a component under `src/ui/`, which `/design` then
       renders instead of a copy. Styling still ships inside the page commits;
       what changed is where a shared pattern lives.
     - **settled 2026-09-03 (ADR-0015 amendment)**: browse pages by keyset
       cursor (`?after=<created_at>,<id>`), forward-only, Back is browser
       history. EXPLAIN whether `id` must join `animals_status_created_idx`
       before writing the query, on a corpus of real size — the phase-2 index
       carry-in is the precedent for not guessing.
     - **settled 2026-09-03 (ADR-0015 amendment)**: browse sorts on `listedAt`,
       not `animals.created_at`, so this phase now depends on
       `animal-listing-dates` landing in phase 2. Duration copy ("listed 3
       years ago") becomes sayable once it does — off `listedAt` only, never
       off `created_at`, which is a fact about our INSERT.
     - **settled 2026-09-04** against the rebuilt 64k corpus. Species: `dog`
       29,560 and `cat` 28,776, then a long tail (bird 723, rabbit 613, guinea
       pig 220, down to snakes) — the two-species v1 filter is honest, but the
       tail is real animals and must stay reachable unfiltered. State: 57
       values after the normalizer fix, six of them NOT US states — `ON`, `AB`,
       `BC`, `QC`, `SK`, `PR`, 683 animals. Never hardcode the fifty: RG is not
       US-only and those animals would become unreachable.
     - carry-in: build the filter's OPTION list from values matching
       `^[A-Z]{2}$`, not from `select distinct state`. Twenty-seven animals
       carry a junk `T` that predates the normalizer fix and **cannot be
       removed by replay** — see below — so a raw distinct query offers `T` as
       a filter nobody can use.

4. **closure — purge path + e2e**
   - [ ] `display-purge-path` — medium, moderate
   - [ ] `animal-pages-e2e` — medium, moderate
     - carry-in (phase-1 verify pass): nothing stops a page assembling its own
       predicate, and no unit test can catch that. Assert BOTH halves for one
       non-visible animal — the detail 404 and its absence from browse.

5. **docs reconciliation**
   - [ ] `flows-and-roadmap-docs` — low, mechanical

## Replay cannot retract a claim (found 2026-09-04)

Measured, not reasoned: the `stateOr` fix promoted 5,023 corrected states on
replay and left 27 junk `T` values exactly where they were. The normalizer now
asserts *nothing* for an uninterpretable state, and an absent claim does not
overwrite — which is ADR-0009's phase-7 rule ("null claims may not silently
beat real values") working as designed.

The consequence is worth stating because ADR-0009 promises the corpus is the
repair path: **replay repairs any claim except one we should never have made.**
Correcting a value needs only a better assertion; retracting one needs a
mechanism that does not exist.

Nothing currently obliges us to retract a fact — ADR-0006's set-deletion and
ADR-0015's display purge both DELETE rows rather than withdraw claims, so
neither is blocked. Reopen this if an obligation ever lands on `animals`
itself.

**Critical path:** `animal-display-table` → `stage4-display-upsert` → `animal-listing-dates` → `animal-detail-page` → `display-purge-path` → `flows-and-roadmap-docs`

## Why this order

**1. foundations — schema, contracts, predicate, contact route** — All five have no unbuilt dependencies and touch disjoint files. Batch the two schema slices (location columns + animal_display table) into ONE `db:generate` so migration 0004 is a single additive file rather than two. normalizer-display-output is pure type wiring that can land alongside. visible-animals-predicate is self-contained (all columns exist) and is the one slice here that gets an adversarial pass. The contact route is a static page whose only dependency (brand tokens) is already satisfied — landing it early means the detail page has a real link target from day one.

**2. ingest wiring + read-side helpers** — Each consumes phase-1 outputs: stage4 needs the table + the Normalizer `display` field; RG promotion needs the `display` field + location claim keys; the picker needs the row type; browse-indexes needs the state column and the fixed WHERE shape of visibleAnimals. Land stage4 before RG promotion so the promotion's first real poll produces rows. Fold browse-indexes' migration into the same generate as any schema change here; otherwise it is migration 0005. stage4 and the picker are the two verify-pass slices.

**3. pages (styled with brand tokens)** — Both RSCs compose only helpers from phases 1–2 (visibleAnimals, picker, display rows, location facts, contact route). The assessments encode a cycle (pages depend on brand-tokens-in-pages, which depends on the pages); resolve it by treating the remaining token work as the styling pass of these same page slices — build each page directly on the @theme tokens, no separate commit. Build detail first, then browse (browse cards reuse the detail's photo/fact rendering).

**4. closure — purge path + e2e** — Both need rendered pages: purge asserts the detail page falls back to facts after DELETE; e2e transcribes the Decision 5/2/6 checklist against seeded pages. The e2e seeding decision (globalSetup running runIngest over golden fixtures + an 8-day-stale identity + an adopted animal) is the only design work in this phase — settle it before writing specs. e2e is also the sanctioned verification for the page slices, so do not skip it.

**5. docs reconciliation** — Must land last: every flows.md box has to name a symbol that exists (visibleAnimals, animal_display, page paths, the stage-4 upsert). Check roadmap item 3 off and pin the four revisit triggers as carry-ins; CLAUDE.md only changes if a new npm script appeared (none expected).

## Batching, verify, risks (workflow notes)

MODEL: every slice is opus — there is no Fable work in this ADR, so no model-based batching is needed; batch by phase.

BATCH: (1) animal-location-facts + animal-display-table into one schema edit and one `npm run db:generate` (single migration 0004); add normalizer-display-output to that same commit since it is the type-level twin of the table. (2) stage4-display-upsert + rescuegroups-display-promotion as one commit-pair — the upsert has nothing to write until the promotion emits `display`, and the parity test covers both. (3) The two pages + the styling half of brand-tokens as one unit; do not open a separate styling PR. (4) Fold browse-indexes' migration into whichever phase-2 schema change generates a migration, or accept it as 0005.

VERIFY (genuinely warranted, 3 slices): visible-animals-predicate — check EXISTS is per-identity (disappeared_at IS NULL and last_seen_at fresh on the SAME row), null status excluded, 8-day cutoff injectable, helper composable for list and by-id. stage4-display-upsert — check no `animal.updated` / `changed` event fires from the display upsert on re-poll (event_log is append-only, ADR-0003), updatedAt untouched, replay rebuild yields an identical row. licensed-display-picker — check `aggregator-display` is never added to the shelter PERMISSIONS list or inferred via tierOf/rankOf, and that unknown shelter / revoked grant / asOf-before-grantedAt / display-less scrape shelter / RG-without-aggregator-display all return null (default deny).

DO NOT VERIFY (loud-failure or checklist slices): animal-location-facts (parity harness catches it), animal-display-table, normalizer-display-output, browse-indexes (perf miss, not correctness), rescuegroups-display-promotion (fixture test), display-purge-path (test fails loudly), claim-or-optout-contact-route (copy), brand-tokens-in-pages, animal-detail-page and animal-browse-page (animal-pages-e2e IS their verification), animal-pages-e2e, flows-and-roadmap-docs. Use /shipshape as the gate on every commit; no /deploy until phase 4 is green.

SEQUENCING RISKS: (a) The assessment dependency graph has a cycle (pages <-> brand-tokens-in-pages); resolved above by folding the styling into the page slices — do not wait on it as a separate prerequisite. (b) Touching MERGED_FIELDS in animal-location-facts changes what `changed`/`conflicted` events fire on for existing corpus rows; the first replay after migration will emit location-change events for every animal — expected, but confirm the parity test asserts it once, not per re-poll. (c) rescuegroups-display-promotion must supersede (not delete) the existing 'never asserts prose or photos' test and the ADR-0006 header comment with an ADR-0015 citation, and decide `?width=500` at promotion vs render in a comment — the detail page assumes render-time, so pick render-time unless there is a reason not to, and keep both slices consistent. (d) display-purge-path has to stand up the first source-scoped purge helper (none exists); keep v1 scope to display rows only and say so in the comment, or it balloons into the ADR-0006 raw/facts purge. (e) e2e visibility fixtures depend on wall-clock time; seed last_seen_at relative to now() in globalSetup, not as fixed timestamps, or the suite goes red after 8 days. (f) Commit only when Logan asks — phases are review units, not auto-commits.

## Per-slice assessment

### `animal-location-facts` — medium · moderate · risk low
depends on: none

No city/state/postal/org fields exist anywhere in src/ yet (grep on
pipeline.ts, schema.ts, pg.ts, memory.ts, rescuegroups.ts is empty), so the
slice is fully todo. The reasoning load is small because the merge is already
generic: `mergeClaims` (merge.ts) and the Postgres writer's
`currentClaimsOf`/touched loop (pg.ts:128-180) both iterate `MERGED_FIELDS`
and store per-field provenance in the JSONB `provenance` column, so the new
facts get `resolveClaim` tier+recency semantics for free. Real work is: extend
`AnimalFields` + `MERGED_FIELDS` (the `satisfies` clause keeps them in sync at
typecheck), add nullable text columns to `animals` in schema.ts, generate an
additive Drizzle migration (nullable ADD COLUMN on a mutable derived table —
no append-only corpus risk), confirm the memory writer needs no field-specific
change, and add a location scenario to tests/ingest-writer-parity.test.ts. One
judgement call worth a moment: whether org name belongs as a fact on `animals`
or as display content (ADR Decision 4 says AnimalClaims) — follow the ADR.
Medium rather than low because touching MERGED_FIELDS silently changes what
`changed`/`conflicted` events fire on, and the parity test must cover it; but
the existing writer-parity harness makes a plausible-but-wrong implementation
unlikely to ship, so no adversarial verify pass. No dependencies: this is
schema/contract groundwork that the normalizer promotion and browse slices
consume. Shipshape gates the commit (migration + schema + docs).

### `animal-display-table` — low · mechanical · risk low
depends on: none

Purely additive Drizzle table that copies the existing `animalIdentities`
shape in src/db/schema.ts (integer animal_id FK with onDelete cascade,
`source` typed as `Source`, uniqueIndex on (animal_id, source)) plus a text
description, jsonb string[] photo_urls, listing_org, tracker_url, fetched_at,
and `npm run db:generate` for migration 0004. No existing column or append-
only table is touched (`animals.photo_keys` stays), so migration safety on the
corpus is not a concern; the only judgment is writing the ADR-0015 schema
comments as prohibitions (never merged into animals, purgeable derived data,
URLs not R2 keys) in the house style. Nothing under src/ or drizzle/
references animal_display yet, so status is todo. No upstream slice needed —
the location-facts slice edits `animals` independently and both can generate
migrations in either order. Shipshape covers typecheck plus the schema-comment
convention check; no adversarial pass is warranted for a table definition
whose failure mode is a typecheck or migration-generation error, not a silent
bug.

### `normalizer-display-output` — low · mechanical · risk low
depends on: none

Pure type/contract wiring: src/core/ingest/pipeline.ts today has
`Normalizer.normalize(): Promise<AnimalClaims>` and `AnimalCandidate { source,
externalId, rawId, claims }` with no `display` anywhere; the slice adds a
`DisplayContent` type, an optional `display` field on the candidate (or a
`{claims, display?}` return), and threads it through the ~40-line stage loop
so `CanonicalWriter.apply` receives it. Memory/pg writers just accept the new
shape without acting on it (the upsert is stage4-display-upsert). The only
invariant to hold — `display` never enters `AnimalClaims`/MERGED_FIELDS so it
cannot compete in `resolveClaim` — is enforced by the type boundary the ADR
prescribes, not by reasoning-heavy logic; tsc and the existing suites catch
regressions, so no adversarial pass is warranted. No dependency on the table
or migration: the contract can land first with the field unconsumed. Shipshape
for the pre-commit gate; no deploy since nothing user-facing changes.

### `stage4-display-upsert` — medium · moderate · ⚠ verify · risk medium
depends on: `animal-display-table`, `normalizer-display-output`

No `animal_display` reference exists in src/ yet (grep clean), so status is
todo. The work is wiring: `createPgCanonicalWriter.apply` already runs one
transaction with the fact merge, so the change is an `insert ...
onConflictDoUpdate` on (animal_id, source) inside that tx when
`candidate.display` is present, plus a Map in `createMemoryStages`, plus tests
patterned on the existing pg/memory/parity suites (tests/ingest-writer-
parity.test.ts is the template). No merge/conflict reasoning — display is per-
source and never merged (Decision 3), which is what keeps this off the high
rungs. The moderate part and the reason for a verify pass: stage 4 must stay
idempotent — the display upsert must not emit `animal.updated` events
(event_log is append-only; a phantom row per re-poll is uncorrectable,
ADR-0003), and a replay rebuild must yield an identical row from the stored
observation (Consequence 2). A plausible-but-wrong version that touches
`updatedAt` or emits on every poll would ship silently, so one adversarial
pass on idempotency/parity is cheap insurance; the implementation itself is
opus-grade. Needs the table+migration and the Normalizer `display` output to
exist first; the RG promotion slice and purge path build on top of it, not
before it. shipshape gates the commit; no deploy in this slice.

### `rescuegroups-display-promotion` — medium · moderate · risk low
depends on: `normalizer-display-output`, `animal-location-facts`

Adapter work mapping documented RG fields (descriptionText, pictures[], orgs
included resource, trackerimageUrl) onto the new `display` output and new
location claims in src/core/ingest/rescuegroups.ts — currently the normalizer
emits only identity claims (status: nothing promoted yet). Medium rather than
low because: (a) the existing 'never asserts prose or photos' test and the
ADR-0006 header comment encode the opposite policy and must be deliberately
superseded with an ADR-0015 citation, not just deleted; (b) the picture-object
shape and org city/state/postal live in the `included` resources, so the
mapping must be read off the recorded 2026-08-17 fixture and hand-checked,
with provenance attribution updated; (c) the `?width=500` placement decision
must be stated in a comment. No merge/conflict reasoning, no crypto, no
migration — a plausible-but-wrong version fails a fixture test, so opus and no
adversarial verify. Depends on the `display` field existing on the Normalizer
contract and on location claim keys existing in AnimalClaims/MERGED_FIELDS.

### `display-purge-path` — medium · moderate · risk low
depends on: `animal-display-table`, `stage4-display-upsert`, `animal-detail-page`

Checked src/: no ADR-0006 set-deletion/purge path exists yet (grep for
purge/delete in src/core/ingest/pg.ts, src/db/schema.ts, src/worker/ finds
only the append-only invariant comment and one cascade FK). So this slice
cannot merely "add a DELETE to the existing purge" — it has to stand up the
minimal source-scoped purge entry point (e.g. a `purgeSource('rescuegroups')`
helper in the pg writer) with the display DELETE in it, plus a comment marking
it the sanctioned ADR-0006 decision-4 exception. That scoping decision (what
the first purge helper covers: display rows only vs. also raw/facts) nudges it
from mechanical to moderate, but the code itself is a single DELETE on a
derived table with a source column and one pg test asserting animals/facts
survive and display rows vanish, then a render check that the page falls back
to facts. No merge/conflict or crypto reasoning; a wrong implementation is
loud (test fails), not silent — so no adversarial verify pass, opus is fine,
shipshape gates the commit. Needs the table and stage-4 upsert to exist (to
have rows to purge) and the detail page (for the fallback-render assertion).

### `visible-animals-predicate` — medium · moderate · ⚠ verify · risk medium
depends on: none

All three columns the predicate needs (animals.status,
animal_identities.disappeared_at / last_seen_at) already exist in
src/db/schema.ts and no visibleAnimals helper exists under src/, so this is a
fresh, self-contained slice with no dependency on the display-table or
location work. The code is one Drizzle query fragment (status = 'available'
AND EXISTS identity WHERE disappeared_at IS NULL AND last_seen_at > now - 8
days) plus pg boundary tests modeled on the existing tests/ingest-pg-*.test.ts
harness — moderate, not hard-reasoning, so opus. Verification is warranted
despite the small size because the ADR names the exact failure mode (a page-
local predicate or an off-by-one on the 8-day/NULL-status boundary shows a
just-adopted dog to a donor) and a plausible-but-slightly-wrong predicate
would pass a naive test; the reviewer should check that the EXISTS is per-
identity (not disappeared_at IS NULL on one identity and fresh last_seen_at on
another), that null status is excluded, that the 8-day cutoff is
injectable/deterministic in tests, and that the helper is a composable
fragment usable by both browse (list) and detail (by id) rather than a page-
specific query. Browse-indexes is a performance concern layered on top, not a
prerequisite.

### `browse-indexes` — low · mechanical · risk low
depends on: `animal-location-facts`, `visible-animals-predicate`

Purely additive Drizzle index declarations in src/db/schema.ts (today only
animals_status_idx and animal_identities_animal_idx exist) plus `db:generate`
— no data rewrite, so append-only corpus safety is not in play. The ADR
(Consequence 3, line 82) names the columns outright; the only judgment is
matching the composite index column order to the actual visibility predicate
and the longest-listed sort (created_at), which is why it should land after
animal-location-facts (adds the state column being indexed) and visible-
animals-predicate (fixes the WHERE shape to index against). Confirmation is a
mechanical EXPLAIN on the local corpus; a wrong index is a perf miss, not a
correctness bug, so no adversarial pass is warranted.

### `licensed-display-picker` — medium · moderate · ⚠ verify · risk medium
depends on: `animal-display-table`

Nothing exists yet under src/ (grep for animal_display/licensed is empty;
src/app has only the scaffold page). The building blocks are already there:
hasGrant (default-deny, asOf-aware) in src/core/shelters.ts and
isScrapeSource/shelterSlugOf in src/core/sources.ts. The picker is a ~20-line
pure function: rescuegroups row -> allowed iff the key-level aggregator-
display permission holds; scrape:<slug> row -> allowed iff
hasGrant(shelterBySlug(slug), 'display', asOf); anything else -> null. That is
moderate, not hard-reasoning: the logic is a two-branch gate, not a
tier/recency merge. Medium rather than low because of two traps the ADRs name
explicitly: aggregator-display is held by the RG API key, not a shelter, and
must NOT be added to the shelter PERMISSIONS list or inferred via
tierOf/rankOf (ADR-0006 amendment: 'never conflated in code'; ADR-0015
Context: permissions are not facts and the merge must never treat them as
one). Verification is warranted because the failure mode is a page rendering a
shelter's scraped photo or prose without a display grant (a legal/consent
violation, not a cosmetic bug) and a single pass could plausibly ship a picker
that falls through to 'any row' or leans on the trust ranking. Tests must
cover: unknown shelter, revoked grant, asOf before grantedAt, scrape row with
a display-less shelter, and RG row when aggregator-display is absent. Depends
only on animal-display-table for the row type; multi-row precedence is an
ADR-0015 revisit trigger, so v1 need not resolve it. Opus is right: the
reasoning is contained and the ADRs spell out the rule; shipshape gates the
commit; no deploy in this slice.

### `animal-detail-page` — medium · moderate · risk medium
depends on: `visible-animals-predicate`, `licensed-display-picker`, `animal-display-table`, `stage4-display-upsert`, `rescuegroups-display-promotion`, `animal-location-facts`, `claim-or-optout-contact-route`, `brand-tokens-in-pages`

src/app/animals/ does not exist yet (only layout.tsx, page.tsx, api/ under
src/app), so status is todo. The slice is a React Server Component that
composes helpers other slices define: `visibleAnimals` for the query +
`notFound()`, the licensed display picker for the
photo/description/org/tracker row, and the contact route for the claim/opt-out
line. No merge logic, no crypto, no migration — the reasoning is in ADR-0015
already; the page just has to honour a checklist of rules (revalidate=3600,
`isBirthDateExact` gate on `animals.birth_date`, `?width=500` hotlinks never
R2, verbatim blockquote, tracker img on RG-sourced animals, honest
last_seen_at line, no-updates promise for unverified shelters, no sponsor
button). That checklist is what pushes it to medium rather than low, and risk
to medium (a missed rule is a license/framing violation, not a crash), but
each rule is mechanically checkable and the animal-pages-e2e slice is the
sanctioned verification for exactly these rules, so no separate adversarial
pass is warranted. Throughput matters more than deep reasoning: opus. Depends
on the predicate, picker, display table + its writers (so there is data to
render), location facts (org city/state on the page), the contact route (the
claim line needs a real target), and the brand-token conventions it must be
built in. Ships behind the pre-commit gate (shipshape); the production roll
belongs to whichever slice closes item 3, not this page alone.

### `animal-browse-page` — medium · moderate · risk medium
depends on: `visible-animals-predicate`, `animal-location-facts`, `licensed-display-picker`, `browse-indexes`, `brand-tokens-in-pages`

src/app/animals/ does not exist and no visibleAnimals/animal_display/location
column is in src/ yet, so status is todo. The page is an RSC (Next 16.2,
Tailwind 4 already in package.json) that calls the shared visibleAnimals
helper with URL searchParams (species, state), sorts by earliest first-seen,
paginates, and renders cards via the licensed display picker; `export const
revalidate = 3600`. That is wiring plus a query with filters/pagination —
moderate, not hard-reasoning: the visibility predicate, licensed-photo
selection, and the 64k-row indexes are separate slices it depends on. Risk is
medium only because the bright lines (no rarity/scarcity/countdown, no
'available now' copy) and 'must use visibleAnimals, never its own predicate'
are easy to violate by taste; the e2e slice (animal-pages-e2e) is the check,
so no adversarial verify pass is needed. State filter needs animal-location-
facts; card styling needs the brand-token conventions. Opus for throughput;
shipshape before commit.

### `claim-or-optout-contact-route` — low · mechanical · risk low
depends on: `brand-tokens-in-pages`

ADR-0015 Decision 5 bullet 4 only requires a reachable contact destination (a
static /claim-style server-component page or mailto) explaining "claim" vs
"remove my listings"; per-org exclusion is explicitly a revisit trigger, so
there is no registry write, no visibility-predicate change, no merge or
persistence logic. src/app currently has only layout/page/api/health — nothing
exists, so status is todo. The real work is copy that matches DIRECTION's
Google-Business/Yelp framing (no bait-and-switch, no implied care) and a link
from every RG detail page; the detail page consumes this route rather than the
reverse, so the only true dependency is the brand-token/page-shell convention
it must render with. A wrong implementation is a wrong sentence, not a silent
data bug, so no adversarial verify pass; shipshape covers the copy/bright-line
check before commit. Playwright coverage lands in animal-pages-e2e.

### `brand-tokens-in-pages` — low · mechanical · risk low
depends on: `animal-detail-page`, `animal-browse-page`

The token half is already done: /home/oof/dogchain/src/app/globals.css defines
the cuddly palette (cream/bark/honey/leaf/paw, radius-cuddly, dark variant)
under Tailwind 4 @theme, and /home/oof/dogchain/src/app/layout.tsx is a
server-component root layout with the wordmark in
public/brand/wordmark-v1.png. What remains is applying those tokens to the
browse card and detail layouts as responsive server components — pure
styling/markup with no logic, no data decisions, no new dependencies, and an
explicit ADR instruction not to add Zustand. That is mechanical UI work: low
effort, opus, no adversarial verification; shipshape covers the no-hardcoded-
hex convention. It can only land on the pages it styles, so it depends on
animal-detail-page and animal-browse-page.

### `animal-pages-e2e` — medium · moderate · risk low
depends on: `animal-detail-page`, `animal-browse-page`, `claim-or-optout-contact-route`, `visible-animals-predicate`, `licensed-display-picker`, `rescuegroups-display-promotion`

The assertions themselves are a checklist transcribed from ADR-0015 Decision
5/2/6 — text-presence/absence checks, a link, a 404, an order and two filters
— which is mechanical Playwright work. The only real design question is
seeding: e2e/ today has a single home.spec.ts with no DB fixture
(playwright.config.ts boots `npm run dev` only), while the pg unit tests seed
via createPgStages/runIngest and skip without DATABASE_URL. The slice must
pick a seeding path (a globalSetup that runs the ingest pipeline over golden
fixtures against the local Postgres, plus an 8-day last_seen_at and a
status='adopted' case to prove the visibility predicate and the 404) and
decide how visibility-window fixtures stay fresh relative to wall-clock time —
that lifts it from low to medium, not beyond. No plausible-but-wrong failure
mode: a wrong assertion fails loudly, so no adversarial verify pass and opus
throughput is right. Depends on the two pages, the contact route (the 'Not
affiliated' link must resolve), the visibility predicate (404 behaviour), the
licensed picker and RG display promotion (tracker image, org name,
description). Nothing built yet under src/app/animals, so status is todo.
shipshape applies as the pre-commit gate; deploy is not this slice's job
(e2e:prod is reused by /deploy later).

### `flows-and-roadmap-docs` — low · mechanical · risk low
depends on: `stage4-display-upsert`, `visible-animals-predicate`, `animal-detail-page`, `animal-browse-page`, `claim-or-optout-contact-route`, `display-purge-path`, `licensed-display-picker`

Pure doc reconciliation: doc/flows.md already carries a `(planned, item 3)`
Animal page render section (line 256) and an ingest diagram whose stage-4 box
needs the display upsert added; roadmap item 3 (line 95) is unchecked and no
src/app/animals or animal_display code exists yet. The work is editing ASCII
boxes to name real symbols and pinning four revisit triggers as carry-ins — no
algorithmic reasoning, no failure mode beyond a stale name, which /shipshape's
docs-match-code check catches. Must land last because every box must cite a
symbol that actually exists; CLAUDE.md only changes if a new npm script
appears (none is implied by the ADR).
