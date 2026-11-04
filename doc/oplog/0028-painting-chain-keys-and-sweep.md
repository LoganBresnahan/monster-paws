# 0028: The painting chain's keys and the keepsake sweep on, with no shelter to paint for

Status: run
Planned: 2026-11-04 · Run: 2026-11-04, 14:40 to 14:48 UTC; the hosts line 04:45 UTC
Why: real gifts to a shelter that holds a grant get a painting and an email (ADR-0035, ADR-0027 as amended 2026-11-02). Logan, to the moderator, 2026-11-03: "i want real donations working". Roadmap: Accounts and donating (item 4)
Commit deployed: none new. The app and worker images are oplog 0025's, so this only changes `.env` and recreates those two.

What changes on the droplet: five `.env` keys below, and `ART_SWEEP=on`; a roll of app and worker to read them. In Resend: a webhook, made by Logan. In `pass`: one new entry, its signing secret. On this box: a hosts line, `generateHosts = false` in `/etc/wsl.conf`, and the art worker started, a host process under `home_worker`.

What this opens: `/api/webhooks/resend` starts answering, signed requests only. `/unsubscribe` starts working. The sweep starts, and **it finds nothing to do while `SHELTERS` is empty**, so it writes no keepsake and sends no job. `EMAIL_SWEEP` stays unset here, so no mail goes out on its own, and with no keepsake there is nothing to mail.

Who does what: **Logan gives the word for step 1, in the session that runs it.** Logan creates the webhook in step 3, and types the one sudo line in step 7. `paintings` starts its worker in step 8. Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] Oplog 0025 has run: this needs migrations `0017` and `0018` and its image.
- [x] Oplog 0027 has run (done, 2026-11-04), and `paintings`' worker has taken a job on the dev database under the same options, so a job sent here has somewhere to go. Its queries fit the role: read 2026-11-04 in `src/worker/art.ts` and `src/core/share/keepsake.ts`, which select `keepsake`'s id and token and `keepsake_fact`, insert into `keepsake_fact`, and call `pg_advisory_xact_lock` and `current_database()`, and nothing else.
- [x] `ART_PHOTO_HOSTS` is on topdog, in `0b587cc`, so step 8's checkout must be at or after it. Before it, `fetchPhotos` took any https host and followed redirects.
- [x] Oplog 0026's domain answers: a real gift's art reaches the mail through `media.monsterpaws.org`.
- [x] `pass` unlocked by Logan.
- [x] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log shows `== exit`: 14:40 UTC, the night's log at `== exit 0`, 07:40 UTC.

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
Logan, directly, the night before: "1 and 2 are done what is the sudo line?", his word with the webhook made, and "yes" to running past 05:00 UTC. The moderator stopped it soon after, because his token limit was at 90% and a production run shouldn't be cut off halfway, so only step 7's hosts line had run. His fresh word the next morning: "run 0028". The moderator confirmed the card free and origin held at `08f3dde` at 14:39 UTC. The UI chat's vitest ran through this, CPU only in its own database.

**Changed from the steps above:**
- Step 3 was Logan's before this entry began: the webhook with its five events, and `resend/webhook-signing-secret`, read here only as starting `whsec_`.
- Step 4 made sure `.env` ended in a newline before appending, and read `WORKER_MODE` too.
- Step 6 read the job count once, not after a fixed 90 s: the sweep had already ticked.
- **Step 8 stopped once on `paintings`' own permission check,** which refused the start as a production deploy. It asked Logan, and this session didn't start the worker in its place. Logan to `paintings`, relayed by it: "start it please".
- `.env.before-0028` was deleted at the end, since it held secrets. A rollback is now deleting the six lines.

**Step 1, 14:40 UTC.** `IMAGE_TAG` `0989a18cf020f1211dde8a2d8dd2e24c1ef4ea2a`; checkout `11a07f1`. `SHARE_BASE_URL` counts `1`, every other key `0`. Health 200 on `0989a18`.

**Step 2, 14:40 UTC.** `resend/suppression-hmac-key` reads 65 bytes. Only its length was read, and no new key was made.

**Step 4, 14:40 UTC.** `EMAIL_SUPPRESSION_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_LIVE`, `EMAIL_ART_SOURCE` and `ART_SWEEP` count `1`; `EMAIL_SWEEP`, `EMAIL_LIVE_ALLOWED_TO` and `WORKER_MODE` count `0`.

**Step 5, 14:40 to 14:41 UTC.** The roll took 4.85 s by `time`, the slowest of the three so far. 180 POSTs, 180 `404`, **no 5xx**, slowest 11.65 s. Health 200, the same sha.

**Step 6, 14:42 UTC.** Resend's webhook, unsigned: 401. Unsubscribe with a token matching nothing: 404. App and worker print `on` and `0`. Log grep `0`. `keepsake 0`, `painting_email_sends 0`, `email_suppressions 0`; the `art.generate` queue exists, policy `standard`; 0 jobs.

**Step 7, 04:45 and 14:43 UTC.** Logan typed the sudo line at 04:45 UTC, and it held through the night: `generateHosts` counted `1`, the hosts line `1`, the name resolves to `127.0.0.1`. The tunnel started at 14:43 UTC with 1 process and an empty log. From node's `pg`, with verification on: `{"u":"home_worker","s":true,"j":0}`, and the lock taken.

**Step 8, 14:45 to 14:48 UTC, by `paintings`.** Started from `/home/oof/monsterpaws-art-08f3dde`, a `git archive` export of `08f3dde`, PID 3324780. First lines `[worker] art store bound to database defaultdb` and `[worker] art.generate registered (WORKER_MODE=art)`. Two minutes on: those lines and nothing else, and the store holds only its `.database` marker. Read here at 14:48 UTC: 0 `art.generate` jobs, 0 keepsakes, 0 sends, 1 connection as `home_worker`, named `pgboss`.

Better Stack, a count only: 0 reports in the last 30 minutes. Nothing paints and nothing mails: `SHELTERS` is empty and `EMAIL_SWEEP` unset.

**Not survived by a reboot:** the tunnel and the worker are plain processes, so a restart of this box stops both, and paid paintings wait and alert after 30 minutes. They start again by steps 7 and 8.

## Follow-ups
- `doc/infra.md`'s registry: `resend/webhook-signing-secret`, and the droplet's new keys.
- Oplog 0029: Spencer's grant and go-live; **the art worker restarted from a checkout with the grant's commit, since `keepsakeShare` reads `SHELTERS` from its own code and publish refuses otherwise, by `paintings`**; Logan's first real donation; then one send by hand and `EMAIL_SWEEP=on` as its last step.
