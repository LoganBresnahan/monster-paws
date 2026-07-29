# ADR-0005: Aggregator-first growth; verification as the claimed upgrade tier

> ToS research resolved by ADR-0006 (2026-07-29): Petfinder API is dead,
> Adopt-a-Pet is closed — RescueGroups.org is the sole aggregator backbone.

## Context
Waiting on shelter partnerships caps supply at hand-onboarded shelters.
Shelters already syndicate adoptable listings publicly (Petfinder,
RescueGroups, Adopt-a-Pet); Every.org can route a donation to nearly any US
501(c)(3) without the shelter's prior involvement (ADR-0002).

## Decision
Seed the site with all shelters' public adoptable listings — every listing
API as an append-only adapter, entity resolution (shelter + name + breed +
photo similarity) into canonical animal records with per-field provenance.
Scraping is **selective**: one scraper per hosting *platform*
(Shelterluv/PetPoint hosted widgets share markup), only for claimed or
high-traffic shelters — never per-site at large. Donations work from day one;
outreach becomes "your supporters gave $X and want verified updates."
Verification (attestations, badge, update promise) is the upgrade tier a
shelter claims. Unverified listings: 100% passthrough, "not affiliated —
claim your shelter" framing, instant opt-out. Copy on unverified animals
promises only "your donation goes to Shelter X."

## Consequences
- Cold-start solved on the supply side; the aggregator is the shelter
  acquisition funnel and the corpus (future RAG substrate) grows from day one.
- Supply rides on third-party API goodwill — **ToS review of all three APIs
  is a blocking task before build** (roadmap step 0).
- Stale-listing handling required (show freshness; adopted-already donations
  still went to the shelter).

## Alternatives
- Partnership-first (original plan): kept as the verified tier, but growth
  can't depend on it.
- Universal site scraping: rejected — unwinnable maintenance war, worse optics.

## Revisit triggers
- A listing API revokes access or forbids the use case in ToS review.
- A shelter backlash pattern (opt-outs, complaints) despite mitigations.
