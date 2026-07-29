# ADR-0002: Every.org fiscal rails; 100% passthrough; no programmatic ads

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
