# ADR-0002: Every.org fiscal rails; 100% passthrough; no programmatic ads

> Amended 2026-10-26: Every.org takes a card donation only for a nonprofit
> that has claimed its profile — see the amendment below.

## Context
Donations must reach shelters. Building payments means custody, compliance,
501(c)(3) formation, state charitable-solicitation registration — months of
admin, in a domain (payments) of no interest. The aggregator model (ADR-0005)
also lists shelters that never opted in, which makes taking a cut of their
donations ethically and optically fraught.

## Decision
All donations flow through the Every.org API (free, API-first, receipts and
disbursement to any US 501(c)(3)). **Monster Paws takes 0% of every donation,
permanently.** Operations funded by an optional donor tip at checkout
(default modest, zeroable); curated local sponsorship (NPR-style
underwriting) as a later option. No programmatic ads. Own 501(c)(3) formed
only if a legal entity becomes genuinely necessary.

## Consequences
- "100% goes to the shelter, always" is the trust story and defuses the
  unclaimed-listing consent problem.
- No payment code, PCI surface, or donation-revenue accounting.
- Dependent on Every.org's continued existence and API terms.
- Tip revenue scales with usage; infra (~$30/mo) is covered at trivial volume.

## Alternatives
- Own 501(c)(3) with operations cut (GlobalGiving/Cuddly model): rejected —
  admin burden now, weaker trust story, payments work.
- Ads: rejected — RPM math doesn't cover costs at plausible traffic, and ads
  next to shelter animals undercut the trust the attestation layer builds.

## Revisit triggers
- Every.org shuts down, changes terms, or adds fees.
- Tips persistently fail to cover infrastructure.

## Amendment (2026-10-26): a claimed profile, fees by payment method

### Context
The decision above read Every.org as paying out to any US 501(c)(3). Logan
found otherwise on the live site, 2026-10-26:

- **An unclaimed nonprofit takes no direct donation.** Border Tails Rescue
  (Northbrook, IL; EIN 85-0940489; Plum's rescue) is listed but has not
  claimed its profile, and its page offers no donate form: only "open an
  Every.org donor-advised fund to recommend a grant to them". No sponsor
  takes that path from a listing, so for an unclaimed shelter the donate link
  ADR-0027 builds leads nowhere. Small rescues are the likeliest unclaimed.
- **Fees depend on how the donor pays.** Every.org charges nothing of its
  own; the processor's fee comes out of a card payment ("Incurs fees") and
  not out of a bank payment ("Give 100%"), on the donor's own payment page.
  A third party reports the nonprofit card rate as 2.2% + $0.30 (bevy.org,
  unconfirmed), which would leave $0.68 of a $1 card gift.
- **The minimum is unconfirmed.** Every.org's docs publish none and let a
  link set its own (`min_value`); one nonprofit reports $10 (bevy.org).
  Logan wants $1 if it works.
- **Each donor can hold an Every.org donor-advised fund:** a balance funded
  once (by bank, no fee) and granted out later, unclaimed nonprofits
  included. Whether a grant from it through our donate link reaches our
  webhook with the intent's id is unknown.

### Decision
1. **A sponsorship needs the shelter's claimed Every.org profile.** The
   Sponsor button shows only for an animal whose shelter has one; any other
   animal stays browse-only, and nothing on its page implies otherwise. The
   claim is recorded beside the shelter's match in `shelter_nonprofits`
   (ADR-0027) when the donate loop is built.
2. **Claiming is part of the shelter ask.** The consent email (roadmap item
   5) asks each shelter to claim its free Every.org profile alongside the
   photo grant: minutes of work, and it gives them donate buttons and
   payouts for every donor, not only ours.
3. **0% stays permanent; the processor's fee is named, not hidden.** We
   take nothing and Every.org takes nothing; a card's processing fee is the
   processor's. Copy that says "100% goes to the shelter" is reviewed against
   this before the donate loop ships.

### Consequences
- A shelter that never claims its profile can be browsed but never
  sponsored through us. The aggregator listing is unchanged.
- The bank-payment and donor-advised-fund paths, the minimum, and what the
  webhook reports for each are measured with one small real donation through
  the staging webhook before the donate loop ships (roadmap, Accounts and
  donating).

### Alternatives still open (Logan, to discuss)
- **The shelter's own donation page** (Shelterluv's per-account donation
  link, or any other) as a second rail for an unclaimed shelter: money
  reaches them, but nothing confirms it to us, so no keepsake follows
  (ADR-0027). Shelterluv's API spec sits behind its developer login, so
  whether it exposes donations is unknown until a shelter grants access.
- **Pointing donors at their own Every.org donor-advised fund** for an
  unclaimed shelter: possible, but too many steps for a first sponsorship.

### Revisit triggers
- Every.org lets unclaimed nonprofits take card or bank donations again.
- The first measured donation shows a minimum or fee different from the
  figures above.
