# 0032: Deploy `dea83ba` — Cat Town's opt-out, ahead of the go-live

Status: run
Planned: 2026-11-04 · Run: 2026-11-04, 17:05 to 17:09 UTC
Why: Cat Town replied to Logan's wave: "remove and take us off your email list". The ask promised that takes its listings down (ADR-0029 §5), and this is the first real opt-out. Logan, directly: "sure ship it first", ahead of the vision-model test that holds oplog 0029, and "we can probably just branch off of where the last deploy was and add this removal?". Roadmap: Shelter consent (item 5)
Commit deployed: `dea83ba`, on branch `hotfix/cat-town`, `83b2bc9` plus the exclusion alone. CI builds images for `hotfix/**`. The exclusion also lands on topdog, so oplog 0029's image keeps it.

What changes: one raw message into the vault. On the droplet, the app and worker images, by `IMAGE_TAG`. `rescuegroups:org:5818` joins `SHELTER_EXCLUSIONS`, which closes its pages and its donation path. The checkout stays at `4445141`, with no `git pull`, since compose and the `Caddyfile` are the same. No `.env` key, Caddy, DNS or migration change.

What this opens: nothing. This image has no grant, no sort and no wording change from `83b2bc9`: production differs by one shelter.

Who does what: **Logan gave the word above, to the session running this.** Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] CI green on `dea83ba`: `verify`, `images`, `sourcemaps`, run 41872309284.
- [x] Ship bar on `dea83ba`, in a temporary checkout at exactly that sha, 2026-11-04 16:55 to 17:03 UTC: vitest 911 of 911 twice with `--maxWorkers=2`, typecheck clean, `npm run e2e` 59 of 59.
- [x] e2e against the published app image, Every.org set to production, 2026-11-04 17:04 UTC: 46 passed in 11.0 s, 13 skipped, all in `e2e/share.spec.ts`. The published worker image booted on a throwaway database: up after 24 s, 0 fatal lines, no `art.generate` queue.
- [x] `git diff --stat 83b2bc9 dea83ba` read: `src/core/shelters.ts` and `tests/shelter-registry.test.ts`, and nothing in `public/`, `drizzle/` or the server config.
- [x] Disk clear for the pull: 12G free after oplog 0031.
- [x] `pass` unlocked by Logan.
- [x] Not within an hour of 06:00, 07:00 or 08:30 UTC, and the night's log shows `== exit`.
- [x] The moderator rechecked the box at 17:05 UTC: batch 40a on the card, 24 GB free in Windows, the driver pool 1.7 GB, load 1.9, no build or test. **Short of the usual line, on the moderator's say and Logan's "okay lets try the deploy":** `paintings`' batch may be on the card through this roll, so the risk is the box freezing during an SSH step. One session per step, and the rollback `83b2bc9` ready.

## Steps

### 0. The raw message into the vault
ADR-0029 keeps a shelter's raw message the same day. Its hash fits one exact file, the Gmail API's raw message, held in the `emails` session's scratchpad. It holds the sender's name and phone number, so it never enters this repo.

    RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ENDPOINT="$(pass show cloudflare/r2-vault-endpoint | head -n1)" \
    RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(pass show cloudflare/r2-vault-access-key-id | head -n1)" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(pass show cloudflare/r2-vault-secret-access-key | head -n1)" \
    sh -c 'rclone copyto <that file> "r2:monsterpaws-vault/consent/rescuegroups:org:5818-2026-11-04.eml" && rclone cat "r2:monsterpaws-vault/consent/rescuegroups:org:5818-2026-11-04.eml" | sha256sum'
Verify: the hash starts `ef6e69b7e108975c`, the one in `SHELTER_EXCLUSIONS`.
Stop if: it differs. The roll doesn't depend on this step, but the evidence does.
Rollback: `rclone deletefile`.

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 && df -h / | tail -1 &&
      for k in ART_SWEEP EMAIL_SWEEP WORKER_MODE; do printf "%s " $k; grep -c "^$k=" .env; done'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG` is `83b2bc901e68e87b251d3f1a8e98ba228b5481d7`, recorded in Run; `ART_SWEEP 1`, `EMAIL_SWEEP 0`, `WORKER_MODE 0`; health 200.
Rollback: n/a — the record.

### 2. Read Cat Town's animal, for step 4's check
    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \""' <<'SQL'
    SELECT 'migrations', count(*) FROM drizzle.__drizzle_migrations;
    SELECT 'cat town animal', min(id), count(*) FROM animals WHERE shelter_external_id = 'rescuegroups:org:5818' AND status = 'available';
    SQL
    curl -s -o /dev/null -w "cat town animal, before %{http_code}\n" https://monsterpaws.org/animals/$C
Verify: `migrations 19`; Cat Town's id and count recorded; its page 200 before the roll, so step 4's 404 means something.
Rollback: n/a — a read.

### 3. Pull the image; nothing restarts
    ssh root@$IP 'cd monsterpaws && sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=dea83ba2f2726b96e7922afe4ce5843be4d4f345/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images && git log --oneline -1'
Verify: app and worker resolve to `dea83ba` and are pulled; the checkout still `4445141`; all three still run the old containers.
Rollback: `IMAGE_TAG` back to step 1's sha.

### 3b. The timed roll, with a POST every half second
    : > roll.log; ( for i in $(seq 1 180); do curl -sS -m 40 -o /dev/null -w '%{http_code} %{time_total}\n' -X POST --data x \
        https://monsterpaws.org/api/webhooks/everyorg/wrong >> roll.log 2>&1 & sleep 0.5; done; wait ) & L=$!
    sleep 5; date -u +%T; ssh root@$IP 'cd monsterpaws && time docker compose -f docker-compose.prod.yml up -d app worker'; date -u +%T; wait $L
    cut -d' ' -f1 roll.log | sort | uniq -c; sort -k2 -n roll.log | tail -1
    curl -fsS https://monsterpaws.org/api/health
Verify: every line is 404, the slowest under 30 s; health 200 on `dea83ba`; Caddy not recreated; the worker up 20 s on with no `fatal`.
Stop if: any 5xx, or the worker restarting.
Rollback: `IMAGE_TAG` back to step 1's sha, `up -d app worker`, after listing `/spool`.

### 4. Live checks: Cat Town is gone, and nothing else changed
    for p in / /animals /privacy /claim /thanks /demo; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    curl -s -o /dev/null -w "cat town animal %{http_code}\n" https://monsterpaws.org/animals/$C
    curl -s -o /dev/null -w "cat town sponsor %{http_code}\n" https://monsterpaws.org/animals/$C/sponsor
    curl -s "https://monsterpaws.org/animals?shelter=rescuegroups:org:5818" | sed 's/<[^>]*>//g' | grep -ci "cat town"
    curl -s https://monsterpaws.org/animals | grep -cE "Can be sponsored|Sponsorable first"
    curl -s https://monsterpaws.org/ | grep -c "Donations coming soon"
Verify: six pages 200; Cat Town's animal and sponsor pages 404, and its shelter view `0`; `/animals`' grep `0`; the footer's line still `1`, since this image changes no wording. Cat Town stays in the database: the exclusion hides it at every read.
Rollback: step 3b's.

## Run
Logan, directly, in the session that ran it: "sure ship it first" and "we can probably just branch off of where the last deploy was and add this removal?". To the moderator: "okay lets try the deploy", which it read as this entry and told him so. Commit deployed `dea83ba`, on `hotfix/cat-town`.

**This ran with the card busy, deliberately:** `paintings`' batch 40a was on the card throughout, guard PID 3430363 from before step 0 to after step 4. Nothing hiccuped on this side: no SSH step stalled, and 21 GB was free in the WSL distro at the end. Whether the batch's own output was affected is `paintings`' to read.

**Changed from the steps above:** step 0 ran `rclone` from its pinned image with `RCLONE_S3_NO_CHECK_BUCKET=true`. `/test-gift` wasn't read live: the image at 17:04 UTC answered 404, and 83b2bc9 had already removed it.

**Step 0, 17:06 UTC.** The raw message at `r2:monsterpaws-vault/consent/rescuegroups:org:5818-2026-11-04.eml`, the hash read back from the vault starting `ef6e69b7e108975c`, the one in `SHELTER_EXCLUSIONS`.

**Step 1, 17:06 UTC.** `IMAGE_TAG` `83b2bc901e68e87b251d3f1a8e98ba228b5481d7`, the rollback. Checkout `4445141`. `/` 52%. `ART_SWEEP 1`, `EMAIL_SWEEP 0`, `WORKER_MODE 0`. Health 200 on `83b2bc9`.

**Step 2, 17:06 UTC.** `migrations 19`. 54 available Cat Town animals. One read before the roll: 200, naming Cat Town.

**Step 3, 17:06 to 17:07 UTC.** App and worker pulled at `dea83ba2f2726b96e7922afe4ce5843be4d4f345`; the checkout still `4445141`; all three on the old containers.

**Step 3b, 17:07 UTC.** The roll took 3.49 s by `time`, 17:07:16 to 17:07:20. 180 POSTs, 180 `404`, **no 5xx**, slowest 10.13 s. Health 200 on `dea83ba`. Caddy not recreated. The worker still up about a minute on, with 0 `fatal` lines. `/` 56%, 11G free.

**Step 4, 17:08 UTC.** Six pages 200. That Cat Town animal 404, its sponsor page 404, and its shelter view `0`. `/animals` holds no "Can be sponsored" or "Sponsorable first". The footer's line still `1`. Better Stack, a count only: 0 reports in 15 minutes.

Nothing failed, and nothing was rolled back.

## Follow-ups
- Oplog 0029 rolls onto its own sha, which holds this exclusion through topdog, and rolling back past it must keep the exclusion.
- Old images, by `doc/infra.md`'s Recurring ops, keeping this one and the one before.
