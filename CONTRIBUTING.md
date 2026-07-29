# Contributing

Early days — the best contribution right now is an issue describing what you
tried to do and what happened.

## Ground rules

- **License:** contributions are accepted under [AGPL-3.0](LICENSE).
- **Sign-off (DCO):** commit with `git commit -s`, certifying the
  [Developer Certificate of Origin](https://developercertificate.org/) —
  that you have the right to submit the work. No CLA, no paperwork.
- **Every decision gets an ADR** (`doc/adr/`, Nygard style) — see
  `CLAUDE.md` for the working conventions and `doc/DIRECTION.md` for what
  this project is (and its bright lines — no rarity tiers on animals,
  nothing tradeable, no dark patterns; PRs crossing those close).
- Tests: `npm test` (twice), `npm run typecheck`, `npm run e2e` — all green
  before a PR.
- Never commit secrets, donor data, or shelter correspondence. Golden
  fixtures may contain only already-public listing data.
