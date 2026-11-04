# 0028: The painting chain's keys and the keepsake sweep on, with no shelter to paint for

Status: planned
Planned: 2026-11-04 · Run: —
Why: real gifts to a shelter that holds a grant get a painting and an email (ADR-0035, ADR-0027 as amended 2026-11-02). Logan, to the moderator, 2026-11-03: "i want real donations working". Roadmap: Accounts and donating (item 4)
Commit deployed: none new. The app and worker images are oplog 0025's, so this only changes `.env` and recreates those two.

What changes on the droplet: five `.env` keys below, and `ART_SWEEP=on`; a roll of app and worker to read them. In Resend: a webhook, made by Logan. In `pass`: one new entry, its signing secret. On this box: a hosts line, `generateHosts = false` in `/etc/wsl.conf`, and the art worker started, a host process under `home_worker`.

What this opens: `/api/webhooks/resend` starts answering, signed requests only. `/unsubscribe` starts working. The sweep starts, and **it finds nothing to do while `SHELTERS` is empty**, so it writes no keepsake and sends no job. `EMAIL_SWEEP` stays unset here, so no mail goes out on its own, and with no keepsake there is nothing to mail.

Who does what: **Logan gives the word for step 1, in the session that runs it.** Logan creates the webhook in step 3, and types the one sudo line in step 7. `paintings` starts its worker in step 8. Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [ ] Oplog 0025 has run: this needs migrations `0017` and `0018` and its image.
- [ ] Oplog 0027 has run (done, 2026-11-04), and `paintings`' worker has taken a job on the dev database under the same options, so a job sent here has somewhere to go. Its queries fit the role: read 2026-11-04 in `src/worker/art.ts` and `src/core/share/keepsake.ts`, which select `keepsake`'s id and token and `keepsake_fact`, insert into `keepsake_fact`, and call `pg_advisory_xact_lock` and `current_database()`, and nothing else.
- [ ] `ART_PHOTO_HOSTS` is on topdog, since step 8 runs from its tip. As of 2026-11-04 it exists only uncommitted on `lora`, and without it `fetchPhotos` takes any https host and follows redirects.
- [ ] Oplog 0026's domain answers: a real gift's art reaches the mail through `media.monsterpaws.org`.
- [ ] `pass` unlocked by Logan.
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log shows `== exit`.

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 && cp .env .env.before-0028 && chmod 600 .env.before-0028 &&
      for k in SHARE_BASE_URL ART_SWEEP EMAIL_SWEEP EMAIL_LIVE EMAIL_ART_SOURCE RESEND_API_KEY RESEND_WEBHOOK_SECRET EMAIL_SUPPRESSION_KEY EMAIL_LINK_ORIGIN EMAIL_LIVE_ALLOWED_TO; do printf "%s " $k; grep -c "^$k=" .env; done'
    curl -fsS https://monsterpaws.org/api/health
Verify: `SHARE_BASE_URL` counts `1`, every other key `0`; health 200 on 0025's sha. Only names are read.
Rollback: n/a — the record.

### 2. Read that the never-mail key exists
Logan created `resend/suppression-hmac-key` on 2026-11-03 (`doc/infra.md`). **Never make a new one:** losing it loses the never-mail list, because a digest made under a new key matches nothing, and nothing has been written under it on production yet, but this is the key the entry below puts there.

    pass show resend/suppression-hmac-key | head -n1 | wc -c
Verify: 65, 64 characters and a newline. Only its length is read.
Stop if: it's missing. Ask Logan; nothing here makes one.
Rollback: n/a — a read.

### 3. Logan makes the webhook in Resend's dashboard
`https://monsterpaws.org/api/webhooks/resend`, subscribed to `email.delivered`, `email.bounced`, `email.complained`, `email.suppressed` and `email.failed`. The last two do nothing until oplog 0029's image, and are subscribed here so that nobody has to come back to the dashboard. He copies the signing secret to `pass` by `pass insert -m resend/webhook-signing-secret`, and it's never pasted into a chat.
Verify: `pass show resend/webhook-signing-secret | head -n1 | grep -c '^whsec_'` prints 1.
Rollback: delete the webhook; `pass rm -f resend/webhook-signing-secret`.

### 4. The keys into `.env`, on stdin; nothing restarts
    { printf 'EMAIL_SUPPRESSION_KEY=%s\n' "$(pass show resend/suppression-hmac-key | head -n1)"
      printf 'RESEND_API_KEY=%s\n' "$(pass show resend/api-key | head -n1)"
      printf 'RESEND_WEBHOOK_SECRET=%s\n' "$(pass show resend/webhook-signing-secret | head -n1)"
      printf 'EMAIL_LIVE=production\nEMAIL_ART_SOURCE=media\nART_SWEEP=on\n'; } | ssh root@$IP 'cd monsterpaws && cat >> .env && for k in EMAIL_SUPPRESSION_KEY RESEND_API_KEY RESEND_WEBHOOK_SECRET EMAIL_LIVE EMAIL_ART_SOURCE ART_SWEEP EMAIL_SWEEP EMAIL_LIVE_ALLOWED_TO; do printf "%s " $k; grep -c "^$k=" .env; done'
Never set `EMAIL_LINK_ORIGIN` or `EMAIL_LIVE_ALLOWED_TO` here: the first defaults to the real origin, and the second is ignored under `production`, which would mislead a reader.
Verify: the first six count `1`; `EMAIL_SWEEP` and `EMAIL_LIVE_ALLOWED_TO` count `0`.
Rollback: `cp .env.before-0028 .env`.

### 5. The timed roll, with a POST every half second
    : > roll.log; ( for i in $(seq 1 180); do curl -sS -m 40 -o /dev/null -w '%{http_code} %{time_total}\n' -X POST --data x \
        https://monsterpaws.org/api/webhooks/everyorg/wrong >> roll.log 2>&1 & sleep 0.5; done; wait ) & L=$!
    sleep 5; date -u +%T; ssh root@$IP 'cd monsterpaws && time docker compose -f docker-compose.prod.yml up -d app worker'; date -u +%T; wait $L
    cut -d' ' -f1 roll.log | sort | uniq -c; sort -k2 -n roll.log | tail -1
    curl -fsS https://monsterpaws.org/api/health
Verify: every line is 404, no 5xx; health 200, the same sha.
Stop if: any 5xx.
Rollback: `cp .env.before-0028 .env`, `up -d app worker`.

### 6. Prove the routes answer and nothing happens
    curl -s -o /dev/null -w "resend webhook, unsigned %{http_code}\n" -X POST --data x https://monsterpaws.org/api/webhooks/resend
    H=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'); N=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
    curl -s -o /dev/null -w "unsubscribe, a token that matches nothing %{http_code}\n" -X POST --data confirm=yes "https://monsterpaws.org/unsubscribe/$H-$N"
    sleep 90
    ssh root@$IP 'cd monsterpaws && for c in app worker; do docker compose -f docker-compose.prod.yml exec -T $c sh -c "printenv ART_SWEEP; printenv EMAIL_SWEEP | wc -l" </dev/null; done;
      docker compose -f docker-compose.prod.yml logs --since 3m worker </dev/null | grep -cE "fatal|keepsake sweep failed";
      docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c \
      "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \" -c \"SELECT count(*) FROM keepsake\" -c \"SELECT count(*) FROM painting_email_sends\" -c \"SELECT count(*) FROM email_suppressions\" -c \"SELECT name FROM pgboss.queue WHERE name = '"'"'art.generate'"'"'\" -c \"SELECT count(*) FROM pgboss.job WHERE name = '"'"'art.generate'"'"'\""'
Verify: the unsigned webhook 401; the unsubscribe 404; `on` and `0` from both containers; log grep `0`; `keepsake 0`, `painting_email_sends 0`, `email_suppressions` unchanged and recorded; the `art.generate` queue exists; 0 jobs. If oplog 0021 hasn't run, Logan's test gifts are still closed with no animal, and this read proves the sweep passes over them.
Stop if: a keepsake or a job exists: `ART_SWEEP` off first, by step 4's rollback.
Rollback: step 5's.

### 7. The database's name resolves to the tunnel, on this box
The worker can't run in a container: `guardPainter` needs `docker`, `guard.sh`, `powershell.exe` and `wsl.exe`, and in `node:24-alpine` every job would fail. On the host it needs the database's own hostname to reach the tunnel, so TLS still verifies that name. WSL rewrites `/etc/hosts` at every distro start unless told not to. Logan types this, with `!`, or in a WSL terminal if sudo can't prompt there:

    ! H=$(pass show digitalocean/pg-home-worker-url | head -n1 | sed -E 's#^.*@([^:/]+):.*#\1#'); sudo sed -i '/^\[network\]/a generateHosts = false' /etc/wsl.conf && printf '127.0.0.1 %s\n' "$H" | sudo tee -a /etc/hosts >/dev/null; unset H

    ssh root@$IP 'cat monsterpaws/do-ca.crt' > ~/monsterpaws/var/do-ca.crt
    nohup scripts/home-worker-tunnel.sh >> ~/monsterpaws/var/home-worker-tunnel.log 2>&1 &
Never run `scripts/poll-via-home.sh` while this tunnel is up: it forwards the same local port. The hostname is in `/etc/hosts` and never printed.
Verify: `grep -c generateHosts /etc/wsl.conf` prints 1; `DATABASE_URL=$(pass show digitalocean/pg-home-worker-url | head -n1) NODE_EXTRA_CA_CERTS=~/monsterpaws/var/do-ca.crt` and node's `pg` answers `select current_user` as `home_worker`, with verification on, by `node -e` from a checkout. Oplog 0027's step 6 already took the handler's advisory lock under this role.
Rollback: stop the tunnel; delete both lines with sudo.

### 8. `paintings` starts the art worker
From a checkout at topdog's tip, with the tunnel up. After this entry's queue exists, because with none it raises the error 8 times in 7 s to Better Stack. The store is its own: its `.database` marker binds it to production's database, and the demo's store is bound to `monsterpaws_demo`.

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
Under `home_worker` it only calls `work`, with no `createQueue`, migrations or upkeep, and its pools at 2. It skips a job, without failing it, in the nightly quiet window, while a guard batch or ComfyUI runs, or under 22 GB free, and the sweep sends it again within the hour. It fetches a listing's photos only over https from `ART_PHOTO_HOSTS`, default `cdn.rescuegroups.org`.
Verify: its first lines read `art store bound to database <name>`, then `art.generate registered (WORKER_MODE=art)`; no error in the log after 2 minutes; `pgboss.job` still holds 0 `art.generate` rows.
Stop if: it reports permission denied: that's the role's grants, and it stops until they're read.
Rollback: SIGTERM by PID. Its own shutdown runs.

## Run
<filled in as it happens>

## Follow-ups
- `doc/infra.md`'s registry: `resend/webhook-signing-secret`, and the droplet's new keys.
- Oplog 0029: Spencer's grant and go-live; **the art worker restarted from a checkout with the grant's commit, since `keepsakeShare` reads `SHELTERS` from its own code and publish refuses otherwise, by `paintings`**; Logan's first real donation; then one send by hand and `EMAIL_SWEEP=on` as its last step.
