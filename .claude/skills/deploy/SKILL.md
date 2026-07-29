---
name: deploy
description: Put a verified Monster Paws build into production on the droplet. Ship bar first (vitest green twice + typecheck), then build the production images, run Playwright e2e against the PRODUCTION build locally, roll onto the droplet via compose with the previous image kept for rollback, smoke the live site, and hand off a dogfood script so the user exercises the new iteration for real. Run after substantive changes when the user wants the new build live.
---

# /deploy — put a verified build into production

"Deployed" means: images built from a known commit, verified by machine
against the *production* build, rolled onto the droplet with the previous
version retained, and the live site smoked — then handed to the user with a
dogfood script so first real use is confident, not exploratory.

**Infra guard:** if the droplet/registry/compose targets aren't provisioned
yet (pre-roadmap-item-1, or secrets absent), stop and say exactly what's
missing — do not simulate a deploy.

**Preconditions (refuse to proceed if unmet):**
1. Working tree clean, or the user explicitly okayed deploying dirty state.
   Either way record the exact sha (and dirty files) in the report.
2. Ship bar: `npm test` green **twice** and `npm run typecheck` clean — run
   them now; don't trust memory or an earlier session's green.

## 1. Build the production artifacts

```sh
docker compose -f docker-compose.prod.yml build   # app + worker images
```

Tag images with the sha. The e2e in step 2 runs against these exact images —
same bytes that ship.

## 2. Verify the production build locally

```sh
docker compose -f docker-compose.prod.yml up -d   # prod images, local Postgres
npm run e2e:prod                                   # Playwright vs the prod containers
```

**Dev-mode green does not count.** Production Next.js fails in
production-only ways: ISR/cache behavior, env wiring, standalone-output
paths, worker container startup. A failure here is a deploy stopper — read
the trace before touching anything.

Migrations: if this release includes schema changes, run them against a
disposable copy first (`drizzle-kit migrate` on a fresh DB seeded from the
latest dump) — the append-only corpus (ADR-0003) makes destructive-migration
accidents permanent.

## 3. Roll onto the droplet, with rollback

```sh
ssh <droplet> 'cd monsterpaws && git pull && docker compose -f docker-compose.prod.yml up -d --build'
```

(No registry in v1 — the droplet builds from the repo, ADR-0007. Rollback is
`git checkout <prev sha>` + the same compose command.)

Before switching: record the currently-running image tags (that *is* the
rollback). After switching: keep the previous images — never prune in the
same session as a deploy. Run any pending migrations. Rollback is
`docker compose up -d` with the previous tags — state it in the report with
the exact tags.

## 4. Smoke the live site

Machine checks against production, through Cloudflare:

- `curl -fsS https://<domain>/api/health` — app up, DB reachable.
- Load an animal page anonymously — ISR serving, images from R2 resolving.
- Worker heartbeat: latest poller run timestamp visible (log or admin
  endpoint) — the queue is alive, not just the web tier.

## 5. Dogfood handoff

The machine check proved the build on golden paths; dogfooding proves it on
real ones. Tell the user concretely what to exercise this iteration — the
surfaces the release touched, plus the standing trio: browse to a real
animal page cold (fast? images right? freshness honest?), make a test-mode
donation end to end (card generated? looks like the dog?), and — once the
verified tier exists — a real confirm-click round trip. Any surprise gets
pinned immediately as a carry-in on the relevant `doc/roadmap.md` item —
dogfood findings evaporate if they only live in chat.

## 6. Report

```
DEPLOYED — Monster Paws @ <sha> → <domain>
  ship bar     vitest <n>/<n> ×2 · typecheck clean
  verified     <n>/<n> e2e vs PRODUCTION images (local) · migrations: <none | applied on copy then prod>
  rolled       app:<tag> worker:<tag> on droplet · previous: <tags> (rollback = compose up with these)
  smoke        health ✓ · animal page ✓ · worker heartbeat ✓
  dogfood      <the 2-3 things to try for real this iteration>
```
