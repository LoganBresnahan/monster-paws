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
