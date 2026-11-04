# 0025: Deploy `<SHA>` — the site's demo pages, the share page and the keepsake schema, with nothing painted

Status: planned
Planned: 2026-11-04 · Run: —
Why: social sites build a preview only from a public page, so the share page has to be live (ADR-0036), and the home and `/demo` changes ship for the Meta
demo (ADR-0028 as amended 2026-11-03). Roadmap: Accounts and donating (item 4)
Commit deployed: `<SHA>`, topdog's head once the mail, the UI chat's real-paintings commit and the `/privacy` line are in; the moderator names it. This entry is amended to it before step 1, and CI is read on it.

What changes on the droplet: the app and worker images; migrations `0017` and `0018`; `SHARE_BASE_URL=https://media.monsterpaws.org` in `.env`. Compose and the `Caddyfile` are unchanged since `12c451f` (prerequisite below), so Caddy doesn't restart.

What this opens: `/share/<token>`, which reads published files from `media.monsterpaws.org`, by a token that can't be guessed. `/unsubscribe` and `/api/webhooks/resend`, whose unset keys leave them doing nothing. The donate link stops offering bank. **Nothing paints and nothing mails:** this image carries `sweepKeepsakes` and the painting email, and both stay off with `ART_SWEEP` and `EMAIL_SWEEP` unset, and `SHELTERS` holds no grant. Migration `0017` reshapes `keepsake`, which step 2 reads as empty. The `manual` display licence is inert while no such row exists, which step 2 also reads.

Who does what: **Logan gives the word for step 1, in the session that runs it.** Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] Logan's words for `/privacy`'s share-page line are in, 2026-11-04 ("yes" to the draft, directly), and pinned by `tests/privacy-page.test.ts`.
- [ ] CI green on `<SHA>`: `verify`, `images`, `sourcemaps`. Both `images` and `sourcemaps` before rolling (ADR-0010 as amended 2026-09-30).
- [ ] Ship bar on `<SHA>`: vitest twice, typecheck, `npm run e2e`.
- [ ] `git diff 12c451f <SHA> -- Caddyfile docker-compose.prod.yml` prints nothing. If it prints, this entry gains Caddy's restart or a compose step before step 1.
- [ ] e2e against the published app image, Every.org set to production. Tell the moderator first. `e2e/share.spec.ts` skips under `PW_BASE_URL`, so step 6 covers the share routes live.

      docker run --rm -d --name mp-e2e --network host \
        -e DATABASE_URL=postgres://monsterpaws:monsterpaws@localhost:5432/monsterpaws_e2e \
        -e PORT=3200 -e HOSTNAME=127.0.0.1 -e EVERYORG_ENV=production -e EVERYORG_WEBHOOK_TOKEN=e2e-token \
        ghcr.io/loganbresnahan/monster-paws-app:<FULL SHA>
      PW_BASE_URL=http://127.0.0.1:3200 npm run e2e:prod
      docker stop mp-e2e
- [ ] Migrations `0017` and `0018` rehearsed on a scratch restore of the newest dump, then dropped: 17 to 19, animals unchanged.
- [ ] `pass` unlocked by Logan.
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log shows `== exit`.
- [ ] The dev box free: nobody on `:3100`/`:3200` or `monsterpaws_e2e`, no batch on the card. The moderator holds the card.
- [x] Oplog 0026's domain answers: steps 1 to 3 run, 2026-11-04 00:08 UTC. Its step 4, the first published set, isn't needed here. Step 6 checks a set only if one is up.
- [x] Oplog 0023's two proof reports reached Better Stack: read 2026-11-04 00:32 UTC, 2 reports in the last 30 minutes, both `kept, not acted on: unparsable`. Counts only.

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 &&
      docker compose -f docker-compose.prod.yml ps --format "{{.Service}} {{.Image}} {{.Status}}" &&
      for k in SHARE_BASE_URL ART_SWEEP EMAIL_SWEEP EMAIL_LIVE RESEND_API_KEY EMAIL_SUPPRESSION_KEY; do printf "%s " $k; grep -c "^$k=" .env; done'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG` is `12c451f8588136b877cdb48976c686ff20dc3228`, recorded in Run; health 200 on it; **each of the six keys counts `0`**, and only names are read, never a value.
Stop if: `ART_SWEEP` or `EMAIL_SWEEP` counts anything but `0`.
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
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<FULL SHA>/" .env &&
      printf "SHARE_BASE_URL=https://media.monsterpaws.org\n" >> .env &&
      grep -c ^SHARE_BASE_URL= .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images'
Only `app worker`, so the unpinned `caddy:2-alpine` doesn't move.
Verify: the checkout at this entry's commit; app and worker resolve to `<SHA>` and are pulled; `SHARE_BASE_URL` counts `1`; all three still run the old containers.
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
    curl -s https://monsterpaws.org/privacy | grep -c "Your painting also gets its own page"
    curl -s https://monsterpaws.org/demo/plum/sponsor | grep -c "Paying by bank"
    curl -s -o /dev/null -w "resend webhook %{http_code}\n" -X POST --data x https://monsterpaws.org/api/webhooks/resend
    curl -s -o /dev/null -w "unsubscribe, no token %{http_code}\n" https://monsterpaws.org/unsubscribe
    ssh root@$IP 'cd monsterpaws && for c in app worker; do docker compose -f docker-compose.prod.yml exec -T $c sh -c "printenv SHARE_BASE_URL; printenv ART_SWEEP EMAIL_SWEEP | wc -l" </dev/null; done;
      docker compose -f docker-compose.prod.yml logs --tail 40 worker </dev/null | grep -cE "fatal|keepsake.sweep|painting"; 
      docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \" -c \"SELECT count(*) FROM keepsake\" -c \"SELECT count(*) FROM painting_email_sends\" -c \"SELECT count(*) FROM pgboss.queue WHERE name = '"'"'art.generate'"'"'\""'
    curl -fsS https://monsterpaws.org/api/health
If oplog 0026 has published a set by now, the moderator gives its token on stdin and `/share/<token>` is read once: 200, and an `og:image` naming `/share/<token>/1/painting.jpg`.
Verify: five pages 200; all five share lines 404; the `/privacy` line counts `1`; "Paying by bank" counts `0`; the resend webhook 404; `/unsubscribe` no 5xx, status recorded; both containers print the media URL and `0`; the log grep counts `0`; `keepsake 0`, `painting_email_sends 0`, no `art.generate` queue; health 200 on `<SHA>`.
Stop if: a keepsake, a send or an `art.generate` queue exists: find out why before anything else.
Rollback: step 5's.

## Run
<filled in as it happens>

## Follow-ups
- Tick nothing in the plan: the art path's slices finish with oplog 0029.
- `doc/infra.md` records `SHARE_BASE_URL` on the droplet.
- Oplog 0027, then 0028, then 0029, each on Logan's word.
