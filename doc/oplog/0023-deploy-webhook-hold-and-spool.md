# 0023: Deploy `12c451f` — the webhook survives a roll and a database failover

Status: run
Planned: 2026-11-03 · Run: 2026-11-04, 00:24 to 00:30 UTC
Why: ADR-0027 as amended 2026-11-03 (decision 8 is this entry's order). Aim: live before 2026-11-10 00:15 UTC, since
DigitalOcean's maintenance window still reads pending. Roadmap: Accounts and donating (item 4)
Commit deployed: `12c451f` (`verify`, `images` and `sourcemaps` green, CI run 41717322836), this entry following in its own push so the image tag is the code commit

If the Meta demo's site deploy goes first or together, its commits sit on the same line and carry this slice, so this entry
moves to that sha and says so here before step 1, as 0019 did. A separate UI deploy is oplog 0025.

What changes on the droplet: the app and worker images; migration `0016`, a new table and a backfill, no existing row
changed; Caddy restarted, for `lb_try_duration 30s`; a new named volume, `webhook_spool`, on app and worker; the compose
file's `WEBHOOK_SPOOL_DIR`. No `.env`, Cloudflare or DNS change. `/privacy` gains Logan's approved line and "can still get",
and `/thanks` gains its link (ADR-0035 question 7). `/test-gift` stays until oplog 0024.

What this opens: nothing for a donor. `SHELTERS` still holds no grant.

Who does what: **Logan gives the word for step 1, in the session that runs it; "commit and push" doesn't cover production.**
Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] CI green on `12c451f`: `verify`, `images`, `sourcemaps`, run 41717322836. Both `images` and `sourcemaps` before rolling
      (ADR-0010 as amended 2026-09-30).
- [x] Ship bar on `12c451f`: vitest 581 of 581 twice, typecheck, `npm run e2e` 39 of 39, all in the donate worktree on
      2026-11-03; the moderator read the three commits and didn't re-run them.
- [x] e2e against the published app image, with Every.org configured as production. Run 2026-11-03 21:45 UTC: 39 of 39 in 11.4 s,
      and `/privacy` holds the new wording. `batch37a` was on the card during it, short of the dev-box line below: this doesn't use
      the card, and about 21 GB was free. Tell the moderator first:

      docker run --rm -d --name mp-e2e --network host \
        -e DATABASE_URL=postgres://monsterpaws:monsterpaws@localhost:5432/monsterpaws_e2e \
        -e PORT=3200 -e HOSTNAME=127.0.0.1 \
        -e EVERYORG_ENV=production -e EVERYORG_WEBHOOK_TOKEN=e2e-token \
        ghcr.io/loganbresnahan/monster-paws-app:12c451f8588136b877cdb48976c686ff20dc3228
      PW_BASE_URL=http://127.0.0.1:3200 npm run e2e:prod
      docker stop mp-e2e
- [x] The proof re-run on the published images, compose's real volume and a private Postgres (ADR-0027 as amended
      2026-11-03, decision 7), 21:52 to 21:59 UTC with the card free, matching its Measured table: healthy, 200 in 0.05 s; database
      stopped, 200 in 0.03 s, a file with no donor, recorded 80 s after it returned; a listener that never answers, 200 in 5.02 s,
      `clock_expired` in sweeps, recorded 41 s after, the next delivery 0.02 s; 200 POSTs through a roll, all 404, slowest 1.3 s; a
      9.6 s delivery with a roll at 3 s, recorded. The droplet's roll is what step 6 times.
- [x] Migration `0016` rehearsed: `drizzle-kit migrate` on a scratch database restored from the newest dump in the main
      checkout's `var/dumps/`, then dropped, 2026-11-03 21:52 UTC: 0 restore errors, 12 to 17 migrations, animals 112123 before and
      after. That dump holds no webhook rows, so the backfill rests on a scratch database migrated to 0015 first (3 rows, the same
      times, 0 undecided), and step 2 reads production's rows.
- [x] `pass` unlocked by Logan.
- [x] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log
      shows `== exit`.
- [x] The dev box free: nobody on `:3100`/`:3200` or `monsterpaws_e2e`, no batch on the card.

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 &&
      docker compose -f docker-compose.prod.yml ps --format "{{.Service}} {{.Image}} {{.Status}}" &&
      docker volume ls -q | grep -c webhook_spool'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG` and the checkout name the running sha, recorded in Run; the volume count is `0`; health 200 with that sha.
Rollback: n/a — this is the record.

### 2. Before migrating, account for every completed delivery with no donation
The backfill marks every existing row decided, so a row whose decision failed would never re-run, and the bank delivery could
be one (ADR-0027 as amended 2026-11-03, decision 5). This is also the one read of the bank gift, if it has landed.

    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt \
      postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -At -F \" \""' <<'SQL'
    SELECT 'no-donation', p.id, p.received_at, p.body::jsonb->>'paymentMethod', p.body::jsonb->>'amount'
      FROM everyorg_webhook_payloads p LEFT JOIN donations d ON d.webhook_payload_id = p.id
      WHERE p.body::jsonb->>'event' = 'donation.completed' AND d.id IS NULL ORDER BY p.id;
    SELECT 'after-paypal', p.id, p.received_at, p.body::jsonb->>'paymentMethod', p.body::jsonb->>'netAmount',
           p.received_at - (p.body::jsonb->>'donationDate')::timestamptz
      FROM everyorg_webhook_payloads p WHERE p.id > 35 ORDER BY p.id;
    SELECT 'payloads', count(*) FROM everyorg_webhook_payloads;
    SQL
Verify: no `no-donation` line, and the payload count recorded for step 4. A bank row, if any, goes in Run and in oplog 0021's
context, with its delay.
Stop if: a `no-donation` line. Say which gift it is and tell Logan before migrating: the backfill would close it for good.
Rollback: n/a — a read.

### 3. Pull the release, one SSH session; nothing restarts
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=12c451f8588136b877cdb48976c686ff20dc3228/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images'
Only `app worker`, so the unpinned `caddy:2-alpine` doesn't move. Git replaces `./Caddyfile`, and the running Caddy keeps
reading the old text.
Verify: checkout at this entry's commit; app and worker resolve to `12c451f8588136b877cdb48976c686ff20dc3228` and are pulled; all three still run the old
containers.
Rollback: `IMAGE_TAG` back to step 1's sha, `git checkout` it. Nothing runs from the new images yet.

### 4. Migrate, while the old images serve
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml \
      run --rm --no-deps worker npx drizzle-kit migrate; \
      docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -At -F \" \" \
        -c \"SELECT count(*) FROM drizzle.__drizzle_migrations\" \
        -c \"SELECT outcome, count(*) FROM everyorg_webhook_decisions GROUP BY 1\" \
        -c \"SELECT count(*) FROM everyorg_webhook_payloads p LEFT JOIN everyorg_webhook_decisions d ON d.payload_id = p.id WHERE d.payload_id IS NULL\""'
    curl -fsS https://monsterpaws.org/api/health
The old code never reads the new table. A delivery between here and step 6 gets no decisions row from it, so the new worker
re-decides it after the roll: the intent's row lock and the charge's unique key make that a `replay`, never a second gift.
Verify: 17 migrations, read back, since npm notices hid the success line in 0019; `before_this_table` equal to step 2's
payload count; 0 undecided; health still 200 on the old sha.
Rollback: forward only. The old image runs with the table in place.

### 5. Caddy first, timed
    ssh root@$IP 'cd monsterpaws && S=$(date +%s%N) && docker compose -f docker-compose.prod.yml restart caddy &&
      for i in $(seq 1 40); do curl -s -o /dev/null -m 2 -k --resolve monsterpaws.org:443:127.0.0.1 https://monsterpaws.org/api/health && break; sleep 0.25; done;
      echo "gap $(( ($(date +%s%N)-S)/1000000 )) ms";
      docker compose -f docker-compose.prod.yml exec -T caddy wget -qO- http://localhost:2019/config/ | grep -o "\"try_duration\":[0-9]*"'
    curl -fsS https://monsterpaws.org/api/health
`caddy reload` would succeed on the old text, since the file is a single-file bind mount, so this is a restart, and the running
config is what counts. Certificates live in `caddy_data`, which stays. A delivery inside the restart's gap has no hold: this is
the one moment this entry can lose one, so keep it short and record it.
Verify: `"try_duration":30000000000`; the gap recorded; health 200 through Cloudflare, on the old sha, so the certificate holds.
Rollback: `git checkout <step 1's sha> -- Caddyfile` and restart caddy.

### 6. The timed roll, with a POST every half second
A wrong secret stores nothing and answers the route's own bare 404, so it proves the hold with no row written.

    : > roll.log; ( for i in $(seq 1 180); do curl -sS -m 40 -o /dev/null -w '%{http_code} %{time_total}\n' -X POST --data x \
        https://monsterpaws.org/api/webhooks/everyorg/wrong >> roll.log 2>&1 & sleep 0.5; done; wait ) & L=$!
    sleep 5; date -u +%T; ssh root@$IP 'cd monsterpaws && time docker compose -f docker-compose.prod.yml up -d app worker'; date -u +%T; wait $L
    cut -d' ' -f1 roll.log | sort | uniq -c; sort -k2 -n roll.log | tail -1
    curl -fsS https://monsterpaws.org/api/health
Verify: every line is 404, with the slowest under Caddy's 30 s, both recorded; the roll's length recorded; health 200 with the new
sha; Caddy not recreated.
Stop if: any 5xx. A 502 at once means a connection was cut after it was sent, which `lb_try_duration` alone doesn't retry. The fix
is `request_buffers 128KiB` with `lb_retry_match` (Measured table), a Caddyfile change in a new entry, not a rollback.
Rollback: `IMAGE_TAG` back to step 1's sha, `up -d app worker`, after listing `/spool`: a file there waits for a forward roll.

### 7. Prove the volume, the table and the sweep on production, one delivery
This writes one row and sends one report, expected to raise `everyorg webhook kept, not acted on: unparsable`. It goes from the
droplet, so the row holds the droplet's address, not home's as 0019's did. The secret reaches the droplet on stdin.

    pass show everyorg/webhook-secret | head -n1 | ssh root@$IP 'read -r s; cd monsterpaws &&
      curl -s -o /dev/null -w "proof %{http_code}\n" -X POST --data "proof from oplog 0023" "https://monsterpaws.org/api/webhooks/everyorg/$s";
      for c in app worker; do docker compose -f docker-compose.prod.yml exec -T $c sh -c "printenv WEBHOOK_SPOOL_DIR; touch /spool/.probe && rm /spool/.probe && ls -A /spool | wc -l"; done;
      docker compose -f docker-compose.prod.yml logs --tail 30 worker | grep -E "fatal|webhook_sweep" | cut -c1-160;
      docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -At -F \" \" \
        -c \"SELECT p.id, d.outcome, d.decided_at - p.received_at FROM everyorg_webhook_payloads p JOIN everyorg_webhook_decisions d ON d.payload_id = p.id ORDER BY p.id DESC LIMIT 1\" \
        -c \"SELECT count(*) FROM everyorg_webhook_payloads p LEFT JOIN everyorg_webhook_decisions d ON d.payload_id = p.id WHERE d.payload_id IS NULL\""'
Verify: `proof 200`; both containers print `/spool` and `0`, so each can write the volume and no file waits; the worker logs no
`fatal`; the newest row reads `unparsable`; 0 undecided. The row stays: append-only, no donor in it, nothing acts on it.
Rollback: none needed for the row.

### 8. The pages, and the read ADR-0035 needs
    for p in / /animals /privacy /thanks /demo; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    curl -s https://monsterpaws.org/privacy | grep -c "can still get its painting"
    ssh root@$IP 'cd monsterpaws && U=$(docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -At -c \"SELECT photos->0->>'"'"'url'"'"' FROM animal_display WHERE source = '"'"'rescuegroups'"'"' AND jsonb_array_length(photos) > 0 LIMIT 1\"");
      curl -sS -I -m 15 -o /dev/null -w "photo head %{http_code} in %{time_total}s\n" "$U"'
RescueGroups resets every connection from the droplet (ADR-0033), and the photos are on `cdn.rescuegroups.org` (ADR-0006), so
ADR-0035 decision 11 waits on this. It prints a status, never the URL.
Verify: 200 for the five pages; `1` for the wording; the photo's status or the reset, recorded in Run. A reset isn't a failed
deploy: it goes to ADR-0035 and the plan's slice D.
Rollback: n/a — reads.

## Run
Logan, directly, in the session that ran it: "you can accept adr0035 and run oplog 0023 pass is unlocked". The moderator held the card: batch 38f's
guard came down, then its go at 00:23 UTC, with `:3100` and `:3200` free. This session read 0 guards and 0 listeners at 00:24. Commit deployed `12c451f`,
as planned, from the checkout at `3bcb2dd`. The moderator pushed `7177dfa` at 00:26, after step 3, under Logan's standing word to it, and the droplet's
checkout stays at `3bcb2dd`.

**Changed from the steps above, on the verifier's read through the moderator, none as a new commit, since origin had to stay put for step 3:**
- Step 2 and every later `psql` ran with `-v ON_ERROR_STOP=1`, so a failed read couldn't pass as silence.
- Step 5 read `http://127.0.0.1:2019/config/`, not `localhost`: in `caddy:2-alpine`, BusyBox `wget` tries only `::1` for that name, while admin listens on `127.0.0.1`.
- Step 7's curl took its URL from stdin (`curl -K -`), so the secret never sat on its command line. `psql "$DATABASE_URL"` still shows that password in the droplet's `ps` for its moment, as 0019's did.
- Step 7 also dropped one proof file in `/spool`, because the direct delivery is decided by the route and never touches the sweep. **So this entry wrote two rows and not one.**

**Step 1.** `IMAGE_TAG` `cc8ca3289890b10d99f99dbbbc004d0999af3c20`, the rollback. Checkout `fcbc5a6`. App and worker on `cc8ca32`, Caddy `caddy:2-alpine`; 0 `webhook_spool` volumes; health 200 on `cc8ca32`.

**Step 2, 00:24 UTC.** No `no-donation` line. No row after id 35, so **Logan's bank gift, submitted 14:30 UTC on 2026-11-03, had no webhook after about 9 h 54 min.** 3 payloads.

**Step 3, 00:24 to 00:25 UTC.** Checkout `3bcb2dd`, app and worker pulled at `12c451f8588136b877cdb48976c686ff20dc3228`, all three containers still old.

**Step 4, 00:25 UTC.** npm notices hid the success line again, so the read-back is the proof: 17 migrations; `before_this_table 3`, equal to step 2; 0 undecided; health 200 on `cc8ca32`.

**Step 5, 00:25 to 00:26 UTC.** Gap 2,240 ms. `"try_duration":30000000000`. Health 200 through Cloudflare on `cc8ca32`.

**Step 6, 00:26 UTC.** The roll took 3.06 s by `time`, 00:26:22 to 00:26:26. 180 POSTs, 180 `404`, **no 5xx**, slowest 9.47 s. Health 200 on `12c451f`. Caddy not recreated.

**Step 7, 00:28 to 00:30 UTC.** `proof 200`. App and worker each printed `/spool` and `0`. Newest row id 36, `unparsable`, decided in 0.066 s; 0 undecided; no `fatal`.
The proof file went in at 00:28:23. My script stopped right after writing it, because `docker compose exec -T` took the rest of the heredoc as its own stdin, so the file was read back in step 8's session, and nothing was harmed. The sweep logged `"replayed":1` and then `"decided":{"unparsable":1}`; id 37, `unparsable`, decided 72 s after its received time; 0 files; 0 undecided. Both rows stay: append-only, no donor in them. Better Stack wasn't read for the expected `everyorg webhook kept, not acted on: unparsable` reports.

**Step 8, 00:28 UTC.** `/`, `/animals`, `/privacy`, `/thanks` and `/demo` all 200; wording count 1. **Photo HEAD from the droplet: 200 in 0.46 s**, one read of one photo: `cdn.rescuegroups.org` didn't reset the droplet, as `api.rescuegroups.org` does (ADR-0033). Health 200 on `12c451f` at the end.

Nothing failed, and nothing was rolled back. No delivery was seen during step 5's gap, and this entry doesn't show that none arrived: the only marker would be Every.org's own record.

## Follow-ups
- Tick `webhook-hardening` in the plan, and record the droplet's roll and any 5xx in ADR-0027's Measured limits by a new note.
- Oplog 0021's cleanup, then slices C and D on Logan accepting ADR-0035, and oplog 0024.
