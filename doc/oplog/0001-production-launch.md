# 0001: Production launch — browse first: database, animal pages, the crew, worker, error reporting

Status: planned
Planned: 2026-09-29, revised 2026-10-26 · Run: 2026-10-27 01:12 UTC –
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
Logan approved the run 2026-10-26 (local evening); started 2026-10-27 01:12 UTC.

**0. Push and CI.** topdog pushed at `34d36ff` (b9d7c07..34d36ff, 14 commits);
CI run 40431254413. Ship bar on that code the same evening: vitest 309/309
twice, typecheck clean, e2e 29/29 on the production build.

**1. What was running (the rollback).** Droplet `monsterpaws` (nyc3, 1 GB) on
`hotfix/next-16.3.8` at `c58d87f`; `IMAGE_TAG=c58d87f7ee095ab9f81f947bce4aacca7c5c21b9`
for both `monster-paws-app` and `monster-paws-worker`, caddy `2-alpine`. `.env`
held `IMAGE_TAG` and `NODE_ENV` only. `/api/health`
`{"ok":true,"sha":"c58d87f…","uptimeSec":2277021}`. No Managed Postgres
existed (`doctl databases list` empty). Memory 957 MB total, 509 MB available;
disk 48% used.

**Gate before the droplet.** CI 40431254413 green: verify, images, sourcemaps.
The published images `34d36ffb3e1d57a412c4851d1bd5346109701942` pulled; e2e
29/29 against that app image (`npm run e2e:prod`), its health reporting the
sha; the worker image's `npx drizzle-kit migrate` on an empty scratch database
applied all 12 migrations (0000–0011), 19 tables. Logan chose to keep the
worker running beside step 7's hand-run poll and measure memory, since a poll
by hand beside the live worker is how recovery runs work later.

**2. Managed Postgres.** `monsterpaws-pg` (id `a464ff4f…`), PG 16, db-s-1vcpu-1gb,
nyc3, one node, created 01:29 UTC and online after ~280 s. Firewall: one rule,
`droplet:588758367`. The private connection string went straight into `pass`
as `digitalocean/database-url` (the cluster's admin user, `sslmode=require`);
never printed. From the droplet over the private network:
PostgreSQL 16.15, `vector` 0.8.7 available and created, `pg_trgm` 1.6
available. Backups (API, 2026-10-27): one daily, scheduled 15:55 UTC, every
24 h, the first taken at 01:33 UTC. **Point-in-time restore is offered** at this
size: Overview → Actions → Restore from backup reads "restore to any
transaction, as far back as 7 days" with "Choose a point in time" (Logan,
read 01:50 UTC). The same screen said "No backups available" twenty minutes
after creation although the API listed the 01:33 backup — to recheck after
the 15:55 UTC scheduled backup; a ticket to DO if it persists.

**3. `.env`.** The live `.env` was copied to `.env.before-0001` (mode 600)
first. The four values were piped from `pass`; a fifth, not in the plan,
`SENTRY_ENVIRONMENT=production`, because step 10 checks that tag and nothing
set it. SSH refused connections for about a minute after the burst of six
quick sessions (socket-activated sshd); the four appends had landed, the fifth
was re-run in one session, and from then on each step is one session. `.env`
had been mode 644 and is 600 now. Names checked once each, values never shown.

**4. Pull.** Checkout `topdog` at `34d36ff`; `IMAGE_TAG` set to that sha; both
images pulled, nothing restarted. The pull also fetched a newer
`caddy:2-alpine`, which step 6 picks up.

**5. Migrate — stopped, then fixed.** `drizzle-kit migrate` ended without
applying anything: `pg` treats `sslmode=require` as verify-full, and DO signs
the cluster with its own project CA, so every connection failed
`SELF_SIGNED_CERT_IN_CHAIN`. Fix (Logan chose verification over
`uselibpqcompat` encrypt-only): the cluster's CA from `doctl databases get-ca`
(CN "… Project CA", valid to 2036-10-24) at `monsterpaws/do-ca.crt` on the
droplet; `docker-compose.prod.yml` mounts it into app and worker as
`NODE_EXTRA_CA_CERTS`; `scripts/backup-db.sh` hands it to `pg_dump` as
`PGSSLROOTCERT`; the URL in `pass` and `.env` says `sslmode=verify-full`.
Proven first with a one-off container: connected, `ssl: true`. The compose
change ships in its own commit; the images stay `34d36ff` (no code changed).
Then `2be3acb` pulled onto the droplet (`IMAGE_TAG` unchanged) and
`drizzle-kit migrate` through the worker image: "migrations applied
successfully"; 12 rows in `drizzle.__drizzle_migrations`, 19 tables (accounts
through sign_in_links, the donor tables empty). The live site still served
`c58d87f` throughout.

**6. Start.** Monitor 4995794 paused 01:50 UTC; `up -d` started app and worker
at `34d36ff` and recreated caddy on the newer `2-alpine`. Health 503 as
designed (`db: up`, `lastCompletePollAt: null`, sha `34d36ff…`); `/`,
`/animals` (empty) and `/demo` 200; the worker logged `ingest.poll registered
(0 7 * * *)`. Memory: worker 152 MB waiting on the queue, app 81 MB, caddy
19 MB; 363 MB available, swap 70 MB.

**7. First poll — blocked by RescueGroups.** The poll exited at once with
`fetch failed`. From the droplet, every RescueGroups host resets the
connection mid-TLS-handshake (`ECONNRESET`, after Encrypted Extensions):
`api.rescuegroups.org` and `rescuegroups.org` alike, from the container and
from the host's own curl, while `example.com` answers 200. From Logan's home
machine the same API answers normally (404 on the bare `/v5/` path; this
morning's dev poll fetched 63,198). RescueGroups refuses the droplet's
address, not our code. Nothing was written; the database is empty.

**7, revised during the run — the first poll from home** (planned 02:15 UTC,
Logan's call: ask RescueGroups to allowlist the droplet, and bridge now).
`scripts/poll-via-home.sh` runs the same worker image (`34d36ff`, read from
the droplet's `.env`) with the same `npm run ingest -- poll` on Logan's
machine, where RescueGroups answers, writing to production through an SSH
tunnel to the droplet. The database firewall is unchanged (the droplet only);
the container resolves the database's own hostname to the tunnel, so TLS
still verifies against DO's CA. Everything rides ONE SSH connection: the
droplet's ufw `LIMIT` on 22/tcp refused this machine twice tonight after six
connections in 30 s.

    scripts/poll-via-home.sh            # pass unlocked; prints the run summary

Verify: the summary reports ~60–85k observed, 0 failures, a complete run; the
heartbeat ping succeeds; `/api/health` 200 with this run's
`lastCompletePollAt`; `/animals` lists animals and filters to IL. Dry run
first, read-only (02:12 UTC): connected through the tunnel, TLS verified,
`raw_payloads` 0; RescueGroups answered from home.
Rollback: none needed — append-only; a partial run is correct as far as it
got, and a failed run is run again.
Steps 8–10 then run as planned, except that the heartbeat and monitor stay
paused until RescueGroups allowlists the droplet: health is green only within
27 h of a complete poll, and from home that is only as daily as Logan runs it.

**7, run.** Started 02:16:24 UTC. Through the tunnel the poll is round-trip
bound — every write crosses home → droplet → database — at ~335 listings a
minute (5,700 stored by 02:33), so the first full poll takes ~3 hours where the
dev poll took 15 minutes; CPU here ~4%. Logan let it run overnight. A faster
shape (the poll on the droplet, only RescueGroups' requests leaving through
home) is a follow-up.

**9. Backup, run early** (02:35 UTC, while `pass` was unlocked — it would
relock before the poll ended). Heartbeat 518590 "db backup — nightly 08:30
UTC" created (24 h, grace 2 h), its URL straight into `pass` as
`betterstack/heartbeat-db-backup`. `.env.backup` written in one session: four
names, mode 600; `.env` holds no `R2_VAULT` line, and `docker exec
monsterpaws-worker-1 env` shows none. `scripts/backup-db.sh` by hand:
`pgdump/2026-10-27.sql.gz`, 10,021,979 bytes — the database mid-poll — listed
from dev with the vault key; heartbeat "up". `/etc/cron.d/monsterpaws-backup`
installed: `30 8 * * *`. The 08:30 run takes the first full copy.

**7, finished** 08:27:06 UTC, 6 h 11 min: `observed 63,435, persisted 63,434,
deduped 1, conflicted 0, failures 0`, one `animal.seen` per animal, a
complete `ingest_runs` row (02:16:25 → 08:27:06). Heartbeat pinged. Health
**200**: `db up`, `lastCompletePollAt 08:27:06`, `pollStale false`, sha
`34d36ff…`. `/animals`, `?state=IL` and `?zip=60614` each list a full page.
The droplet's own 07:00 job failed as expected — `ingest.poll` failed after 3
attempts by 07:49 with `ECONNRESET` (RescueGroups' block).
Memory after (08:37): app 115 MB, worker 72 MB, caddy 16 MB; 416 MB available,
swap 166 MB.

**9, first full copy.** The 08:30 cron: `pgdump/2026-10-27.sql.gz` 109,342,400
bytes, replacing the 02:37 mid-poll dump of the same date.

**10, smoke (machine).** 200 for `/`, an Illinois animal page, `/demo`,
`/demo/ducky`, `/demo/collection/ducky`, `/claim`, `/robots.txt`,
`/favicon.ico`. Left for Logan: the walk-through on a phone and a laptop, and
one deliberate error seen in Better Stack with the sha and `environment` tag.
Storage 10 GiB; maintenance window Tuesdays 00:15 UTC.

## Follow-ups
- RescueGroups asked (2026-10-27, Logan, in the 2026-08-02 key thread) to
  allowlist the droplet's address; until then, `scripts/poll-via-home.sh`
  every day or two, the heartbeat and monitor 4995794 paused, and the
  droplet's own 07:00 job failing once a day in Better Stack. When it is
  allowlisted: check from the droplet, then step 8 (unpause both). The script
  stays as a standing tool (Logan).
- ufw on the droplet allows 2375/2376 (the Docker API, left by DO's Docker
  image); nothing listens there (`dockerd -H fd://`) and the cloud firewall
  admits only 22/80/443 — remove the two rules in a later entry.
- The app connects as the cluster's admin user; a least-privilege role for
  app and worker.
