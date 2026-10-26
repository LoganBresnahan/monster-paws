# 0001: Production launch — browse first: database, animal pages, the crew, worker, error reporting

Status: planned
Planned: 2026-09-29, revised 2026-10-26 · Run: —
Why: roadmap item 3b; ADR-0028 as amended 2026-10-23 (browse before the
donate loop) and 2026-10-26 (the home section includes `/demo`); ADR-0010 as
amended 2026-09-28 / 2026-09-29, ADR-0015, ADR-0017, ADR-0007 as amended;
`doc/infra.md` steps 6 and 7
Commit deployed: —

Production today is the v0.1.0 landing page from `hotfix/next-16.3.8`
(`c58d87f`, oplog 0002) with no database; the worker container runs but idles
because `DATABASE_URL` is unset. This entry turns on, in one run: Managed
Postgres, the animal pages over a first poll of RescueGroups, today's home
page (the crew, "How it works, with Ducky", `/demo`), the worker's daily poll,
Better Stack error reporting and the poll heartbeat.

**Revised 2026-10-26 for browse first** (ADR-0028 as amended 2026-10-23):
Chicago shelters reading the consent email should find real animals and a
real home page, so the database and pages launch now and the donate loop,
keepsake art and the home worker's scoped credentials follow in their own
entries. Nothing here takes a donation: no page has a Sponsor button
(ADR-0015 decision 6), `/demo` moves no money, and every page says a donation
goes to the shelter and we keep $0, never "100%" (ADR-0002 as amended
2026-10-26). The 2026-10-05 re-scope (the whole loop first) is superseded.

**Production starts from an empty database** (Logan, 2026-10-26; ADR-0003 as
amended): migrations, then a first poll — the dev corpus since 2026-08-25
stays in dev and its `var/dumps/` copies, never restored here. **The off-DO
backup goes live in the same sitting** (step 9): nightly, not weekly, with the
vault key kept out of the shared `.env`.

## Prerequisites
- [ ] Roadmap item 3b's launch prerequisites hold for browse: SDK
      integration, `lastCompletePollAt`, the disappearance-rate gate and the
      revalidation decision are done (2026-09-30 / 10-01); the UI audit's
      open items are not launch-blocking for browse — the browse disclaimer
      wording (`doc/issues.md`, UI) ships as it reads today and is dogfooded
      in step 9, and the donation flow is no longer on these pages.
- [ ] topdog is pushed and CI is green on the commit being deployed:
      `images` pushed `monster-paws-app:<sha>` and `monster-paws-worker:<sha>`
      (ADR-0007), and **`sourcemaps` is green for that sha** — errors that
      arrive before the maps are processed stay minified forever (ADR-0010 as
      amended 2026-09-30). The job's green check is the gate, never a timer.
- [ ] `npm run e2e` green on that commit locally (`/deploy` step 2): 23
      specs as of 2026-10-26, the demo and the crew's lightbox among them.
- [ ] The droplet is on `hotfix/next-16.3.8` with `IMAGE_TAG` pinned to
      `c58d87f…` (oplog 0002; `/api/health` reported that sha 2026-10-26) —
      step 4 moves it back to `topdog`.
- [ ] `pass` is unlocked and holds `digitalocean/api-token`,
      `rescuegroups/api-key`, `betterstack/errors-dsn`,
      `betterstack/heartbeat-ingest-poll`, `betterstack/uptime-token`,
      `cloudflare/r2-vault-access-key-id`, `cloudflare/r2-vault-secret-access-key`,
      `cloudflare/r2-endpoint`;
      `gh secret list` shows `BETTERSTACK_ERRORS_DSN` and
      `BETTERSTACK_SOURCEMAPS_TOKEN`.
- [ ] Nothing else is changing production today.
- [ ] Not within an hour of 07:00 UTC — the scheduled poll must not overlap
      the manual first one (step 7).

## Steps

### 0. Push topdog and wait for CI
    git push origin topdog
    gh run watch "$(gh run list --branch topdog --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
Verify: the run is green, `images` and `sourcemaps` included; `<sha>` below
is that run's head sha.
Rollback: n/a — nothing on the droplet has changed.

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
image is what dev and CI run — confirm `create extension vector` works). Read
the cluster's Backups tab and record in **Run** what this size gets: daily
backups only, or point-in-time restore too (ADR-0003 as amended 2026-10-26).
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
names exactly once each (names only — never cat the file). No Every.org
credential goes in: nothing in this release reads one.
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
Verify: every migration under `drizzle/` applied, through `0011` (the donor
schema, ADR-0027 — its tables ship empty and nothing writes them yet); `\dt`
shows `raw_payloads`, `animals`, `animal_identities`, `animal_display`,
`event_log`, `ingest_runs`, and the donor tables (`donation_intents`,
`keepsake`, `email_suppressions`, …).
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
`/animals` renders an empty browse, not a 500; the home page shows the crew
and `/demo` walks through.
Rollback: set `IMAGE_TAG` back to the step-1 sha, `git checkout
hotfix/next-16.3.8`, `up -d`, and unpause 4995794; the landing page returns.

### 7. Run the first poll by hand
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml \
      run --rm worker npm run ingest -- poll'
    # in a second session, the whole time:
    ssh root@$IP 'docker stats --no-stream; free -m'
Verify: the run summary reports ~60–85k observed (63,198 on dev,
2026-10-26), 0 failures, and a complete run (no `lifecycleSkipped`); nothing
disappears on an empty database, so the rate gate passes by construction.
`/api/health` is now **200**, its `lastCompletePollAt` this run's finish — the
CLI records its run in `ingest_runs` exactly as the worker's job does; memory
stays under the DO alert (90%); `/animals` lists animals, the State filter
narrows to IL (1,978 visible on dev that day), and a detail page renders with
its photos, tracker and — where the source published one — its "full listing"
link. Record the counts and the duration in **Run**.
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

### 9. The nightly off-DO backup (ADR-0003 as amended 2026-10-26)
    U=$(pass show betterstack/uptime-token)
    curl -s -X POST https://uptime.betterstack.com/api/v2/heartbeats -H "Authorization: Bearer $U" \
      -H "Content-Type: application/json" -d '{"name":"db backup — nightly 08:30 UTC",
      "period":86400,"grace":7200,"email":true}' \
      | jq -r .data.attributes.url | pass insert -m betterstack/heartbeat-db-backup
    for pair in R2_VAULT_ACCESS_KEY_ID:cloudflare/r2-vault-access-key-id \
                R2_VAULT_SECRET_ACCESS_KEY:cloudflare/r2-vault-secret-access-key \
                R2_ENDPOINT:cloudflare/r2-endpoint \
                HEARTBEAT_DB_BACKUP_URL:betterstack/heartbeat-db-backup; do
      var=${pair%%:*}; entry=${pair#*:}
      printf '%s=%s\n' "$var" "$(pass show "$entry" | head -n1)" \
        | ssh root@$IP 'umask 077; cat >> monsterpaws/.env.backup'
    done
    ssh root@$IP 'monsterpaws/scripts/backup-db.sh'          # the first copy, by hand
    ssh root@$IP 'echo "30 8 * * * root /root/monsterpaws/scripts/backup-db.sh >> /var/log/monsterpaws-backup.log 2>&1" \
      > /etc/cron.d/monsterpaws-backup'
Verify: the script prints `pgdump/<date>.sql.gz` and a size over 1 MB, and
`rclone_r2 vault lsl r2:monsterpaws-vault/pgdump/` (from dev) lists it; the
heartbeat shows "up". The key stayed out of the worker's reach:
`ssh root@$IP 'grep -c R2_VAULT monsterpaws/.env; stat -c %a monsterpaws/.env.backup'`
prints `0` and `600`, and `docker exec monsterpaws-worker-1 env | grep -c R2_VAULT`
prints `0`. `/etc/cron.d/monsterpaws-backup` exists with that one line. Add
the heartbeat's id to infra.md's registry row in the same commit as **Run**.
Rollback: `rm /etc/cron.d/monsterpaws-backup monsterpaws/.env.backup`, delete
the heartbeat, `pass rm betterstack/heartbeat-db-backup`; the uploaded dump is
harmless and stays.

### 10. Smoke and dogfood (`/deploy` steps 4–5)
Verify: both uptime monitors green (4995794 is the silent-worker alert now: it
goes red 27 h after the last complete poll); one deliberate error reaches Better Stack
tagged with the deployed sha and `environment=production`; whether "The
destination stream closed early" (`doc/issues.md`, UI) arrives there as an
error is noted in **Run**. Logan, on a phone and a laptop: the home page's
first screen shows the crew; a painting and a photo open whole and carry the
mark; the demo walks from pick to adoption day; browse, filter to Illinois,
open a detail page, follow the listing link; the favicon is the M. The next
morning's 07:00 UTC poll pings its heartbeat on its own, and the 08:30 UTC
backup lands in the vault and pings its own.
Rollback: step 6's rollback.

## Run
—

## Follow-ups
—
