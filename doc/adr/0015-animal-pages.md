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

## Amendment (2026-09-03): browse pages by keyset cursor, and the sort's name is never rendered

Prompted by starting phase 3 of the build plan. Decision 5 named browse's
default sort and its two filters but was silent on how 64k rows are paged —
and on inspection the sort column means less than its name says. Two
decisions.

### 1. Keyset cursor, forward-only — not offset

`/animals?after=<created_at>,<id>`, resolving to
`where (created_at, id) > ($1, $2) order by created_at asc, id asc limit 24`.
The cursor is the sort key of the last row on the page, so a URL names a
**row**, not a position.

Offset is rejected on the same ground decision 2 rejects a per-page
predicate. The visible set does not just grow: every poll adopts animals out
of it (ADR-0014), so rows vanish from the middle and everything after shifts
up. Under `offset`, an animal crossing a page boundary between two clicks is
skipped silently and no test can see it — the just-adopted-dog failure one
layer up from `visibleAnimals`. A keyset window cannot skip or repeat, and a
shared link still means the same thing after the next poll.

The `id` is not decoration. `created_at` is not unique — the 2026-08-25
backfill wrote 64k rows in one run — and a cursor without a unique tiebreaker
straddles a tie group, which is exactly the skip-or-repeat this decision buys
off.

Accepted costs, so they are not re-litigated as bugs: no page numbers, no
"showing 49–72 of 3,104" (a total needs a second count over the same
predicate), and **Back is browser history** — there is no `?before=` in v1.
Adding one later is a reverse-ordered query, not a redesign.

`animals_status_created_idx` is `(status, created_at)`; the row comparison
wants `id` in the index as well. EXPLAIN against a corpus of real size before
adding the column, as the phase-2 index carry-in did — an index changed on a
guess is how that carry-in started.

### 2. Two dates are promoted: `listedAt` and `sourceUpdatedAt`

Decision 4 promotes neither, so `animals.created_at` — when our own INSERT ran
— was standing in for a listing date. For the 64k backfill that column is
2026-08-25 on every row: it orders browse by RescueGroups' pagination and calls
the result "longest-listed". Two RG fields fix it, and both are needed, because
either one alone is worse than neither.

- `attributes.createdDate` → **`listedAt`**, a claim on `animals` — merged with
  provenance like any other fact (ADR-0013). It is what the default sort orders
  by and what the browse index is built around.
- `attributes.updatedDate` → **`sourceUpdatedAt`**, a column on
  `animal_identities`, **never** a merged claim. It is per-source by nature —
  how recently *that* source touched *its* record — which is the shape of
  `last_seen_at` sitting beside it, and decision 3 needs all three conditions
  satisfied by one identity row.

Measured against the live feed before deciding (600 records over 60 randomly
chosen pages, 2026-09-03; an earlier six-page sample was six clusters rather
than 600 draws, because a page of this feed is internally homogeneous —
re-sample by page, never by record):

- `createdDate` is a real per-animal date, not a migration stamp. 17% of
  animals share an exact timestamp with an org sibling, but only one such
  cluster is older than two years; the rest are same-day intake batches.
- It is also the field that ranks abandonment. ~10% of the feed was listed 2+
  years ago and 82% of that tail has not been updated in twelve months.
  Unguarded, a longest-first sort opens browse on records that are ~95% stale
  at the ten-year end — the stale-data risk arriving through the sort instead
  of through the predicate.
- The tail is not uniformly dead: listings from 2006 turn up with
  `updatedDate` inside the last month — a shelter still maintaining a record
  for an animal who genuinely has not found a home. That animal is why the
  sort exists, and `updatedDate` is the only thing separating it from an
  abandoned row.

The tail samples are small (60 clusters; ±5–8 points at 95%). The ordering of
these effects is robust, the exact percentages are not — re-measure before
moving a threshold, and never quote these numbers as current.

### 3. Visibility gains an upkeep bound: 24 months since the source last touched the record

`visibleAnimals` gains a third condition, on the same identity row as the other
two: `source_updated_at` within **24 months**. The 8-day window asks *did we
see this in the feed*; this asks *did anyone at the shelter touch it*. A record
its own shelter has not edited in two years is not one we can vouch for, and
decision 2 already settles what follows once that is admitted.

Measured cost: ~6.3% of the feed, ~4,100 of 64,110 animals (listed 2.9–18.1
years ago, median 5.1). It leaves ~2,400 long-waiting-and-maintained animals to
lead the sort, which is the page the sort was for.

**Nothing is deleted, and nothing stops being collected.** This is a read-side
predicate and only that: the poll keeps fetching these animals, `raw_payloads`
keeps every observation, `animals` and `animal_identities` keep their rows,
`animal_display` keeps its content. A hidden animal returns the day its shelter
edits the listing, with no backfill — the next poll carries the new
`updatedDate`. Hiding is not purging (ADR-0006 decision 4); no append-only rule
is touched here.

### Consequences (added)

- Browse URLs shared or indexed stay valid across polls; the row a cursor names
  may itself be adopted out, which the `>` comparison handles without a lookup.
- A full canonical rebuild rewrites the sort key and reshuffles the order, so
  cursors in the wild break. Cheap: a broken cursor is a page of animals, not
  an error.
- `listedAt` is a new `MERGED_FIELDS` entry, so the first replay after its
  migration fires `changed` for every animal in the corpus — expected once, and
  the build plan's sequencing risk (b) is the place that is checked.
- `animals_status_created_idx` is superseded: the sort key and the keyset
  comparison must share one index, so it becomes `(status, listed_at, id)`.
  EXPLAIN it on a corpus of real size before believing the shape, as the
  phase-2 index carry-in had to.
- ~4,100 animals are collected but never rendered. That is a supply-side number
  worth watching, not a bug.

### Revisit triggers (added)

- Browse needs page numbers or a total → keyset gains a `?before=` and a
  counted variant, or the filtered list is small enough that offset is honest.
- A shelter tells us a hidden animal is real → the 24-month bound is wrong, or
  upkeep needs a signal beyond `updatedDate`.
- A second source supplies `listedAt` → it merges by tier, but "longest-listed"
  may want the earliest date across sources instead. Decide it then; do not let
  `resolveClaim` decide it by default.
- The tail percentages are re-measured and have moved materially → revisit both
  the bound and the default sort.

## Amendment (2026-09-04): the first client island is the photo gallery

Decision 7 said server components only, with the first client island arriving
at item 4 with a state-library ADR. Dogfooding the detail page moved it
earlier, for two reasons found by using the page rather than by design.

- **The hotlinked hero photo loaded last and shoved the page down.** The fix is
  a fixed aspect box the photo fills absolutely, so height is decided before a
  third-party image of unknown dimensions arrives. That much is still server
  markup and is the load-bearing half of this amendment: the URLs are
  third-party and uncached, so what reads as a small jump on a dev machine is
  the whole page moving under a reader's thumb.
- **Thumbnails that do nothing are a broken promise.** A grid of small photos
  under a large one reads as clickable, so clicking one replaces the hero.
  That is client state, and no server round trip should be spent on it.

`AnimalGallery` (`src/ui/animal-gallery.tsx`) is therefore a `"use client"`
component holding one `useState` index. **No state library**: this is component
state, not shared application state, and the Zustand dependency ADR that
CLAUDE.md's Stack section owes is still owed by whatever first needs a store —
this does not pay it and must not be cited as if it had.

Everything else on the page stays a server component: the island is the gallery
and nothing else, and the licensed-display pick, the visibility predicate and
the tracker pixel all stay on the server where they cannot be reasoned around
by a client render.

## Amendment (2026-09-04): photos carry their published dimensions

Decision 3 stored photos as bare URLs, which left a page no way to know a
photo's shape before it loaded. Every option from there is bad: crop it
(`object-cover` cut the head off a portrait shot of a dog), letterbox it in a
guessed frame, or size the frame to the image after it arrives and move the
page under the reader.

RescueGroups publishes the pixel size of every variant it serves — measured
across 73,833 pictures in the corpus, `large.url`, `resolutionX` and
`resolutionY` are present on all of them, none zero. So the shape is not a
guess we have to make; it is data we were dropping.

- `animal_display.photo_urls` (`string[]`) becomes **`animal_display.photos`**
  (`{ url, width, height }[]`), and `DisplayContent.photoUrls` becomes
  `DisplayContent.photos`. Migrations 0007 (drop) and 0008 (add); the table is
  derived, so `npm run ingest -- replay rescuegroups` rebuilt all 64,133 rows —
  62,121 of them with photos, none malformed.
- **URL and dimensions come from one variant or neither.** `large` and
  `original` are different pixel sizes of the same picture (500×636 against
  700×890 in the fixture), so crossing them sizes every frame wrong while
  looking entirely plausible.
- **A picture whose variant publishes no usable size is dropped**, exactly as
  one with no URL already was. With 100% coverage upstream, a missing dimension
  means the payload changed shape — and an invented dimension is worse than a
  dropped photo, because the page trusts it.
- The detail frame takes the selected photo's own ratio and contains the image
  in it: no crop, no bars, and the space is still reserved before the image
  arrives. The height cap is spent as a max-WIDTH derived from the ratio — a
  `max-height` on a full-width box lets the frame stay wider than the photo and
  the bars return.

Thumbnails stay cropped square: at 80px a thumbnail is a target to press, not
the photo anyone reads the animal from.

## Amendment (2026-09-04): the link back is two claims, not one

Decision 5 requires a page that "links back to the listing organization by
name", and the RescueGroups key application promised the same thing in the
terms `AGGREGATOR_LICENSES` cites. The first detail page named the organization
without linking it, on the belief — from reading ONE payload — that RG
publishes no organization URL. Wrong: measured across the corpus, it publishes
several.

- `orgs.url` covers 62,658 of 64,133 animals (97.7%), plus `adoptionUrl` and
  `facebookUrl` for orgs that file elsewhere.
- The ANIMAL carries `url` for 11,933 of them (18.6%) — its own listing page on
  the organization's site.

Both are promoted as claims (`orgUrl`, `listingUrl` — migration 0009), not as
display content: where an animal is listed is a fact about the animal, subject
to the merge and provenance like `orgName` beside it, while the description is
a licensed copy of someone's words. **Neither is ever assembled.** The listing
URLs are per-organization subdomains
(`catrangers.rescuegroups.org/animals/detail?AnimalID=…`), so a URL built from
an org id would send a donor to a different shelter and call it attribution —
`trackerUrlOf`'s rule, applied where it matters most.

**Validation, because the field is not clean**: 3,349 org URLs arrive with no
scheme, and some hold something that never was a URL — one is a street address,
one is the bare string `http://`. A value is promoted only if it parses with a
dotted, whitespace-free hostname. The single character we add is a missing
scheme, and it is `http://`, which is what 82% of this feed's own organizations
publish; an https-capable host redirects, whereas assuming https breaks every
shelter still serving plain http.

Result: 62,729 of 64,133 animals now carry at least one link home, 1,404 carry
none and render the organization's name alone. The page links the org name to
`orgUrl` and, when there is one, offers the animal's own listing as a second
link — the strongest attribution available, since it is the page we are showing
a copy of.

`orgUrl` and `listingUrl` are new `MERGED_FIELDS` entries, so the first replay
after the migration fired `animal.updated` for 62,729 animals — the same
expected-once cost the `listedAt` amendment names, and the same permanent
`event_log` rows.
