# 0002: Security hotfix — Next.js 16.2.12 → 16.3.8 on the live landing page

Status: run
Planned: 2026-09-30 · Run: 2026-09-30 16:42 UTC
Why: three critical Next.js advisories against 16.2.12, patched in 16.3.8
(GHSA-2xp9-vwfh-vxw4: RCE in the Image Optimization API via `libheif` when
AVIF is processed, CVSS 9.5 — production's `/_next/image` answers 200;
GHSA-p293-qw3h-jr36 and GHSA-vcvr-r3jv-pc5j do not apply: we are not
Windows-hosted and never use `next/og`). ADR-0007 as amended; ADR-0023.
Commit deployed: `c58d87f` on `hotfix/next-16.3.8` (CI run 36745839439, green)

Production runs the 2026-07-30 landing image built from `3f3c270` (the
droplet's checkout), tagged only `:latest`. `topdog` cannot be deployed —
its landing page links to `/animals`, which answers 500 without a database —
so the fix is a branch from `3f3c270` that changes one dependency.

This also retires a live trap: every `topdog` push re-points `:latest` at the
newest build, so any `docker compose pull` on the droplet today would silently
swap in the item-3 app. After this entry production runs a **pinned sha tag**.

## Prerequisites
- [ ] Nothing else is changing production.
- [ ] CI is green on the hotfix branch and its images job pushed
      `monster-paws-app:<sha>` and `monster-paws-worker:<sha>` — sha tags only.

## Steps

### 1. The hotfix branch (repo, not production)
    git switch -c hotfix/next-16.3.8 3f3c270
    npm install next@16.3.8 eslint-config-next@16.3.8
    # ci.yml: images job runs for refs/heads/hotfix/* too, and a hotfix pushes
    #         ONLY the sha tag — never :latest
    # docker-compose.prod.yml: image: …-app:${IMAGE_TAG:?set IMAGE_TAG in .env}
    #                          (same for worker) — no more implicit :latest
    git push -u origin hotfix/next-16.3.8
Verify: CI green (typecheck, tests, e2e against the production build); GHCR
has both images at the branch sha; `:latest` untouched.
Rollback: delete the branch; nothing reached production.

### 2. Record what is running — this is the rollback
    ssh root@$IP 'cd monsterpaws && git log -1 --oneline &&
      docker inspect --format "{{.Name}} {{.Image}}" $(docker compose -f docker-compose.prod.yml ps -q)'
    ssh root@$IP 'docker tag ghcr.io/loganbresnahan/monster-paws-app:latest monster-paws-app:rollback-0002 &&
      docker tag ghcr.io/loganbresnahan/monster-paws-worker:latest monster-paws-worker:rollback-0002'
    curl -fsS https://monsterpaws.org/api/health
Verify: image ids and the local rollback tags written into **Run**; the
rollback tags point at the running image ids.
Rollback: n/a.

### 3. Check out the hotfix and pin the tag
    ssh root@$IP 'cd monsterpaws && git fetch origin &&
      git checkout hotfix/next-16.3.8 &&
      printf "IMAGE_TAG=%s\n" <sha> >> .env'
Verify: `git log -1` is the hotfix sha; `.env` names are `NODE_ENV IMAGE_TAG`.
Rollback: `git checkout topdog` at `3f3c270`, remove the `IMAGE_TAG` line.

### 4. Pull and roll
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml up -d app worker'
Verify: `curl -fsS https://monsterpaws.org/api/health` reports `"sha":"<sha>"`
— not `"dev"` (closes the `doc/issues.md` entry); the landing page renders;
`/_next/image?url=%2Fbrand%2Fwordmark-v1.png&w=64&q=75` answers 200; both
Better Stack monitors stay up; `free -m` shows headroom.
Rollback: point both services at the step-2 tags —
`IMAGE_TAG` cannot name a local tag under the ghcr prefix, so re-tag:
`docker tag monster-paws-app:rollback-0002 ghcr.io/loganbresnahan/monster-paws-app:rollback-0002`
(worker likewise), set `IMAGE_TAG=rollback-0002`, `up -d app worker`.

### 5. Smoke and leave it
Verify: landing page on a phone and a desktop; Better Stack monitors green for
30 minutes; the next `topdog` push does NOT change what production runs
(it only moves `:latest`, which nothing references now).
Rollback: step 4's.

## Run
1. Branch `hotfix/next-16.3.8` from `3f3c270`: next + eslint-config-next pinned
   to exactly 16.3.8 (npm wrote `^16.3.8`; restored to exact). **Found on the
   way:** this commit's Dockerfile never had the `BUILD_SHA` stamp and its
   ci.yml never passed it — the real root cause of production's `"sha":"dev"`,
   not a stale image. Added both. Compose checked both ways: without
   `IMAGE_TAG` it refuses to start; with it, both services resolve to the sha.
   CI green; GHCR has app + worker at `c58d87f7…`, `:latest` untouched.
2. 16:42 UTC — droplet at `3f3c270`; running app `6aa481a123ef`, worker
   `cfc25eb5ea56`, caddy `5f5c8640aae0`. Local tags `monster-paws-app:rollback-0002`
   and `monster-paws-worker:rollback-0002` point at those ids. Health before:
   `{"ok":true,"sha":"dev","uptimeSec":5341115}` (~62 days up).
3. Checked out `hotfix/next-16.3.8` (`c58d87f`); `.env` names now
   `NODE_ENV IMAGE_TAG`; compose resolves both images to the sha.
4. 16:43:12 UTC — pulled and `up -d app worker`; caddy not restarted. Health
   after: `{"ok":true,"sha":"c58d87f7…","uptimeSec":9}`; landing 200 with its
   copy; `/_next/image` 200 `image/png`; `next` inside the container reports
   16.3.8; worker idles as designed (no `DATABASE_URL`); memory 404 MB
   available of 957.
5. Both Better Stack monitors up at 16:43, and still up at 17:13 UTC after 30
   minutes (health `uptimeSec` 1807) — zero incidents since 16:40. Frozen.

## Follow-ups
- `topdog` adopts the pinned `IMAGE_TAG` compose and the ci.yml tag rule
  before oplog 0001 — or the launch reintroduces `:latest`. (Done in the
  working tree the same day, alongside the Next.js 16.3.8 upgrade on topdog.)
- Delete `hotfix/next-16.3.8` once `topdog` carries Next ≥ 16.3.8 and 0001 has
  run; keep the `rollback-0002` tags until then.
