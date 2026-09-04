# Issues

Known defects and rough edges, mostly found by dogfooding (ADR-0019). This is
the **inbox**, not the plan: `doc/roadmap.md` says what we are building and
`doc/plans/` says how, and a finding graduates out of here the moment it earns
a checklist item, an ADR, or a carry-in pinned to the work that will hit it.

Newest first within each section. Delete an entry when it is fixed — the commit
is the record, and a file of ticked boxes stops being read.

## Data quality

- **Some listings are not animals.** The head of the longest-listed sort is
  administrative records a rescue parked in the feed years ago:
  "ADOPTION-Read First" (listed 2006), "Kittens!!!!" (2006), "OK Fosters
  Needed" (2008), "One by One cats". All `available`, all edited recently
  enough to clear the 24-month upkeep bound, all rendering as an animal with a
  breed and a photo. The bound filters abandonment, not not-an-animalness.
  Also seen: names that are dates or intake codes ("Sunshine 9.21.09").
  *Blocks the browse page* — it is the first thing a donor would see there.
  Pinned as a carry-in on `animal-browse-page`. Found 2026-09-04.
- **A description is sometimes the shelter's whole adoption manual.** Deposit
  amounts, PayPal instructions, adoption-fair schedules, size-and-age glossary
  — one seen at ~4,000px tall. Whitespace tidying (ADR-0018 as amended) made it
  legible, not short. A clamp with a "read the full listing" expander is the
  obvious answer and is interactive, so it wants deciding with the browse card.
  Found 2026-09-04.

## UI

- (empty)

## Compliance

- **1,404 animals (2.2%) render their organization's name with no link home** —
  the source publishes no usable URL for them, and we never assemble one
  (ADR-0015 as amended). Under the terms' link-back promise this is the honest
  floor rather than a defect, but it is worth watching: if the share grows, the
  org's email or phone may have to stand in. Found 2026-09-04.
