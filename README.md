<p align="center">
  <img src="public/brand/wordmark-v1.png" alt="Monster Paws" width="360" />
</p>

<p align="center"><em>every monster deserves a happy ending</em></p>

**Monster Paws** is a free website where you sponsor a real shelter animal.
Your donation goes to the animal's shelter through [Every.org](https://www.every.org),
and we keep $0: no cut, no ads, and we never process a payment. As our
thank-you, we try to paint the animal in watercolour from its listing photos,
with the shelter's permission, and email you the paintings.

Planned, not built yet: shelters signing their animals' care events, so a donor
can see what their support did without having to trust us.

[![CI](https://github.com/LoganBresnahan/monster-paws/actions/workflows/ci.yml/badge.svg)](https://github.com/LoganBresnahan/monster-paws/actions/workflows/ci.yml)

## Status

Live at [monsterpaws.org](https://monsterpaws.org). Sponsoring opens shelter by
shelter, as each gives permission. `doc/roadmap.md` is the build order;
`doc/DIRECTION.md` is the product source of truth; every decision has an
ADR in `doc/adr/`.

## Mission & bright lines

**Inspire joy.** And some things we will never do: no rarity tiers on
animals, nothing tradeable, no dark-pattern pressure, no programmatic ads,
and generated donor updates never claim care that isn't attested.

## Stack

Full-stack TypeScript: Next.js (App Router) + Postgres (the platform:
relational + append-only event log + JSONB corpus + pgvector + pg-boss
jobs) + Drizzle, on a single DigitalOcean droplet behind Cloudflare, images
in R2. Paintings by FLUX.2 [klein] on a GPU in the founder's home, generated
only on donation and only with a shelter's permission. Details: `CLAUDE.md`,
`doc/infra.md`, ADRs 0001–0008.

## Development

```sh
npm install
npm run dev        # http://localhost:3000
npm test           # vitest units
npm run typecheck
npm run e2e        # Playwright (boots the dev server)
npm run db:up      # local Postgres (docker, pgvector)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code: [AGPL-3.0](LICENSE). The Monster Paws name and brand assets are
**not** licensed — see [TRADEMARKS.md](TRADEMARKS.md).
