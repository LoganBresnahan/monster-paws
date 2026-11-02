# 0019: Deploy `cc8ca32` — the donate loop, the production webhook, and the error-report fix

Status: planned
Planned: 2026-11-02 · Run: —
Why: ADR-0027 as amended 2026-11-02 (the account-less donate loop, the production webhook on the
main domain, the hidden test page); ADR-0002 as amended 2026-11-02 (no permission to paint, no
Sponsor button); ADR-0010 as amended 2026-11-02 (error reports stop carrying visitors' data);
roadmap: Accounts and donating (item 4)
Commit deployed: `cc8ca32` (`verify`, `images` and `sourcemaps` green, CI run 41544267324), this entry following in its own push so the image tag is the code commit

First planned on `7335343`, which failed `verify` at the build (run 41541299510: `/thanks` opened the database before reading its cookie, so a build with no database threw), so no image of it exists. The fix is `cc8ca32` (ADR-0017 as amended 2026-11-02). Nothing had run on production, so this entry moved with it.

What changes on the droplet: the app and worker images; one additive migration, `0015`
(`donation_intents.donor_email`, nullable, no row touched); five new `.env` lines; a new pg-boss
schedule, `donate.erase-abandoned`, daily at 06:00 UTC. No compose, Caddy, Cloudflare or DNS change:
the webhook is on `monsterpaws.org`, through the site's own edge, Caddy and app.

What this opens: nothing for a real donor. `SHELTERS` holds no grant, so production shows no Sponsor
button, and only Logan's hidden `/test-gift/<secret>` reaches www.every.org. Removing `EVERYORG_ENV`
and running `up -d app`, since `.env` is read at creation, closes that too: `donateConfigFromEnv`
returns `null`, and the page answers 404.

**Done before this entry, on Logan's own call (2026-11-02, before 22:00 UTC).** As with 0018's click,
ADR-0023's order was not met for these, and nothing on our production changed. Logan created the
production webhook at every.org/developer: partner name `Monster Paws`, domain `monsterpaws.org`, URL
`https://monsterpaws.org/api/webhooks/everyorg/$(pass show everyorg/webhook-secret)`. Every.org did
not test the URL (Logan: "every.org didn't test the webhook"). Claude generated
`everyorg/webhook-secret` with `pass generate -n` (32 alphanumeric characters); its value was never
printed, and was read back only for a length and shape check and by Logan's clipboard command. Logan
saved `everyorg/webhook-token` and `everyorg/auth-token` himself. Claude confirmed all three exist at
22:00 UTC, one line each, differing from their staging entries, by length and comparison only.

Who does what: production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).
Logan gives the word for step 1, and makes the gifts in step 8.

## Prerequisites
- [x] `cc8ca32` pushed on its own, then this entry; CI green on `cc8ca32`: `verify`, `images`,
      `sourcemaps`, run 41544267324. Both `images` and `sourcemaps` before rolling (ADR-0010 as amended
      2026-09-30).
- [x] Ship bar on `cc8ca32`: the moderator's run from the main checkout, finished 23:19 UTC on 2026-11-02,
      vitest 556/556 once, typecheck clean, e2e 39/39; the suite's second run is CI's `verify`, in the run above.
- [ ] e2e against the published app image, with Every.org configured as production, or
      `e2e/donate.spec.ts`'s button test proves nothing:

      docker run --rm -d --name mp-e2e --network host \
        -e DATABASE_URL=postgres://monsterpaws:monsterpaws@localhost:5432/monsterpaws_e2e \
        -e PORT=3200 -e HOSTNAME=127.0.0.1 \
        -e EVERYORG_ENV=production -e EVERYORG_WEBHOOK_TOKEN=e2e-token \
        ghcr.io/loganbresnahan/monster-paws-app:cc8ca3289890b10d99f99dbbbc004d0999af3c20
      PW_BASE_URL=http://127.0.0.1:3200 npm run e2e:prod
      docker stop mp-e2e
- [ ] Migration `0015` rehearsed: `drizzle-kit migrate` on a scratch database restored from the newest
      dump in the main checkout's `var/dumps/`, then dropped.
- [ ] `pass` unlocked by Logan (the DO token, the new entries).
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC
      until that night's log shows `== exit`.
- [ ] Oplog 0020, the purge, committed as `planned` before step 1, since the fix goes live at step 5.
      It runs straight after this entry's step 7, never before: the proof's report must be read before
      retention drops, or the drop could delete it.
- [ ] The dev box free: nobody on `:3100`/`:3200` or `monsterpaws_e2e`, no batch on the card.

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 &&
      cut -d= -f1 .env | grep -c -E "^(EVERYORG_|SITE_ORIGIN$)"'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG` and the checkout name the running sha, recorded in Run; the count is `0`, so no
line here will collide; health 200 with that sha and a fresh `lastCompletePollAt`.
Rollback: n/a — this is the record.

### 2. Make the test page's secret, and set the five lines, one SSH session
    pass generate -n everyorg/test-page-secret 32 >/dev/null
    {
      printf 'EVERYORG_ENV=production\n'
      for pair in EVERYORG_WEBHOOK_TOKEN:everyorg/webhook-token \
                  EVERYORG_AUTH_TOKEN:everyorg/auth-token \
                  EVERYORG_WEBHOOK_SECRET:everyorg/webhook-secret \
                  EVERYORG_TEST_PAGE_SECRET:everyorg/test-page-secret; do
        printf '%s=%s\n' "${pair%%:*}" "$(pass show "${pair#*:}" | head -n1)"
      done
    } | ssh root@$IP 'cat >> monsterpaws/.env && cut -d= -f1 monsterpaws/.env | grep ^EVERYORG_ | sort | uniq -c &&
      grep -cE "^EVERYORG_[A-Z_]+=[A-Za-z0-9._-]+$" monsterpaws/.env'
Verify: the five names, once each (names only, never cat the file), and the count `5`: a locked `pass`
would still write all five names, with empty values. The running containers read `.env` only when
created, so nothing changes until step 5.
Rollback: `ssh root@$IP "sed -i '/^EVERYORG_/d' monsterpaws/.env"`.

### 3. Pull the release, one SSH session; nothing restarts
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=cc8ca3289890b10d99f99dbbbc004d0999af3c20/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images'
Verify: checkout at this entry's commit; both images resolve to `cc8ca3289890b10d99f99dbbbc004d0999af3c20` and are pulled; app and worker
still run the old sha.
Rollback: `IMAGE_TAG` back to step 1's sha, `git checkout` it. Nothing runs from the new images yet.

### 4. Migrate, while the old images serve
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml \
      run --rm --no-deps worker npx drizzle-kit migrate'
    curl -fsS https://monsterpaws.org/api/health
It is additive, so the running code is unaffected: it never reads the new column.
Verify: "migrations applied successfully"; health still 200 on the old sha.
Rollback: forward only. Nothing depends on undoing it, and the old image runs with it in place.

### 5. Switch
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml up -d app worker &&
      sleep 8 && docker compose -f docker-compose.prod.yml logs --tail 20 worker &&
      docker compose -f docker-compose.prod.yml exec -T app printenv EVERYORG_ENV'
    curl -fsS https://monsterpaws.org/api/health
Record the UTC time this finished, for step 7's read.
Verify: app and worker run `cc8ca3289890b10d99f99dbbbc004d0999af3c20`; the worker logs no error, and `ingest.poll unscheduled`, since
`INGEST_POLL_SCHEDULE=off`; `printenv` says `production`; health 200 with `cc8ca3289890b10d99f99dbbbc004d0999af3c20`, `lastCompletePollAt`
under 27 h; caddy untouched.
Rollback: `IMAGE_TAG` back to step 1's sha, `up -d app worker`, and step 2's rollback.

### 6. Prove the schema, the job and the closed door, one SSH session
    ssh root@$IP 'cd monsterpaws && docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" \
      -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -At -F \" \" \
        -c \"SELECT count(*) FROM drizzle.__drizzle_migrations\" \
        -c \"SELECT count(*) FROM information_schema.columns WHERE table_name = '"'"'donation_intents'"'"' AND column_name = '"'"'donor_email'"'"'\" \
        -c \"SELECT name, cron FROM pgboss.schedule WHERE name = '"'"'donate.erase-abandoned'"'"'\" \
        -c \"SELECT count(*) FROM donation_intents\" \
        -c \"SELECT min(a.id) FROM animals a JOIN shelter_nonprofits s ON s.shelter_external_id = a.shelter_external_id WHERE s.everyorg_claim = '"'"'claimed'"'"' AND a.status = '"'"'available'"'"'\""'
Verify: 16 migrations; the column exists; `donate.erase-abandoned 0 6 * * *`, which nothing else tests
and the privacy page rests on; 0 intents; an animal id of a claimed shelter, used below.

    for p in / /animals /privacy /thanks /demo; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    curl -s https://monsterpaws.org/animals/<id> | grep -c "/animals/<id>/sponsor"
    curl -s -o /dev/null -w "sponsor %{http_code}\n" https://monsterpaws.org/animals/<id>/sponsor
    curl -s -o /dev/null -w "wrong test page %{http_code}\n" https://monsterpaws.org/test-gift/wrong
    curl -s -o /dev/null -w "wrong webhook %{http_code} %{size_download}\n" -X POST https://monsterpaws.org/api/webhooks/everyorg/wrong
    curl -s -o /dev/null -w "test page %{http_code}\n" "https://monsterpaws.org/test-gift/$(pass show everyorg/test-page-secret | head -n1)"
Verify: 200 for the five pages; `0` sponsor links and 404 for the sponsor page, on a claimed shelter
with the variable set, so the missing grant is what keeps it shut; 404 for the wrong test page; 404 and
0 bytes for the wrong webhook, which is the route's own bare answer, not Next's page; 200 for the test
page. If no claimed shelter is on record the button check proves nothing: say so in Run.
Rollback: step 5's.

### 7. Prove the error-report fix on production, one delivery
This writes one row and sends one report. It is expected if it raises a Better Stack alert: the alert
will say `everyorg webhook kept, not acted on: unparsable`. **The row keeps home's address:**
`redactHeaders` keeps `cf-connecting-ip` and `x-forwarded-for`, so this row holds Logan's home IP
permanently, in a private table. It has to come from an address other than the droplet's, or a leak
of the requester's address would read as `droplet` and pass. Logan knows, and deleting it is his call.

    curl -s -o /dev/null -w "proof %{http_code}\n" -X POST -H 'Cookie: mp_intents=proof' \
      --data 'proof from oplog 0019 pat@example.com' \
      "https://monsterpaws.org/api/webhooks/everyorg/$(pass show everyorg/webhook-secret | head -n1)?proof=1"
    ssh root@$IP 'cd monsterpaws && docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" \
      -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -At -F \" \" \
        -c \"SELECT id, body::jsonb ? '"'"'unreadable'"'"', headers->>'"'"'cookie'"'"' FROM everyorg_webhook_payloads ORDER BY id DESC LIMIT 1\""'
    # up to ten minutes later, from step 5's time, counts and key checks only:
    BETTERSTACK_TELEMETRY_TOKEN=$(pass show betterstack/telemetry-token | head -n1) DROPLET_IP=$IP \
      node scripts/error-report-counts.mjs <step 5's time, ISO> now
Verify: `proof 200`, which also proves a POST with a real secret reaches the route through Cloudflare;
the row reads `<id> t [redacted]`, so its body is a keyed hash and a size and its cookie header is gone,
and its payload id goes in Run. The row stays: append-only, it holds no donor, and nothing acts on it. In the report's group, `production app node`:
`address_kind` is `none` or `droplet`, since a report with no address may be filled in with the sender's
at ingest. Only `public`, any other address, is a leak, and `with_user` alone isn't one. Expected 0:
`with_a_cookie`, `with_query_string`, `with_body`, `naming_cf_ip`, `naming_xff`, `naming_intent_cookie`,
`naming_proof_address`, `naming_proof_query`, `holding_a_secret_path`. Expected 1:
`webhook_path_scrubbed`, so the path carries the placeholder. Read a `javascript` group, if any, against
`/privacy`, which says a browser's report shows Better Stack its IP: that is not a failed fix.
Stop if: the report has not arrived after ten minutes (say so, and look in the dashboard), `address_kind`
is `public`, or any of the expected zeros isn't. A leak here stops 0020 too, since a purge would only hide
it. The fix is a new image, not a rollback: the old image leaks for certain.
Rollback: none needed for the row; the report goes with 0020's purge or its own retention.

### 8. Handoff: Logan's real gifts
Logan copies the page's address to his clipboard, so it reaches no terminal or transcript, and opens it
in his own browser:

    printf 'https://monsterpaws.org/test-gift/%s' "$(pass show everyorg/test-page-secret | head -n1)" | clip.exe

Card first, then bank (Plaid) and PayPal, from $2, to Spencer Pet Rescue, with his own money. The return
lands on `https://monsterpaws.org/thanks`.

These answer what staging couldn't: the real minimum; `amount`, `netAmount` and `paymentMethod` for each
method; whether a bank gift fires when it starts or when it settles, which can take days; whether
`Authorization` carries the token on each; whether `chargeId` fits `KEPT_SHAPES`, or the gift lands in
`bad_fields` with an alert; whether Every.org's receipt arrives, and what it shows (ADR-0027 decision 6
goes back to Logan if it doesn't); whether Every.org's URL parameters reach `/thanks` in a `Referer`, which
Logan reads from his browser, in DevTools on the `/thanks` request, or from the address bar at Every.org's
checkout for whether `email=` stays; and that a real browser's Server Action passes Cloudflare on the test page's path, which settles that part
of `doc/issues.md`'s entry. The sponsor form's own path first runs on the first real grant.
After the card gift, one SSH session, named columns only, never an address:

    ssh root@$IP 'cd monsterpaws && docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" \
      -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -At -F \" \" -c \"
        SELECT p.id, p.received_at, p.body::jsonb->>'"'"'event'"'"', p.body::jsonb->>'"'"'paymentMethod'"'"',
               p.body::jsonb->>'"'"'amount'"'"', p.body::jsonb->>'"'"'netAmount'"'"', p.body::jsonb->'"'"'droppedKeys'"'"',
               p.headers->>'"'"'authorization'"'"', d.id IS NOT NULL, i.donor_email IS NOT NULL, i.closed_at IS NOT NULL
        FROM everyorg_webhook_payloads p
        LEFT JOIN donations d ON d.webhook_payload_id = p.id
        LEFT JOIN donation_intents i ON i.id = p.partner_donation_id
        WHERE p.id > <step 7's payload id> ORDER BY p.id\""'
Then whether the gift's raw row holds the donor's address, comparing every header value with the proof
row's `cf-connecting-ip` and printing only a boolean. By design the POST comes from Every.org's server, but
0018 read header names only, so nobody has checked the values. This only means something if Logan gives
from the same network he ran the proof from, so say in Run whether he did:

    ssh root@$IP 'cd monsterpaws && docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" \
      -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -At -c \"
        SELECT pr.headers ? '"'"'cf-connecting-ip'"'"',
               EXISTS (SELECT 1 FROM everyorg_webhook_payloads g, jsonb_each_text(g.headers) h
                       WHERE g.id = <the gift payload id>
                         AND position(pr.headers->>'"'"'cf-connecting-ip'"'"' IN h.value) > 0)
        FROM everyorg_webhook_payloads pr WHERE pr.id = <step 7 payload id>;
        SELECT h.key FROM everyorg_webhook_payloads g, jsonb_each_text(g.headers) h
        WHERE g.id = <the gift payload id> AND h.value ~ '"'"'^[0-9a-fA-F:., ]+$'"'"' ORDER BY 1\""'
The first line reads `t f`: the proof row has the header, and no value on the gift's row matches it. The `t`
is what makes the `f` mean anything. His browser may reach Every.org over IPv6 while the proof's curl used
IPv4, so even the same network can give `f`. The second query lists only the **names** of the gift row's headers
whose values look like addresses, which doesn't depend on the network: expected are Cloudflare's and the
forwarding headers, and any other name gets read before the next gift.
Stop if: the comparison prints `t`. A raw row would then hold a donor's address, which ADR-0027 as amended says
it never does: tell Logan before any further gift.
Verify: one row: `donation.completed`, the amount given, `[our auth token]` or a different answer, the
donation written, the address held, the intent closed, and the comparison `f`. This is the first real proof of what this entry is
for, so the entry runs through the card gift and then freezes. Bank and PayPal, which can take days, go in
oplog 0021's context.
Rollback: removing `EVERYORG_ENV` and `up -d app` closes the page. The money is real and stays given.

## Run

## Follow-ups
- Oplog 0020: the old reports purged, by lowering `errors_retention` and restoring it.
- Oplog 0021: the test gifts' rows deleted on `animal_external_id = 'test-gift'` only, never slug or EIN,
  before Spencer's button opens; `EVERYORG_TEST_PAGE_SECRET` unset; the page's code gone in the next
  deploy.
