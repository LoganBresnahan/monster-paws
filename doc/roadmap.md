# Monster Paws roadmap

Several items move in parallel, so there is no single frontier: **Active
tracks**, at the top of Now, names each track, its next step and what it
waits on, and is updated in the commit that moves a track (Logan,
2026-10-22). Numbers are identifiers, not order — order is build order
(re-sequenced 2026-10-05: the MVP loop — list, donate, art — ships before
the production database, so 3c, 4 and 5 precede 3b). Check items off as
they ship; pin deferred sub-tasks to items as carry-ins. Dogfood findings live in
`doc/issues.md` (ADR-0019) and are pinned here as well only when they block a
slice or change build order.

## Now

### Active tracks (2026-10-23)

| Track | Item | Next step | Waits on |
| --- | --- | --- | --- |
| **Meta hackathon** | ADR-0028 | Cut the `meta` branch once ADR-0028 commits; its ten-day plan at `doc/plans/meta-hackathon.md` on the branch. Window 2026-10-26 → 2026-11-04 21:00 ET, judging to 11-08, finals 11-09. Base: SAM 3.1 as a `sam3` pipeline beside owlv2, klein paints, the crew, on a demo stack under our domain. Stretch (decision point **2026-10-30**): a Chicago shelter's grant → ADR-0027's account-less donate loop on topdog takes real donations. Read the Official Rules for a pre-existing-code clause the day they publish | The Official Rules (before 10-26); the API key and credits; a shelter's yes |
| **Accounts and donating** | 4 (ADR-0027) | Pulled forward by ADR-0028: the account-less donate loop first — `donation-intent-donate-link`, `everyorg-webhook-endpoint`, `thank-you-and-claim` (phases 3–5) on topdog, with the production Every.org webhook and the hooks hostname's DNS; `resend-transactional-email` for the root site's email capture ("tell me when sponsorship opens", a line for shelters); `session-dal` and passkeys after 11-04 (phase 1 done 2026-10-22, `drizzle/0011`) | Nothing. The staging webhook is made (2026-10-22); the partners@every.org email is shelved (Logan, 2026-10-22) — signing, retries and lookup are learned against staging in phase 4, where the dashboard also offers an API key and secret |
| **The anatomy LoRA** | 9, pulled forward (ADR-0004 as amended 2026-10-22) | The Qwen-Image-Edit cleanup ran 2026-10-23 (`scripts/gpu-rental.sh`) and is rejected: it restyles the brushwork. NAG on klein-v1 ruled out the same day (batches 12a–12b: anatomy on all 48 at every strength — the references, not the words, carry it). klein Base repainting a LaMa'd groin ellipse (12c) regrew 11 of 12; reading the LaMa'd painting as a reference (12d) regrew none, but every groin is blurry — LaMa erases the painter's lines and nothing draws them back (Logan). RTMPose keypoints (12e) place joints well standing, but a hip-and-knee hull is the thigh, not the groin. Next: continue the painter's lines across the hole and draw them back before the repaint, as `legmask.py` did for tripods (`doc/plans/base-model-candidates.md`) | Nothing: runs on the A770 |
| **Shelter consent** | 5 | ADR-0028's happy path: draft the ask today and send it to every Chicago-area shelter — photos the shelter sends us directly, with permission to display and paint them (display + digify, first-party tier, ADR-0006 decision 6), each yes recorded in the registry; the lawyer's read of the formal three-grant letter follows the first yes | Shelters' replies; decision point 2026-10-30 |
| **Meet the crew** | 3c, the home section | The crew's real photos on the site today (ADR-0028 decision 7: a shelter reading the consent email sees a real product), GPS stripped, under `public/brand/crew/`, labelled the founders' pets; each pet's keepsake beside it later | The paintings: Logan's picks from batches 11a–11c (the whole crew; Beetle with no colour words, Marty with his points spelled out); the cats go up as painted, the dogs wait on the anatomy track — the Qwen cleanup was rejected 2026-10-23 (ADR-0004 as amended 2026-10-23) |
| **Launch** | 3b | Browse-first production launch (ADR-0028 as amended 2026-10-23): revise `doc/oplog/0001-production-launch.md` to the database, pages, poll, error reporting and heartbeat, then run it; the donate loop, home worker and art follow in their own entries | Its prerequisites: CI green with sourcemaps, e2e on the commit, the droplet back on topdog, launch-blocking audit findings fixed or deferred |
| **Small, any time** | 4, 2 | The SDXL strip (item 4 carry-in, then `comfy:build` and `comfy:smoke`); "Recently viewed" (ADR-0025); ingest phase 9 health gates (item 2's other phases wait on item 5's fixtures) | Nothing |
| **Home GPU watch** | — | `/gpu-health` after 2026-10-27: a week clean since the dummy plug closes the flicker and crash entries in `doc/issues.md` | Time |

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

- [ ] **3c. Style discovery → "Meet the crew".** The first art slice, on
      the owned A770 and nothing bought (ADR-0004 as amended 2026-10-05).
      ComfyUI under Logan's own account (never the prod one), display on the
      iGPU; SDXL + IP-Adapter first — the smoothest path on XPU — with every
      model's licence read and recorded before use (ADR-0004 §1). Find the
      Monster Paws look with Logan's own pets as the identity photos: one set,
      unmistakably that animal. The chosen style becomes an ADR-0004 note
      with the reference set and the API-format workflow JSON committed (it
      defines the look the pipeline must later match). Then ship the home
      section: each pet beside its keepsake version, Logan's consent recorded
      as the first `doc/consent/` entry, photo metadata (GPS) stripped, files
      under `public/brand/crew/` (TRADEMARKS.md: all rights reserved),
      labelled unmistakably as the founders' pets, not up for adoption. Nothing
      here touches production or the prod Windows account; those are built at
      item 4 once a workflow is worth deploying.
      - [x] **PyTorch sees the A770** — done 2026-10-05, from a container:
            `comfyui/` (Dockerfile, compose, smoke) and `npm run comfy:*`;
            the host-side facts are in `doc/infra.md`, Home GPU. Intel's
            runtime had to be ≥ 25.x and the whole of `/usr/lib/wsl` mounted.
      - [x] **ComfyUI serves on :8188 from that image** — done 2026-10-05:
            ComfyUI 0.38.0 pinned by sha, `Device: xpu:0`, GUI reachable from
            the Windows browser via mirrored networking.
      - [x] **A first SDXL + IP-Adapter workflow runs on the Arc** — done
            2026-10-07: `ComfyUI_IPAdapter_plus` pinned by sha in the image,
            `comfyui/workflows/sdxl-txt2img.api.json` and
            `sdxl-ipadapter-v0.api.json` committed, `comfyui/run_workflow.py`
            queues one and waits for its images. SDXL 1024² at 25 steps runs
            at 2.3 it/s (54 s cold with the model load, 19 s for the
            IP-Adapter pass once loaded); the identity carried — same dog,
            collar and blanket at weight 0.8, the prompt's style mostly
            overridden, which is the dial "the look" turns. The day went to
            the transport: the image's compute runtime (25.18, the newest in
            Intel's apt channel) was a year older than the Windows driver and
            returned garbage for every copy without an error; the smoke had
            never read a value back. Runtime 26.35, IGC 2.41.5 and Level Zero
            loader 1.34.0 are now pinned from GitHub releases, the smoke
            round-trips values and a 3 GiB allocation, and
            `UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS=1` lifts Level Zero's
            1 GiB single-allocation ceiling (`doc/infra.md`, Home GPU).
      - [x] **The models manifest and its fetcher** — done 2026-10-07
            (ADR-0004 decision 11 as refined 2026-10-05):
            `comfyui/models.manifest` — file, source (`hf:` or `r2:`), sha256,
            licence, date checked — is the §1 licence record (SDXL base
            OpenRAIL++-M; IP-Adapter Plus SDXL and the ViT-H encoder
            Apache-2.0, read that day); `comfyui/models.py fetch` fills the
            store streaming each hash and `up` re-verifies every file before
            ComfyUI serves, refusing on a mismatch (`npm run comfy:models`;
            a vitest drives its `check`). Dev's store is `var/comfyui/`
            inside the `monsterpaws-dev` distro on the M.2. The LoRA upload
            script and the read-only R2 models credential come with item 9's
            first LoRA.
      - [x] **A dedicated dev distro on the M.2** — done 2026-10-06
            (ADR-0004 decision 10 as revised): dual boot retired,
            `monsterpaws-dev` bootstrapped by `scripts/bootstrap-distro.sh`,
            corpus (94,029 animals) and the ComfyUI image carried over, Arc
            smoke green from its own docker engine; the general Ubuntu is
            back on C: and Docker Desktop's junction undone; the 24 GB cap is
            live, Ubuntu's vhdx compacted 204 → 154 GB, Docker's redundant
            copies deleted, and the checkout renamed to `~/monsterpaws` with
            the compose project pinned to the same name, so nothing live
            carries the old name.
      - [x] **The look**, with Logan's pets; the ADR-0004 style note —
            done 2026-10-14 (ADR-0004 as amended 2026-10-14): FLUX.2 klein
            4B in BFL's fp8 reads the grown subject and head crops as
            references, and the storybook prompt holds the style without a
            LoRA. `comfyui/workflows/klein-v1.api.json` is the committed
            look; SDXL + IP-Adapter was the fallback until ADR-0004 as
            amended 2026-10-15 withdrew it. Batches 1–8a in
            `doc/plans/the-look-exploration.md` and
            `doc/plans/base-model-candidates.md`; subject boxes by detector
            (ADR-0026).
            Carry-in: **the WSL2 leak that froze the host three times is
            found and fixed** (`doc/issues.md`, Ops; `doc/infra.md`, Home
            GPU): ComfyUI's per-prompt cache flush against a driver that
            retains every free — `custom_nodes/monsterpaws_xpu` keeps the
            cache, the Arc driver is 101.9034, and batches run through
            `comfyui/guard.sh` until one has completed clean. The
            production worker inherits both: the custom node in the image
            and a process that never empties its cache.
      - [ ] **The home section**, with the consent entry.
- [ ] **4. Donation flow.** *Moved into Now 2026-10-05: part of the MVP that
      gates the production database (3b).* Every.org integration + donor accounts; card on
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
      Carry-in: **donor accounts per ADR-0027** (accepted 2026-10-16):
      passkeys with an emailed link as fallback, the email the only identity,
      a donation tied back by our own `partner_donation_id`, the unsigned
      Every.org webhook trusted no further than its intent, the account made
      after the gift, and delete-everything after an offered export, with
      the counts kept as anonymous stats rows. Build per
      `doc/plans/adr-0027-accounts-build-plan.md` (13 slices, 6 phases;
      settle the keepsakes table and the shelter-to-nonprofit mapping
      early). The staging webhook is self-serve
      (staging.every.org/developer, Logan's account); signing, retries and a
      `chargeId` lookup are asked of partners@every.org, which has lead time.
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
      Carry-in: **provision the production account's graphics routing and
      the one-ComfyUI rule before the first job** (`doc/infra.md`, Home
      GPU, 2026-10-11): sleep and hibernate off on AC (the dev box sleeps
      by Logan's choice until then); per-app `GpuPreference=1` so nothing
      but ComfyUI touches the Arc from that account; dev and production WSL caps sized
      together; the guard refuses to start when the other account's
      ComfyUI holds the card; production's worker has the card by default.
      Carry-in: **the art worker survives a GPU reset** (`doc/issues.md`,
      Ops, 2026-10-12): the Arc's driver times out an engine and Windows
      resets it (a 0x141 watchdog dump in
      `Microsoft-Windows-WerKernel/Operational`), once inside the WSL VM's
      own process, so a job can lose its image. A failed ComfyUI prompt
      fails the attempt and the worker restarts ComfyUI before the retry
      (a lost device stays lost to the process that held it); the retry
      uses the same seed and words, so it paints the same image; QC
      rejects a blank or uniform image outright rather than leaving it to
      the likeness score; and an attempt with a watchdog dump inside its
      window is recorded as a GPU reset, not a model failure. Logan wants
      an alert when one happens: find out whether it fits Better Stack
      (ADR-0010 — an Errors event from the worker, or a heartbeat's
      `/fail`, both of which email) before reaching for plain email. The
      event log lives on Windows, so the reader runs `powershell.exe` from
      the distro, as `scripts/gpu-health.sh` does.
      Carry-in: **the home distro's WSL cap is 32 GB** — measured
      2026-10-09 on the SDXL stack (17 GB high-water); klein's ComfyUI
      holds ~3.4 GB of RAM, and the VM filling up was file cache, which
      `models.py` and the guard now return (2026-10-14, `doc/infra.md`,
      Home GPU). Size dev and production together from those numbers.
      Carry-in: **a throughput sweep before the worker is sized** —
      candidates as one batched sampler call, Arc Control limits, XPU
      precision/attention flags (`doc/plans/the-look-exploration.md`,
      Throughput). Today's 16 s/image is the unoptimised number.
      Carry-in: **art bytes carry the graph that made them.** ComfyUI's
      SaveImage embeds the full prompt graph (prompt text, model names, the
      input file name) as PNG text chunks — that is what lets a dev drag an
      output back onto the canvas. Production never serves that: the
      headless container runs with `--disable-metadata`, and the worker
      re-encodes every candidate before the R2 upload so nothing ComfyUI
      wrote survives, the same strip the consented owner photos get
      (noted 2026-10-07, Logan's question).
      Carry-in: **the subject detector is decided (ADR-0026)** — OWLv2
      prompted from the listing, SAM 2.1 outlines, the clean-up rules, six
      votes, and always one animal chosen with the margin recorded and a
      second look under 0.1; 19 of 20 on a blind set
      (`doc/plans/subject-detection.md`). A companion animal in the frame is
      otherwise copied as faithfully as the subject (batch 1, 2026-10-08).
      The box is rendered at its own aspect, never padded (batches 1b–1d:
      padding shows as bands). Batch 5a (2026-10-12) painted from detector
      boxes instead of hand-drawn ones: Plum indistinguishable; Ducky's boxes
      clipped her muzzle and one of four portraits came out as two dogs,
      which the judge's agreement rule rejected. The crop that fixes it:
      grow the chosen box by its own outline (pixels no other candidate's
      outline claims) plus a margin only where it grew past the box —
      no neighbour brought back on any of 68 photos, and batch 5b
      (2026-10-12) painted Ducky from it as well as from hand-drawn boxes,
      with no two-dog image — but Logan's picks went to the hand cut for
      Ducky (one and one for Plum): the detector's head box, the painter's
      face reference, still clips Ducky's muzzle, and a box the outline stops at is never grown.
      Still to do, in order: grow the head box by the subject's own
      outline and re-run; the **best-two-photos rule** —
      subject size, head found, margin, sharpness, checked against the
      batch-4c hand picks; the photo still sets the view even with the pose
      fixed (a top-down shot gave a top-down keepsake, batch 1d); then the
      worker stage. Known limits: a pile or litter can hide the subject from
      the detector, and "always one" then picks wrong — re-detect when the
      margin is small and no candidate matches the colour; grow a partial box
      to its outline; the part rule drops puppies inside their mother's box,
      wrong for a puppy's listing. A rule change is trusted only after a
      fresh blind set: Logan's shelter-grade crew photos or a fourth Commons
      set (`comfyui/explore/commons-photos.tsv` records the first three).
      Carry-in: **the listing's colour, and a reviewed table from fields to
      words** (`doc/plans/listing-words.md`) — needed by the description and
      by the detector's colour vote, its heaviest. `animals` has no colour
      and the RescueGroups adapter claims none; the source sends exactly one
      of 161 colour entries per animal, with compounds inside the entry
      ("Black and White"), plus `patterns` (18.5%), `isBreedMixed`,
      `breedSecondary`, `coatLength` (76%) and the species' young name
      (puppy, kitten). The adapter claims them; a table written once and
      reviewed by Logan maps each entry to the description's words and to
      the palette colours the colour vote counts (blue, brindle and calico
      are already missing). The description names the sex (always: the
      painter guesses it otherwise — Logan, 2026-10-11), colour, breed, age
      and species; never a positioned noun ("white chest patch" painted a
      bandana, batch 4a); and a colour pair joined with "and" painted another
      dog's markings (batches 4b–4c), so each entry's words are chosen, never
      joined. The table is proposed in place of a runtime language model.
      Before it: a klein batch that removes the words one at a time.
      Carry-in: **visible traits go into the words** (Logan, 2026-10-12) —
      three legs, one eye, ear-tipped; about 1% of the corpus's listings name
      one. A fixed keyword list over the listing's text is the likely source,
      and taking a fact from prose needs an ADR note before it is built.
      Batch 6a (2026-10-12) tested "three-legged" with the fixed pose: 12
      of 12 paintings had four legs. Batch 8a (2026-10-14) tried stronger
      words and the photo's own pose: four legs every time
      (`doc/plans/base-model-candidates.md`). Batches 8b and 8c
      (2026-10-14): an editing instruction never removes the leg.
      Inpainting inside SAM's outline of the leg removes it cleanly when it
      stands apart (the Dane, three of four) and fails when fur runs into it
      (the spaniel). Batch 8d: LaMa (Apache-2.0, CPU) inside SAM's mask
      removes the leg on all six paintings; klein at 0.3 keeps it removed,
      and at 0.5 regrows it. Batch 8e: head and tail give the flank in
      view, and the soles in SAM's outline name each leg; four legs found
      on 15 of 18 paintings (feathered spaniels fail), 0 of 3 photos. Which
      leg is missing comes from the listing's words or a person, never the
      photo. Batches 8f and 8g (2026-10-15): ten fresh Commons tripods,
      rules frozen, removal and recount automatic. Four legs found on 15
      of 30 standing paintings and 1 of 30 sitting; of 12 named removals,
      10 look right and the recount passes 8 with none wrong. About a
      quarter of standing paintings come out three-legged unattended; the
      count is the weak step. Batch 8h: LaMa alone leaves the leg fading
      into the paper; klein at 0.65 inside a small stump region redraws a
      healed, outlined end on 9 of 9 and regrows no leg.
      Carry-in: **art reads the largest photo the consented source offers**
      (Logan, 2026-10-12), never the page's 500-px display copy.
      RescueGroups photos never reach art or its development (ADR-0006 as
      amended 2026-08-25 §2).
      Keepsake poses are fixed — three-quarter sitting or standing, never
      the photo's pose (Logan, 2026-10-12): a front-on sit shows the
      underside, and the judge should reject what a keepsake must not show.
      The judge is an embedding comparison that runs on the card or the
      CPU. The photo never leaves the machine (ADR-0004), so
      a hosted model may only ever see generated candidates, never the
      reference — which rules it out as the likeness judge and leaves it a
      possible anatomy check at most (its own ADR if ever).
      Carry-in: **the donor keeps all four candidates and picks the
      card's face** (Logan, 2026-10-14; ADR-0004 as amended 2026-10-14).
      Four `art` facts per keepsake; a `face` row per pick, never an
      UPDATE; until the donor picks, the first in generation order. The
      judge runs on every set, stores its scores and choice with its
      version, and is never shown or obeyed — the donors' picks are its
      labelled set until it earns the gate. One set per keepsake, never a
      re-roll (DIRECTION.md's third bright line).
      Carry-in: **nothing a keepsake must not show reaches the set**
      (batch 9a, 2026-10-15, `doc/plans/base-model-candidates.md`): run as
      production on Plum and Ducky, all eight showed male genitals (Ducky
      is female) and two carried a painted signature. Batch 9b: no wording
      keeps either out (86 of 96); a landscape canvas fixes Plum's
      front-on sit. Keepsakes are painted on a landscape canvas, and a
      three-legged listing standing only (Logan, 2026-10-15). Removing the genitals after painting only
      blurred the area and was dropped (Logan: "its not good"); male
      anatomy must never be painted on a female, and the fix is the
      painter — item 9's LoRA. A painted signature is found and taken out
      by `comfyui/signature.py` (LaMa). Closed before the first donor's set.
      Carry-in: **strip the SDXL path** (ADR-0004 as amended 2026-10-15:
      klein only, no fallback) — its manifest lines (SDXL base,
      IP-Adapter, its LoRAs, the canny ControlNet; keep CLIP ViT-H, which
      `likeness.py` scores with), the IP-Adapter node in
      `comfyui/Dockerfile`, the harness's SDXL graphs,
      `comfyui/workflows/sdxl-ipadapter-v0.api.json`, and
      `run_workflow.py`'s SDXL examples; rebuild and `npm run comfy:smoke`.
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
- [ ] **5. Local consent outreach.** *Moved into Now 2026-10-05: the MVP needs
      ONE shelter's digify grant so one real animal carries real art (ADR-0006
      decision 6); the rest of the outreach continues after launch.* Permission emails to 3–5 local
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
- [ ] **3b. MVP launch.** Item 3's pages, the donate flow (item 4) and
      keepsake art go live together, with the worker's daily poll and error
      reporting, on Managed Postgres. **Browse goes first, 2026-10-23 (ADR-0028
      as amended): the database and pages launch ahead of the donate loop,
      so Chicago shelters see real animals; the paragraph below is the
      superseded order.** **Re-sequenced 2026-10-05 (Logan): no
      production database until the basic loop works end to end — animal
      list, donations, AI art.** Until then monsterpaws.org stays the v0.1.0
      landing page and the dev corpus plus `db:dump` is the copy of record
      (ADR-0017), so dump after every full poll. Prerequisites, in order — the
      launch itself is planned step by step in
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
            Still open, folded into the launch dogfood:
            - the browse disclaimer wording (`doc/issues.md`, UI);
            - the donation flow on paper — now item 4 itself, reviewed built;
            - "Meet the crew" moved to item 3c, 2026-10-05.
      - [ ] **Items 3c, 4 and 5's first grant are done** — a card can be
            bought for a real animal, and at least one real animal has real
            art. The loop is dogfooded on the dev database first: a real test
            donation, a real card, a real portrait from the home worker.
      - [ ] **Provision + deploy** — run oplog 0001: Managed Postgres
            (~$15/mo), migrations, `.env`, first poll by hand, heartbeat
            unpaused, the home worker's scoped credentials, smoke.

## Next

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
- [ ] **9. Own the look (was: Style LoRA).** Off the path to a first keepsake since
      ADR-0004 as amended 2026-10-14: the prompt holds the style. A klein
      LoRA on the non-distilled Base 4B when that amendment's revisit
      triggers fire (style drift, a look of our own); the judge proper
      (silent until it earns the gate). Carry-in (ADR-0004 as amended 2026-10-05): a
      training set never contains a shelter photo, and every model's licence
      is recorded before it touches a card. Where and how it trains is
      ADR-0004 as amended 2026-10-22: klein Base 4B on a per-job
      DigitalOcean GPU (SDXL and the H100 hour are withdrawn).
      Carry-in: **pulled toward the front by anatomy, not style** (Logan,
      2026-10-15): the painter draws male genitals on nearly every dog,
      females included (batches 9a–9c), and four legs on a tripod (batches
      6a–8h); repair after painting blurs (LaMa) or regrows (klein), and
      the genital repair was dropped. The next art step is a rented GPU to
      train the LoRA on Base 4B — clean undersides, tripods by the leg —
      from paintings Logan approves: tripods repaired by legs.py, and
      paintings whose underside is clean as painted.
      Open: whether a Base-trained LoRA carries to the distilled 4-step
      klein (BFL's own guide says it loads and "usually gives even better
      results"; ours to test); likeness must hold (the harness before
      ship). The ADR-0004 amendment lands with the training plan, before
      the rent. Scope (Logan, 2026-10-22): **no genitals on any dog**, and
      **genitals only** in this LoRA — a tripod LoRA, if needed, is its own.
      **The plan is ADR-0004 as amended 2026-10-22**: batch 10a ruled out
      klein Base as the set's painter (19 of 24 still drawn); the set is
      distilled-klein paintings cleaned by Qwen-Image-Edit 2511 and
      approved by Logan; an edit LoRA trained on Base 4B with ai-toolkit on
      a per-job DigitalOcean GPU Droplet. Next, in order: the GPU limit
      (requested 2026-10-22); the rental job (`doc/infra.md`, GPU rental);
      the cleanup test on batch 9b's 22 anatomy paintings, Logan judging;
      ~60–100 Commons dogs collected; the set; the training runs.
- [ ] **10. Entity resolution at scale.** Second/third listing source; dedup
      across feeds; trust-hierarchy merge.
      Carry-in: **a consented shelter's own feed is matched to its
      RescueGroups listings** (Logan, 2026-10-13), so the page has
      RescueGroups' fuller facts and the art has the shelter's photo. The
      registry knows the shelter's RescueGroups org, so matching stays
      inside one org.
      - RescueGroups' `rescueId` is the shelter's own animal ID: filled for
        68.5% of animals, with 60,727 distinct of 64,429 within their orgs
        (measured 2026-10-13). It should equal the ID in the shelter's own
        system. Name, species, sex and birth date confirm the match.
      - A match adds an identity row (ADR-0013 decision 1). The merge
        already lets RescueGroups fill fields the shelter's feed leaves
        empty (decision 3).
      **RescueGroups' facts must not reach the art as things stand.**
      - Our granted key application says the artwork program is "based on
        the shelter's own authorization and their own photos, not on API
        data" (`doc/rescuegroups-application.md`).
      - The API terms treat use beyond the application as a violation.
      - Everything derived from API data is purged at termination, and that
        purge would reach a keepsake painted from it (ADR-0022).
      Three ways out, to be decided with RescueGroups and a lawyer in an
      ADR-0006 amendment before colour words reach production art:
      - RescueGroups widens the key to cover listing facts (never photos) as
        words for art a shelter has consented to;
      - the digify grant covers the shelter's own listing facts, taken from
        the shelter's own channel;
      - the words come from our own measurement of the consented photo.
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

## Parked ideas

Not scope. An idea becomes scope only when `doc/DIRECTION.md` says so and an
ADR decides it; until then it sits here so it is not lost and not built.

- **Donors' own pets as keepsakes, paid** (Logan, 2026-10-07). A donor
  uploads a photo of their own animal and pays Monster Paws for its keepsake
  art; that revenue funds servers and the GPU. Later, the animals a donor
  owns and sponsors could share a "virtual world" — generated video, or
  something passive and text-based. Why it is parked: the first half changes
  DIRECTION design principle 1, which funds operations by the optional tip
  and takes no payment for anything, and would make Monster Paws the merchant
  of record for a service (tax, refunds, a payments provider — the rails the
  principle exists to avoid). The second half must be designed against the
  bright lines before a line is drawn: nothing tradeable, no rarity, no
  pressure. The image pipeline itself is indifferent — a consented owner photo
  is the easiest identity input there is. Decide at DIRECTION level once
  item 4's donation flow and its accounts ADR exist.
