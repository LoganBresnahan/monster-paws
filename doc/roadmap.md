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
      The **rescuegroups-adapter** shipped out of order 2026-08-17. Its claim
      surface is deliberately thin — name, species, breed, status, sex,
      ageGroup, birthDate, isBirthDateExact, and a namespaced org handle —
      and never prose or photos, since every promoted field must be
      retractable on ToS termination. It is off the critical path: phases 5–9
      are unchanged and the frontier is still phase 5, whose fixtures wait on
      item 5's consent outreach. Golden fixtures hand-checked per site at
      onboarding; fixture-eval canary on the daily cron tick + live health
      gates.
      **Phase 7 shipped out of order 2026-08-21 (ADR-0013)** — re-sequenced
      ahead of 5–6 because the demo must show real animals before any
      shelter is contacted, and the RescueGroups corpus was the only claim
      source available: exact `(source, externalId)` identity in
      `animal_identities`, per-field `resolveClaim(incoming, current)` with
      provenance JSONB, null claims never compete, conflicts counted (lower
      tier disagreeing) never logged, `animal.seen`/`animal.updated` from
      the writer, the poll now runs all four stages, and `npm run ingest --
      poll|replay` as the one-shot tool (the phase-6 replay command, landed
      early). Smoke 2026-08-21: 200 live animals → 200 canonical, re-poll
      and replay both zero events.
      **Phase 8 shipped 2026-08-21 (ADR-0014)**: stage 5 `LifecycleStore`
      — per-source set-diff after a run the caller declares complete;
      `animal.disappeared` / `animal.reappeared` with `last_seen_at` and
      `disappeared_at` on `animal_identities`; partial, empty and throwing
      runs reconcile nothing; replay never does. Adversarial pass 2026-08-21
      hardened the adapter (page-1 `meta.count`/`pages`, malformed-page and
      short-batch throws) and stage 5 (array binding at the 65k-parameter
      ceiling, monotonic run time, one event order). Carry-ins → phase 9:
      the ratio gate (a complete run that disappears more than N% is an
      upstream bug, not an adoption wave); **duplicate externalIds** — the
      2026-08-25 run returned 2 ids twice, and stage 1 compares only the
      LATEST raw row, so two differing payloads under one id re-insert every
      poll and (since ADR-0015) flap the rendered description and photos;
      check whether RG's duplicates actually differ before choosing a fix, and
      note the "a duplicate raw row is inert" comment in `pg.ts` is no longer
      true; ~~**a backward wall clock**~~ — **fixed 2026-09-04 (ADR-0014 as
      amended)**: `at = max(at, newest sighting)`, always, reported as
      `clockSteppedBackMs` and never fatal. No tolerance — the dev box's steps
      are accumulated dual-boot RTC drift (86.7s in August, 105s in September,
      both directions), so any fixed bound is a number waiting to be exceeded.
      Carry-in: a FORWARD step writes a future `last_seen_at` and so widens
      ADR-0015's visibility window until real time catches up — unaddressed,
      because it needs a reference clock the ingest path does not have; and
      **pagination drift** — no
      cursor, so records shift between pages and a trickle of false
      disappear/reappear pairs is expected; needs a reappear-rate metric
      and a sorted search if the API offers one. Measured on the first
      complete run 2026-08-25: page 1 promised 64,653, the run delivered
      64,312 (0.53% short — inside the 1% tolerance) with 2 ids returned
      twice, so the drift is real and visible on day one; 64,110 canonical
      animals, 0 failures, 0 null statuses, 1,465 orgs, ~15 min for 643
      pages, and stage 5 bound all 64k ids in one parameter. **Frontier is now phase 9**
      (health gates + retrieval) — or item 3, since the demo can read
      `animals` now; phases 5–6 still wait on item 5's fixtures.
      **The 2026-08-25 corpus was lost on 2026-09-03** — the poll had written
      it to the dev database, and the test suites truncated
      `raw_payloads` there with no backup anywhere (no Managed Postgres, and
      the RescueGroups adapter never vaults to R2). **ADR-0017** fixes the
      mechanism: tests own `monsterpaws_test`, never the dev database, and
      `npm run db:dump` takes a local copy. Carry-in: **re-poll to rebuild the
      corpus**, then dump it — the run will populate `listed_at` and
      `source_updated_at` on the way in, which the pages need.
      Remaining carry-ins live in the plan — verbatim `description`
      (phase 5), per-field staleness gating (phase 9). Tracker pixel on
      detail pages when listings render.
- [ ] **3. Animal pages.** ISR public pages (browse + detail) rendering real
      local shelters' animals — this is the demo *and* the v1 supply side.
      Carry-in from the ADR-0006 amendments: two distinct display
      permissions, never conflated — **`aggregator-display`** (held by the
      RescueGroups key, 2026-08-25 amendment: listing photos hotlinked from
      RG's CDN + description text, Tracker on every detail page, purgeable)
      and a shelter's **display grant** (scraped prose and photos). Without
      either, a page shows the facts plus our own words. Storing verbatim
      and displaying verbatim are different permissions; no art from API
      photos, ever. Needs: ADR-0015 for the page shape and how display
      content is carried in claims; the normalizer widening to promote
      photo URLs and description.
      **ADR-0015 amended 2026-09-03**: browse pages by keyset cursor, not
      offset; RG's `createdDate`/`updatedDate` are promoted as `listedAt` (a
      claim, and the only column the longest-listed sort may use) and
      `sourceUpdatedAt` (per-source, on `animal_identities`); visibility gains
      a 24-month upkeep bound. Measured on the live feed before deciding:
      ~10% of it was listed 2+ years ago and 82% of that tail has not been
      updated in twelve months, so an unguarded longest-first sort opens
      browse on abandoned listings. The `animal-listing-dates` slice shipped
      the same day (migration 0006).
      Carry-in: a null `source_updated_at` hides an animal, so the existing
      64k corpus stays invisible until a poll or `npm run ingest -- replay
      rescuegroups` fills the column — run that before judging a browse page
      empty.
      Carry-in: **replay cannot retract a claim** — a fact promoted in error
      stays until a source asserts a replacement, because an absent claim never
      overwrites (ADR-0009 phase-7 rule). Measured 2026-09-04: the `stateOr` fix
      corrected 5,023 states on replay and left 27 junk `T` values standing.
      Nothing obliges us to retract a fact today (ADR-0006 set-deletion and
      ADR-0015's display purge both DELETE rows instead), so this is deferred,
      not blocking — the build plan carries the detail. Until it is fixed,
      browse's filter OPTIONS must be built from values matching `^[A-Z]{2}$`,
      never `select distinct state`, or `T` becomes a filter nobody can use.
      Carry-in: ~4,100 animals are now collected but never rendered. A
      supply-side number to watch, not a bug; if it grows, look at the bound
      and at the upstream feed.

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
