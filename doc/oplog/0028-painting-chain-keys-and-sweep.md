# 0028: The painting chain's keys and the keepsake sweep on, with no shelter to paint for

Status: planned
Planned: 2026-11-04 · Run: —
Why: real gifts to a shelter that holds a grant get a painting and an email (ADR-0035, ADR-0027 as amended 2026-11-02). Logan, to the moderator, 2026-11-03: "i want real donations working". Roadmap: Accounts and donating (item 4)
Commit deployed: none new. The app and worker images are oplog 0025's, so this only changes `.env` and recreates those two.

What changes on the droplet: five `.env` keys below, and `ART_SWEEP=on`; a roll of app and worker to read them. In Resend: a webhook, made by Logan. In `pass`: two new entries.

What this opens: `/api/webhooks/resend` starts answering, signed requests only. `/unsubscribe` starts working. The sweep starts, and **it finds nothing to do while `SHELTERS` is empty**, so it writes no keepsake and sends no job. `EMAIL_SWEEP` stays unset here, so no mail goes out on its own, and with no keepsake there is nothing to mail.

Who does what: **Logan gives the word for step 1, in the session that runs it.** Logan creates the key and the webhook in steps 2 and 3. Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [ ] Oplog 0025 has run: this needs migrations `0017` and `0018` and its image.
- [ ] Oplog 0027 has run, and `paintings`' worker has taken a job on the dev database under the same options, so a job sent here has somewhere to go.
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

### 2. Logan makes the never-mail key
This key is permanent: losing it loses the never-mail list, because a digest made under a new key matches nothing.

    openssl rand -hex 32 | pass insert -m resend/suppression-hmac-key >/dev/null
    pass show resend/suppression-hmac-key | head -n1 | wc -c
Verify: 65. It exists nowhere else yet. `doc/infra.md`'s registry gains it in this entry's commit of Run.
Rollback: `pass rm -f resend/suppression-hmac-key`, only before step 4.

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

## Run
<filled in as it happens>

## Follow-ups
- `doc/infra.md`'s registry: `resend/suppression-hmac-key`, `resend/webhook-signing-secret`, and the droplet's new keys.
- Oplog 0029: Spencer's grant and go-live, Logan's first real gift, then one send by hand and `EMAIL_SWEEP=on` as its last step.
