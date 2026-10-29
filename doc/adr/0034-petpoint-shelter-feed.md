# ADR-0034: PetPoint is the first Tier 1 source — one shelter's key, one source each, read only after it says yes

Status: proposed (2026-10-29). Nothing is built, and nothing will be unless Cherryland's answer calls for it (Logan, 2026-10-29).
Amends ADR-0006 (a fourth permission, per-shelter `petango` identity) and
applies ADR-0009's contract to its first `shelter-api` adapter.

## Context
Cherryland Humane Society (Traverse City, MI; EIN 38-1603061, a 501(c)(3);
Every.org profile unclaimed, read 2026-10-29) came to us through a contact
of Logan's. None of its animals are on the site. It does not export to
RescueGroups. Its site loads them from
`ws.petango.com/webservices/adoptablesearch/wsAdoptableAnimals2.aspx`,
PetPoint's adoptable-search iframe (page source read 2026-10-29). ADR-0029
builds every wave from our own listings, so the outreach tool has nothing to
send them.

ADR-0006 Decision 1 already names "shelter-issued keys — Shelterluv,
Petango/PetPoint" as Tier 1, and `src/core/sources.ts` gives `petango` the
`shelter-api` tier. No adapter exists, and `raw_payloads` holds no
`petango` row.

What PetPoint offers (read 2026-10-29):
- **The web service.** `ws.petango.com/webservices/wsAdoption.asmx` is a
  SOAP service with three read-only operations: `AdoptableSearch` (species,
  sex, age group, location, site, on hold, order, breeds, special needs,
  good with dogs, cats or kids), `AdoptableSearchWithStage` (adds the stage)
  and `AdoptableDetails` (one `animalID`). The responses are untyped
  `XmlNode`s. Third-party code reports fields such as `AnimalName`,
  `Species`, `Sex`, `Age`, `Dsc`, `BehaviorResult` and `Photo1`–`Photo3`.
  We have not seen a real response.
- **The key belongs to the shelter.** Every call takes an `authkey`.
  PetPoint support turns web services on for a shelter, and the shelter
  finds its key under Admin > Admin Options > Setup > Online Animal Listing
  Options. There is no developer program, published terms or rate limit.
- **Cherryland's widget key is already public.** It is a parameter of the
  iframe URL on its own pages.
- **The service carries listings, nothing more.** It holds adoptable
  animals, not medical or care records. DIRECTION's read-only sidecar, care
  events diffed from the shelter's system, would need PetPoint's partner
  integration, like the one Shelter Animals Count uses for intake and
  outcome data.

Two things in the code would break on a per-shelter key:
- **Revocation.** `petango` is a fixed source, one identity for every
  PetPoint shelter. Revoking one shelter would mean
  `WHERE source = 'petango' AND <which shelter>`, the hunt the
  `scrape:<slug>` identity was built to avoid (ADR-0006 as amended
  2026-08-02 §4).
- **Disappearance.** Stage 5 writes `animal.disappeared` for every animal
  absent from a complete run of its source (ADR-0014). The rows are
  permanent in the append-only `event_log`, and each such animal drops out
  of browse. An absence is never an outcome (ADR-0020 §5). If one shelter's
  call failed while the others succeeded, every animal of that shelter
  would get a wrong `animal.disappeared`.

## Decision
1. **PetPoint's adoptable web service is the first Tier 1 adapter.**
   `createPetPointAdapter({ slug, authkey })` implements `SourceAdapter`.
   For each species, `AdoptableSearch` returns the ids, and
   `AdoptableDetails` returns each animal's observation. The adapter runs
   sequentially, one request at a time, once a day, as its own run on the
   droplet (`ingest poll --source petango:<slug>`), never inside the
   bridge's RescueGroups poll. The bridge sets `NODE_USE_ENV_PROXY=1` and
   points `HTTPS_PROXY` at `scripts/rg-proxy.ts`, which refuses every host
   but `api.rescuegroups.org` (ADR-0033 §2), so every PetPoint call made
   inside that process would fail. The payload is the response's XML text, stored
   verbatim inside the JSONB, and `contentHash` is taken over that text.
   Parsing happens in the normalizer, so a parser fix replays over the
   corpus (ADR-0009 §1). Reading XML needs a parser, a new dependency
   (`fast-xml-parser`, pinned), which this ADR records.

2. **A key is used only after the shelter grants it, never because we found
   it.** A key in a public widget URL was issued to the shelter for its own
   site. Calling the service with it unasked is scraping on someone else's
   credential, and we never do it, even once to look. The shelter gives or
   confirms the key in writing, and that message is the grant's evidence.
   The key lives in `pass` as `petpoint/<slug>-authkey`. `env:dev` writes it
   to `PETPOINT_AUTHKEY_<SLUG>` (the slug in upper snake case), and the
   production `.env` carries it the same way. A shelter that rotates its
   key ends our access, and that counts as an answer.

3. **Every PetPoint shelter is its own source, `petango:<slug>`.**
   - `petango` leaves `FIXED_SOURCES`. `PetangoSource` joins `ScrapeSource`
     as a per-shelter template, using the registry slug's grammar, and
     `tierOf` maps it to `shelter-api`. No row has ever been written under
     `petango` (checked 2026-10-29), so nothing migrates.
   - Revocation becomes one set operation (`purgeSource`, ADR-0006 as
     amended 2026-09-28).
   - A complete run, and so stage 5, is per shelter: one shelter's failure
     never writes `animal.disappeared` for another shelter's animals.
   - Shelterluv (item 6) takes the same shape when it is built. This ADR
     does not change it.

4. **Reading a shelter's system is a fourth permission, `api`.**
   - `PERMISSIONS` becomes `scrape`, `display`, `digify`, `api`. The `api`
     grant permits calling the shelter's own software with the key it gave
     us. A shelter may allow that and not allow crawling, or the other way
     round, so the two stay separate (ADR-0006 as amended 2026-08-02 §4).
   - The other grants keep their meaning. Under `api` alone, a page shows
     the facts and our own words. `display` licenses the shelter's prose and
     photos. `digify` licenses the painting (ADR-0006 Decisions 5–6). The
     ask requests all three.
   - The poll reads only shelters with an active `api` grant
     (`hasGrant(shelter, "api", now)`), so an expired grant stops the next
     poll.
   - `ShelterEntry` gains a `feed: { platform: "petpoint" }` field that
     names the system.

5. **Photos are URLs, never bytes.** `Photo1`–`Photo3` are stored as URLs
   and hotlinked under the `display` grant, the way RescueGroups photos are
   (ADR-0006 as amended 2026-08-25 §1). The art pipeline fetches a photo
   only under `digify`, as ADR-0004 already does. A description counts as
   display content, not as a fact, and never enters trust resolution.

6. **One feed per shelter until cross-source merge ships.** Stage 3
   matches only an exact `(source, externalId)` (ADR-0013). A shelter whose
   animals came through both RescueGroups and PetPoint would show every
   animal twice. If a PetPoint shelter also exports to RescueGroups, its
   RescueGroups org is held out of the poll when its feed starts, and the
   held-out org is recorded in the registry entry. Item 10 lifts this rule.

7. **No normalizer ships before a real response.** Field names are known
   only from other people's code. The golden fixture comes from the first
   granted response. Logan hand-checks it, its provenance is written down
   (CLAUDE.md), and the shelter's own personal data in it is blanked.
   Health gates follow ADR-0009:
   - A SOAP fault or an authentication error ingests nothing and marks the
     run incomplete.
   - Every observation must carry a name, a species and an id.
   - **An empty search from a shelter that had animals marks the run
     incomplete**, so stage 5 does not run. The stage-5 disappearance gate
     cannot catch this case. Under `DISAPPEARANCE_GATE_FLOOR` (100) it
     never refuses (ADR-0014 as amended 2026-09-30), so a 40-animal shelter
     whose key stopped working would get 40 wrong, permanent
     `animal.disappeared` rows, and every one of its animals would drop out
     of browse. The floor is right for a feed this small, where one real
     disappearance is a large share, so the empty-feed check lives in the
     adapter's run, not in the gate.
   - **A partial answer is the same harm, and is not yet closed.** A short
     SOAP body, or a page or result cap we never noticed, could return 12
     of 40, writing 28 wrong `animal.disappeared` rows that nothing under
     the floor refuses. If the response carries a total, a returned count
     below it marks the run incomplete. Whether it carries one is unknown
     until the first real response. Checking that is part of the fixture
     work above, and until it is answered the gap is open, recorded here.

9. **A feed's run counts toward `/api/health` while its `api` grant is
   active, and a stale feed turns the site red.**
   - `newestCompleteRuns` groups `ingest_runs WHERE complete` by source,
     and `assessHealth` goes stale on the oldest after
     `POLL_STALE_AFTER_HOURS` (27 h). A PetPoint feed that has not
     completed for 27 h turns the whole site's health red, and the health
     monitor alerts even while RescueGroups is fine.
   - That is accepted, as the code intends ("one stale source is a stale
     poller"). A consented shelter whose animals stop updating is a fault
     we owe that shelter a fix for. It is not noise.
   - Health reads only the sources expected to poll: `rescuegroups` and
     each `petango:<slug>` with an active `api` grant. Otherwise a shelter
     that ends its grant, or rotates its key and so ends it, leaves a
     source that stays stale forever. Ending the grant in the registry is
     what takes the source out of health.
   - The feed's daily cadence is fixed by the same 27 h. A slower cadence
     needs per-source thresholds, which this ADR does not decide.
   - Two alarms, two questions. The feed's own heartbeat answers "did the
     run start". Health answers "has it completed within 27 h".

8. **A grant ends with its terms.** Each `api`, `display` and `digify`
   grant records `onEnd` no later than its end (ADR-0006 as amended
   2026-09-28). The ask requests `keepsakes: "retain"` up front, as ADR-0022
   §5 does. `corpus` is decided from what the shelter says, and `display`
   always goes.

## Consequences
- **Growth is one shelter at a time.** There is no feed to poll for every
  PetPoint shelter: each one is a conversation, a key, an entry and a
  fixture check. That fits a referral. It is not a growth channel like
  RescueGroups, though PetPoint is widely used by county and humane-society
  shelters (over 1,300 in 2019).
- **The ask needs a fourth question.** Besides the Every.org claim and the
  painting, the shelter is asked to turn web services on and send its key,
  and to allow display. ADR-0029's template does not fit, so the first
  approach is Logan's own email.
- **The legacy service can go.** 24Pet runs an ASMX service with no
  published terms and could retire or gate it. The adapter is disposable by
  construction (ADR-0009), and a dead service ends the feed, not the corpus.
- **The source model changes.** `src/core/sources.ts`, `src/core/shelters.ts`,
  `src/core/health.ts` (Decision 9) and `tests/display-license.test.ts`
  (which uses the fixed `petango`) all change. `doc/flows.md`'s ingest
  diagram gains the adapter in the same commit (ADR-0012), and the `pass`
  entry goes in `doc/infra.md`'s table by path only.
- **The new run gets its own heartbeat.** The existing heartbeat belongs to
  the bridge's RescueGroups poll (ADR-0033 as amended), so the PetPoint run
  needs one beside health (Decision 9).
- **The droplet's reach to PetPoint is unverified.** RescueGroups refuses
  DigitalOcean's addresses (ADR-0033), and PetPoint might too. Before the
  build, one keyless request from the droplet, a GET of
  `wsAdoption.asmx?WSDL`, proves the route under its own oplog entry
  (ADR-0023). If it is refused, the feed runs from home without the RG
  proxy, which reopens Decision 1.
- **No care events.** Listings from PetPoint are discovery, not
  verification. Attestations from PetPoint data are a separate question.

## Alternatives
- **Scrape the Petango iframe.** ADR-0005 planned "one scraper per hosting
  platform" for widgets. Rejected: the web service returns structured data
  under the same key and the same consent, and a scrape of its HTML is a
  worse copy of it.
- **Use the key in the widget URL without asking.** Rejected (Decision 2).
- **Keep the fixed `petango` source with a shelter column.** Rejected:
  revocation becomes a hunt, and stage 5 couples shelters (Context).
- **PetPlace.** PetPlace, 24Pet, PetPoint and Pethealth are one family,
  under PetPlace Holdings and owned by Independence Pet Holdings since
  2025. PetPoint shelters publish to PetPlace automatically, and PetPlace
  claimed about 270,000 pets from about 8,700 organisations in 2024. As of
  2026-10-29 it has no public API and no developer program. Its
  `robots.txt` allows everything, which is access, not a license, and its
  terms page loads client side and was not read. A partner conversation is
  a possible future Tier 2 aggregator, like Adopt-a-Pet in ADR-0006
  Decision 3, and not a dependency. Scraping it is rejected on ADR-0006's
  grounds.
- **Ask the shelter to list on RescueGroups instead.** No build for us, but
  it puts new work on volunteers (DIRECTION, "zero workflow change"). It
  stays open in the ask as the shelter's choice.

## Revisit triggers
- 24Pet retires, gates or publishes terms for `wsAdoption.asmx`: re-read
  Decisions 1–2.
- A fifth PetPoint shelter grants: one env var per shelter stops being
  sane, so move the keys to a single `pass`-backed map.
- Item 6 (Shelterluv) is built: give it Decision 3's shape.
- Item 10 (cross-source merge) ships: lift Decision 6.
- PetPlace or 24Pet opens a partner API, or PetPoint offers a care-event
  integration for a shelter that has granted `api`.
