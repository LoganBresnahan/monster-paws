# ADR-0021: Listing assessment — an LLM verdict as derived data, gating browse and nothing else

## Context
The head of browse's default sort (longest-listed first, ADR-0015) is not
animals. Measured 2026-09-04 against the real corpus: four of the top six
rows are administrative records a rescue parked in the feed years ago —
"ADOPTION-Read First" (2006), "Kittens!!!!" (2006), "OK Fosters Needed"
(2008), "One by One cats" — all `available`, all maintained recently enough to
clear the 24-month upkeep bound, all rendering as an animal with a breed and
photos. The visibility predicate filters abandonment; nothing filters
not-an-animalness.

Two facts shape the answer:

- **The problem is shallow.** A crude announcement-word regex flags 12% of the
  first 50 rows, 7.5% of the first 200, 4.6% by 1,000 — against a 7.9% corpus
  baseline that is mostly false positives (it catches any name over 28
  characters, "Afraid of Commitment" included). This is a first-impression
  problem of about a dozen rows, and a regex fix hides real animals to catch
  them.
- **It is two problems wearing one face.** "Sunshine 9.21.09", "Mya. Now 15,
  sanctuary dog" and "Nicolette [Permanent Foster]" are real, adoptable
  animals whose *names* read oddly. They must stay exactly where they are.
  Only the first group — listings that are not one adoptable animal — should
  leave browse.

Regex cannot separate those two groups. A model can, and the cost of asking
one is small enough to be uninteresting: roughly 350 input tokens per listing
(name, species, breed, a truncated description, photo count) puts the whole
64,133-animal corpus near **$29 one-time on Claude Haiku 4.5, ~$15 through the
Batch API**, with cents per poll after. So cost never enters this decision;
correctness and placement do.

## Decision

### 1. A verdict is derived data — the `embeddings` pattern, exactly
`animal_assessments` holds one row per `(animal_id, model, prompt_version)`:
the verdicts (§2), a one-line reason, a confidence, `assessed_at`. It is
rebuildable from the corpus like `embeddings` (ADR-0003), and for the same
reason every row carries the model and prompt version that produced it: a
verdict from a retired prompt is a stale derived value, not a fact. **Never a
claim, never in `provenance`, never merged** — no source asserted it, we
inferred it, and a wrong inference that reached `animals` would outrank a
shelter's own record.

### 2. Two signals, and only one may gate anything
- `is_individual_animal` — "is this a listing for one adoptable animal?" This
  is the browse gate.
- `name_reads_as_name` — "does the name read like a name?" This gates
  **nothing**. We cannot rename an animal (that is editing a fact), and a
  shelter's odd name is theirs. At most it is a signal for how a card leads,
  decided if and when a card design wants it.

A single binary would hide Sunshine 9.21.09 for the crime of her name.

### 3. Default-show; hide only on confidence; from browse, never from visibility
The failure asymmetry points the opposite way from `visibleAnimals`.
Visibility is default-deny — unknown upkeep hides — because showing an animal
we cannot vouch for is the stale-data risk. Here, default-deny means hiding a
real animal a shelter listed, which is the worst thing this product can do
quietly. So:

- An animal with no verdict, a low-confidence verdict, or a verdict from a
  prompt version that is not current is **shown**.
- A confident `is_individual_animal = false` removes the animal from **browse
  and any future feed** — a filter composed alongside `visibleAnimals`, never
  folded into it. The detail page stays reachable by link: a false positive
  then means "not discoverable," not "404 on the URL the shelter shared."
- Nothing is deleted, purged, or written to `animals`. Hiding is not purging
  (ADR-0006 decision 4).

### 4. It gates nothing until it has beaten the baseline on a labelled set
A hand-labelled eval set of ~200 listings — sampled from the head of the sort
where the problem lives AND at random, so the labels cover both failure
directions — with precision and recall measured for `is_individual_animal`
against the regex baseline. The harness is product code like the other two
(CLAUDE.md), it runs before any prompt or model change ships, and the number
that matters is **recall on real animals**: how many the gate would hide. That
number, not the junk it catches, decides whether the gate turns on.

### 5. Model and mechanics are parameters, recorded per row
The candidate is Claude Haiku 4.5 through the Batch API, with Claude Sonnet 5
as the step-up if the eval says the cheaper model misses; the eval chooses,
this ADR does not. Structured outputs (`output_config.format`) for the
verdict, a cached instruction prefix, the observation's fields and never the
rendered page. The Anthropic SDK is the dependency; ADR-0009 as amended
already commits to LLM extraction for scraped sources, so whichever slice
lands first brings `@anthropic-ai/sdk` and the second reuses it.

### 6. Deferred — and what happens meanwhile
This is its own slice with its own eval, not a browse sub-task. It is built
after phase 4 of the ADR-0015 plan (browse + e2e, which gate deploy), and most
naturally alongside roadmap item 8, when LLM infrastructure and an eval
harness exist anyway. Until then the dozen rows at the head of the sort are
accepted as a dev-demo blemish, or handled by whatever tiny curated exclusion
browse's author is comfortable owning — never by a regex over names.

## Consequences
- The first LLM in the ingest path: a provider key, prompt versioning, and a
  third eval harness. The eval is the real cost — a labelling afternoon — not
  the API bill.
- A re-run with a new prompt version rewrites every verdict; browse's
  composition changes in one deploy. Version rows so a regression is a
  rollback, not a re-label.
- The verdict reads the same fields the page shows and no others, so the
  judge cannot see something a human on the page could not.
- Two gates now compose for browse: visibility (per-source presence and
  upkeep) and assessment (is this an animal). Keep them separate functions —
  merging them makes the detail page inherit a gate this ADR deliberately kept
  off it.
- A shelter who finds a real animal hidden has the claim route (ADR-0015
  decision 5) and the answer is a labelled example added to the eval set.

## Alternatives
- **A regex over names.** Rejected: measured, it is mostly false positives,
  and its false positives are real animals.
- **Fold the gate into `visibleAnimals`.** Rejected: it 404s the detail page
  on a false positive, and the predicate's default-deny is the wrong default
  for this failure.
- **One binary verdict.** Rejected: conflates a bad name with a non-listing;
  §2.
- **A curated blocklist as the permanent fix.** Rejected as the fix, allowed
  as the interim (§6): it does not scale past the dozen rows we can see, and
  it hides the fact that a classifier is owed.
- **Ask the shelter to fix their listings.** Not rejected — it is what the
  claim route is for — but the listings are decades old and the orgs are not
  our users yet.

## Revisit triggers
- The labelled set shows recall on real animals below a number we are willing
  to say out loud — the gate stays off and the sort takes the blemish.
- A verified shelter (item 7) disputes a verdict — verified-tier listings may
  need to bypass assessment outright.
- Browse gains a second sort or a search (phase 9 retrieval) — decide whether
  the gate applies to all of them or only the longest-listed head where the
  problem was measured.
- The judge is asked a third question (quality, completeness, "featured") —
  that is curation, a different decision with bright-line implications
  (no rarity tiers), and needs its own ADR.
