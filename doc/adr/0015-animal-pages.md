# ADR-0015: Animal pages — browse and detail, visibility, and display content as its own layer

## Context
Roadmap item 3: public pages rendering real shelters' animals — the demo
and the v1 supply side in one build (DIRECTION §growth). The corpus is
ready: ~64k canonical `animals` with per-field provenance (ADR-0013),
per-source presence on `animal_identities` (ADR-0014), and a daily poll.
Two permissions now govern what a page may show (ADR-0006 as amended
2026-08-25): `aggregator-display`, held by the RescueGroups key, licenses
listing photos and descriptions of RG-sourced animals; a shelter's
`display` grant licenses scraped prose and photos. Neither is a fact about
the animal, and the trust merge must never treat them as one.

Three things the pages must be honest about, from DIRECTION's growth
risks: the data is aggregated and refreshed daily, not live; unverified
shelters get a smaller promise than verified ones; and a shelter that
never heard of us must be able to see itself, claim itself, or opt out.

## Decision
1. **Two routes, server-rendered, ISR.** `/animals` (browse) and
   `/animals/[id]` (detail), both React Server Components reading Postgres
   directly — no client store, no API layer between page and DB (CLAUDE.md
   Stack). `revalidate` is **one hour**: the feed changes once a day, so
   a page is at most an hour behind a poll that is itself a day behind the
   shelter. On-demand revalidation from the worker (a signed call to an
   app route after each poll) is deferred until the hour shows.
2. **One visibility predicate, used everywhere.** An animal is visible
   iff `animals.status = 'available'`, it has at least one identity with
   `disappeared_at IS NULL`, and that identity's `last_seen_at` is within
   **8 days** (the weekly refresh minimum plus one). It lives in one query
   helper (`visibleAnimals`), and browse, detail, sitemap and any future
   feed call it — a page that assembles its own predicate is the way a
   just-adopted dog reaches a donor. A detail URL for a non-visible animal
   returns 404, never a stale card.
3. **Display content is a separate layer, keyed by source, never merged.**
   A new derived table `animal_display (animal_id, source, description,
   photo_urls[], listing_org, tracker_url, fetched_at)` holds what a
   normalizer promotes as *expression* — one row per (animal, source),
   upserted by stage 4 alongside the facts. `AnimalClaims` stays facts
   only; the `Normalizer` contract gains an optional `display` output.
   The page picks the display row whose source is **licensed**:
   `rescuegroups` under `aggregator-display`, `scrape:<slug>` under that
   shelter's `display` grant (`hasGrant`), nothing otherwise. Photos are
   **URLs, hotlinked** — for RG, the CDN URL with `?width=500` — never
   fetched into R2 (ADR-0006 amendment §1); `animals.photo_keys` remains
   for R2 keys we hold rights to and is unused by this ADR.
4. **The RescueGroups normalizer promotes**: `descriptionText` (verbatim —
   it is the shelter's words and is rendered as a quotation, never edited),
   picture URLs in the order RG lists them, the org name/city/state/postal
   (facts, into `AnimalClaims` — location is what makes browse "near you"),
   and `trackerimageUrl`. All of it purges with the `rescuegroups` set.
5. **Copy and framing rules**, checked by e2e, not left to taste:
   - Every detail page renders the **Pet Adoption Tracker** image for an
     RG-sourced animal (API terms; ADR-0006 decision 2) and links back to
     the listing organization by name.
   - A **"last updated" line** shows the identity's `last_seen_at`
     honestly; copy never says "available now".
   - An unverified shelter's animal says what a donation does ("goes to
     Shelter X") and promises **no updates**; the verified-tier promise
     appears only when a shelter is verified (item 7). No bait-and-switch.
   - A **"Not affiliated — this is your shelter? Claim it or remove your
     listings"** line on every RG-sourced detail page, with a contact
     route. Instant opt-out is DIRECTION's mitigation, not a nicety.
   - No rarity, no scarcity, no countdowns (bright lines); browse default
     sort is **longest-listed first** — the inversion DIRECTION asks for —
     with species and state as the v1 filters. Distance sort ("near me")
     waits on a postal-code geocode and is a revisit trigger.
6. **No donation surface in this ADR.** The detail page ends at the
   animal and its shelter; the sponsor button is item 4's, because it
   needs the shelter's EIN and the Every.org flow. A page with a dead
   button is worse than a page without one.
7. **Design in code with the brand tokens** (Tailwind 4, the cuddly
   palette, wordmark), server components only — no Zustand yet, since
   nothing here is interactive client state. The first client island
   arrives with item 4 and brings the dependency ADR.

## Consequences
- `animal_display` is one more derived, purgeable table; a revoked RG key
  empties it for that source on purge and pages fall back to facts.
- The page never reads `raw_payloads`: everything it renders was promoted
  through a normalizer, so replay repairs pages too.
- Browse over 64k rows needs indexes on `animals(species)`,
  `animals(shelter_external_id)`, `animal_identities(disappeared_at,
  last_seen_at)`, and a location column set on `animals` (city, state,
  postal — facts with provenance like any other).
- Tracker pixel on every RG detail page means RG sees our page views; that
  is the deal we declared.
- The three flows this adds are drawn in `doc/flows.md` § Animal page
  render.

## Alternatives
- **Client-fetched pages / API routes.** Rejected: server components read
  the DB with less machinery and better cache behaviour; there is no
  client state to justify it.
- **Merge description/photos into `AnimalClaims` as fields.** Rejected: a
  description would then compete in `resolveClaim` as if it were a breed,
  and provenance would claim it is a fact. Expression and facts are
  different objects with different licenses.
- **Copy photos to R2 for reliability.** Rejected: "temporary use and
  display" plus purge-on-termination; hotlinking is the license-shaped
  choice. If RG's CDN proves unreliable, that is a revisit trigger, not a
  quiet change.
- **Show non-visible animals with an "adopted" badge.** Rejected for v1:
  a page for an animal we can no longer vouch for is the stale-data risk
  itself. The adopted moment belongs to a sponsor's collection (item 4+),
  not to public browse.
- **Distance sort now.** Rejected: needs geocoding and a location index;
  state + species gets a local demo done.

## Revisit triggers
- The hour of staleness is visible to a user (an adopted animal browsable
  the morning after) — wire on-demand revalidation from the worker.
- A shelter uses the claim/opt-out line — the registry needs a per-org
  exclusion that overrides `aggregator-display`.
- RG CDN hotlinks fail or get blocked — the storage question reopens
  under the terms, not by copying quietly.
- A second licensed display source for one animal (item 10 merge) — decide
  precedence between display rows (shelter's own over aggregator's).
- Browse needs "near me" — geocode postal codes, add the index, revisit
  the default sort.
