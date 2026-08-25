# ADR-0006: RescueGroups is the aggregator backbone; source-tagged purge exception

Resolves ADR-0005's blocking ToS research (roadmap item 0). Amends ADR-0003's
append-only rule and ADR-0004's art-generation trigger.

## Context
ToS review of the three candidate listing sources (2026-07-29):

- **Petfinder API is dead** — shut down 2025-12-02 by Purina with <1 month
  notice; replaced by an embed-only widget; site scraping ToS-banned and
  WAF-blocked. Even alive, its terms barred us: at-will revocation with
  10-business-day purge, a competitor-display clause banning multi-source
  pages, no photo rights, "no commercial purpose" ambiguity.
- **Adopt-a-Pet has no public API** — partner-contract-only (Mars/Kinship,
  info@adoptapet.com); ToS bans scraping in the broadest terms ("robot,
  spider ... or manual process to ... copy, summarize, or otherwise
  extract"). Useful fact: their shelter terms confirm shelters own listing
  content and license it **non-exclusively** — the same content is always
  obtainable from the shelter directly.
- **RescueGroups.org is viable and aligned**: free, no hard quotas, v2/v5
  APIs, syndication-to-third-parties is their core business (they feed
  Petfinder, Chewy, ASPCA), real aggregator precedent (AllPaws). Per-org
  opt-in: each shelter enables API export and can exclude specific services
  and animals — consent is built into the supply chain. Conditions: Pet
  Adoption Tracker pixel required on every pet detail page; use is scoped to
  what the API key application declares; caching is "temporary" with ≥weekly
  refresh; **on termination, all data "including backups, and all
  information derived or extracted" must be purged**.
- No aggregator grants photo derivative-work rights; photos belong to
  shelters/photographers.

## Decision
1. **Tier 1 (verified): shelter-issued keys** — Shelterluv, Petango/PetPoint
   — obtained through the shelter relationship, with keepsake-art and data
   rights covered in our direct shelter agreement.
2. **Tier 2 (aggregator): RescueGroups only.** Declare the donation +
   keepsake model candidly in the API key application; ship the Tracker
   pixel on pet detail pages; poll within the weekly-minimum refresh;
   honor per-org/per-animal disappearances as revocations.
3. **No Petfinder, no Adopt-a-Pet, no scraping of either.** Adopt-a-Pet
   partner conversation is a possible future, not a dependency.
4. **Purge exception (amends ADR-0003):** every row derived from
   RescueGroups data (raw payloads, canonical fields, embeddings) carries a
   source tag and must be deletable as a set. Append-only remains the rule;
   this is the one sanctioned, source-scoped exception, exercised only on
   ToS termination.
5. **Art-rights gate (amends ADR-0004):** AI keepsake art generates only
   from photos we hold rights to. **Consent and verification are separate
   gates**: photo consent (a shelter's written permission — one email
   suffices) unlocks AI art; verification (attestation signing) is the
   deeper tier. For no-consent shelters, the card displays the animal's
   real photo in the Monster Paws frame; the monster art unlocks when the
   shelter consents — the constraint becomes the claim incentive.
   Consent is **credited on the card**: *"Permission to digify <pet> given
   by <shelter>"* — provenance as brand, and an advertisement to every
   other shelter that permission is grantable.
6. **Production rule:** the AI pipeline is built and exercised internally
   (dev/fixtures/private demos) from day one, but **no generated art ships
   in production without shelter consent on record**. Local shelters are
   the first targets — at local scale, consent is an email, and the first
   goal is proving real donations reach a real shelter.

## Consequences
- Single aggregator dependency; its per-service revocability is mitigated by
  the purge design and by Tier 1 being the product's foundation anyway.
- Coverage is RescueGroups' ~6,200 orgs (subset with exports enabled), not
  Petfinder's ~13k — acceptable: Tier 1 grows coverage where it matters.
- Card art becomes a two-stage reveal product-wide; instant-gratification
  moment for unverified shelters is the framed real photo, not generated art.
- Schema needs `source` tags + set-deletion path from day one.

## Alternatives
- Multi-aggregator ingestion (original ADR-0005 shape): dead — one source
  is gone, one is closed.
- Scraping non-API sources: rejected — explicit ToS bans, and the corpus
  would be poisoned with unlicensed data.

## Revisit triggers
- RescueGroups terms change, or our key/org opt-ins are revoked at scale.
- Adopt-a-Pet or a Petfinder successor opens a partner API worth a contract.
- Tier 1 coverage grows enough that the aggregator tier stops mattering.

## Amendment (2026-08-02): consented first-party scraping, named tiers, revocation

Prompted by the ADR-0009 scrape-first re-cut, which promotes consented
per-site scraping onto the critical path — a path this ADR, read literally,
forbids. Four decisions.

### 1. Consented first-party scraping is a different act from banned scraping

Decision 3 above bans scraping *Petfinder and Adopt-a-Pet*; the Alternatives
section states the rejection without qualification ("scraping non-API
sources: rejected"). That unqualified line is **narrowed here**, not
reversed: what it rejected was scraping sources whose ToS bans it, over
content we hold no license to. Reading a consented shelter's own public site
is a different act on every axis the rejection named.

The justification is already in this ADR's Context: Adopt-a-Pet's shelter
terms confirm **shelters own their listing content and license it
non-exclusively** — the same content is always obtainable from the shelter
directly. The aggregator's ToS binds our relationship with the *aggregator*;
it was never the shelter's only channel to us.

Scope of the permission: publicly reachable pages of a shelter in the
registry with a scrape grant on record, fetched at polite-crawler rates,
honoring robots.txt. Never behind a login, never past a block. A site that
blocks us has answered.

### 2. Consent is the display license, not a courtesy

Three constraints stack and must not be collapsed: **access** (may we fetch
— public, unauthenticated pages, broadly yes), **contract** (may we fetch
given their terms — what killed Petfinder), and **copyright** (may we
*republish* — what we actually do on animal pages). "It's public" answers
only the first.

Within copyright: **facts are not copyrightable** — name, species, breed,
age, sex, weight, intake date, adoption status; compile freely. **Expression
is** — the description prose and the photographs are the shelter's (or the
photographer's) authored work. Therefore a shelter's display grant is what
licenses us to render their prose and photos; without it a page shows the
facts plus our own words. This aligns with Decision 5's existing photo gate
rather than replacing it.

**Append-only is a data-integrity rule, not a legal shield.** Recorded
explicitly because the two are easy to conflate: modification is not the
regulated act — reproduction is, and a derivative work is an *additional*
right on top. "We store it unmodified" is not a defense (verbatim
republication is the harder case to defend, not the easier one). Two
independent reasons that happen to point the same way; if one moves, do not
assume the other moved with it.

### 3. Trust tiers become named and ordered; rank is derived

Decisions 1–2 fixed a two-tier hierarchy. A consented first-party scrape
belongs **above the aggregator** — it is the shelter's own data, read by us
under fixtures and health gates, while aggregator staleness is unbounded and
not ours to repair — and **below Tier 1**, which is defined by a
shelter-issued key plus a data-rights agreement; a scrape has neither.

Mechanism: one ordered tier list is the source of truth and rank is its
index — `shelter-api` → `first-party-scrape` → `aggregator` → `manual`.
Inserting a tier is moving a line: no renumbering, no gap budget, no float
precision to exhaust. **Never persist the rank — persist the tier name.**
A stored rank freezes the ordering at write time, so reordering the
hierarchy would silently rewrite the meaning of every provenance row.

Consequence for code: `Source` opens to admit `scrape:<shelter-slug>`, so it
can no longer key an exhaustive map; the closed **tier** list takes over that
job (`Source → Tier → rank`).

### 4. Consent revocation is a second source-scoped purge exception

Decision 4's purge exception is RescueGroups-scoped, and ADR-0009 §4 calls
consented-scrape rows "fully sacred". But consent granted by email is
revocable by email, so that must be qualified: **revocation of a shelter's
consent is the second sanctioned, source-scoped exception to append-only.**
`scrape:<shelter-slug>` as the source identity is what makes it executable
as a set operation rather than a hunt.

Scope by layer, since the layers differ: vaulted HTML and any displayed
prose or photos go; uncopyrightable facts are a separate question, decided
per revocation and on the shelter's terms, not ours.

Consent grants themselves are **records, not booleans** — granter, date,
basis, and a pointer to the evidence — kept in the checked-in registry so a
commit records who granted what, when, and on what basis. A bare boolean
asserts consent without evidence, the same unfalsifiable failure mode as an
unattributed golden fixture. Revocation is an *append* (a grant gains an end
date), never an edit, so the registry reads as the whole history of the
relationship. Scrape, display, and digify are three separate grants: a
shelter may welcome being listed and object to being crawled nightly.

### Consequences
- ADR-0009's scrape-first plan is legitimate on paper; phase 3 implements
  all four decisions in one commit.
- Animal pages must know a shelter's display grant before rendering prose or
  photos — carried to roadmap item 3.
- Two purge exceptions now exist. Append-only remains the rule; both
  exceptions are source-scoped and exercised only on termination/revocation.

### Revisit triggers (added)
- A shelter revokes consent — the first real exercise of the purge path.
- Any tier is inserted, renamed, or reordered (verify no rank was persisted).
- Scraping expands beyond registry shelters with grants on record — that
  would leave what this amendment sanctions.

## Amendment (2026-08-25): aggregator listing display is a licensed, named permission

Prompted by roadmap item 3. The 2026-08-02 amendment's rule "consent is the
display license" was reasoned about **scraped** content — where we hold no
license without the shelter — and was then read as applying to aggregator
content too, leaving the animal pages with facts and no photos for every
RescueGroups-sourced animal. Re-reading the actual terms
(`doc/rescuegroups-api-terms.md`, fetched 2026-08-25) shows that reading
was wrong for the aggregator, and that the Context line above, "no
aggregator grants photo derivative-work rights", was too broad. Three
decisions.

### 1. Displaying RescueGroups listing content is licensed — by a chain, not by the shelter

The chain: the shelter grants RescueGroups a license "with right of
sublicense … to display, distribute, create derivative works of, and
transmit the data and pictures to third parties"; the API terms grant us
"temporary use and display in your services", scoped to "the API Key
information"; and our key application, granted 2026-08-02, declared
"Display adoptable animals (name, photos, breed, age, description, status,
and organization info) on public pages that link back to the listing
organization" and cards showing "the animal's actual listing photo with
attribution and a link back."

Therefore **rendering a RescueGroups-sourced animal's listing photos and
description on its page and card is inside our license**, with no shelter
grant required. This is a **new named permission, `aggregator-display`**,
attached to the `rescuegroups` source as a whole — it is held by the API
key, not by any shelter, and it is distinct from a shelter's `display`
grant, which continues to govern scraped prose and photos exactly as §2 of
the 2026-08-02 amendment says. The two must never be conflated in code or
copy: an animal page shows RG listing content because the *source* is
licensed, and shows scraped content because the *shelter* consented.

Obligations that ride on `aggregator-display`, all from the API terms:
the Pet Adoption Tracker image on every detail page (Decision 2 above,
unchanged); refresh at least weekly (the daily poll); "temporary" caching,
which we satisfy by **hotlinking photos from `cdn.rescuegroups.org` and
storing URLs only — never copying an API photo into R2**; and purge on
termination (Decision 4 above — the URLs and description text are
RescueGroups-derived rows and go with the set). Attribution is optional
under the terms; we keep the declared link-back to the listing
organization on every page regardless, because we said we would.

### 2. Derivative works from API photos remain forbidden — on three independent grounds

The site terms' "create derivative works of" is the **shelter's grant to
RescueGroups**. It does not flow to us: the API terms, the specific
document governing our license, grant "no rights … other than for
temporary use and display", and specific language governs. Second, our own
declaration scoped artwork to "the shelter's own authorization and their
own photos, not on API data", and use "for any service that provides
features other than those described in the API Key will be considered a
violation." Third — and this would hold even if the first two moved — the
photographer's rights sit beneath the shelter's non-exclusive grant, the
ADR-0004 amendment requires the shelter to warrant it can license the
photo, and the credited consent line is the product's claim incentive.
**No keepsake art is ever generated from an API photo.** Decisions 5 and 6
above are unchanged; this amendment only closes the loophole a reader
could infer from the site terms.

### 3. The RescueGroups normalizer widens deliberately, and marks what it promotes

Decision 4's thinness rule stands — every promoted field must be
retractable — but "retractable" was being read as "identity only".
`aggregator-display` content is retractable too (it purges with the set),
so the normalizer may promote **listing photo URLs and the description
text**, and does, under two rules: they are stored as **URLs and text,
never bytes**; and they are asserted as **display content, not facts** —
a description is the shelter's expression and never enters trust
resolution against a shelter-API claim as if it were a breed. How that
distinction is carried in the claims model is ADR-0015's (item 3) to
decide; this amendment only licenses the promotion.

### Consequences

- ADR-0006 Decision 5's "framed real photo" for no-consent cards is
  achievable for RescueGroups-sourced animals — hotlinked, attributed,
  linking back — which is what the application said.
- A revoked key empties photos and descriptions from every RG-sourced page
  on the next poll and leaves the facts; the aggregator stays expendable
  (DIRECTION §aggregator).
- `doc/rescuegroups-api-terms.md` is the citable record of the terms as
  read on 2026-08-25; re-read it before relying on this amendment after
  RescueGroups revises its API terms.

### Revisit triggers (added)

- RescueGroups revises the API terms' "temporary use and display" language
  or adds a picture clause — re-derive §1 and §3.
- A shelter objects to its RG photos appearing here — honor it as a
  per-org exclusion regardless of the license, and revisit whether
  `aggregator-display` should be overridable per shelter in the registry.
- Item 4 wants the listing photo *inside* a generated composition (a
  frame is display; a composite may be a derivative) — decide the line
  then, not by analogy.
