# Issues

Known defects and rough edges, mostly found by dogfooding (ADR-0019). This is
the **inbox**, not the plan: `doc/roadmap.md` says what we are building and
`doc/plans/` says how, and a finding graduates out of here the moment it earns
a checklist item, an ADR, or a carry-in pinned to the work that will hit it.

Newest first within each section. Delete an entry when it is fixed — the commit
is the record, and a file of ticked boxes stops being read.

## Data quality

- **Some listings are not animals; some animals have names that are not
  names.** Four of the top six rows of the browse sort are administrative
  records, and the two problems must not share a fix — see **ADR-0021** for the
  measurements and the decision (an LLM verdict as derived data, gating browse
  only, default-show, eval-gated, deferred past phase 4). The interim shipped
  2026-09-04 with the browse page: six hand-checked listings in
  `BROWSE_EXCLUSIONS`, keyed by `(source, external_id)` and applied beside the
  visibility predicate, so their detail pages still resolve. That covers the
  head of one sort and nothing else — the rest of the corpus is unmeasured, so
  this stays open until item 7b. Found 2026-09-04.
- **A thin tail of descriptions is the shelter's whole adoption manual** —
  deposit amounts, adoption-fair schedules, size-and-age glossaries. Re-measured
  2026-09-04 after whitespace tidying (ADR-0018 as amended), which fixed most of
  what the original 4,010px screenshot showed (that quote is now 1,173px): the
  median description renders at ~278px and p90 at ~684px, but 752 of 45,131
  (1.7%) run past 4,000 characters, the longest at 4,771px (animal 46364).
  Excerpting was considered and rejected — the text stays whole and unlinkified
  (ADR-0015 as amended) — so what is left is a readability question for a very
  small tail, not a safety one. Found 2026-09-04.

## UI

- (empty)

## Ops

- **Production `/api/health` reports `sha: "dev"`**, so the running build
  cannot be identified from outside the box. Its uptime puts the container
  start at about 2026-07-30 21:08 UTC, four minutes after the commit that
  added the `BUILD_SHA` stamp, so the image most likely predates the stamp
  rather than the stamp being broken — unconfirmed. `/deploy`'s smoke step
  should assert the sha equals the commit it rolled; if the next deploy still
  says `dev`, the build arg is not reaching the image. Found 2026-09-28.

## Compliance

- **1,404 animals (2.2%) render their organization's name with no link home** —
  the source publishes no usable URL for them, and we never assemble one
  (ADR-0015 as amended). Under the terms' link-back promise this is the honest
  floor rather than a defect, but it is worth watching: if the share grows, the
  org's email or phone may have to stand in. Found 2026-09-04.
