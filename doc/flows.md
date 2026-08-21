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

## Ingest pipeline — the four stages (ADR-0009)

Every source, scrape or API, enters through one `SourceAdapter` and runs the
same stage path. `runIngest` is the full run; `replay` re-enters at stage 2
over the retained corpus, with no source contact — the two share
`runDerivedStages`, and if they ever diverge replay stops proving anything
about production.

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
                               │ StoredObservation<P>  (+rawId)
                               ▼
   stage 2  ┌──────────────────────────────────┐
  normalize │ stages.normalizers.get(source)    │  per-source mapper; LLM
            │  .normalize(stored) → AnimalClaims│  extraction is a normalizer
            │  every field: {value, source,     │  like any other
            │                fetchedAt}         │  (planned: phases 5–6)
            └──────────────────┬───────────────┘
                               │ AnimalCandidate
                               ▼
   stage 3  ┌──────────────────────────────────┐
   resolve  │ EntityResolver.resolve(candidate) │  → animalId | null (new)
            │                                   │  (planned, phase 7)
            └──────────────────┬───────────────┘
                               ▼
   stage 4  ┌──────────────────────────────────┐
    write   │ CanonicalWriter.apply(cand, id)   │  animals   (DERIVED)
            │  resolveClaims per field          │  event_log (SACRED)
            │  emit animal.seen / .updated      │  idempotent: unchanged
            │  (.disappeared from absence only) │  observation emits nothing
            └──────────────────┬───────────────┘  (planned, phases 7–8)
                               ▼
            IngestRunReport {observed, persisted, deduped, normalized,
                             events, failures[stage]}  → health gates (phase 9)
```

A failure at any derived stage is recorded in `failures` with its stage and
the loop continues — one malformed payload must never truncate the run.

## RescueGroups daily poll — what runs today (ADR-0006, ADR-0009)

The only live poller. It is **stage 1 only** by construction: `runRawOnlyPoll`
never touches stages 2–4, so nothing reaches `event_log` until the merge
exists. The corpus it collects is what those stages replay over later.

```
  worker boot (src/worker/index.ts)
       │
       ▼
  planIngestPoll(process.env)
       │
       ├─ RESCUEGROUPS_API_KEY missing or blank ──► register:false + skipReason
       │                                             logged, never silent (ADR-0010)
       ▼
  boss.schedule("ingest.poll", "0 7 * * *")      ≤ once a day — the ToS asks
       │                                          for a weekly-minimum refresh
       │  daily tick
       ▼
  runRawOnlyPoll(adapter, createPgRawStore(db))
       │
       ▼
  createRescueGroupsAdapter({apiKey}).fetch()            RescueGroups v5
       │                                                 ┌──────────────────┐
       │  POST …/animals/search/available/?limit&page    │ JSON:API          │
       │  Authorization: <key>                           │ data[]   animals  │
       │  body {"data":{"filters":[]}}  ─────────────────► included[] orgs,  │
       │  ◄────────────────────────────────────────────── │  breeds, statuses │
       │  loop page = 1..meta.pages                       │  (unordered set)  │
       ▼                                                 └──────────────────┘
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
  RawPollReport {observed, persisted, deduped}  → worker log
       ║
       ╳  stops here. No normalize, no resolve, no event rows.
          rescueGroupsNormalizer exists (thin claims: name, species, breed,
          status, sex, ageGroup, birthDate, isBirthDateExact, org handle —
          never prose or photos, every field retractable on ToS termination)
          but is wired only in tests until phases 6–8.
```

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
       │     exact tie?     → first argument wins        manual
       │                      (call as (incoming, current) so a fresh
       │                       derivation wins and replay can repair)
       ▼
  winning Claim → animals.<field>  + provenance {source, fetchedAt}
```

Carry-in pinned 2026-08-18 for phase 7 (`96f1ddf`): a fresher same-tier
`null` claim currently wins on recency and would erase a real value. The merge
slice decides the rule and its adversarial pass must cover it; today
`resolveClaim` compares whatever it is handed.

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
  └───────────┘     │ on animal pages           (planned, item 3)   │
                    └──────────────────────────────────────────────┘
  ┌───────────┐     ┌──────────────────────────────────────────────┐
  │ "digify"  ├────►│ photo → third-party AI → monster art          │
  └───────────┘     │ credited "Permission to digify <pet> given by │
                    │ <shelter>"                (planned, item 4)   │
                    └──────────────────────────────────────────────┘

  revoke "scrape"  → purge prefix + rows (carve-out 2), downstream grants moot
  revoke "display" → pages fall back to facts + our words; corpus untouched
  revoke "digify"  → no new art; existing cards keep their credit line
```

The registry is checked in and empty until item 5; the commit that adds a
grant is the record, with evidence under `doc/consent/`.
