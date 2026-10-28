# 0007: Deploy `40cb846` — the poll fits the droplet, the droplet's schedule off, the footer's six profiles

Status: planned
Planned: 2026-10-28 · Run: —
Why: ADR-0009 as amended 2026-10-28 (stages 2–4 per observation — oplog
0006 ran the droplet out of heap at ~45k); ADR-0033 as amended 2026-10-28
(`INGEST_POLL_SCHEDULE=off` unschedules the droplet's doomed 07:00 job; the
CLI exits 2 on an incomplete full run); the pool `error` listener (oplog
0005's crash); ADR-0032 as amended (Instagram and the Facebook Page in the
footer); roadmap: Launch (3b). Logan, 2026-10-28: "turn off the automatic
job that cant work because of rescuegroups … commit this and deploy".
Commit deployed: `40cb846` (19 commits on `c45e085`, oplog 0004); this entry
follows in its own push so the image tag is the code commit

What changes on the droplet: the app and worker images, and one new `.env`
line, `INGEST_POLL_SCHEDULE=off`, which makes the new worker call
`boss.unschedule("ingest.poll")` at boot — the old job only fails against
RescueGroups' refusal and, on its last attempt, pings the poll heartbeat
`/fail`. No migration (`drizzle/` and `src/db/schema.ts` unchanged since
`c45e085`), no compose, Caddy, Dockerfile, package or DNS change. The
outreach CLI changes ride in the image and run only from dev. Health stays
503 (`pollStale`) after this entry: the poll that turns it green is the
next entry, a bridge poll on the new image.

Memory headroom for that poll and every nightly after it: the full feed on
this code peaked at **~284 MB RSS** (a dev poll under a 400 MB heap cap,
64,093 observed, 0 failures, 13 min, 2026-10-28), against **~416 MB
available** on the droplet with app, worker and caddy running (oplog 0001,
2026-10-27 08:37) — ~130 MB of margin, where the old code needed more than
V8's ~480 MB heap.

## Prerequisites
- [ ] topdog at `40cb846` plus this entry; ship bar on `40cb846`: vitest
      424/424 twice, typecheck clean, e2e 34/34 against the dev build
      (2026-10-28, the bridge worktree, identical tree).
- [ ] `40cb846` pushed on its own, then this entry; CI green on `40cb846`:
      `verify`, `images`, `sourcemaps`.
- [ ] e2e against the published app image (`npm run e2e:prod` on
      `ghcr.io/loganbresnahan/monster-paws-app:40cb846…` on `:3200`, reading
      `monsterpaws_e2e`).
- [ ] `pass` unlocked by Logan (the DO token, for the droplet's address).
- [ ] Not within an hour of 07:00 or 08:30 UTC.
- [ ] The dev box free: lora held off the card (the moderator session), nobody
      on `:3100`/`:3200` or `monsterpaws_e2e`, no bridge poll running.
- [ ] Production steps run by Logan in his own terminal, one SSH session per
      step (the droplet's ufw `LIMIT` on 22/tcp).

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && grep -c ^INGEST_POLL_SCHEDULE= .env; git log --oneline -1'
    curl -s https://monsterpaws.org/api/health
Verify: `IMAGE_TAG=c45e085…`, no `INGEST_POLL_SCHEDULE` line (count 0),
checkout `c45e085`; health 503 with sha `c45e085…`, `pollStale true`,
`lastCompletePollAt 2026-10-27T08:27:06Z`.
Rollback: n/a — this is the record.

### 2. Pull the release and set the switch, one SSH session; nothing restarts
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=40cb846dfa5eec24377295234b1117f5772ff0b4/" .env &&
      echo INGEST_POLL_SCHEDULE=off >> .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images &&
      grep -c ^INGEST_POLL_SCHEDULE=off .env'
Verify: checkout at topdog's head; both images resolve to `40cb846…` and are
pulled; the switch line counted once; app and worker still running `c45e085`
(the old worker never reads the switch).
Rollback: `IMAGE_TAG` back to `c45e085…`, delete the `INGEST_POLL_SCHEDULE`
line, `git checkout c45e085` — nothing runs the new images yet.

### 3. Switch
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml up -d app worker &&
      sleep 10 && docker compose -f docker-compose.prod.yml logs --tail 20 worker'
    curl -s https://monsterpaws.org/api/health
Verify: app and worker run `40cb846…`; the worker logs
`INGEST_POLL_SCHEDULE=off — ingest.poll unscheduled; the bridge polls` and
NOT `ingest.poll registered`; health answers with sha `40cb846…` — still 503,
`pollStale true` (expected until the next entry's poll); caddy untouched.
Rollback: `IMAGE_TAG` back to `c45e085…`, delete the switch line, `up -d app
worker` — the old worker re-registers the 07:00 schedule at boot.

### 4. Prove the schedule is gone from pg-boss, one SSH session
    ssh root@$IP 'cd monsterpaws && docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" \
      -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -Atc \"SELECT count(*) FROM pgboss.schedule WHERE name = '"'"'ingest.poll'"'"'\""'
Verify: `0` — pg-boss holds no cron row for `ingest.poll`, so no 07:00 job
is created tomorrow. The query prints a count only; the connection string
stays inside the container.
Rollback: step 3's.

### 5. Smoke
    for p in / /animals /claim /demo; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    curl -s https://monsterpaws.org/ | grep -o 'href="https://[^"]*\(linkedin\|x\.com\|bsky\|instagram\|facebook\|youtube\)[^"]*"'
Verify: 200 for every page and one animal page cold; the footer carries the
six profile hrefs (ADR-0032 as amended).
Rollback: step 3's.

### 6. Dogfood handoff (Logan)
The footer on a phone and at xl width (one line, six profiles); an animal
page cold. The poll itself is the next entry.

## Run

## Follow-ups
- The next entry: a bridge poll on `40cb846` (`scripts/poll-via-bridge.sh`),
  which should complete and turn health green.
