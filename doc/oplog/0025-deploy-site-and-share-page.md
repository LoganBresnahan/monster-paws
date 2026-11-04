# 0025: Deploy `0989a18` — the site's demo pages, the share page and the keepsake schema, with nothing painted

Status: run
Planned: 2026-11-04 · Run: 2026-11-04, 04:17 to 04:22 UTC
Why: social sites build a preview only from a public page, so the share page has to be live (ADR-0036), and the home and `/demo` changes ship for the Meta
demo (ADR-0028 as amended 2026-11-03). Roadmap: Accounts and donating (item 4)
Commit deployed: `0989a18`, named by the moderator, 2026-11-04: Logan's new crew portraits with Plum's new painting, the mail with its review fixes, the art worker job, the real-paintings commit and every word he approved. Logan chose to carry these over `9d297c9`: "wait". This entry follows in its own push so the image tag is the code commit

What changes on the droplet: the app and worker images; migrations `0017` and `0018`; `SHARE_BASE_URL=https://media.monsterpaws.org` in `.env`. Compose and the `Caddyfile` are unchanged since `12c451f` (prerequisite below), so Caddy doesn't restart. At Cloudflare: seven cached files purged, because the crew's paintings and Plum's photo and thumbnail change in place under the same names.

**Words:** this image puts Logan's approved wording live everywhere, "donation" for "gift", with the sponsor page and `/thanks` saying "we're painting" only where the sweep would paint, which on production is nowhere until oplog 0029.

What this opens: `/share/<token>`, which reads published files from `media.monsterpaws.org`, by a token that can't be guessed. `/unsubscribe` and `/api/webhooks/resend`, whose unset keys leave them doing nothing. The donate link stops offering bank. **Nothing paints and nothing mails:** this image carries `sweepKeepsakes`, the art worker's job and the painting email, and all stay off with `ART_SWEEP`, `WORKER_MODE` and `EMAIL_SWEEP` unset, and `SHELTERS` holds no grant. Migration `0017` reshapes `keepsake`, which step 2 reads as empty. The `manual` display licence is inert while no such row exists, which step 2 also reads.

Who does what: **Logan gives the word for step 1, in the session that runs it.** Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] Logan's words for `/privacy`'s share-page line are in, 2026-11-04 ("yes" to the draft, directly), and pinned by `tests/privacy-page.test.ts`.
- [x] CI green on `0989a18`: `verify`, `images`, `sourcemaps`, run 41766314793. Both `images` and `sourcemaps` before rolling (ADR-0010 as amended 2026-09-30).
- [x] Ship bar on `0989a18`, in a temporary checkout at exactly that sha, 2026-11-04 03:19 to 03:26 UTC: vitest 890 of 890 twice, typecheck clean, `npm run e2e` 57 of 57. The verifier read this sha and found nothing that stops the deploy.
- [x] The published worker image booted on a throwaway database with no keys, 2026-11-04 03:28 UTC: up after 24 s, 0 fatal lines, no `art.generate` queue. It's the first image to load `sharp` at the worker's boot.
- [x] `git diff 12c451f 0989a18 -- Caddyfile docker-compose.prod.yml` prints nothing, read 2026-11-04. If it prints, this entry gains Caddy's restart or a compose step before step 1.
- [x] e2e against the published app image, Every.org set to production, moderator told first, 2026-11-04 03:27 UTC: 46 passed in 10.9 s, 11 skipped, which skip under `PW_BASE_URL`, so step 6 covers the share routes live. `/privacy` holds the new line and no "account", and `/demo/plum/sponsor` has no "Paying by bank".

      docker run --rm -d --name mp-e2e --network host \
        -e DATABASE_URL=postgres://monsterpaws:monsterpaws@localhost:5432/monsterpaws_e2e \
        -e PORT=3200 -e HOSTNAME=127.0.0.1 -e EVERYORG_ENV=production -e EVERYORG_WEBHOOK_TOKEN=e2e-token \
        ghcr.io/loganbresnahan/monster-paws-app:0989a18cf020f1211dde8a2d8dd2e24c1ef4ea2a
      PW_BASE_URL=http://127.0.0.1:3200 npm run e2e:prod
      docker stop mp-e2e
- [x] Migrations `0017` and `0018` rehearsed on a scratch restore of the newest dump, then dropped, 2026-11-04 03:28 UTC: 0 restore errors, 12 to 19 migrations (the dump predates production's 17), animals 112123 before and after, `keepsake` holds `id`, `intent_id`, `share_token` and `snapshotted_at`, and `painting_email_sends` and `resend_webhook_events` are empty.
- [x] `pass` unlocked by Logan.
- [x] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log shows `== exit`.
- [x] The dev box free: no batch on the card, read and held by the moderator at 04:17 UTC. **Short of the line:** the UI chat's vitest and e2e ran through this entry, CPU only in their own database, which the moderator allowed with load at 0.6.
- [x] Oplog 0026's domain answers: steps 1 to 3 run, 2026-11-04 00:08 UTC. Its step 4, the first published set, isn't needed here. Step 6 checks a set only if one is up.
- [x] `604a76c`, the UI chat's scrub, is in this sha, so a non-404 from media can't put a token in an error report.
- [x] Oplog 0023's two proof reports reached Better Stack: read 2026-11-04 00:32 UTC, 2 reports in the last 30 minutes, both `kept, not acted on: unparsable`. Counts only.

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 &&
      docker compose -f docker-compose.prod.yml ps --format "{{.Service}} {{.Image}} {{.Status}}" &&
      for k in SHARE_BASE_URL ART_SWEEP WORKER_MODE EMAIL_SWEEP EMAIL_LIVE RESEND_API_KEY EMAIL_SUPPRESSION_KEY; do printf "%s " $k; grep -c "^$k=" .env; done'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG` is `12c451f8588136b877cdb48976c686ff20dc3228`, recorded in Run; health 200 on it; **each of the seven keys counts `0`**, and only names are read, never a value.
Stop if: `ART_SWEEP`, `WORKER_MODE` or `EMAIL_SWEEP` counts anything but `0`.
Rollback: n/a — the record.

### 2. Before migrating, read what `0017` and the licence depend on
    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt \
      postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \""' <<'SQL'
    SELECT 'keepsake', count(*) FROM keepsake;
    SELECT 'keepsake_fact', count(*) FROM keepsake_fact;
    SELECT 'manual_display', count(*) FROM animal_display WHERE source = 'manual';
    SELECT 'manual_identity', count(*) FROM animal_identities WHERE source = 'manual';
    SELECT 'migrations', count(*) FROM drizzle.__drizzle_migrations;
    SQL
Verify: `keepsake 0`, `keepsake_fact 0`, `manual_display 0`, `manual_identity 0`, `migrations 17`.
Stop if: any of the first four isn't `0`. `0017` drops `keepsake.donation_id` and adds `NOT NULL` columns, and a `manual` row would become displayable.
Rollback: n/a — a read.

### 3. Pull the release and set the one new key, one SSH session; nothing restarts
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=0989a18cf020f1211dde8a2d8dd2e24c1ef4ea2a/" .env &&
      printf "SHARE_BASE_URL=https://media.monsterpaws.org\n" >> .env &&
      grep -c ^SHARE_BASE_URL= .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images'
Only `app worker`, so the unpinned `caddy:2-alpine` doesn't move.
Verify: the checkout at this entry's commit; app and worker resolve to `0989a18` and are pulled; `SHARE_BASE_URL` counts `1`; all three still run the old containers.
Rollback: `IMAGE_TAG` back to step 1's sha, delete the `SHARE_BASE_URL` line, `git checkout <step 1's sha>`, and later `git checkout topdog`, since that leaves HEAD detached and the next pull fails until then.

### 4. Migrate, while the old images serve
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml \
      run --rm --no-deps worker npx drizzle-kit migrate; \
      docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \" \
        -c \"SELECT count(*) FROM drizzle.__drizzle_migrations\" \
        -c \"SELECT column_name FROM information_schema.columns WHERE table_name = '"'"'keepsake'"'"' ORDER BY 1\" \
        -c \"SELECT count(*) FROM painting_email_sends\""'
    curl -fsS https://monsterpaws.org/api/health
`12c451f` never reads `keepsake` or the new tables, so the old image runs on the new schema.
Verify: 19 migrations, read back, since npm notices hide the success line; `keepsake` has `id`, `intent_id`, `share_token`, `snapshotted_at` and no `donation_id`; `painting_email_sends` answers `0`; health still 200 on the old sha.
Rollback: forward only.

### 5. The timed roll, with a POST every half second
    : > roll.log; ( for i in $(seq 1 180); do curl -sS -m 40 -o /dev/null -w '%{http_code} %{time_total}\n' -X POST --data x \
        https://monsterpaws.org/api/webhooks/everyorg/wrong >> roll.log 2>&1 & sleep 0.5; done; wait ) & L=$!
    sleep 5; date -u +%T; ssh root@$IP 'cd monsterpaws && time docker compose -f docker-compose.prod.yml up -d app worker'; date -u +%T; wait $L
    cut -d' ' -f1 roll.log | sort | uniq -c; sort -k2 -n roll.log | tail -1
    curl -fsS https://monsterpaws.org/api/health
    sleep 20; ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml ps worker --format "{{.Status}}" </dev/null; docker compose -f docker-compose.prod.yml logs --tail 40 worker </dev/null | grep -cE "fatal|Cannot find|ERR_DLOPEN"'
Verify: every line is 404, with the slowest under Caddy's 30 s, both recorded; the roll's length recorded; health 200 with the new sha; Caddy not recreated; **the worker still up 20 s on, with the log grep at `0`**, since this image is the first to load `sharp` at the worker's boot and health reads only the app.
Stop if: the worker is restarting: step 5's rollback, since it would be crash-looping with polls and the webhook sweep down.
Stop if: any 5xx. The fix is `request_buffers 128KiB` with `lb_retry_match` (ADR-0027 as amended 2026-11-03), a Caddyfile change in a new entry, not a rollback.
Rollback: `IMAGE_TAG` back to step 1's sha, `up -d app worker`, after listing `/spool`: a file there waits for a forward roll.

### 6. Live checks: the pages, the share routes, and that nothing paints
`e2e/share.spec.ts` can't run against a deployed server, so the 404s below are its live cover. The token here is random and maps to nothing.

    for p in / /animals /privacy /thanks /demo; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    T=$(head -c 16 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')
    for p in "/share/$T" "/share/$T/1" "/share/$T/1/painting.jpg" /share/short /share/..%2f..%2fetc; do curl -s -o /dev/null -w "share %{http_code}\n" "https://monsterpaws.org$p"; done
    curl -s https://monsterpaws.org/privacy | grep -c "The painting also gets its own page"
    curl -s https://monsterpaws.org/demo/plum/sponsor | grep -c "Paying by bank"
    curl -s -o /dev/null -w "resend webhook %{http_code}\n" -X POST --data x https://monsterpaws.org/api/webhooks/resend
    curl -s -o /dev/null -w "unsubscribe, no token %{http_code}\n" https://monsterpaws.org/unsubscribe
    ssh root@$IP 'cd monsterpaws && for c in app worker; do docker compose -f docker-compose.prod.yml exec -T $c sh -c "printenv SHARE_BASE_URL; printenv ART_SWEEP WORKER_MODE EMAIL_SWEEP | wc -l" </dev/null; done;
      docker compose -f docker-compose.prod.yml logs --tail 40 worker </dev/null | grep -cE "fatal|keepsake.sweep|painting"; 
      docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \" -c \"SELECT count(*) FROM keepsake\" -c \"SELECT count(*) FROM painting_email_sends\" -c \"SELECT count(*) FROM pgboss.queue WHERE name = '"'"'art.generate'"'"'\""'
    curl -fsS https://monsterpaws.org/api/health
If oplog 0026 has published a set by now, the moderator gives its token on stdin and `/share/<token>` is read once: 200, and an `og:image` naming `/share/<token>/1/painting.jpg`.
Verify: five pages 200; all five share lines 404; the `/privacy` line counts `1`; "Paying by bank" counts `0`; the resend webhook 404; `/unsubscribe` no 5xx, status recorded; both containers print the media URL and `0`; the log grep counts `0`; `keepsake 0`, `painting_email_sends 0`, no `art.generate` queue; health 200 on `0989a18`.
Stop if: a keepsake, a send or an `art.generate` queue exists: find out why before anything else.
Rollback: step 5's.

### 7. Purge the seven files at Cloudflare
They change in place under the same names, and production sends `max-age=14400`, so the edge could serve the old ones for 4 hours. A browser that already has one can show it for up to 4 hours, which nothing here can reach. `/_next/image` is `DYNAMIC` at the edge and needs no purge.

    U=$(for p in plum marty beetle stacey ducky; do printf 'https://monsterpaws.org/brand/crew/%s-painting.jpg\n' $p; done; printf 'https://monsterpaws.org/brand/crew/plum-%s.jpg\n' photo thumb)
    Z=$(curl -fsS -H "Authorization: Bearer $(pass show cloudflare/dns-token | head -n1)" "https://api.cloudflare.com/client/v4/zones?name=monsterpaws.org" | jq -r '.result[0].id')
    curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/$Z/purge_cache" -H "Authorization: Bearer $(pass show cloudflare/dns-token | head -n1)" -H 'Content-Type: application/json' --data "$(printf '%s\n' "$U" | jq -R . | jq -cs '{files:.}')" | jq -c '{success}'
    for u in $U; do f=${u##*/}; curl -s -o /tmp/0025-$f -w "$f %{http_code} " "$u"; a=$(sha256sum < /tmp/0025-$f | cut -c1-16); b=$(git show 0989a18:public/brand/crew/$f | sha256sum | cut -c1-16); [ "$a" = "$b" ] && echo same || echo DIFFERS; done
Verify: `{"success":true}`; seven 200s, all `same`, so the edge now serves this commit's files. **Then look at `/tmp/0025-plum-photo.jpg` and `/tmp/0025-plum-thumb.jpg`: Plum's collar tag is blurred.** Never paste the old image anywhere. Delete the files after.
Stop if: a hash differs after a second read a minute later. It's a look at Cloudflare, not a rollback.
Rollback: n/a. A purge only makes the edge fetch again.

## Run
Logan, directly, in the session that ran it, after "wait" for an earlier sha: "check with mod but we should be ready for deploy". I took that as his word, conditional on the moderator, and told him so. The moderator confirmed at 04:17 UTC: the card free, origin held at `11a07f1`. Commit deployed `0989a18`, from the checkout at `11a07f1`.

**Changed from the steps above, none as a new commit:**
- Step 3 made sure `.env` ended in a newline before appending, so the new key couldn't join the last line.
- Step 7's files went to the session's scratchpad, not `/tmp`, and were deleted after.
- Step 6 also read that `/privacy` holds no "gift", and read one published set.

**Step 1, 04:17 UTC.** `IMAGE_TAG` `12c451f8588136b877cdb48976c686ff20dc3228`, the rollback. Checkout `3bcb2dd`. All three containers up; health 200 on `12c451f`. All seven keys counted `0`.

**Step 2, 04:17 UTC.** `keepsake 0`, `keepsake_fact 0`, `manual_display 0`, `manual_identity 0`, `migrations 17`.

**Step 3, 04:17 to 04:18 UTC.** Checkout `11a07f1`; `SHARE_BASE_URL` counts `1`; app and worker pulled at `0989a18cf020f1211dde8a2d8dd2e24c1ef4ea2a`; all three still on the old containers.

**Step 4, 04:18 UTC.** npm notices hid the success line again, so the read-back is the proof: 19 migrations; `keepsake` holds `id`, `intent_id`, `share_token` and `snapshotted_at`; `painting_email_sends` answers `0`; health 200 on `12c451f`.

**Step 5, 04:19 UTC.** The roll took 2.63 s by `time`, 04:19:17 to 04:19:21. 180 POSTs, 180 `404`, **no 5xx**, slowest 8.45 s. Health 200 on `0989a18`. Caddy not recreated. The worker was still up about a minute on, with the log grep at `0`.

**Step 6, 04:21 UTC.** Five pages 200. Share routes: an unknown token, its `/1` and its `/1/painting.jpg` all 404, a bad-shape token 404, and **the encoded traversal `/share/..%2f..%2fetc` 400 and not the planned 404**: still a refusal, and it reached no key. `/privacy` holds the line, 0 "account", 0 "gift". "Paying by bank" `0`. Resend's webhook 404; `/unsubscribe` with no token 404. Both containers print the media URL and `0`. Log grep `0`. `keepsake 0`, `painting_email_sends 0`, no `art.generate` queue.
Keepsake 1's published set, its token given by `paintings` and kept out of this file: the page 200 with the name, an `og:image` naming its own `/1/painting.jpg`, and that image 200, `image/jpeg`, 142,648 bytes. Health 200 on `0989a18`.

**Step 7, 04:21 UTC.** `{"success":true}`. Seven files 200 and every hash the same as this commit's. Looked at `plum-photo.jpg` and `plum-thumb.jpg`: Plum's collar tag is blurred in both. A browser that already held an old file can show it for up to 4 hours.

Better Stack read afterwards, a count only: 0 reports in the 15 minutes around the roll. Nothing failed, and nothing was rolled back. No delivery was seen during the roll: 2.63 s under Caddy's hold, and no webhook row was read.

## Follow-ups
- Tick nothing in the plan: the art path's slices finish with oplog 0029.
- `doc/infra.md` records `SHARE_BASE_URL` on the droplet.
- Oplog 0027, then 0028, then 0029, each on Logan's word.
