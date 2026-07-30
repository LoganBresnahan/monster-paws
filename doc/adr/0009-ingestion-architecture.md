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
  are fully sacred.

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
