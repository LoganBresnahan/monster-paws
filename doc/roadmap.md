# Monster Paws roadmap

Frontier = first unchecked item under **Now**. Check items off as they ship;
pin deferred sub-tasks to items as carry-ins. Dogfood findings live in
`doc/issues.md` (ADR-0019) and are pinned here as well only when they block a
slice or change build order.

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
      ~~the ratio gate~~ — **built 2026-09-30 (ADR-0014 as amended)**, item
      3b (a complete run that disappears more than N% is an
      upstream bug, not an adoption wave — but N must be a rate per day
      since the last complete run, not a flat share: the first poll after
      24 days away, 2026-09-28, legitimately disappeared ~21k of 85k
      identities, and a flat N would have refused it. That run also
      overflowed the stack on the single INSERT of its event wave; stage 5
      now inserts in chunks inside the one transaction, with a 25k-row
      test); **duplicate externalIds** — the
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
      pages, and stage 5 bound all 64k ids in one parameter. Carry-in → phase 9: **a picture with no published
      dimensions is dropped** (ADR-0015 as amended), which is right while
      RescueGroups publishes them for 73,833 of 73,833 pictures and silent if
      that ever stops — pages would simply lose photos. The health gate should
      watch the promoted photo count per run, not just failures. Its sibling
      (ADR-0015 revisit trigger): **RG CDN hotlinks failing or blocked** —
      photos are hotlinked, so a CDN refusing us is invisible to the poll;
      the storage question reopens under the terms, never by copying quietly.
      **Frontier is now phase 9**
      (health gates + retrieval) — or item 3, since the demo can read
      `animals` now; phases 5–6 still wait on item 5's fixtures.
      **The 2026-08-25 corpus was lost on 2026-09-03** — the poll had written
      it to the dev database, and the test suites truncated
      `raw_payloads` there with no backup anywhere (no Managed Postgres, and
      the RescueGroups adapter never vaults to R2). **ADR-0017** fixes the
      mechanism: tests own `monsterpaws_test`, never the dev database, and
      `npm run db:dump` takes a local copy. ~~Carry-in: **re-poll to rebuild
      the corpus**, then dump it~~ — **done 2026-09-03 and again 2026-09-28**,
      both dumped to `var/dumps/`: 85,204 identities, none missing `listed_at`
      or `source_updated_at`.
      Carry-in → phases 5–6: a scraped shelter page publishes prose WITH
      HTML tags, which `decodeEntities` does not cover — that is a
      sanitization decision needing its own ADR (ADR-0018 revisit trigger),
      not a wider entity table.
      Remaining carry-ins live in the plan — verbatim `description`
      (phase 5), per-field staleness gating (phase 9). Tracker pixel on
      detail pages when listings render.
- [x] **3. Animal pages.** Done 2026-09-28. ISR public pages (browse + detail) rendering real
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
      ~~Carry-in: a null `source_updated_at` hides an animal, so the existing
      64k corpus stays invisible until a poll or replay fills the column~~ —
      **discharged by the 2026-09-03 re-poll**; no identity has a null
      `source_updated_at` as of 2026-09-28. The rule still holds for any
      database restored from a dump older than migration 0006.
      Carry-in: **replay cannot retract a claim** — a fact promoted in error
      stays until a source asserts a replacement, because an absent claim never
      overwrites (ADR-0009 phase-7 rule). Measured 2026-09-04: the `stateOr` fix
      corrected 5,023 states on replay and left 27 junk `T` values standing.
      Nothing obliges us to retract a fact today (ADR-0006 set-deletion and
      ADR-0015's display purge both DELETE rows instead), so this is deferred,
      not blocking — the build plan carries the detail. The fix is now
      named: `purgeSource`'s from-scratch per-animal rebuild (ADR-0006 as
      amended 2026-09-28) is the same mechanism. Until it is fixed,
      browse's filter OPTIONS must be built from values matching `^[A-Z]{2}$`,
      never `select distinct state`, or `T` becomes a filter nobody can use.
      The `animal-detail-page` slice shipped 2026-09-04: `/animals/[id]`,
      ISR at an hour, reading only through `loadAnimalDetail` so the one
      visibility predicate cannot be bypassed. Two findings from the first
      render against the real corpus. **ADR-0018**: 72% of stored descriptions
      are HTML-entity-encoded (none carry tags), so prose is entity-decoded at
      render, never at promotion. The link-back that decision 5 and the key
      application promise is **closed** (migration 0009): `orgUrl` (97.7% of
      animals) and the animal's own `listingUrl` (18.6%) are promoted as
      claims, validated and never assembled, leaving 1,404 animals named but
      unlinked.
      Amended again the same day: photos carry the dimensions RescueGroups
      publishes (`animal_display.photos`, migrations 0007/0008, corpus
      replayed), so a detail frame takes each photo's own shape instead of
      cropping the animal or letterboxing it.
      Carry-in: ~4,100 animals are now collected but never rendered. A
      supply-side number to watch, not a bug; if it grows, look at the bound
      and at the upstream feed.
      The `animal-browse-page` slice shipped 2026-09-04, and with it
      `brand-tokens-in-pages`: `/animals` reads only through `src/core/browse.ts`
      (facet grid, keyset page, licensed card display), the landing hero links
      to it, and the dev-only stub is gone. **ADR-0015 amended again the same
      day**: browse renders per request rather than on ISR — filters and the
      cursor are search params, so there is no URL set to revalidate, and
      per-request is fresher than the hour, never staler. Measured on the live
      corpus: 0.55 ms for the page query, 8.8 ms for a deep filtered cursor,
      30 ms for the facet grid — that last is the one to watch, and caching it
      for the hour is the revisit trigger. The filter menus are the visible
      corpus's own values, counted under each other, which discharges the
      `^[A-Z]{2}$` carry-in (the junk `T` state is offered nowhere, and the
      non-US `ON`/`AB`/`BC`/`QC`/`SK`/`PR` stay reachable).
      Carry-in: the ADR-0021 interim shipped as **six curated exclusions**
      (`BROWSE_EXCLUSIONS`), keyed by `(source, external_id)` and composed
      beside `visibleAnimals` — delete the list wholesale when item 7b lands,
      never grow it.
      The `display-purge-path` slice shipped 2026-09-28: `purgeDisplay` in
      `src/core/purge.ts` (and `npm run ingest -- purge-display <source>`)
      deletes one source's `animal_display` rows and nothing else — raw, vault
      and facts are a separate purge, decided per termination. It refuses while
      the source's display license is active, so the checked-in revocation
      always comes first.
      Carry-in → phases 5–6: **a purge is undone by the next ingest of that
      source.** Stage 4 writes display rows whatever the license says (the
      gate is at render), so a replay, or a scrape that still holds its
      `scrape` grant after `display` is revoked, rebuilds the purged rows.
      Pages still refuse to render them, so nothing unlicensed is shown, but
      the purge no longer holds. **Decided 2026-09-28 (ADR-0015 as
      amended): stage 4 writes display only while the source is licensed**,
      in both writers, superseding the parity test that stores an unlicensed
      `shelterluv` row. Build it before the first scrape source can lose a
      grant; `onEnd` end terms on every license and grant (ADR-0006 as
      amended 2026-09-28) land with it.
      The `animal-pages-e2e` slice shipped 2026-09-28 (ADR-0017 as amended):
      Playwright seeds `monsterpaws_e2e` through the real pipeline and runs
      against the standalone production server it starts itself, so CI's
      `/animals` no longer answers 500. Plan phase 4 is green, which lifts
      its "no /deploy" hold.
      The docs reconciliation closed the item 2026-09-28: flows.md names only
      built symbols, and ADR-0015's four open revisit triggers are pinned as
      carry-ins to the items that will meet them — on-demand revalidation
      (7c), per-org opt-out (5), CDN hotlink failure (2, phase 9), display
      precedence (10). "Near me" stays in the ADR; no item plans it.

- [ ] **3b. Production launch.** Item 3's pages, the worker's daily poll and
      error reporting go live together, on Managed Postgres. Prerequisites,
      in order — the launch itself is planned step by step in
      `doc/oplog/0001-production-launch.md` (ADR-0023), which is revised as
      each lands and never improvised on the day:
      - [x] **SDK integration** (7c; ADR-0010 as amended 2026-09-29,
            2026-09-30) — done 2026-09-30: app server (ContextLines off),
            browser SDK deferred behind a stub (first-load JS unchanged),
            worker failure reports + heartbeat (`/fail` only on attempt 3/3),
            source maps proven end to end and uploaded by their own CI job,
            which `/deploy` requires green. Next.js 16.3.8 on topdog too.
      - [x] **`lastCompletePollAt` in `/api/health`** (7c; ADR-0010 as
            amended 2026-09-30) — done 2026-09-30: `ingest_runs`, one
            append-only row per run written by `runIngest` (worker and CLI
            alike); the endpoint is 503 unless the database answers and the
            oldest source's newest complete run is under 27 h old. The
            rate gate below divides by that row.
      - [x] **The disappearance-rate gate** (item 2 phase 9; ADR-0014 as
            amended 2026-09-30) — done 2026-09-30: stage 5 refuses, writing
            nothing, when ≥100 identities go at a compounding rate above
            5%/day since the last complete `ingest_runs` row; the worker
            reports a refusal to Better Stack, and
            `ingest poll --max-daily-disappearance R` lets a person accept one
            wave. The 2026-09-28 wave measures 1.2%/day and passes.
            **Corrected 2026-10-05 (ADR-0014 correction):** with no
            `ingest_runs` row, the gap is the disappearing set's MEDIAN last
            sighting. The first real dev poll was refused twice at "over 1.0
            day(s)": once measured from the source's newest sighting (this
            run's own new animals), then from the newest among the
            disappearing (stragglers a partial run created that morning).
            Both collapsed a 7-day gap to the one-day floor. Production was
            never exposed: it records `ingest_runs` from an empty first poll.
            The third dev poll that day passed at 1.78%/day: 8,509 disappeared,
            120 reappeared, the first complete `ingest_runs` row, and dev
            `/api/health` green.
      - [x] **The revalidation decision** (7c carry-in; ADR-0015 as amended
            2026-10-01) — decided 2026-10-01: the hour is accepted; freshness
            is checked live at the donate step instead (item 4 carry-in).
      - [ ] **UI + user-flow audit** (Logan, 2026-10-01) — walk every page
            this launch makes public (landing, browse, detail, `/claim`) and
            every promise it makes about donating, before any of it is live;
            findings go to `doc/issues.md` (ADR-0019). Also reviews the
            planned donation flow (item 4) on paper, since the launch copy
            already promises it. **Round 1 done 2026-10-05**, reviewed live in
            the shared browser (CLAUDE.md, Visual review):
            - browse opens newest first, with longest waiting in a Sort menu
              (ADR-0015 as amended 2026-10-05);
            - the filter menus recount as you pick, and Clear and Back reset
              them (ADR-0015 as amended 2026-10-04);
            - a site-wide footer (contact, source link, "Under construction");
              the wordmark replaces the "← Monster Paws" back link;
            - light-only theme (ADR-0016 as amended 2026-10-02); the hand
              cursor on buttons and dropdowns.
            Still open:
            - **a "Meet the crew" home section** with Logan's own pets, each
              beside its AI keepsake version. It waits on photos. Before it
              ships: the chosen art style becomes an ADR-0004 note (it defines
              the Monster Paws look the pipeline must later match), Logan's
              consent is recorded as the first `doc/consent/` entry, photo
              metadata (GPS) is stripped, and the files go under
              `public/brand/crew/` (TRADEMARKS.md: all rights reserved). Label
              them unmistakably as the founders' pets, not up for adoption;
            - the browse disclaimer wording (`doc/issues.md`, UI);
            - the donation flow on paper.
      - [ ] **Provision + deploy** — run oplog 0001: Managed Postgres
            (~$15/mo), migrations, `.env`, first poll by hand, heartbeat
            unpaused, smoke.

## Next

- [ ] **4. Donation flow.** Every.org integration + donor accounts; card on
      donate — framed real photo by default; AI art (ADR-0004 pipeline v0,
      built and exercised internally) ships in production **only for
      consented shelters**, credited "Permission to digify <pet> given by
      <shelter>". **The donate control must be unmistakable** — descriptions
      quote shelters verbatim and 0.76% of them carry a Venmo or PayPal handle,
      so our rail cannot be confusable with someone else's (ADR-0015 as
      amended). Collection page — the card timeline reads `animal_story`
      (ADR-0020); the two kinds projectable today, `status.changed` and
      `listing.reappeared`, are enough for a first card and may pull the
      projector forward from item 6.
      Carry-in: **the accounts ADR comes first** — no ADR yet decides how a
      donor signs in, what we hold about them, how an Every.org donation is tied
      back to an account, or deletion. DIRECTION and ADR-0022 assume accounts
      exist; write the decision before the build, not during it.
      Carry-in: **"Recently viewed" (ADR-0025)**, buildable any time and
      independent of accounts: ids in the visitor's `localStorage`, a `/recent`
      page of current cards ("no longer listed" for an animal that left),
      "Clear history". Whether it syncs for signed-in donors is the accounts
      ADR's question.
      Carry-in: **art is generated at home and arrives when it is ready**
      (ADR-0004 as amended 2026-10-05): pipeline v0 is a ComfyUI workflow
      committed with its model hashes and licence record, run as CI-built
      containers — the worker registered for `art.generate` only, beside a
      headless ComfyUI with the PyTorch wheel as a build argument (ADR-0007
      as amended 2026-10-05) — in a WSL distro on the second M.2 under a
      dedicated `monsterpaws` Windows account, with scoped credentials
      (infra.md registry) handed over by `/deploy` on a localhost SSH port,
      and an SSH tunnel to the droplet for Postgres, outbound only; the
      droplet's worker never registers that queue. The card shows the framed
      photo until the art lands, with its own message. Provisioning the home
      worker — user, distro, Task Scheduler start, credentials — is an
      infra.md step and an oplog entry; the unattended distro is the first
      thing to dogfood. Nothing is bought: the owned A770 plus rented
      training hours is the hardware plan until GPU prices normalize.
      Carry-in: **the donate step checks the animal's live visibility**
      (ADR-0015 as amended 2026-10-01) and says "no longer listed" — never
      "adopted" — then proceeds; the page cache is an hour old by design.
      Carry-in: **the keepsake is its own entity (ADR-0022)** — snapshotted
      at donation, append-only, every field a row carrying the basis it is
      held on (`donation`, `grant:<slug>:<permission>`,
      `aggregator:<source>`), and the card renders from it alone, never
      through `animals`. Build it before a donation points at an animal, and
      decide the degraded aggregator-only card's copy here.
      Carry-in: **the full source purge is designed before this item ships**
      (ADR-0006 as amended 2026-09-28) — keepsake facts are in its set.
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
      Carry-in: **the first claim/opt-out email needs a per-org exclusion**
      (ADR-0015 revisit trigger) — one that overrides `aggregator-display`
      in the registry, honored whatever the license says. The `/claim` line
      is on every RG detail page, so this can arrive before any grant does.
      Carry-in: **the ask carries a retention clause (ADR-0022 §5)** —
      keepsakes already given to donors (name, breed, age, photo, art) stay
      in their accounts if the shelter later withdraws. It must be in the
      FIRST email; the answer becomes the grant's end terms (ADR-0006 as
      amended 2026-09-28). Have a lawyer read the wording first.
      **Milestone: one real donation reaches one real shelter.** Verified-
      tier pitch (Shelterluv key, attestations) follows with whichever
      shelter warms up first.
- [ ] **6. Shelterluv integration.** Approval → poller → care-event diffing.
      Lands the `animal_story` table and its projector (ADR-0020) — care
      `kind`s are named against real care events here, not before; the
      newsworthiness list classifies every `AnimalFields` entry or the build
      fails.
- [ ] **7. Attestation pipeline.** Shelter keys, weekly batch-confirm
      dashboard, hash anchoring, R2 flat-file mirror, public verification page.

## Later

- [ ] **7b. Listing assessment (ADR-0021).** An LLM verdict per listing —
      "is this one adoptable animal?" — as derived, model-versioned data,
      gating browse only, default-show, and switched on only after a
      hand-labelled eval beats the regex baseline on *recall of real animals*.
      Sits here because it brings the first LLM into the ingest path and a
      third eval harness, which item 8 needs anyway. ~$15 for the whole corpus
      via the Batch API; the labelling afternoon is the real cost.
- [ ] **7c. Ops brief (ADR-0010 as amended 2026-09-28, 2026-09-29).** Two
      channels by latency: errors + an external uptime check on an extended
      `/api/health`
      (`lastCompletePollAt`) for anything a person must act on today; an
      `ops.daily` worker job → append-only `ops_daily` row → tokened
      `/api/ops/daily` → a claude.ai routine that writes the daily brief for
      everything else. Prompted by the 2026-09-28 stage-5 failure, which in
      production would have been a pg-boss job failing silently while the site
      aged out of its visibility window. Sentry, the uptime check and the
      health extension come first, before the first deploy that turns the
      poller on. **Provider provisioned 2026-09-29 (ADR-0010 as amended):**
      Better Stack — the Errors application, a keyword monitor on
      `/api/health`, and the poll heartbeat, created paused (`doc/infra.md`
      step 6d). The SDK integration, source maps, the worker's heartbeat
      pings and `lastCompletePollAt` were built 2026-09-30 (item 3b); left:
      the heartbeat and health monitor armed in the poller deploy (oplog
      0001), and the `ops.daily` brief. ~~Carry-in: on-demand revalidation from the
      worker~~ — **decided 2026-10-01 (ADR-0015 as amended)**: the hour is
      accepted, and the donate step checks live instead. The poller has never run in production, which is still the
      v0.1.0 landing page with no database behind it (`doc/infra.md` step 6).
- [ ] **8. Update generation + faithfulness evals.** LLM donor updates from
      confirmed events; the no-unattested-claims harness; adoption
      "graduation" moment + gotcha-day card. Reads `animal_story` only, never
      `event_log` (**ADR-0020**, decided 2026-09-04 after a replay wrote
      62,729 true-but-not-news `animal.updated` rows): prose elaborates within
      a row's evidence tier and never up it, and the harness joins story →
      evidence. Two constraints on generating from listing descriptions
      (ADR-0015 as amended): prose never reproduces a handle, URL, email or
      phone out of one — a mechanical harness check — and a licensed DISPLAY is
      not a licensed derivative, so the ADR-0004 consent gate is the shape to
      copy before an LLM rewrites an unverified shelter's prose.
- [ ] **9. Style LoRA.** Fine-tune the "Monster Paws look"; identity conditioning;
      CLIP-QC harness proper. Carry-in (ADR-0004 as amended 2026-10-05): a
      style brief and reference set come first, and never contain a shelter
      photo; SDXL trains on the A770, a FLUX-class train rents an H100 hour;
      every model's licence is recorded before it touches a card, and FLUX
      [dev] at home needs BFL's paid licence — Replicate's does not travel.
- [ ] **10. Entity resolution at scale.** Second/third listing source; dedup
      across feeds; trust-hierarchy merge.
      Carry-in: **display precedence between two licensed rows** (ADR-0015
      revisit trigger) — `pickLicensedDisplay` ranks a shelter's own words
      over an aggregator's copy by a stated v1 rule, not a decided one; the
      first merged animal with two licensed rows is when to decide it.
      Carry-in: **`purgeSource` is built and tested on a two-source animal
      before this ships** (ADR-0006 as amended 2026-09-28): delete the
      source's corpus and its `event_log` rows, then rebuild each affected
      animal from scratch. Until this item, every animal has one source and a
      purge is a set delete; after it, only the rebuild separates them.
- [ ] **11. PWA push** for sponsors; **Expo app** when push friction costs
      engagement.
- [ ] **12. Vet co-signing.**
