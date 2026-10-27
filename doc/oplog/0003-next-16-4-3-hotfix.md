# 0003: Security hotfix — Next.js 16.3.8 → 16.4.3, the starter SVGs removed

Status: run
Planned: 2026-10-27 · Run: 2026-10-27 14:31 – 14:32 UTC
Why: three Next.js advisories fixed in 16.4.1 (GHSA-673q-mjm6-r5xr,
GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r), and a scanner probing production
for the first (`doc/issues.md`, UI); ADR-0007 as amended, oplog 0001
Commit deployed: `a2610f5` (CI run 40521006645: verify, images, sourcemaps green)

Production runs Next.js 16.3.8 (images `34d36ff`, oplog 0001). A scanner from
Belgium POSTed `Next-Action: cachefn` to `/`, `/api` and `/app` at 10:52 UTC
2026-10-27 — a probe for remote code execution through `use cache` functions.
None of the three advisories is exposed as built (no `use cache`, no Server
Actions, an Alpine/musl image already carrying `sharp` 0.35.5), but the version
is in range and is being probed, and one later change could expose it. This
entry upgrades `next` and `eslint-config-next` alone (12 lockfile packages, all
`@next/*`), removes the five unused starter SVGs from `public/` — the image
advisory's surface — and rolls the new images. No migration, no `.env` change.

## Prerequisites
- [ ] Ship bar on the upgrade commit: vitest twice, typecheck, lint, e2e on the
      production build.
- [ ] Pushed; CI green on that commit — `verify`, `images` and `sourcemaps`.
- [ ] e2e against the published app image (`npm run e2e:prod`).
- [ ] `pass` unlocked (the DO token, for the droplet's address).
- [ ] Not within an hour of 07:00 or 08:30 UTC (the poll and backup crons).

## Steps

### 1. Record what is running — this is the rollback
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG=34d36ff…`, health 200 with that sha.
Rollback: n/a — this is the record.

### 2. Pull and switch, one SSH session
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<sha>/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml up -d app worker'
Verify: app and worker run `<sha>`; the worker logs `ingest.poll registered`;
health 200 with `<sha>` (the last poll is under 27 h old, so it stays green).
Rollback: `IMAGE_TAG` back to `34d36ff…`, `up -d app worker`.

### 3. Smoke
Verify: 200 for `/`, `/animals`, an animal page, `/demo` and its pages,
`/claim`; `/next.svg` now 404; `npm audit --omit=dev` lists no `next`
advisory on the deployed commit.
Rollback: step 2's.

## Run
**Prerequisites.** Ship bar on `a2610f5`: vitest 309/309 twice, typecheck
clean, e2e 29/29 on the production build. Lint shows two errors, both present
on 16.3.8 and outside CI (`global-error.tsx`'s `<a>`, `e2e/fixtures.ts`'s
Playwright `use`). `npm audit --omit=dev`: no `next` advisory; one high left,
`source-map-js` 1.2.1 through tailwind's postcss, build time only. CI
40521006645 green; e2e 29/29 against the published app image. 14:31 UTC.

**1.** Running: `IMAGE_TAG=34d36ff…`, checkout `2be3acb`; health 200 with
`34d36ff…`, `lastCompletePollAt` 08:27:06.

**2.** One session: `git pull` (to `a2610f5`), `IMAGE_TAG` set, app and worker
pulled and recreated; caddy untouched (up 13 h). The worker logged
`ingest.poll registered (0 7 * * *)`. Health 200 with `a2610f5…`, the poll
still fresh.

**3.** 200 for `/`, `/animals`, an Illinois animal page (62983), `/demo`,
`/demo/ducky`, `/demo/ducky/sponsor`, `/demo/collection/ducky`, `/claim`;
404 for `/next.svg` and `/vercel.svg`.

## Follow-ups
- `source-map-js` to 1.2.2 (build time only; `npm audit fix` also moves
  vitest, drizzle-kit, rolldown and postcss, so its own small commit).
- The two lint errors, and lint in CI's `verify` so a third cannot land.
