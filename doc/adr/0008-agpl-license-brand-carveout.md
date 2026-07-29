# ADR-0008: Public repo under AGPL-3.0; brand carved out; DCO

## Context
The repo is going public (portfolio value: verifiable eval/agentic-dev
evidence; mission value: a provenance product should be inspectable;
practical value: unlimited CI, free secret-scanning push protection). A
license must protect a charitable-purpose codebase with real brand assets.
The failure mode to prevent is proprietary capture: a closed for-profit
fork running as a service (SaaS loophole) on donated work.

## Decision
- **AGPL-3.0-only** for the repository. Network copyleft closes the SaaS
  loophole: anyone running a modified version as a service must publish
  their source. Permissive licenses (MIT/Apache-2.0) were rejected for the
  app because they permit exactly the failure mode.
- **TRADEMARKS.md**: the Monster Paws name and `public/brand/` assets are
  not licensed — all rights reserved; public forks must rebrand.
- **DCO sign-off** for outside contributions (CONTRIBUTING.md). Logan
  remains sole copyright holder for now, preserving a future assignment to
  the 501(c)(3) or relicensing without a CLA chase.
- **Escape hatch:** components intended for wide reuse (e.g., a future
  attestation sign/verify library that shelter-tech vendors should embed)
  are extracted to separate repos under **Apache-2.0** — the standard
  "AGPL app, permissive libraries" split.

## Consequences
- Clones must stay open — mission-aligned; corporate license-allergy is
  irrelevant for an end-user service.
- `package.json` license field: `AGPL-3.0-only`.
- Fixture/PR hygiene rules are now public-facing (CONTRIBUTING.md).

## Alternatives
- Apache-2.0: best permissive option (patent grant, trademark exclusion) —
  reserved for extracted libraries instead.
- MIT: no patent grant, no protections; rejected.
- BSL/fair-source: revenue-protection licenses, wrong shape for a nonprofit.

## Revisit triggers
- 501(c)(3) formation (copyright assignment to the entity).
- A partner legally unable to interact with AGPL in a way that blocks the
  mission (would consider targeted dual-licensing, as sole holder).
