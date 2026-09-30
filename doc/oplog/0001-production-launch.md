# 0001: Production launch — database, animal pages, worker, error reporting

Status: planned
Planned: 2026-09-29 · Run: —
Why: roadmap item 3b; ADR-0010 as amended 2026-09-28 / 2026-09-29, ADR-0015,
ADR-0017, ADR-0007 as amended; `doc/infra.md` steps 6 and 7
Commit deployed: —

Production today is the v0.1.0 landing page with no database; the worker
container runs but idles because `DATABASE_URL` is unset. This entry turns on
everything at once: Managed Postgres, the animal pages, the worker's daily
poll, Better Stack error reporting and the poll heartbeat. **Revise this plan
as each item 3b prerequisite lands** — it was drafted before they were built,
and a step that changed underneath it must be rewritten here, not improvised
on the day.

## Prerequisites
- [ ] Roadmap item 3b's checklist is complete (SDK integration,
      `lastCompletePollAt`, the disappearance-rate gate, the revalidation
      decision) — every box checked, none "nearly".
- [ ] CI is green on the commit being deployed: `images` pushed
      `monster-paws-app:<sha>` and `monster-paws-worker:<sha>` (ADR-0007), and
      **`sourcemaps` is green for that sha** — errors that arrive before the
      maps are processed stay minified forever (ADR-0010 as amended
      2026-09-30). The job's green check is the gate, never a timer.
- [ ] The droplet is on `hotfix/next-16.3.8` with `IMAGE_TAG` pinned
      (oplog 0002) — step 4 moves it back to `topdog`.
- [ ] `npm run e2e` green on that commit locally too (`/deploy` step 2).
- [ ] `pass` holds `rescuegroups/api-key`, `betterstack/errors-dsn`,
      `betterstack/heartbeat-ingest-poll`; `gh secret list` shows
      `BETTERSTACK_ERRORS_DSN` and `BETTERSTACK_SOURCEMAPS_TOKEN`.
- [ ] Nothing else is changing production today.
- [ ] Not within an hour of 07:00 UTC — the scheduled poll must not overlap
      the manual first one (step 7).

## Steps

### 1. Record what is running — this is the rollback
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml images'
    curl -fsS https://monsterpaws.org/api/health
Verify: the image tags and the health sha are written into **Run** below
before anything else happens.
Rollback: n/a — this step *is* the rollback record.

### 2. Provision Managed Postgres (infra.md step 6)
    DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) \
      doctl databases create monsterpaws-pg --engine pg --version 16 \
      --size db-s-1vcpu-1gb --region nyc3
    # wait for status "online", then allow ONLY the droplet:
    doctl databases firewalls append <db-id> --rule droplet:<droplet-id>
    doctl databases connection <db-id> --private   # same region → private network
Store the private connection string straight into `pass` as
`digitalocean/database-url` (pipe it, never print it) and add that row to the
`infra.md` registry in the same commit as this entry's **Run**.
Verify: `doctl databases get <db-id>` shows online, PG 16, nyc3; the firewall
lists only the droplet; the `vector` extension is available (the pgvector
image is what dev and CI run — confirm `create extension vector` works).
Rollback: `doctl databases delete <db-id>` — it holds nothing yet.

### 3. Fill the droplet's `.env` — values piped, never echoed
    for pair in DATABASE_URL:digitalocean/database-url \
                RESCUEGROUPS_API_KEY:rescuegroups/api-key \
                SENTRY_DSN:betterstack/errors-dsn \
                HEARTBEAT_INGEST_POLL_URL:betterstack/heartbeat-ingest-poll; do
      var=${pair%%:*}; entry=${pair#*:}
      printf '%s=%s\n' "$var" "$(pass show "$entry" | head -n1)" \
        | ssh root@$IP 'cat >> monsterpaws/.env'
    done
Verify: `ssh root@$IP 'cut -d= -f1 monsterpaws/.env | sort'` lists the four
names exactly once each (names only — never cat the file).
Rollback: delete the four lines; the worker idles again without
`DATABASE_URL`.

### 4. Pull the release
    ssh root@$IP 'cd monsterpaws && git fetch origin && git checkout topdog && git pull &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<sha>/" .env &&
      docker compose -f docker-compose.prod.yml pull'
Verify: `docker compose config` resolves both images to `<sha>`; the pull
fetched them; nothing restarted yet.
Rollback: `git checkout hotfix/next-16.3.8` and restore the oplog-0002
`IMAGE_TAG` — nothing is running from the new images yet.

### 5. Migrate the new database
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml \
      run --rm worker npx drizzle-kit migrate'
Verify: every migration under `drizzle/` applied; `\dt` shows `raw_payloads`,
`animals`, `animal_identities`, `animal_display`, `event_log`, `ingest_runs`.
Rollback: drop and recreate the database — it is empty.

### 6. Start the new images
From here until step 7's poll completes, `/api/health` is 503 by design — no
complete poll exists yet (ADR-0010 as amended 2026-09-30) — so pause its
monitor first, or it opens an incident mid-launch:

    U=$(pass show betterstack/uptime-token)
    curl -s -X PATCH -H "Authorization: Bearer $U" -H "Content-Type: application/json" \
      -d '{"paused":true}' https://uptime.betterstack.com/api/v2/monitors/4995794
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml up -d'
    curl -sS https://monsterpaws.org/api/health     # -sS, not -f: a 503 is expected here
Verify: health is **503** with `"db":"up"`, `"lastCompletePollAt":null` and the
deployed sha (not `"dev"` — `doc/issues.md`); any other `db` value is a real
failure — stop. The worker log says `ingest.poll registered (0 7 * * *)`;
`/animals` renders an empty browse, not a 500.
Rollback: set `IMAGE_TAG` back to the step-1 sha, `git checkout
hotfix/next-16.3.8`, `up -d`, and unpause 4995794; the landing page returns.

### 7. Run the first poll by hand
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml \
      run --rm worker npm run ingest -- poll'
    # in a second session, the whole time:
    ssh root@$IP 'docker stats --no-stream; free -m'
Verify: the run summary reports ~64–85k observed, 0 failures, and a complete
run (no `lifecycleSkipped`); `/api/health` is now **200**, its
`lastCompletePollAt` this run's finish — the CLI records its run in
`ingest_runs` exactly as the worker's job does; memory stays under the DO alert (90%); `/animals` lists animals and a
detail page renders with its photos and tracker. Record the counts and the
duration in **Run**.
Rollback: the corpus is append-only and correct even if the run is partial;
a failed run is re-run, never cleaned up by hand.

### 8. Arm the heartbeat and the health monitor
    U=$(pass show betterstack/uptime-token)
    curl -s -X PATCH -H "Authorization: Bearer $U" -H "Content-Type: application/json" \
      -d '{"paused":false}' https://uptime.betterstack.com/api/v2/heartbeats/499765
    curl -s -X PATCH -H "Authorization: Bearer $U" -H "Content-Type: application/json" \
      -d '{"paused":false}' https://uptime.betterstack.com/api/v2/monitors/4995794
    curl -fsS "$(pass show betterstack/heartbeat-ingest-poll)"   # the manual run counts as today's
Verify: the heartbeat and monitor 4995794 both show "up" in Better Stack. The
ingest CLI does not ping the heartbeat — only the worker's job does — hence
the manual ping; it does write `ingest_runs`, which is what the monitor reads.
Rollback: PATCH `{"paused":true}` on both.

### 9. Smoke and dogfood (`/deploy` steps 4–5)
Verify: both uptime monitors green (4995794 is the silent-worker alert now: it
goes red 27 h after the last complete poll); one deliberate error reaches Better Stack
tagged with the deployed sha and `environment=production`; browse, filter,
open a detail page, follow the listing link; the next morning's 07:00 UTC
poll pings the heartbeat on its own.
Rollback: step 6's rollback.

## Run
—

## Follow-ups
—
