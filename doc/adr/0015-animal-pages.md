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

## Amendment (2026-09-04): the description stays whole, and is never linkified

Prompted by a listing whose description ends in the shelter's Venmo handle and
a PayPal.me link (animal 63964). Measured before deciding: of 45,131 stored
descriptions, 342 (0.76%) name a payment platform — PayPal 303, Venmo 206, plus
CashApp/Zelle/GoFundMe — and they sit late, a median 72% of the way through the
text. 37.6% contain a URL, 20.5% an email, 11.9% a phone number.

Excerpting was considered and **rejected**: dropping every paragraph holding a
URL, email or phone empties 23% of descriptions outright (10,372 animals) and
deletes the adoption contact details that get animals homes, and a
payment-platform blocklist is an arms race against a field we do not control.
Decision 4 stands unamended — the shelter's words render verbatim and in full.

What is added is the invariant that makes that safe, which until now held only
by accident:

1. **Description text is NEVER linkified.** It renders as a text node, so a URL
   in it is inert characters. No `dangerouslySetInnerHTML`, no linkify helper,
   no autolinking — the change that turns a stranger's `paypal.me` into one
   click is exactly the "helpful" one a future contributor will propose. A unit
   test guards the page source, and phase 4's e2e asserts zero anchors inside
   the quotation.
2. **The money rail must be unmistakable** (roadmap item 4). Our donate control
   is the only payment surface we vouch for; a payment handle sitting in
   someone else's quoted text must never be confusable with it. That is a
   requirement on item 4's design, recorded here because the risk arrives with
   this page and not with that one.
3. **Attribution stays visible.** The quotation is marked as the shelter's own
   words with the organization named beneath it, and the organization is linked
   (this ADR as amended) — a reader can always reach the source that wrote the
   text they are reading.

Storage was never the question: the full description is kept verbatim in
`animal_display` and the raw payload is permanent, so what a page chooses to
show costs the corpus nothing.

### Consequence for generation (roadmap item 8)

Two constraints, decided here because they are constraints on THIS text:

- **Generated prose may never reproduce contact or payment details** — no
  handle, URL, email or phone lifted out of a description. This is a mechanical
  check the faithfulness harness can make, and a far easier one than the
  care-claim rule beside it.
- **A licensed display is not a licensed derivative.** The RescueGroups terms
  grant "temporary use and display"; an LLM-written story derived from a
  shelter's prose is arguably neither. Decide it deliberately at item 8 — the
  ADR-0004 gate on AI art (consented shelters only) is the shape to copy, and
  in ADR-0020 terms anything generated from a description is `observed` tier at
  best, never attested.

## Amendment (2026-09-04): browse renders per request, and its filters are the corpus's own

Prompted by building the browse page. Decision 1 put both routes on ISR at an
hour and decision 5 named two filters; neither survives contact with a page
whose URL carries filters and a cursor. Three decisions.

### 1. Browse is rendered per request; the hour stays with detail

Filters and the keyset cursor are search params, so there is no finite set of
browse URLs to revalidate — species × state × every cursor is the whole corpus
written as URLs. Rendering per request is also *fresher* than the hour, never
staler, so nothing decision 1 promised a donor is weakened; what it costs is
database work per view, and that is measured rather than assumed on the live
64k corpus: **0.55 ms** for the page query at page one, **8.8 ms** for a deep
cursor with both filters (the filters are not in the sort index, so this one
grows with depth into the sort), **30 ms** for the facet grid.

The 30 ms is the number to watch. Caching it for an hour is one wrapper when
browse traffic makes it matter — that is a revisit trigger, not machinery to
add before the first shelter has been contacted.

### 2. Filter options are the visible set's own values, counted

The menus are built from one `(species, state, count)` aggregate over the
*visible* set — about 700 cells — never from a hardcoded list of species or the
50 states. Two consequences that are the point rather than side effects:

- **A filter can only ever open a page that has animals on it.** An option
  nobody can use is a dead end a reader blames themselves for.
- **States must match `^[A-Z]{2}$`.** Replay cannot retract a claim, so 27
  animals still carry the junk state `T` that a fixed normalizer no longer
  asserts; `select distinct state` would offer it as a choice. This is the
  build plan's carry-in, discharged here.

Each menu is counted under the *other* menu's selection, from the same grid, so
"cat (412)" beside a chosen state means 412 cats in that state and cannot
disagree with the page it opens. An unknown or junk value in a URL is dropped
rather than queried: a filter silently ignored would show animals nobody asked
for, and one silently applied would empty a page for a reason nobody can see.

### 3. The interim for listings that are not animals is six curated rows

ADR-0021 defers the real fix — an LLM verdict as derived data, roadmap item 7b
— and leaves browse the interim, either "accept the blemish" or "a tiny curated
exclusion". Measured 2026-09-04 at the head of the longest-listed sort: the
four oldest visible rows are administrative (`ADOPTION-Read First`,
`Kittens!!!!`, `OK Fosters Needed`, `One by One cats`), and two group listings
sit just behind them (`Kittens Available 20+!`, whose own description says the
pictured kittens are adopted, and `Red Eared Slider Turtles!`). Six rows out of
60,295 visible, all six in the first thirty a reader sees. The exclusion is
worth the six lines.

- **Keyed by `(source, external_id)`, never by `animals.id`.** A canonical
  rebuild reassigns our ids, and a stale id list would then hide six animals
  chosen at random — a silent, undetectable wrong.
- **Composed beside `visibleAnimals`, never inside it.** Visibility is what a
  donor may reach at all; this is one page's editorial interim, and a detail
  page linked from anywhere still resolves.
- **Never a regex over names**, per ADR-0021: the same pattern that catches
  `Kittens!!!!` hides `Sunshine 9.21.09` and `Afraid of Commitment`, who are
  real animals waiting sixteen and fifteen years.

Each entry carries the listing's name and what it actually is, so a reviewer
can find the row again and delete the list wholesale when item 7b lands.

### Consequences (added)

- The browse page reads the database three times per view (facets, page, card
  display) and holds no count and no page number, so nothing on it can imply
  scarcity.
- `AnimalCard` (`src/ui/animal.tsx`) frames a card photo at a fixed 4:3 and
  *contains* it, where the detail page takes each photo's own ratio: a grid
  needs one card height, and the alternative to ground around a photo is the
  crop that cut a dog's head off. `/design` renders the component itself
  (ADR-0016).
- The landing page's hero now links to `/animals` — browse is the demo, so the
  dev-only stub and its "(soon!)" button are gone.

### Revisit triggers (added)

- The facet grid's 30 ms shows up in browse latency → cache it for the hour,
  or narrow it to the facets a page actually renders.
- A reader asks for "near me", a total, or page numbers → the geocode trigger
  above, and the `?before=` / counted-variant trigger from the keyset
  amendment.
- Item 7b's verdict ships → delete `BROWSE_EXCLUSIONS` entirely rather than
  growing it; a curated list that outlives its interim becomes an unreviewable
  editorial policy.

## Amendment (2026-09-28): stage 4 writes display only while the source is licensed

`display-purge-path` shipped `purgeDisplay`, and with it a gap: stage 4
upserted display rows whatever the license said, leaving the license check to
render (`pickLicensedDisplay`). So the next ingest of a purged source rebuilt
its rows — a `replay rescuegroups` after termination (replay needs no key), or
tonight's scrape of a shelter that revoked `display` but kept `scrape`. Nothing
unlicensed rendered, but the purge did not hold, and ADR-0006's terms are about
holding, not only showing.

### Decision
The writer upserts `animal_display` for a candidate **only if
`isDisplayLicensed(source, asOf)`**, where `asOf` is the write's clock, not the
observation's `fetchedAt`: whether we may hold expression is a question about
now. An unlicensed candidate's display is dropped silently — no event, no
failure — and its facts are written as before. Both writers (`memory.ts`,
`pg.ts`) gate identically; the parity harness covers it.

`pickLicensedDisplay` stays as the render gate. The two are defence in depth,
and the render gate also covers the hour a detail page is ISR-cached after a
revocation.

### Consequences
- A display row now means "held under a license that was live when written",
  and `purgeDisplay` plus this gate make a display end stick (ADR-0006 as
  amended 2026-09-28, decision 2).
- Replay is no longer purely a function of the corpus: the display rows it
  rebuilds depend on the licenses at `asOf`. That is the point — a re-grant
  followed by a replay restores pages, and nothing else does.
- The parity test "keeps a second source's display row beside the first"
  stores an unlicensed `shelterluv` row. It is superseded, not deleted: a
  licensed second source keeps its row beside the first, an unlicensed one
  writes none. A Tier 1 source displaying anything needs its own license
  record first — none exists, and nothing displays one today.

### Revisit triggers (added)
- A source's license is decided per animal or per org, not per source —
  `isDisplayLicensed` needs the candidate, not just its source.

## Amendment (2026-10-01): the hour of staleness is accepted; the donate step checks live

Decision 1 deferred on-demand revalidation "until the hour shows", and the
roadmap made it a launch decision: once the poller runs in production, an
animal that disappears this morning keeps its cached detail page for up to an
hour, and so does an animal whose display license was revoked.

### Decisions
1. **The hour is accepted, with no worker-driven revalidation.** Browse
   renders per request, so a disappeared animal leaves the list at the poll; only
   someone already holding a detail URL sees the cached page, and that page
   already lags the shelter by up to a day of polling.
2. **Freshness that matters is checked at the action, never at the page.** The
   donate step (roadmap item 4) reads the animal's live visibility server-side
   and says so when it has changed — *"Rex is no longer listed. Your donation
   still goes 100% to Happy Tails"* — and then proceeds. A donation to the
   shelter of an animal that just left is still a good donation. Revalidation
   could never cover this: a tab left open for three days is staler than any
   cache.
3. **The copy says "no longer listed", never "adopted".** A disappearance is
   inferred from absence (ADR-0014); an outcome is a shelter's sentence
   (ADR-0020).

### Consequences (added)
- No signed worker→app route and no new secret. A revoked display license keeps
  its photos on a cached detail page for up to an hour after the purge.
- Item 4 carries the live check as a build requirement, not a nicety.

### Revisit triggers (added)
- A licensor's terms require removal faster than an hour → revalidate the
  purged animals' paths from `purgeDisplay`.
- Detail pages gain anything time-critical besides donating (a countdown, a
  "needs a home by" date) → on-demand revalidation from the worker.

## Amendment (2026-10-04): the browse filters recount as you pick

Dogfooding found the filter menus lying until submit. Pick "pig (6)" and the
State menu still offered every state with its all-species count, though all six
pigs are in one state. The counts were right after "Show me", because the
server recounts per request, but a menu that only tells the truth after you
commit to it does not help you choose.

### Decisions
1. **The filter form is browse's one client island** (`BrowseFilterForm`,
   `src/ui/browse-filters.tsx`), in the gallery's terms: component state, no
   state library, and it does not pay CLAUDE.md's owed Zustand ADR.
2. **It recounts from the server's grid, never from its own query.** The page
   hands it `loadFacetGrid`'s cells (~300 now), and each pick re-runs the same
   `facetOptions`, moved to the database-free `src/core/facets.ts`. The live
   menu and the menu the server renders after "Show me" are the same function
   over the same rows, so they cannot disagree. An e2e test compares them.
3. **A pick that empties the other menu's choice clears it**, so "Show me"
   can never open a page with no animals.
4. **It stays a plain GET form.** With JavaScript off it submits exactly as
   before, and every combination is still a shareable URL.

### Consequences (added)
- The grid ships with the page, about 10 KB before compression. It grows with
  species × states rather than with animals, so that cost stays flat.
- `src/core/facets.ts` must never import the database: it runs in the browser.

## Amendment (2026-10-05): browse opens newest-first; longest waiting is a choice

Decision 5 made **longest-listed first** the default sort, as the inversion
DIRECTION's first bright line asks for. Dogfooding found the cost: the front page
never changes. In the dev corpus of 2026-10-05, about 26,600 of 68,600 visible
animals were listed in the last month and 957 were listed 5+ years ago. A
longest-first default shows a returning visitor the same few hundred long-listed
records on every visit, while the feed turns over daily underneath.

### Decisions
1. **The default sort is newest first** (`listed_at desc, id desc`). It is the
   source's own listing date, the same column the other sort reads, so it ranks
   no animal by appeal and stays inside bright line 1.
2. **Longest waiting stays one deliberate pick away**: a Sort menu beside Kind
   and State, `?sort=longest`. The inversion moves from the front door to a
   choice. The fuller answer to "long-stay animals get the most celebrated
   cards" is item 4's, not a sort default.
3. **Paging walks the same index in either direction**: the keyset row
   comparison flips (`<` for newest), and `animals_status_listed_idx` is
   scanned backward. Measured on the 2026-10-05 dev corpus: 0.13 ms, an
   index-only backward scan with no sort node.
4. **Newest-first requires a listing date.** Postgres sorts nulls first in
   descending order, so an animal no source dated would otherwise lead the page.
   RescueGroups dates every visible animal today.
5. **The default never appears in a URL we build.** An unknown `sort` value
   reads as the default, never as an error, because a sort is a shared URL. The
   form always submits `sort`, so it still works with JavaScript off.

### Consequences (added)
- A wait-time filter was considered and declined: with newest-first as the door,
  the oldest listings appear only when someone asks for them.
- Brand-new listings more often lack a photo or carry a shelter ID as a name
  ("A435266"). Newest-first shows more of both; the second is ADR-0021's
  listing assessment (item 7b).

### Revisit triggers (added)
- Longest waiting still opens on records no one could adopt (sanctuary and
  permanent-foster residents, auto-touched listings). Tighten the upkeep bound
  for very old listings rather than adding a filter.
