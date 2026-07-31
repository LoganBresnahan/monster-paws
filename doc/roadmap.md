# Monster Paws roadmap

Frontier = first unchecked item under **Now**. Check items off as they ship;
pin dogfood findings and deferred sub-tasks to items as carry-ins.

## Now

- [x] **0. ToS research (blocking).** Done 2026-07-29 → **ADR-0006**:
      Petfinder API dead, Adopt-a-Pet closed; RescueGroups is the sole
      aggregator backbone (Tracker pixel, candid key application, purge
      exception); shelter-issued keys are Tier 1; AI art gated on verified
      shelters (photo unlocks → monster art at verification).
      Carry-in → item 1: schema needs `source` tags + set-deletion path.
      Carry-in → item 2: apply for the RescueGroups API key early — approval
      latency is on the critical path.
- [x] **1. Scaffold.** Done 2026-07-29. Next.js 16 (App Router, src/, TS,
      Tailwind) + Drizzle schema stub (append-only raw_payloads/event_log
      with source tags per ADR-0006 carry-in, animals with provenance JSONB,
      embeddings with embedding_model) + pg-boss worker stub + vitest
      (trust-hierarchy unit, 5 passing ×2) + Playwright (landing spec,
      passing) + docker-compose.dev.yml (pgvector/pg16) + Commands filled.
      Carry-in → item 2: run first migration + pgvector `vector` column when
      ingestion lands; `npm audit` shows 12 high (dev-chain) — triage then.
- [x] **1b. Landing live on monsterpaws.org.** Done 2026-07-30, tagged
      **v0.1.0**. Droplet (hardened SSH) + firewall + proxied DNS + LE certs
      via Caddy + SSL Full (strict) + anti-spoof TXTs + security.txt; all
      tokens least-privilege in pass. **Next human step: submit
      `doc/rescuegroups-application.md` — the site is live.**
- [ ] **2. Ingest v0.** Build per **ADR-0009 as amended 2026-07-30** (v1:
      LLM-only extraction over vaulted HTML; declarative scraper tier
      deferred behind a volume trigger) and
      `doc/plans/adr-0009-ingestion-build-plan.md` (11 slices, 6 phases;
      critical path runs through entity-resolution-merge — the lone
      Fable+verify slice). Golden fixtures hand-checked per site at
      onboarding; fixture-eval canary on the daily cron tick + live health
      gates. RescueGroups key pending (applied 2026-07-30); adapter is off
      the critical path, so build proceeds on fixtures. Tracker pixel on
      detail pages when listings render.
      Phase 1 (`observation-contract`) shipped: `src/core/ingest/`.
      Carry-in → phase 3 (`llm-extractor`): **no source tag exists for a
      consented scrape** — `SOURCES`/`TIER_RANK` cover only shelterluv,
      petango, rescuegroups, manual. Needs a per-site identity
      (`scrape:<shelter-slug>`) and a tier rank; ADR-0006 predates the
      amendment that made LLM extraction the only scraping mechanism, so
      whether an LLM-read site still outranks the aggregator is an open
      decision. Blocks the extractor.
      Carry-in → phase 3: **shelter registry** (site URL, display + digify
      consent, ToS tier, fixture path, slug). Recommended as a checked-in
      typed module, not a table — consent is a legal artifact and git history
      records who granted it and when. `animals.shelter_external_id` should
      point at that slug; today it is a dangling string with no referent.
      Carry-in → phase 3: `description` must be extracted **verbatim**, never
      summarized (a paraphrase stored as the shelter's words is a corpus lie,
      and adjacent to the no-unattested-claims bright line); the fixture eval
      checks exact match, not similarity. Long-text fields also need
      normalized comparison before change detection, or every poll emits a
      spurious `animal.updated`.
      Carry-in → phase 4 (`entity-resolution-merge`): the tier branch of
      `resolveClaim` is **unexercised** — v1 resolves on exact
      (source, externalId), so one animal only ever holds claims from one
      source and every merge decides on recency. Silent Tier-1 clobbering
      cannot be caught by the current suite. Also: a losing claim is dropped
      with no record that sources disagreed — decide whether a
      `sources.conflicted` event is worth emitting.
      Carry-in → phase 6 (`ingest-health-gates`): a claim the extractor
      *stops* asserting keeps its old value and old `fetchedAt`, so an animal
      can read as freshly verified while carrying one stale claim. Gate on
      per-field staleness, not just run-level coverage.
- [ ] **3. Animal pages.** ISR public pages (browse + detail) rendering real
      local shelters' animals — this is the demo *and* the v1 supply side.

## Next

- [ ] **4. Donation flow.** Every.org integration + donor accounts; card on
      donate — framed real photo by default; AI art (ADR-0004 pipeline v0,
      built and exercised internally) ships in production **only for
      consented shelters**, credited "Permission to digify <pet> given by
      <shelter>". Collection page.
      Carry-in: **`shelters` table lands here or at item 7** — whichever comes
      first. The registry (item 2 carry-in) covers config and consent; a table
      is owed once a shelter is a user-facing entity that donations route to
      and attestations are signed by. Migration stays mechanical if the
      registry slug is the natural key from day one.
- [ ] **5. Local consent outreach.** Permission emails to 3–5 local
      shelters: display + digify consent (one email = the ADR-0006 gate).
      **Milestone: one real donation reaches one real shelter.** Verified-
      tier pitch (Shelterluv key, attestations) follows with whichever
      shelter warms up first.
- [ ] **6. Shelterluv integration.** Approval → poller → care-event diffing.
- [ ] **7. Attestation pipeline.** Shelter keys, weekly batch-confirm
      dashboard, hash anchoring, R2 flat-file mirror, public verification page.

## Later

- [ ] **8. Update generation + faithfulness evals.** LLM donor updates from
      confirmed events; the no-unattested-claims harness; adoption
      "graduation" moment + gotcha-day card.
- [ ] **9. Style LoRA.** Fine-tune the "Monster Paws look"; identity conditioning;
      CLIP-QC harness proper.
- [ ] **10. Entity resolution at scale.** Second/third listing source; dedup
      across feeds; trust-hierarchy merge.
- [ ] **11. PWA push** for sponsors; **Expo app** when push friction costs
      engagement.
- [ ] **12. Vet co-signing.**
