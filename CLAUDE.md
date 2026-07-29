# Monster Paws

Verified animal-shelter sponsorship: donors pick a real shelter animal, donate
(100% to the shelter via Every.org), and collect the animal's story — signed
care-event attestations, AI keepsake card art, an adoption-day "evolution."
Sponsorship with provenance, never "buy a slice of a dog."

**`doc/DIRECTION.md` is the source of truth for product intent** — the
collector loop, the aggregator growth model, money rails, bright lines, and
non-goals. Read it before product-level decisions; keep it updated when scope
changes. `doc/PLAN.md` is the superseded pre-pivot plan, kept for reference
only — do not build from it.

## Stack

- **Full-stack Next.js monolith, TypeScript end to end** — one Node process
  for SSR pages + API routes; a second worker process (same repo/types) for
  pg-boss jobs, the listings pollers, and image generation.
- **Postgres is the platform**: relational tables, append-only event log, raw
  API payloads (JSONB), full-text search, pgvector embeddings, and the job
  queue (pg-boss). No Redis, no separate vector DB below ~10M vectors.
- **Drizzle** ORM. **Cloudflare R2** for all images + the attestation
  flat-file mirror (DB stores keys only). **Every.org API** for donations —
  we never process payments or take a cut.
- Infra: DigitalOcean droplet (Docker Compose: Caddy / app / worker) + DO
  Managed Postgres (PITR) + Cloudflare free CDN. ~$30/mo. Serverless hosts
  are disqualified — the poller/queue need an always-on process.
- Image pipeline: style LoRA × per-image identity conditioning (IP-Adapter /
  Flux Kontext) on Replicate behind a provider interface. Generate **only on
  donation**, never per listing. CLIP-similarity auto-QC picks best of 3–4.

## Non-negotiable domain rules

- **Append-only data.** Raw payloads and event-log rows are never UPDATEd or
  DELETEd — corrections are new rows. The corpus is the asset.
- **Embeddings are derived data**: every vector row carries `embedding_model`;
  the column is rebuildable from raw corpus, never backed up as sacred.
- **Trust hierarchy** for animal facts: shelter API (verified) >
  platform-widget scrape > aggregator APIs; conflicts resolve by tier, then
  recency; every fact stores source + fetched_at.
- **Bright lines** (see DIRECTION.md): no rarity tiers on animals, nothing
  tradeable ever, no dark-pattern pressure, no programmatic ads, generated
  donor text never claims care that isn't attested.

## Conventions

- Documentation lives in `doc/`. `doc/roadmap.md` tracks build order
  (frontier = first unchecked item); check items off as they ship; dogfood
  findings get pinned there as carry-ins, not left in chat.
- **Every decision gets an ADR** in `doc/adr/NNNN-slug.md` (Nygard style:
  Context / Decision / Consequences / Alternatives / Revisit triggers). New
  dependency, changed contract or algorithm, pattern adopted or rejected —
  that's a decision. Implementation detail is not. Supersede rather than
  rewrite. Build plans derived from ADRs live in `doc/plans/`.
- Test pyramid: **vitest** for units (entity resolution, attestation
  sign/verify, trust-hierarchy merge, eval scorers), **Playwright** e2e for
  the donor and shelter flows, **dogfooding** after every deploy — real
  browsing, a real test donation, a real confirm click. Golden fixtures
  (sample listing payloads with hand-checked canonical outputs) are shared by
  unit and e2e suites.
- The two eval harnesses are product code, not scaffolding: text faithfulness
  (donor updates vs. attestations) and image likeness (CLIP score vs. real
  photos). Changes to generation prompts/models must run the harness before
  ship.

## Skills & workflows

- `/orient` — session-start bearing: commits + roadmap + docs reconciled
  against memory. Read-only.
- `/shipshape` — pre-commit verification: tests green twice, docs current,
  conventions hold.
- `/deploy` — ship bar → build → e2e against the production build → roll onto
  the droplet with rollback kept → smoke prod → dogfood handoff.
- `adr-plan` workflow (`.claude/workflows/adr-plan.js`) — decompose an
  accepted ADR into an effort-ranked, dependency-ordered build checklist
  before implementing it.

## Commands

Pre-scaffold — no code yet. When the repo is scaffolded, fill this section in
the same commit (dev server, `npm test`, `npm run typecheck`, `npm run e2e`,
build, migrate) and keep it exact: stale commands here are worse than none.
