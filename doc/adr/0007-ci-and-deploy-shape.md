# ADR-0007: GitHub Actions CI; droplet deploys by compose build

> **Amended 2026-07-30** (the revisit trigger fired early, from cost not
> build-time): while traffic is ~zero the droplet is the cheapest tier
> (s-1vcpu-1gb, $6/mo), which cannot build images. CI now builds and pushes
> `monster-paws-app` / `monster-paws-worker` to GHCR after the verify job
> (public packages, free); the droplet deploy is `git pull && compose pull
> && up -d`. Rollback improved as a side effect: images are sha-tagged, so
> rolling back = pinning the previous sha tag. Local e2e:prod still builds
> via the retained `build:` targets. Upsize the droplet in place when real
> traffic or worker load arrives (upsizing works; downsizing never does).

## Context
Need CI (typecheck, unit ×2, e2e vs production build — the /shipshape
machine half on a clean machine) and a deploy shape for the droplet. GitLab
free tier is 400 compute min/mo on shared runners; GitHub Actions is
unlimited for public repos and 2,000 min/mo for private — our run costs
~5–8 min. Repo visibility is undecided (public has portfolio value and
unlimited minutes); the setup below is identical either way.

## Decision
- **GitHub Actions** (`.github/workflows/ci.yml`): on every push/PR —
  typecheck, vitest twice (the flaky bar), production build, Playwright
  against `next start` (dev-mode green does not count, matching /deploy).
- **Next.js `output: "standalone"`** for a minimal app image; one
  multi-stage Dockerfile with two targets (`app`, `worker` — worker runs
  tsx over full deps).
- **Deploys build on the droplet**: `git pull && docker compose -f
  docker-compose.prod.yml up -d --build`. No image registry in v1 — one
  less credential/system; the droplet builds in ~a minute at this size.
  Caddy (auto-HTTPS) fronts the app; Cloudflare proxies in front (SSL mode
  Full (strict)); Postgres is DO Managed, never a container.

## Consequences
- CI and /shipshape agree by construction; a red ci.yml and a red
  /shipshape should mean the same thing.
- Droplet builds mean a brief CPU spike per deploy and no image rollback
  registry — rollback is `git checkout <prev sha> && compose up --build`
  (the /deploy skill records the sha). Acceptable at this scale.
- Worker image is fat (full node_modules + tsx). Fine now; compile the
  worker when it grows.

## Alternatives
- GitLab CI: rejected — 400 min/mo or self-hosted runner ops.
- GHCR registry + `compose pull`: cleaner rollbacks, but adds tokens and a
  push pipeline for no v1 gain. Revisit trigger below.

## Revisit triggers
- Deploy frequency or build time makes droplet builds annoying → GHCR.
- Private repo approaches the 2,000-min cap → public or self-hosted runner.
