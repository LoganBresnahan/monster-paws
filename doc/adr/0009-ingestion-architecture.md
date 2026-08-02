# ADR-0009: Ingestion — disposable sources, sacred corpus, tiered extraction

## Context
Roadmap item 2. Sources: RescueGroups API (Tier 2, ADR-0006) now; per-site
scrapers for consented local shelters next; Tier 1 shelter APIs later.
Scrapers break whenever sites redesign — the architecture must make that a
20-minute repair, not a fire. The corpus must be RAG-ready for AI features
whose shape is not yet chosen (ADR-0003).

## Decision

**1. One contract for every source.** Each source (API or scraper) emits
**observations**: `{ source, externalId, payload, fetchedAt, contentHash }`.
A shared pipeline does everything downstream, in stages:
persist raw (append-only, source-tagged) → normalize (per-source mapper →
canonical fields) → entity-resolve (fuzzy merge across sources) → update
canonical animals + emit events (`animal.seen` / `animal.updated` /
`animal.disappeared` — adoption is inferred from disappearance).
Raw payloads are retained verbatim, so **normalizers are re-runnable**: fix
a mapper, replay the corpus, canonical rebuilds. Source-specific code is
only the fetch/extract edge — the part designed to be thrown away.

**2. Scrapers are disposable by construction.**
- Extraction is **declarative** (URL-discovery strategy + selector map),
  so a redesign means rewriting selectors, not logic.
- Every scraper ships a **golden fixture**: saved HTML + hand-checked
  expected output. Repair loop = new snapshot → fix selectors → test green.
- **Health gates**: each run reports items-found + required-field coverage.
  Zero items or missing fields → scraper disabled + flagged, nothing
  ingested; its listings marked stale. Broken scrapers fail loudly, never
  pollute.

**3. Extraction is tiered by volume; LLMs run at the right time.**
- **Platform tier** (Shelterluv/PetPoint widgets — uniform markup, many
  shelters): hand-built declarative scrapers.
- **Long-tail tier** (one-off consented local sites): **runtime LLM
  extraction** (HTML → schema-validated JSON). At tens of pages/day this
  costs pennies and is immune to redesigns; schema validation + health
  gates catch hallucination.
- **Repair tier**: when a declarative scraper's health gate trips, an LLM
  regenerates the selector config from the new HTML, validated against the
  golden fixture. Deterministic at runtime, AI as the mechanic.
- Extraction accuracy against golden fixtures is the project's **third
  eval harness** (alongside text faithfulness and image likeness), and the
  first to ship.

**4. Postgres layers, strictly derived left→right (extends ADR-0003):**
raw (sacred: raw_payloads + content_hash; scraped HTML archived to R2
vault, key in row) → events (sacred: event_log) → canonical (derived:
animals with per-field provenance, trust-tier resolved) → retrieval
(derived: embeddings with `embedding_model`, FTS tsvector; chunks reference
subject ids so retrieval joins back to structured truth).
- `content_hash` dedup: new raw row only when payload changed; otherwise a
  cheap `last_seen` touch. Append-only in spirit, signal-dense in practice.
- Embedding/chunk generation runs as pg-boss jobs triggered by event_log
  inserts — retrieval stays eventually-consistent automatically.
- Every retrievable chunk traces to a specific fetch from a specific
  source at a specific time: the product's provenance model applied to its
  own data.
- RescueGroups rows carry the ADR-0006 purge tag; consented-scrape rows
  are fully sacred — qualified by the ADR-0006 amendment (2026-08-02):
  consent revocation is a second source-scoped purge exception.

## Consequences
- Any source can die (Petfinder-style) without touching the corpus or
  downstream code.
- Replayable normalization makes mapper bugs recoverable retroactively.
- Three extraction tiers mean coverage scales from "one weird local site"
  to "500 shelters on one platform" without changing the pipeline.
- LLM extraction introduces per-page inference cost and nondeterminism —
  bounded by volume tiering, schema validation, and the eval harness.
- R2 HTML archive grows unboundedly — cheap, but needs a lifecycle note
  eventually.

## Alternatives
- Per-source bespoke pipelines: rejected — N sources × M stages of drift.
- Runtime LLM extraction everywhere: rejected — cost/nondeterminism at
  platform-tier volume for no resilience gain (fixtures already de-risk
  deterministic scrapers).
- Scrapy/managed scraping SaaS: rejected — our volumes are tiny; the
  complexity lives in extraction, not crawling.

## Revisit triggers
- A platform tier site adds anti-bot measures beyond polite-crawler norms.
- LLM extraction cost or error rate at long-tail volume stops being noise.
- The R2 HTML archive needs lifecycle/retention policy.

## Amendment (2026-07-30): v1 collapses the platform tier into the long-tail tier

**Decision.** For v1, every scraped source is treated as long-tail: runtime
LLM extraction (vaulted HTML → schema-validated JSON) is the *only* scraping
mechanism. The declarative scraper engine and the LLM selector-repair loop
(Decision 2's declarative-extraction bullet and Decision 3's platform/repair
tiers) are **deferred, not deleted** — they activate when a platform-tier
volume trigger fires (roughly: one platform's uniform widgets exceeding
~50–100 pages/day, or LLM extraction cost/error leaving noise territory).

**Why.** The tier boundary was volume-based, and v1 volume (3–5 consented
local shelters, tens of pages/day) is long-tail-sized on every axis the ADR
cared about. At list prices the entire daily poll costs cents (batched Haiku
≈ $2.50/mo; DeepSeek-class models less), so the rejected-alternative
reasoning ("cost/nondeterminism at platform-tier volume") does not yet
apply. Pages rarely changing argues *for* runtime LLM here: redesign
immunity comes free instead of via a repair pipeline built to service
selector fragility.

**What is unchanged** (the load-bearing parts, extraction-method-agnostic):
raw HTML is vaulted to R2 and hashed *before* extraction, making the LLM
extractor a **replayable normalizer** over the sacred corpus — a bad
extraction is fixed by prompt repair + corpus replay, never lost. Schema
validation, golden fixtures, and health gates remain the hallucination
bounds.

**Two distinct quality loops** (do not conflate):
1. *Fixture eval* — per onboarded site, a hand-checked golden fixture
   (saved HTML + expected canonical output, verified by a human). The
   harness diffs LLM output against truth; runs on prompt/model/provider
   changes AND as a cheap canary on the daily cron tick. Proves the
   mechanism; says nothing about today's live pages.
2. *Live-run gates* — every real ingest: schema validation, items-found and
   required-field coverage, plus sanity invariants on fresh output (counts
   don't crater, species don't flip, names non-empty). Fail loud into the
   event log (ADR-0010 boring alerts). Police each run.

**Provider choice is empirical, not aesthetic.** Extraction sits behind a
provider interface (`extract(html, schema) → json`, same pattern as the
ADR-0004 image pipeline). The fixture harness scores candidate models
(DeepSeek-class, batched Haiku, one larger model as ceiling); the cheapest
passing model wins. Cost differences at this volume are dollars/year —
accuracy and ops simplicity decide. Note: DeepSeek's API terms permit
using inputs to improve services; acceptable here (public shelter
listings), revisit if inputs ever include non-public data.

**Consequences.** v1 build drops two slices (declarative-scraper-engine,
llm-selector-repair): 13 → 11. The extractor moves from the last phase to
the source edge. The extraction-accuracy harness is still the project's
first eval harness to ship — now also the model-selection mechanism, and a
dry run for the item-8 text-faithfulness harness (same shape: LLM output
diffed against ground truth). New revisit trigger: the platform-tier
volume threshold above re-activates the deferred declarative tier.
