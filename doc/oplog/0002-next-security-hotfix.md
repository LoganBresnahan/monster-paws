# 0002: Security hotfix — Next.js 16.2.12 → 16.3.8 on the live landing page

Status: planned
Planned: 2026-09-30 · Run: —
Why: three critical Next.js advisories against 16.2.12, patched in 16.3.8
(GHSA-2xp9-vwfh-vxw4: RCE in the Image Optimization API via `libheif` when
AVIF is processed, CVSS 9.5 — production's `/_next/image` answers 200;
GHSA-p293-qw3h-jr36 and GHSA-vcvr-r3jv-pc5j do not apply: we are not
Windows-hosted and never use `next/og`). ADR-0007 as amended; ADR-0023.
Commit deployed: —

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
—

## Follow-ups
- `topdog` adopts the pinned `IMAGE_TAG` compose and the ci.yml tag rule
  before oplog 0001 — or the launch reintroduces `:latest`.
- Delete `hotfix/next-16.3.8` once `topdog` carries Next ≥ 16.3.8 and 0001 has
  run; keep the `rollback-0002` tags until then.
