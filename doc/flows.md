# Process and data flows

The diagrams here are the source of truth for the *shape* of each flow — the
stages, the boundaries between them, and the external calls (ADR-0012).
`doc/infra.md` holds the deployment, CI and custody pictures; this file holds
everything that moves through the running system. Every box names a real
symbol or table so the diagram is greppable against `src/`; a stage that is
not built yet is marked `(planned, phase N)` and cites the plan.

Change a flow's shape — add a stage, move a boundary, add an external call —
and update its diagram in the same commit. `/shipshape` checks that every
identifier boxed here still exists.

## Ingest pipeline — the five stages (ADR-0009 as amended 2026-10-28, ADR-0013, ADR-0014)

Every source, scrape or API, enters through one `SourceAdapter` and runs the
same stage path. `runIngest` is the full run; `replay` re-enters at stage 2
over the retained corpus, with no source contact — the two share
`deriveOne`, and if they ever diverge replay stops proving anything about
production. `runIngest` runs stages 1–4 for each observation as the adapter
yields it, so only the seen ids grow with the feed; stage 5 runs once, after
the feed (ADR-0009 as amended 2026-10-28). An adapter error propagates out of
`runIngest` rather than producing a short report: a partial fetch must never
reach stage 5.

```
  source (live)                       corpus (retained)
       │                                    ▲
       ▼                                    │ replay(source, stored, stages)
  ┌────────────────────┐                    │ re-enters here — stages 2–4 only
  │ SourceAdapter      │                    │
  │  .fetch()          │  Observation<P>    │
  │  async generator   ├──────┐             │
  └────────────────────┘      │             │
                              ▼             │
   stage 1  ┌──────────────────────────────┴───┐
   persist  │ RawStore.persist(obs)             │  raw_payloads  (SACRED)
            │  latest row same content_hash?    │  ─ insert:  new row
            │   yes → touch last_seen only      │  ─ dedup:   last_seen UPDATE
            │   no  → INSERT                    │    (the one sanctioned UPDATE)
            └──────────────────┬───────────────┘
                               │ StoredObservation<P>  (+rawId) — straight on
                               │ to deriveOne, never buffered for the feed
                               ▼
   stage 2  ┌──────────────────────────────────┐
  normalize │ stages.normalizers.get(source)    │  per-source mapper; LLM
            │  .normalize(stored) →             │  extraction is a normalizer
            │   {claims, display?}              │  like any other
            │  claims: {value, source,          │  (planned: phases 5–6)
            │           fetchedAt} per field    │  display = licensed
            │  display: description, photos,    │  expression, never a claim
            │   listingOrg, trackerUrl          │  (ADR-0015)
            └──────────────────┬───────────────┘
                               │ AnimalCandidate
                               ▼
   stage 3  ┌──────────────────────────────────┐
   resolve  │ EntityResolver.resolve(candidate) │  → animalId | null (new)
            │  exact (source, externalId) via   │  animal_identities (DERIVED)
            │  animal_identities  (ADR-0013)    │  fuzzy matcher: item 10
            └──────────────────┬───────────────┘
                               ▼
   stage 4  ┌──────────────────────────────────┐
    write   │ CanonicalWriter.apply(cand, id)   │  animals   (DERIVED)
            │  per field, null claims skipped:  │   + provenance{field:
            │   resolveClaim(incoming, current) │      {source, fetchedAt}}
            │  emit animal.seen / .updated      │  event_log (SACRED), same
            │  nothing when canonical reproduced│  transaction as the row
            │  display? → upsert (animal_id,    │  (ADR-0013)
            │    source): no event, no          │  animal_display (DERIVED,
            │    updated_at, never merged       │   purgeable — ADR-0015)
            │    only if isDisplayLicensed(     │  (planned: the license
            │    source, now)                   │   gate, ADR-0015 am.)
            │  sourceUpdatedAt? → this source's │  animal_identities (DERIVED)
            │    identity only: no event, and   │   source_updated_at
            │    never a claim (ADR-0015 am.)   │
            └──────────────────┬───────────────┘
                               ▼
   stage 5        ◆ complete run?  caller passed {complete: true}
  lifecycle       │                AND the run saw ≥1 animal; never on replay
                  │                (ADR-0014)
                  ├── no ──► skip stage 5: lifecycleSkipped =
                  │          "run declared partial" | "run observed nothing"
                  │ yes
                  ▼
            LifecycleStore.reconcile(source, seen ids, at, gate)
              at = max(at, newest sighting) — the invariant, not a tolerance;
              a stepped host clock is corrected + reported (ADR-0014 amended)
              count this source's identities, BEFORE any write:
                present (not yet disappeared) · disappearing (present, unseen)
                  │
                  ▼
                  ◆ does the amount make sense?  judgeDisappearances
                  │   days = since RunStore.lastCompleteAt, ≥ 1;
                  │   none recorded → since the disappearing
                  │   set's MEDIAN last_seen_at (ADR-0014 corr.)
                  │   rate = 1 − (1 − disappearing/present)^(1/days)
                  │   (ADR-0014 am. 2026-09-30; normal is ~1.2%/day)
                  │
                  ├── ≥100 disappearing AND rate > 5%/day ──► REFUSE
                  │      writes nothing: no disappeared_at, no event;
                  │      lifecycleSkipped = the reason, gateRefused = true
                  │      → worker: Sentry error today; run recorded
                  │        complete:false, so /api/health ages from the
                  │        last good run; a real wave clears itself as the
                  │        gap grows, or a person reruns with
                  │        ingest poll --max-daily-disappearance R
                  │ passes
                  ▼
            ┌──────────────────────────────────┐
            │  this source's identities only:   │  animal_identities (DERIVED)
            │   seen → last_seen_at = at        │   last_seen_at,
            │     (+ animal.reappeared if it    │   disappeared_at
            │        was disappeared)           │  event_log (SACRED), same
            │   absent → disappeared_at = at    │   transaction as the count
            │     + animal.disappeared          │
            └──────────────────┬───────────────┘
                               ▼
            IngestRunReport {observed, persisted, deduped, normalized,
                             conflicted, lifecycleSkipped?, events,
                             failures[stage]}
                               │
                               ▼            never on replay, never for a run
            RunStore.record(toRunRecord)    that threw (ADR-0010)
              complete = stage 5 ran        ingest_runs (append-only)
                               │                 │
                               │                 └→ /api/health: newestCompleteRuns
                               │                    → assessHealth: 503 once the
                               │                    OLDEST source's newest complete
                               │                    run is > 24 h + 3 h grace
                               ▼
                                            → further health gates (planned,
                                              phase 9: promoted photo count,
                                              reappear rate)
```

A failure at any derived stage is recorded in `failures` with its stage and
the loop continues — one malformed payload must never truncate the run.

## RescueGroups daily poll — what runs today (ADR-0006, ADR-0009, ADR-0013, ADR-0033 as amended 2026-10-28)

The only live poller. Since ADR-0013 it runs every stage; the same path
is available one-shot as `npm run ingest -- poll [--max-pages N]`, and
`npm run ingest -- replay rescuegroups` re-enters at stage 2 over the corpus.

```
  worker boot (src/worker/index.ts)
       │
       ▼
  planIngestPoll(process.env)
       │
       ├─ INGEST_POLL_SCHEDULE=off ──► boss.unschedule("ingest.poll"), logged;
       │    the bridge polls instead (ADR-0033 as amended 2026-10-28) — the
       │    production setting until RescueGroups allowlists the droplet
       ├─ RESCUEGROUPS_API_KEY missing or blank ──► register:false + skipReason
       │                                             logged, never silent (ADR-0010)
       ▼
  boss.schedule("ingest.poll", "0 7 * * *")      ≤ once a day — the ToS asks
       │                                          for a weekly-minimum refresh
       │  daily tick
       ▼
  runIngest(adapter, createPgStages(db, [rescueGroupsNormalizer]))
       │
       ▼
  createRescueGroupsAdapter({apiKey}).fetch()            RescueGroups v5
       │                                                 ┌──────────────────┐
       │  POST …/animals/search/available/?limit&page    │ JSON:API          │
       │  Authorization: <key>                           │ data[]   animals  │
       │  body {"data":{"filters":[]}}  ─────────────────► included[] orgs,  │
       │  ◄────────────────────────────────────────────── │  breeds, statuses │
       │  loop page = 1..meta.pages                       │  (unordered set)  │
       │                                                 └────────▲─────────┘
       │  until the allowlist the droplet is refused, so          │ ADR-0033
       │  scripts/poll-via-bridge.sh (nightly: poll-nightly.sh at │
       │  07:00 UTC from home, the whole run up to 3 times,       │
       │  ADR-0033 as amended 2026-10-30) runs this CLI on the    │
       │  droplet via bridge-poll-droplet.sh,                     │
       │  with HTTPS_PROXY → ssh -R → scripts/rg-proxy.ts at home ┘
       │  (CONNECT api.rescuegroups.org:443 only); the database
       │  connection stays droplet → Postgres
       ▼
  per animal:
    sidecarFor(animal, included)   pick this animal's refs, SORT by (type,id)
                                   — unsorted, ~20% of re-polls hash as changed
    contentHashOf({animal, included})
    yield Observation {source:"rescuegroups", externalId, payload,
                       fetchedAt, contentHash}
       │
       ▼
  RawStore.persist ──► raw_payloads   (insert | last_seen touch)
       │
       ▼
  rescueGroupsNormalizer   thin claims: name, species, breed, status, sex,
       │                   ageGroup, birthDate, isBirthDateExact, org handle
       │                   — never prose or photos; every field retractable
       ▼                   on ToS termination
  stage 3 → stage 4 → stage 5   (see the pipeline diagram above)
       │               animals + animal_identities + event_log
       │               worker: {complete: true}; CLI: complete only
       │               without --max-pages
       │
       ◆ disappearance gate: does today's loss make sense?   (ADR-0014 am.
       │   ≥100 gone at > 5%/day since the last complete run   2026-09-30)
       ├── no ──► nothing marked gone; gateAlert(report) →
       │          Sentry.captureMessage(level error, gate: disappearance) —
       │          a person looks today, the job still succeeds (a retry
       │          re-fetches the same feed)
       │ yes
       ▼
  RunStore.record → ingest_runs   (complete only if stage 5 ran)
       │
       ▼
  IngestRunReport → worker log  {event:"ingest.run.completed", …counts}
                    CLI: stdout counts; exit 2 when a run asked to be
                    complete was not — incompleteRun(report) — so the
                    bridge pings the heartbeat /fail, never success
```

Smoke 2026-08-21 (2 pages, 200 animals): first run 200 `animal.seen`;
re-poll 200 deduped, 0 events; replay 0 events, 0 failures.

Purge path (ADR-0006 as amended): on ToS termination every row with
`source='rescuegroups'` is set-deletable — the first of the two carve-outs
from append-only.

## Consented scrape — vault before observe (ADR-0006 as amended, ADR-0011)

The scrape path is how the pipeline proves itself end-to-end without external
approval. No shelter is in the registry yet (roadmap item 5), so this flow is
built and tested but has no live source.

```
  shelter page fetch                                       gate 1: scrape
       │  html, url, fetchedAt                             hasGrant(shelter,"scrape")
       ▼                                                   must be active
  vaultThenObserve(vault, {source:"scrape:<slug>", ...})
       │
       │ 1. vault.put(slug, html)         R2  monsterpaws-corpus  (ADR-0011)
       │      key = htmlKey(slug, html)   ┌────────────────────────────────┐
       │     html/<slug>/<sha>.html  ────►│ content-addressed, slug-sharded │
       │          prefix = slug so        │ worker key: corpus+media only   │
       │          revocation deletes      └────────────────────────────────┘
       │          one prefix
       │ 2. payload = {url, vaultKey}     DB stores the KEY, never the HTML
       │ 3. contentHashOf(payload)
       ▼
  Observation<ScrapedPage> ──► RawStore.persist ──► raw_payloads
                                                         │
                                                         ▼
                                         stage 2: LLM extractor reads
                                         vault.get(vaultKey), never the
                                         live site — a prompt bug is fixed
                                         by replay        (planned, phase 5)
```

The ordering is the invariant: fetch → vault → hash → raw row. HTML that
reaches the corpus without reaching R2 first leaves a raw row pointing at a
key that was never written, and replay can no longer repair it.

Purge path: revocation of the scrape grant deletes the `html/<slug>/` prefix in R2
and the `source='scrape:<slug>'` rows — the second carve-out.

## Trust-hierarchy merge — one field at a time (ADR-0006 as amended, ADR-0009)

Per field, never per row. Each `Claim` carries `{value, source, fetchedAt}`;
tier and rank are derived on read from `source` and never stored, so the
hierarchy can be reordered without rewriting history.

```
  claims for ONE field, from N observations
       │
       ▼
  resolveClaims(claims)  =  fold with resolveClaim(winner, next)
       │
       │   resolveClaim(a, b):
       │     tierOf(source) ──► rankOf(tier)         TIERS (ordered, ADR-0006):
       │                                             shelter-api
       │     rank differs?  → lower rank wins          first-party-scrape
       │     same rank?     → later fetchedAt wins     aggregator
       │     same instant?  → later rawId wins           manual
       │     same row?      → first argument wins
       │                      (call as (incoming, current) so a fresh
       │                       derivation of one row repairs on replay)
       ▼
  winning Claim → animals.<field>  + provenance {source, fetchedAt, rawId}
                  written whenever the winning claim changed — value OR
                  provenance — so a same-value higher tier takes the field

  mergeClaims (src/core/ingest/merge.ts) — the one kernel both writers call:
    incoming.value == null   → skipped: never wins, never stamps provenance
    crossTier(incoming, current) AND values differ
                             → counted in IngestRunReport.conflicted
                               (either direction; staleness within a tier
                                is not a conflict, or replay would count
                                every superseded row)
```

The null rule closes the phase-7 carry-in from `96f1ddf`: a fresher same-tier
`null` no longer erases a real value. `resolveClaim` itself still compares
whatever it is handed — the skip lives in the writer.

## Consent grants — three gates, three outputs (ADR-0006 as amended, ADR-0004)

A shelter's consent is three separate grants, each a record (granter, date,
basis, evidence), each gating a different output. Storing verbatim and
displaying verbatim are different permissions.

```
  src/core/shelters.ts  SHELTERS[slug].grants[]   {permission, granter,
                                                  grantedAt, revokedAt?, basis}
       │
       │  hasGrant(shelter, permission, asOf) — unknown shelter, unlisted
       │  permission and revoked grant all read as false
       ▼
  ┌───────────┐     ┌──────────────────────────────────────────────┐
  │ "scrape"  ├────►│ fetch + vault their pages  (R2 corpus)        │
  └───────────┘     │ raw_payloads rows  source='scrape:<slug>'     │
                    │ facts may render on pages in OUR words        │
                    └──────────────────────────────────────────────┘
  ┌───────────┐     ┌──────────────────────────────────────────────┐
  │ "display" ├────►│ render THEIR description prose + photos       │
  └───────────┘     │ on animal pages, via pickLicensedDisplay      │
                    └──────────────────────────────────────────────┘
  ┌───────────┐     ┌──────────────────────────────────────────────┐
  │ "digify"  ├────►│ photo → ComfyUI on the home GPU → monster art │
  └───────────┘     │ credited "Permission to digify <pet> given by │
                    │ <shelter>"  (planned, item 4; § Keepsake art) │
                    └──────────────────────────────────────────────┘

  revoke "display" → pages fall back to facts + our words; purgeDisplay
                     (src/core/purge.ts) deletes that source's animal_display
                     rows once the revocation is committed; corpus untouched
  revoke "digify"  → no new art; existing cards keep their credit line
```

Revocation terms — the part of this flow not yet built:

```
  (planned, ADR-0006 as amended 2026-09-28 — the ADR's contract, not yet code)
  every revocation commits onEnd {corpus, keepsakes, evidence} first;
  the purge reads it
  revoke "scrape"  → onEnd.corpus = "purge": purgeSource deletes prefix +
                     rows + events, rebuilds survivors from scratch;
                     "retain": corpus stays. Downstream grants moot either way
```

The registry is checked in and empty until item 5; the commit that adds a
grant is the record, with evidence under `doc/consent/`.

## Animal page render — facts, display layer, visibility (ADR-0015, ADR-0018)

Both routes are built. Pages read Postgres directly from Server Components;
nothing here touches `raw_payloads`.

```
  request /animals/[id]                ISR, revalidate 1h
       │
       ▼
  loadAnimalDetail(db, id, asOf)       composes visibleAnimalById — a page that
       │                               assembles its own predicate is the bug
       ▼
  visibleAnimals(db).where(id)         ONE predicate, every page. All three
       │                               conditions on the SAME identity row:
       │                               status = 'available'
       │                               AND an identity with disappeared_at IS NULL
       │                               AND its last_seen_at > now() - 8 days
       │                               AND its source_updated_at > now() - 24 mo
       ├─ none ──► 404                 (never a stale card)
       ▼
  animals row  (facts + provenance)    name, species, breed, sex, ageGroup,
       │                               birthDate/isBirthDateExact, location
       │                               + live animal_identities (disappeared
       │                               ones dropped: a source that stopped
       │                               listing is not evidence of a sighting)
       ▼
  animal_display rows for the animal, one per source   (DERIVED, purgeable:
       │                               purgeDisplay(source) once its license ends)
       │                               photos = [{url, width, height}] — sizes
       │                               are the source's own, never computed
       │
       │   pick the LICENSED row, or none:
       │     source = 'rescuegroups'   → aggregator-display  (held by the key,
       │                                 ADR-0006 as amended 2026-08-25)
       │     source = 'scrape:<slug>'  → hasGrant(shelter, "display")
       │     else                      → facts + our own words, no photo
       ▼
  render                               src/app/animals/[id]/page.tsx
    photos      AnimalGallery (detail's one client island, ADR-0015 as amended):
                frame takes the photo's OWN ratio from animal_display.photos
                {url,width,height} → whole photo, no crop, no bars, no jump;
                thumbnails swap the hero. AnimalPhoto is a plain <img>, never
                next/image, whose loader copies the file onto our server
    description verbatim, as a quotation; decodeEntities then tidyWhitespace,
                in that order (ADR-0018 as amended: 72% are entity-encoded,
                none carry tags, and the blank lines ARE decoded &nbsp;)
    tracker     TrackerPixel <img src=tracker_url> — driven by the RG display
                row itself, never by whichever row won display precedence
                (a shelter's own row outranking RG must not drop the pixel)
    footer      "last updated <last_seen_at>" · listing org linked by name to
                animals.org_url, plus animals.listing_url when the source
                publishes the animal's own page (ADR-0015 as amended) — both
                claims, never assembled: a built URL points at the wrong
                shelter and calls it attribution
                "listed <listed_at>" — the source's date, never created_at
                "Not affiliated — claim or remove your listings"
                unverified: "your donation goes to <org>"; no update promise
```

Browse (`/animals`) is the same predicate, one page at a time.

```
  request /animals?species=&state=&age=     rendered PER REQUEST — filters and
           &sex=&zip=&miles=&shelter=&after=
       │                                    the cursor are search params, so
       │                                    there is no URL set to revalidate
       │                                    (ADR-0015 as amended). Fresher than
       │                                    detail's hour, never staler
       ▼
  scope (ADR-0015 as amended 2026-10-26)    ?shelter= → loadShelter (null when
       │                                    it lists no visible animal); ?zip= →
       │                                    zipPoint (src/core/geo.ts, Census
       │                                    ZCTA; a PO-Box zip by its sectional
       │                                    center) → zipsWithin(miles) over
       │                                    loadShelterZips: a BrowseScope that
       │                                    narrows the grid, the page and the
       │                                    random pick alike. An unplaceable
       │                                    zip limits nothing and says so
       ▼
  loadFacetGrid(db, asOf, scope)            one aggregate over the VISIBLE set:
       │                                    (species, state, age, sex, count),
       │                                    1,553 cells on the 63k corpus
       ▼
  facetOptions(grid, filters)               src/core/facets.ts, database-free so
       │                                    the filter island runs it too. The
       │                                    menus ARE the corpus's values —
       │                                    never a hardcoded species list, and
       │                                    states must match ^[A-Z]{2}$ (replay
       │                                    cannot retract the junk `T` state).
       │                                    Each menu counted under the OTHER
       │                                    menus' selections, so a count is a
       │                                    promise about the page it opens
       ▼
  filtersFrom(searchParams, grid)           a value the corpus does not hold is
       │                                    DROPPED, never queried: silently
       │                                    ignored shows animals nobody asked
       │                                    for; silently applied empties a page
       ▼
  loadBrowsePage(db, filters, cursor, asOf, exclusions, sort, scope)
       │                                    "Surprise me" → GET /animals/random:
       │                                    pickRandomAnimalId, same matchingParts
       │                                    and scope,
       │                                    uniform random() → 307 to /animals/<id>
       │
       ├─ visibleAnimals(asOf)              THE predicate — the same one detail
       │                                    composes, never a copy
       ├─ not exists BROWSE_EXCLUSIONS      six hand-checked non-animal listings
       │                                    keyed by (source, external_id), never
       │                                    by animals.id, which a canonical
       │                                    rebuild reassigns. BESIDE visibility,
       │                                    so /animals/[id] still resolves.
       │                                    Interim only — ADR-0021 item 7b
       ├─ species / state / age / sex = $   the menus (ADR-0015 decision 5, as
       │                                    amended 2026-10-26; no breed menu)
       ├─ shelter = $ / left(zip,5) in (…)  the scope; an empty zip list is an
       │                                    empty page, never the whole country
       ├─ sort = parseSort(?sort)           newest (default) | longest — ADR-0015
       │                                    as amended 2026-10-05; newest also
       │                                    requires listed_at, which desc would
       │                                    otherwise put first when null
       ├─ (listed_at, id) >|< (cursor)      keyset, forward only: an offset window
       │                                    shifts as animals are adopted out and
       │                                    silently skips whoever crosses a page
       │                                    boundary. `id` is the tiebreaker the
       │                                    backfill's shared timestamps need
       ▼
  order by listed_at desc, id desc          newest first by default; asc, asc for
       │                                    longest waiting — both the source's
  limit 24 + 3                              date, never created_at, and never
       │                                    anything resembling desirability
       │                                    (bright line 1). The extra rows say
       │                                    "there is more" without a count, and
       │                                    name the teaser under Next
       ▼
  loadCardDisplay(db, ids, asOf)            pickLicensedDisplay per animal — the
       │                                    same picker as detail; an unlicensed
       │                                    row means a card with no photo
       ▼
  render                                    src/app/animals/page.tsx
    cards       AnimalCard (src/ui/animal.tsx, rendered by /design too):
                photo contained in a fixed 4:3 frame — a grid needs one card
                height, and the alternative to ground around a photo is the crop
                that cut a dog's head off on detail
    filters     BrowseFilterForm (src/ui/browse-filters.tsx), browse's one
                client island (ADR-0015 as amended 2026-10-04, 2026-10-26): the
                server hands it the grid, each pick re-runs facetOptions so the
                other menus recount, and with JS a change applies itself 400 ms
                later as one history entry (Back undoes it), the list dimmed
                while it loads. Without JS it is the plain GET form and "Show
                me". Every URL comes from browseSearch, and none carries
                `after`: a new filter starts at the first animal
    shelter     a chip naming it, its ✕ leaving the view; detail links "See all
                N animals from <org>" when the shelter lists more than one
    paging      "← Previous 24" / "Next 24 animals →" (ADR-0015 as amended
                2026-10-05): ?before= walks the same keyset backward, and each
                button shows only when a row really lies that way — probed,
                never assumed from the URL. Still no page number and no total,
                so nothing on the page can imply scarcity. Under Next:
                waitingTeaser(nextNames) — "LUCHA, IVORY, and BOBA are
                waiting…", the next page's first names, never a count
    no pixel    the Pet Adoption Tracker is owed on every pet DETAIL page
                (ADR-0006 decision 2); one per card would report 24 views of
                animals nobody opened
```

## Animal story — the donor feed is a projection, never the ledger (ADR-0020)

Planned: the boundary is decided; the table lands with roadmap item 6 and the
first projector with item 4. Nothing donor-facing reads `event_log`.

```
  PERMANENT TRUTH                        DISPOSABLE INTERPRETATION   (planned, items 4/6)
  ───────────────                        ─────────────────────────
  event_log                              animal_story  (planned, item 6)
    animal.updated ──┐                     derived: rebuilt from scratch by the
    animal.reappeared│                     projector; ids unstable, never
    animal.disappeared                     referenced from outside
     (only past the stage-5                     ▲
      disappearance gate,                       │
      ADR-0014 am.)  │                          │
    animal.seen      │                          │
                     │                          │ only writer
  attestations ──────┤                   projectStory()  (planned, item 4/6)
  (planned, item 7)  │                     │  newsworthiness list: status → news;
                     │                     │  orgUrl / listingUrl / postalCode /
                     └────────────────────►│  listedAt → nothing. A field missing
                                           │  from the list fails the build.
                                           │
                                           │  tier by EVIDENCE, name persisted:
                                           │    attestation row  → 'attested'
                                           │    shelter-api row  → 'reported'
                                           │    aggregator row   → 'observed'
                                           │
                                           │  forbidden: animal.disappeared → an
                                           │  outcome. "Went home" is a shelter's
                                           │  sentence, never an absence's.
                                           ▼
                            readers, all above the line:
                              card timeline      (planned, item 4)
                              update generator   (planned, item 8) — elaborates
                                                  within a tier, never up it;
                                                  faithfulness eval joins
                                                  animal_story → evidence
                              notifications      (planned, item 11) — reference
                                                  the evidence, not the story id
```

Why the line is where it is: on 2026-09-04 a replay backfilling two new merged
fields wrote 62,729 true, permanent `animal.updated` rows about nothing that
happened to an animal. The ledger was right; it was only ever wrong as a feed.

## Donate → webhook → keepsake — tied back by our own id (ADR-0027)

Planned: roadmap item 4, `doc/plans/adr-0027-accounts-build-plan.md`. The
tables are built (`drizzle/0011`); every stage is not. No wall stands before
the gift: the account comes after it, if at all.

```
  animal page, donate click         (planned, phase 3)
       │  mints donation_intents row: 128-bit id, (source, external_id),
       │  nonprofit slug + EIN from shelter_nonprofits — no row, no button
       │  intent id → httpOnly cookie on this browser
       ▼
  every.org donate link             partner_donation_id = intent id,
       │                            webhook_token (EVERYORG_WEBHOOK_TOKEN)
       │  ── Every.org boundary: the money and the receipt are theirs ──
       ▼
  POST /api/webhooks/everyorg/<secret>   (planned, phase 4) unsigned
       │  staging: staging-hooks.monsterpaws.org → tunnel → monsterpaws-dev
       ▼
  everyorg_webhook_payloads         body as text + headers, stored before
       │                            anything is believed (append-only)
       │  match partnerDonationId → open intent, slug + EIN exact;
       │  anything else kept and logged, never acted on
       ▼
  one transaction                   (planned, phases 4–5)
       │  donations row (charge_id unique: a replay inserts nothing)
       │  donation_stats row, only when the insert happened — no donor in it
       │  donation_intents.closed_at
       │  snapshotKeepsake() → keepsake + keepsake_fact   (§ Keepsake snapshot)
       │  boss.send('art.generate')   when the shelter granted digify
       ▼
  thank-you page                    (planned, phase 5) the cookie holds the
       │                            keepsake for this browser; keep it in an
       │                            account: email → sign_in_links → passkey
       ▼
  claim                             donation_intents.account_id set; from
                                    here the account owns it all

  account deleted  → export offered first; then keepsake art in R2, facts,
                     keepsake, donations, payloads naming the donor, intents,
                     links, sessions, passkeys, the account; the address off
                     Resend's list. donation_stats and email_suppressions
                     (an HMAC, no address) stay (ADR-0027 as amended 2026-10-22)
```

## Keepsake snapshot — held on its own basis, never a view of the listing (ADR-0022)

Planned: roadmap item 4. The card reads the keepsake alone; the listing side
may be purged, rebuilt or merged without touching it.

```
  donation completes (Every.org)             (planned, item 4)
       │
       ▼
  snapshotKeepsake()  (planned, item 4)      the ONE writer — every field
       │                                     must name its basis or it is
       │  reads, once, at donation time:     not written
       │    animals + licensed animal_display row + the shelter registry
       ▼
  keepsake            (built, writer planned) basis = donation, through its
       │                                     donation: amount, date, nonprofit
       │                                     append-only, never UPDATEd
       ▼
  keepsake_fact       (built, writer planned) (keepsake_id, field, value,
       │                                      basis, snapshotted_at)
       │   basis = grant:<slug>:<permission> → kept per the grant's onEnd
       │   basis = aggregator:<source>       → purged with the source
       │   one basis per field; the most durable available wins
       ▼
  donor collection card                      never joins animals /
                                             animal_display to render

  aggregator license ends  →  DELETE keepsake_fact WHERE basis =
                              'aggregator:rescuegroups'  (set delete)
                              card degrades to its donation half:
                              "A sponsorship at <shelter> · <date> · $<n>"
```

## Keepsake art — generated on hardware we control, arriving when ready (ADR-0004 as amended 2026-10-05, ADR-0026)

Planned: roadmap item 4 (pipeline v0), item 9 (the LoRA). The photo never
leaves a machine we control; the job waits for the box, never the other way
round. Both workers are the same binary — the droplet's never registers
`art.generate`, the home's registers nothing else.

```
  snapshotKeepsake()  (planned, item 4)         keepsake_fact rows written,
       │                                        basis = grant:<slug>:digify
       │  boss.send('art.generate', {keepsakeId})
       ▼
  pg-boss queue  art.generate                   DO Managed Postgres
       │                                        ── droplet boundary ──
       │  SSH tunnel droplet → PG (the droplet is the trusted source;
       │  the house opens no port — outbound only)
       ▼                                        ── home boundary ──
  src/worker/index.ts, art.generate only        (planned) the worker
       │                                        container, prod WSL distro
       │                                        under the "monsterpaws"
       │                                        Windows user
       ▼
  subject detection, CPU  (planned, ADR-0026)   experiment: comfyui/detect.py
       │   OWLv2 asked for the listing's        (19/20 blind). Every box past
       │   species, colour, head → SAM 2.1      the floors outlined; groups,
       │   outlines → clean-up rules → six      duplicates, parts dropped.
       │   votes → ALWAYS one animal chosen,    Never the framed photo for an
       │   margin recorded; under 0.1 a second  unclear subject (Logan,
       │   look on crops · head box inside it   2026-10-12)
       │
       │  POST /prompt  (localhost HTTP)
       ▼
  monster-paws-comfyui, headless, TORCH=xpu     (planned) CI-built. Built:
       │   subject box at its aspect + head     comfyui/workflows/*.api.json,
       │   (the companion animal stays          comfyui/models.manifest (hash
       │   outside, never padded)               + licence), models.py fetch at
       │   description from the listing's       start — mismatch = no serve.
       │   fields through a reviewed table      Crops by the detector (ADR-0026):
       │   (sex, colour, breed, age, species)   comfyui/explore/boxes-detected.json.
       │   painter: FLUX.2 klein 4B (BFL fp8)   comfyui/workflows/klein-v1.api.json
       │   reading the grown subject and head   (ADR-0004 as amended 2026-10-14,
       │   crops as references · landscape      2026-10-15). klein only, no
       │   canvas · a tripod stands · 4 cands   fallback painter
       ▼
  signature out  (planned, item 4)              experiment: comfyui/signature.py,
       │   ink on the paper outside the dog's   LaMa on CPU (batches 9a–9c)
       │   outline, bottom right → LaMa
       ▼
  judge v0, silent  (planned, item 9)           scores + choice stored with
       │   all four go on; nothing gated        the judge's version, never
       │   or regenerated on its word           shown (ADR-0004 as amended
       │                                        2026-10-14); donors' face
       │                                        picks are its labelled set
       ▼
  R2 monsterpaws-media  (write-only pair)       keys only in the DB
       │
       ▼
  keepsake_fact  field='art' ×4  basis=grant:<slug>:digify   (append)
       │
       ▼
  "<pet>'s portraits are ready"  (planned)      the card's second reveal —
       │                                        the framed photo was the
       │                                        first (ADR-0006 decision 5)
       ▼
  donor picks the card's face  (planned)        a new row per change, never
       │                                        an UPDATE; until then, the
       │                                        first in generation order
       ▼
  keepsake_fact  field='face'  (append)         one set per keepsake, never
                                                a re-roll (bright line 3)

  box asleep / down      → the job waits; no Replicate fallback by default
                           (it would re-open the §2 disclosure)
  anatomy LoRA training  → a rented DigitalOcean GPU per job
                           (scripts/gpu-rental.sh train), on pairs of
                           Commons dogs only (comfyui/pairs.py), never a
                           shelter photo; the .safetensors comes home
```

## Error reporting — the SDK is Sentry's, the service is a DSN (ADR-0010)

Built 2026-09-30 except where marked. Nothing reports without a DSN, so dev
and CI's e2e send nothing.

```
  browser                          app server (Next)          worker (tsx)
  instrumentation-client.ts        instrumentation.ts         src/worker/index.ts
   stub: queue window errors        Sentry.init at register    Sentry.init first
   ─ load + idle, or 1st error ─►   ContextLines OFF — Better  ContextLines ON (real
   import("@sentry/nextjs")         Stack skips any frame that  TS source, no maps)
   (never static: ~57 KB gz)        carries source lines        poll failure → event,
   init, replay the queue          onRequestError →            attempt n/3 tagged;
        │                            captureRequestError        disappearance gate
        │                                 │                     refused → error event
        │                                 │                     heartbeatPing():
        │                                 │                     success → URL
        │                                 │                     final fail → /fail
        ▼                                 ▼                          │        │
  reportingOptions() — one settings object: tracing 0, no PII,       │        │
  release = build sha, tags.component   (src/core/observability.ts)  │        │
        │                                 │                          │        │
        └──────── envelope ───────────────┴──────────────────────────┘        │
                          ▼                                                   ▼
            Better Stack Errors  app `monsterpaws`          heartbeat 499765 (armed
            resolves frames by debug ID ◄─┐                  by oplog 0010)
                                          │
  CI: images ─ Docker build stamps debug IDs offline (scripts/sourcemaps.sh inject)
      └─ --target sourcemaps export ─► sourcemaps job: upload, retry ≤ 6 until
                                       processed — /deploy's gate for the sha
```

## Listing assessment — a verdict beside visibility, never inside it (ADR-0021)

Planned: roadmap item 7b. Derived data like `embeddings`; gates browse only.

```
  animals + animal_display          the fields the PAGE shows — never the raw   (planned, 7b)
       │                            payload, so the judge sees nothing a reader
       ▼                            could not
  assessListings()   (planned, 7b)  Batch API, cached instruction prefix,
       │                            structured output; model + prompt_version
       │                            stamped on every row
       ▼
  animal_assessments                (animal_id, model, prompt_version) →
       │                              is_individual_animal   ← the only gate
       │                              name_reads_as_name     ← gates NOTHING
       │                              confidence, reason, assessed_at
       │                            rebuildable; a new prompt version rewrites
       │                            every row in one run
       ▼
  browse / feeds                    where(visibleAnimals() AND notJunk())
                                    notJunk = no verdict, low confidence, or
                                    stale prompt version → SHOWN; only a
                                    confident false hides. Composed, never
                                    folded into visibleAnimals —
  detail /animals/[id]              reads visibleAnimals() ONLY: a false
                                    positive is "not discoverable," never a
                                    404 on the link the shelter shared

  eval (planned, 7b)                ~200 hand-labelled listings, head-of-sort
                                    AND random; the gate turns on when recall
                                    on REAL animals clears the bar, not when
                                    junk-catch does
```

## Shelter outreach — our own listings, their own site, one guarded door (ADR-0029)

Built 2026-10-27 (`doc/plans/adr-0029-outreach-build-plan.md`), driven by
hand through `npm run outreach`. Every fact about a shelter comes from what
we already display or from the shelter's own site; RescueGroups' contact
fields are never read. A message leaves only through `sendWave`, and a live
run needs a person at a terminal.

```
  animals                           loadOutreachShelters(): the organisations
       │                            with a visible animal, described by what
       │  visibleAnimals()          most of their visible animals carry — name,
       │  ↳ SHELTER_EXCLUSIONS      city, state, zip, website, count, the live
       │    applied INSIDE it       shelter-view link; never raw_payloads
       ▼
  selectWave()                      a named wave: 50 mi of 60614 or states,
       │                            ≤200, the already-approached dropped
       │
       ├──► match ──────────────────────────────────────────────────────────
       │     ensureBmf()            ── IRS boundary: eo_<state>.csv, public
       │          │                    domain, into var/irs/ (gitignored) ──
       │     matchEin()             Dice over the name, city and filing codes
       │          │                 as nudges; a person picks the row
       │     nonprofitByEin()       ── Every.org boundary: EVERYORG_API_KEY;
       │          │                    a 404 is a normal null ──
       │     recordShelterNonprofit()
       │          ▼
       │     shelter_nonprofits     everyorg_slug, ein, everyorg_claim read
       │                            from hasAdmin — claimed | unclaimed |
       │                            unknown, never a boolean
       │
       ├──► find-emails ────────────────────────────────────────────────────
       │     findAddresses()        ── the shelter's site: robots.txt kept,
       │          │  politeFetcher()   1 req/s, MonsterPawsBot named ──
       │     recordAddressCandidates()
       │          ▼
       │     shelter_contacts       every address a CANDIDATE with its
       │          │                 source_url; confirmAddress() by a person
       │          ▼                 sets confirmed_at — nothing else sends
       │
       ▼
  assembleWave()                    renderAsk() per shelter: claim line only
       │                            when not claimed, the hackathon clause as
       │                            an input with a date, no address on it
       ▼
  sendWave()                        one transaction per message under
       │  loadSendFacts()           pg_advisory_xact_lock: judgeSend() reads
       │  judgeSend()               outreach_events + shelter_contacts —
       │                            ≤40 / rolling 24 h · ≥60 s apart · one per
       │                            shelter per wave · follow-up ≥7 d after the
       │                            FIRST, never a third · confirmedAddress()
       │                            only · not excluded, opted out, answered
       │                            or bounced
       ├──► rehearseWave()          `send`: the same loop into Mailpit inside
       │                            a transaction rolled back — the record
       │                            judged as live, nothing kept
       │
       │    `send --live`:          gmailTransport() (GMAIL_USER + app
       │     liveSendGate()         password from pass), liveSendGate() on
       │     confirmLiveSend()      the previous wave (>5% bounced or a
       │                            complaint refuses; --override noted on
       │                            every send), the wave's name typed back
       ▼
  ── SMTP boundary: Mailpit (localhost:1025) or smtp.gmail.com as Logan ──
       │
       ▼
  recordOutreachEvent()             the `sent` row ONLY after the transport
       │                            returned a message_id; a throw stops the
       ▼                            wave with no row
  outreach_events                   append-only: sent | bounced | replied |
       │                            opted_out | granted, by shelter_external_id
       │                            and wave; `record` writes the replies
       │                            Logan reads in Gmail
       ▼
  waveHealth()                      `status`: per wave by kind, bounce and
                                    reply rates against its sends

  an opt-out  →  evidenceOf(.eml)   Message-ID + sha256 of the raw message;
                 SHELTER_EXCLUSIONS the entry in git, the .eml in the vault
                 (exclusionProblems) under consent/, the opted_out row here
                 (ADR-0029 as amended 2026-10-27)
```
