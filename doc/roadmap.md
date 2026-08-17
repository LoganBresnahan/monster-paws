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
      ~~Carry-in → item 2: apply for the RescueGroups API key early~~ —
      **granted 2026-08-02**, in `pass` at `rescuegroups/api-key`. The
      adapter is no longer blocked; it stays off the critical path by
      construction (one adapter + one normalizer, zero pipeline edits).
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
      `doc/plans/adr-0009-ingestion-build-plan.md` (**re-cut 2026-07-31:
      scrape-first** — 9 phases; critical path runs taxonomy+registry →
      vault → extractor → normalizers → entity-resolution-merge, the lone
      Fable+verify slice; the RescueGroups adapter is now unblocked but
      stays unscheduled — off the critical path by construction).
      Phases 1–4 shipped: observation contract + pipeline skeleton
      (`e713544`), raw-persist-dedup + first migration (`6c31d76`), source
      taxonomy + shelter registry implementing the **ADR-0006 amendment of
      2026-08-02** (consented scraping legitimized and scoped, consent as
      the display license, named ordered tiers with rank derived and never
      persisted, revocation as a second purge exception), and the R2 corpus
      vault (**ADR-0011**: `monsterpaws-corpus` bucket, `aws4fetch`,
      content-addressed slug-sharded keys, `vaultThenObserve` enforcing
      fetch → vault → hash → raw row).
      Bucket provisioned and round-tripped live 2026-08-17, and the R2
      credential split in two the same day — worker key (corpus+media) vs
      vault key (backups + the future attestation mirror), separation
      verified both directions, read and write (`doc/infra.md` step 5).
      Golden fixtures hand-checked per site at onboarding;
      fixture-eval canary on the daily cron tick + live health gates.
      Former carry-ins are folded into the plan itself — verbatim
      `description` (phase 5),
      fixture-simulated two-source merge + `sources.conflicted` question
      (phase 7), per-field staleness gating (phase 9). Tracker pixel on
      detail pages when listings render.
- [ ] **3. Animal pages.** ISR public pages (browse + detail) rendering real
      local shelters' animals — this is the demo *and* the v1 supply side.
      Carry-in from the ADR-0006 amendment: a page may render a shelter's
      description prose and photos only under that shelter's **display
      grant**; without one it shows the facts plus our own words. Storing
      verbatim and displaying verbatim are different permissions.

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
      shelters: **scrape + display + digify are three separate grants**
      (ADR-0006 as amended), each recorded with granter, date, basis and a
      pointer to the email. Each grant lands as an entry in the checked-in
      registry (`src/core/shelters.ts`, shipped empty at item 2) with the
      evidence filed under `doc/consent/` — the commit is the record.
      The digify ask carries the ADR-0004 amendment's
      two additions: photos are processed by third-party AI services, and
      the shelter confirms it holds or can license the photo.
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
