# 0030: Deploy `83b2bc9` — the wording and fixes, before the claimed-shelter wave

Status: planned
Planned: 2026-11-04 · Run: —
Why: Logan wants the claimed-shelter wave sent this morning, Chicago time, with a link to `/privacy`: "we need to deploy before we send these emails" (to the `emails` session, relayed by the moderator). This image fixes the line he'll link to. Roadmap: Accounts and donating (item 4), Shelter consent (item 5)
Commit deployed: `83b2bc9`, with the `emails` session's wording and `/privacy`'s Sponsor-button line, named by the moderator. This entry follows in its own push so the image tag is the code commit.

What changes on the droplet: the app and worker images. No `.env`, Caddy, compose or DNS change, and no migration unless the prerequisite below says otherwise.

What this opens: nothing. `SHELTERS` stays empty, so there's no Sponsor button and nothing paints. `/test-gift`'s code is gone, `/thanks` and the wording are in, and so are the share fixes. `ART_SWEEP` stays on with nothing to do, and `EMAIL_SWEEP` stays unset. The art worker on this box stays where it is.

Who does what: **Logan gives the word for step 1, in the session that runs it.** The outreach wave's `send --live` is his, after this. Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] CI green on `83b2bc9`: `verify`, `images`, `sourcemaps`, run 41853891768.
- [x] Ship bar on `83b2bc9`, in a temporary checkout at exactly that sha, 2026-11-04 15:04 to 15:11 UTC: vitest 911 of 911 twice with `--maxWorkers=2`, typecheck clean, `npm run e2e` 59 of 59.
- [x] e2e against the published app image, Every.org set to production, 2026-11-04 15:12 UTC: 46 passed in 11.0 s, 13 skipped under `PW_BASE_URL`; `/privacy` clear of "gift", "account" and "stop taking donations", `/claim` holds its line, `/test-gift` 404. The published worker image booted on a throwaway database: up after 24 s, 0 fatal lines, no `art.generate` queue.
- [x] `git diff --name-status 0989a18 83b2bc9 -- public drizzle Caddyfile docker-compose.prod.yml` read, 2026-11-04: it prints nothing, so no purge, no migration and no config change. 19 migrations at this sha.
- [ ] `pass` unlocked by Logan.
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC, and the night's log shows `== exit`.
- [ ] The moderator holds the card.

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 &&
      for k in ART_SWEEP EMAIL_SWEEP WORKER_MODE; do printf "%s " $k; grep -c "^$k=" .env; done'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG` is `0989a18cf020f1211dde8a2d8dd2e24c1ef4ea2a`, recorded in Run; `ART_SWEEP 1`, `EMAIL_SWEEP 0`, `WORKER_MODE 0`; health 200.
Rollback: n/a — the record.

### 2. Pull the release, one SSH session; nothing restarts
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=83b2bc901e68e87b251d3f1a8e98ba228b5481d7/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images'
Verify: the checkout at this entry's commit; app and worker resolve to `83b2bc9` and are pulled; all three still run the old containers.
Rollback: `IMAGE_TAG` back to step 1's sha; `git checkout <step 1's sha>`, then `git checkout topdog` later.

### 3. The timed roll, with a POST every half second
    : > roll.log; ( for i in $(seq 1 180); do curl -sS -m 40 -o /dev/null -w '%{http_code} %{time_total}\n' -X POST --data x \
        https://monsterpaws.org/api/webhooks/everyorg/wrong >> roll.log 2>&1 & sleep 0.5; done; wait ) & L=$!
    sleep 5; date -u +%T; ssh root@$IP 'cd monsterpaws && time docker compose -f docker-compose.prod.yml up -d app worker'; date -u +%T; wait $L
    cut -d' ' -f1 roll.log | sort | uniq -c; sort -k2 -n roll.log | tail -1
    curl -fsS https://monsterpaws.org/api/health
Verify: every line is 404, the slowest under 30 s; health 200 on `83b2bc9`; Caddy not recreated; the worker up 20 s on with no `fatal`.
Stop if: any 5xx, or the worker restarting.
Rollback: `IMAGE_TAG` back to step 1's sha, `up -d app worker`, after listing `/spool`.

### 4. Live checks: the words, and nothing painting
    for p in / /animals /privacy /claim /thanks /demo; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    curl -s -o /dev/null -w "test-gift %{http_code}\n" https://monsterpaws.org/test-gift/anything
    T=$(head -c 16 /dev/urandom | base64 | tr '+/' '-_' | tr -d '='); curl -s -o /dev/null -w "unknown share %{http_code}\n" "https://monsterpaws.org/share/$T"
    curl -s https://monsterpaws.org/privacy | sed 's/<[^>]*>//g' | grep -ciE "\bgifts?\b|\baccount\b|stop taking donations"
    curl -s https://monsterpaws.org/privacy | grep -c "The painting also gets its own page"
    curl -s https://monsterpaws.org/claim | sed 's/<[^>]*>//g' | grep -c "We work with the shelters whose animals you can sponsor"
    ssh root@$IP 'cd monsterpaws && docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -c \"SELECT count(*) FROM keepsake\" -c \"SELECT count(*) FROM painting_email_sends\" -c \"SELECT count(*) FROM pgboss.job WHERE name = '"'"'art.generate'"'"'\"" </dev/null'
Verify: six pages 200; `test-gift` and the unknown share 404; the first `/privacy` grep `0`; the next two `1`; `keepsake 0`, sends `0`, jobs `0`. **Logan reads `/privacy` himself before he links it.**
Rollback: step 3's.

## Run
<filled in as it happens>

## Follow-ups
- Logan's claimed-shelter wave, by `npm run outreach -- send --live`, only by him.
- Oplog 0029, a small deploy on top if Spencer's yes comes in.
