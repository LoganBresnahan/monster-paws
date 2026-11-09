# 0035: Deploy `a933820`: C.A.R.E.'s grant, and the Sponsor button opens on its animals

Status: planned
Planned: 2026-11-09 · Run: —
Why: ADR-0028 as amended 2026-11-09, ADR-0002 as amended 2026-11-02, ADR-0015 as amended 2026-11-04. Logan: "another shelter wants to allow us to paint ... so we need to get them sponserable pronto. ... i suppose their animals should slot in with spencers in the order they were listed"
Commit deployed: `a933820` (`a9338201cc5077bc39dd3ad3edf9776fc1ea99f2`). Rollback: `221b6cd`. This entry follows in its own push, so the image tag is the code commit.

What changes on the droplet: the app and worker images, and one `shelter_nonprofits` row. On this box: the art worker restarts from `/home/oof/monsterpaws-art-a933820`.

**What this opens: a real-money Sponsor button on C.A.R.E.'s listings (Cat/Canine Assistance, Referral & Education, `rescuegroups:org:4821`, Sherman Oaks, CA), cats and dogs, beside Spencer's.** A recorded donation paints and mails exactly as Spencer's do (oplog 0029). A cat paints without the photo reader, which is for dogs only (`READER_SPECIES`), as in 0029's rehearsal. The order needs no code: under the default Sort, "Sponsorable first", the list leads with every shelter `sponsorableShelterIds` returns, newest-listed first, so C.A.R.E.'s animals fall in among Spencer's by `listed_at`.

What ships besides the grant, all already running at home in the art worker since `d15dd23`: the photo reader (`d7f90c8`, `ab34160`) and the memory wait (`d15dd23`). On the droplet their only effect is one extra abort at shutdown, in `src/worker/index.ts`, which holds no art job there. No migration (19 at this sha, as on production), and nothing in `Caddyfile`, `docker-compose.prod.yml` or `public/` changed since `221b6cd`, so no purge.

Who does what: the moderator runs every step on Logan's own "go 0035". Logan makes step 7's donation if he chooses. Production steps run in one SSH session each (ufw `LIMIT` on 22/tcp).

Left out on purpose:
- **e2e against the published app image.** Since `221b6cd`, the droplet's code differs only by the registry and art-only code. `npm run e2e` on this sha builds and serves the production build.
- **Any change to the sort.** See above.

## Prerequisites
- [x] **C.A.R.E.'s yes:** "Thank you and sure, go ahead and paint away. Yes, these are all our images to share.", from Mary, signing for C.A.R.E. from the shelter's own address, at 2026-11-08 02:56:50 UTC. It answers Logan's email of 2026-11-04, which asked both questions and gave the newer withdrawal term. DKIM, SPF and DMARC pass for `care4pets.org`. The raw message, exported by Logan from Gmail, is 14,743 bytes, and its start, end and size match the Gmail API's raw. `evidenceOf` reads Message-ID `<1a1b9165453.2afd294c3474891.900162816372033612@care4pets.org>` and sha256 `c9f54770b64c6ba9cd9bfa519b498ffe26f087737a1b62b13ce2f33ebce77275`, the registry's. The file is in the moderator's scratchpad and never enters this repo: it holds both addresses.
- [x] Every.org's API read on the day, 2026-11-09 03:03 UTC: `care4pets`, EIN `954347009`, `hasAdmin` and `donationsEnabled` both true. The outreach match recorded the same EIN, checked by Logan, on 2026-11-04.
- [ ] The ship bar on `a933820`: vitest twice, typecheck clean, `npm run e2e`.
- [ ] CI green on `a933820`, with both images published.
- [ ] `/home/oof/monsterpaws-art-a933820` holds `git archive a933820`, `EXPORTED_FROM` `a933820`, `d15dd23`'s `node_modules` hard-linked (the same `package-lock.json`), and `var` linked to the main checkout's. Its `src/` differs from `d15dd23`'s only in `src/core/shelters.ts`.
- [ ] `pass` unlocked.
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log shows `== exit`. No roll in progress.
- [ ] No ComfyUI, guard, build or test running; the art worker idle, with no `art.generate.waiting` since its last `painted`.
- [ ] Logan's "go 0035", to this session.

## Steps

### 0. The raw message into the vault

    S=<the moderator's scratchpad>/care
    RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ENDPOINT="$(pass show cloudflare/r2-vault-endpoint | head -n1)" \
    RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(pass show cloudflare/r2-vault-access-key-id | head -n1)" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(pass show cloudflare/r2-vault-secret-access-key | head -n1)" \
    sh -c 'rclone copyto "$0/care4pets-2026-11-08.eml" "r2:monsterpaws-vault/consent/rescuegroups:org:4821-2026-11-08.eml" && rclone cat "r2:monsterpaws-vault/consent/rescuegroups:org:4821-2026-11-08.eml" | sha256sum' "$S"

Verify: the hash starts `c9f54770b64c6ba9`, the registry's.
Stop if: it differs. Nothing in the button depends on this step, but the evidence does.
Rollback: `rclone deletefile`.

### 1. Record what is running: this is the rollback

    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 && cp .env .env.before-0035 && chmod 600 .env.before-0035 &&
      docker compose -f docker-compose.prod.yml ps --format "{{.Service}} {{.Image}} {{.Status}}" && df -h / | tail -1 &&
      for k in ART_SWEEP EMAIL_SWEEP EMAIL_LIVE WORKER_MODE; do printf "%s " $k; grep -c "^$k=" .env; done'
    curl -fsS https://monsterpaws.org/api/health

Verify: `IMAGE_TAG` is `221b6cdb5c97a8b731011b62807f1f11623f937f`; `ART_SWEEP`, `EMAIL_SWEEP` and `EMAIL_LIVE` count `1`, `WORKER_MODE` `0`; at least 5 GB free; health 200 on `221b6cd`.
Stop if: less than 5 GB free. Old images come off first, in their own entry, as 0031 did.
Rollback: n/a, the record.

### 2. The art worker restarts from the checkout holding the grant
`keepsakeShare` reads `SHELTERS` from its own code, and publish refuses a keepsake whose basis isn't there. So this goes first: with the old images serving, no C.A.R.E. keepsake can exist yet, and the new code differs from the running code only in the registry.

    P=$(pgrep -f 'monsterpaws-art-d15dd23/node_modules/.bin/tsx'); echo "pid $P"; kill -TERM $P
    for i in $(seq 1 60); do pgrep -f monsterpaws-art-d15dd23 >/dev/null || break; sleep 1; done; pgrep -fc monsterpaws-art-d15dd23
    cd /home/oof/monsterpaws-art-a933820 && \
    DATABASE_URL="$(pass show digitalocean/pg-home-worker-url | head -n1)" \
    NODE_EXTRA_CA_CERTS=/home/oof/monsterpaws/var/do-ca.crt \
    WORKER_MODE=art ART_STORE_DIR=/home/oof/monsterpaws/var/keepsakes-production \
    SHARE_PUBLISH=on SHARE_WRITE_BUCKET=monsterpaws-media \
    SHARE_WRITE_ENDPOINT="$(pass show cloudflare/r2-endpoint | head -n1)" \
    SHARE_WRITE_ACCESS_KEY_ID="$(pass show cloudflare/r2-access-key-id | head -n1)" \
    SHARE_WRITE_SECRET_ACCESS_KEY="$(pass show cloudflare/r2-secret-access-key | head -n1)" \
    SENTRY_DSN="$(pass show betterstack/errors-dsn | head -n1)" \
    RESCUEGROUPS_API_KEY= ART_SWEEP= \
    nohup npm run worker >> var/explore/art-worker-production.log 2>&1 &

Verify: the old processes count `0`. The log's next lines read `art store bound to database defaultdb`, then `art.generate registered (WORKER_MODE=art)`, with no error after 2 minutes, and `pgrep -f monsterpaws-art-a933820` finds it.
Stop if: it doesn't register. Start it again from `/home/oof/monsterpaws-art-d15dd23` with the same command, and stop the entry.
Rollback: SIGTERM, and the same command from `/home/oof/monsterpaws-art-d15dd23`. Donations wait meanwhile, and the sweep alerts after 30 minutes.

### 3. Pull the release, one SSH session; nothing restarts

    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=a9338201cc5077bc39dd3ad3edf9776fc1ea99f2/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images && ls drizzle/*.sql | wc -l'

Verify: the checkout at this entry's commit; app and worker resolve to `a933820` and are pulled; 19 migrations; all three still run the old containers.
Rollback: `IMAGE_TAG` back to step 1's sha; `git checkout <step 1's sha>`, then `git checkout topdog` later.

### 4. C.A.R.E.'s row, then the timed roll, which opens the button
Both are needed for a Sponsor button: `sponsorNonprofit` reads the grant from the image and the row from the database. The row goes in first, while the old images, which hold no C.A.R.E. grant, still serve, so it opens nothing on its own.

    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At"' <<'SQL'
    INSERT INTO shelter_nonprofits (shelter_external_id, everyorg_slug, ein, source, fetched_at, everyorg_claim, claim_checked_at)
    VALUES ('rescuegroups:org:4821', 'care4pets', '95-4347009', 'Every.org API, read 2026-11-09 03:03 UTC: hasAdmin and donationsEnabled true; Mary said yes for C.A.R.E., 2026-11-08', now(), 'claimed', now());
    SQL
    first() { curl -s "https://monsterpaws.org/animals?$1" | grep -oE 'href="/animals/[0-9]+"' | grep -oE '[0-9]+' | head -1; }
    C=$(first shelter=rescuegroups%3Aorg%3A4821)
    curl -s https://monsterpaws.org/animals/$C/sponsor -o /dev/null -w 'care sponsor before the roll %{http_code}\n'
    : > roll.log; ( for i in $(seq 1 180); do curl -sS -m 40 -o /dev/null -w '%{http_code} %{time_total}\n' -X POST --data x \
        https://monsterpaws.org/api/webhooks/everyorg/wrong >> roll.log 2>&1 & sleep 0.5; done; wait ) & L=$!
    sleep 5; date -u +%T; ssh root@$IP 'cd monsterpaws && time docker compose -f docker-compose.prod.yml up -d app worker'; date -u +%T; wait $L
    cut -d' ' -f1 roll.log | sort | uniq -c; sort -k2 -n roll.log | tail -1
    curl -fsS https://monsterpaws.org/api/health

Verify: `INSERT 0 1`; C.A.R.E.'s sponsor page `404` before the roll; every probe line `404`, the slowest under 30 s; health 200 on `a933820`; the worker up 20 s on with no `fatal`.
Stop if: any 5xx, or the worker restarting.
Rollback: `IMAGE_TAG` back to step 1's sha and `up -d app worker`, after listing `/spool`. **That closes C.A.R.E.'s button**, since the old image holds no grant for it. The row stays and does nothing, and Spencer's button stays open.

### 5. Live: the button is on C.A.R.E.'s and Spencer's animals, and nobody else's
An id for each is read from the site itself, so it's an animal a visitor can see. `O` is the first card of a filtered list,
which keeps the old order, and the read below confirms its shelter is neither:

    C=$(first shelter=rescuegroups%3Aorg%3A4821); S=$(first shelter=rescuegroups%3Aorg%3A11756); O=$(first state=NY)
    for p in / /animals /privacy "/animals/$C" "/animals/$C/sponsor" "/animals/$S/sponsor" "/animals/$O"; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    curl -s -o /dev/null -w "another shelter's sponsor %{http_code}\n" https://monsterpaws.org/animals/$O/sponsor
    curl -s https://monsterpaws.org/animals/$C | grep -cE "has not partnered|Not affiliated"
    curl -s https://monsterpaws.org/animals/$O | grep -cE "has not partnered"
    curl -s https://monsterpaws.org/animals/$C/sponsor | grep -cE "Our thank-you|try to paint"

And the order: the first page of `/animals`, read back against the database in one read-only session.

    curl -s https://monsterpaws.org/animals | grep -oE 'href="/animals/[0-9]+"' | grep -oE '[0-9]+' | awk '!s[$0]++' | head -30 | paste -sd, > ids
    ssh root@$IP '...psql, as step 4...' <<SQL
    BEGIN READ ONLY;
    SELECT a.id, a.shelter_external_id, a.listed_at FROM animals a WHERE a.id IN ($(cat ids)) ORDER BY array_position(ARRAY[$(cat ids)]::bigint[], a.id);
    SELECT 'other', a.id, a.shelter_external_id FROM animals a WHERE a.id = $O;
    ROLLBACK;
    SQL

And the donate link, by reading what C.A.R.E.'s sponsor form submits: `care4pets`, production's Every.org, and the production token, with no value printed.
Verify: all 200 except another shelter's sponsor page, `404`. The partner lines count `0` on C.A.R.E.'s page and at least `1` on the other. The sponsor wording counts at least `1`. The first page leads with C.A.R.E.'s and Spencer's animals mixed together, in falling `listed_at`, before any other shelter's. **Logan opens a C.A.R.E. listing himself.**
Stop if: another shelter's sponsor page answers 200. Roll back.
Rollback: step 4's.

### 6. The day's watch
The worker's first sweep after the roll, read in its log: no error naming `shelters`, `keepsake` or `care4pets`. And `node scripts/error-report-counts.mjs now-1h now`, which should show no new report since step 4.
Verify: as written.
Rollback: step 4's, on a new report that names this deploy.

### 7. A real donation to a C.A.R.E. animal, Logan's call
If he makes one, it's read as 0029's step 8 was: `recorded` up by one; a keepsake whose facts carry basis `grant:care4pets:digify`; the art worker's `painted` line with `published: true`; one row in `painting_email_sends` with `sent_at`; `email.delivered`. If he skips it, the Run says so, and the first real donor's set is read the same way.
Verify: as written.
Stop if: publish refuses the keepsake. That is the art worker's registry, so step 2 is checked again.
Rollback: a real donation isn't undone.

### 8. The record
`doc/roadmap.md`'s go-live line names both shelters, `a933820` and the art worker's new checkout, in the commit that fills in this Run.
Verify: `git show --stat` names it.
Rollback: not applicable.

## Run

(Filled in while running.)

## Follow-ups
- `.env.before-0035` is deleted once the deploy has held a day, since it holds secrets.
- `/home/oof/monsterpaws-art-d15dd23` stays until the new worker has painted once, then goes with the older exports.
