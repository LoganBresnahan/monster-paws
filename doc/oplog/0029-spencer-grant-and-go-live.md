# 0029: Spencer's grant, the Sponsor button opens, and the first real donation

Status: planned
Planned: 2026-11-04 · Run: —
Why: "beetle painting is the backup, i want real donations working" (Logan, to the moderator, 2026-11-03), on a plain yes from Spencer Pet Rescue: "all we need is a yes from her and its good enough. shes an admin of the shelter she runs the every.org page. she already knows the plan about making art for people when they donate. i think its fine. I will send the email myself" (Logan, in the `emails` session, 2026-11-03). Roadmap: Accounts and donating (item 4)
Commit deployed: `<SHA>`, named by the moderator once Spencer's reply is in and the fixes below have landed. This entry follows in its own push so the image tag is the code commit.

What changes on the droplet: the app and worker images; any new migration; one `shelter_nonprofits` row; `EMAIL_SWEEP=on`, last. On this box: the art worker restarted from a checkout holding the grant.

**What this opens: a real-money Sponsor button on Spencer Pet Rescue's listings, 11 available at the 2026-11-04 read, and only theirs.** A recorded donation gets a keepsake within a minute and four paintings about 5 minutes later when the card is free, published at a public share page under its own token, and from the last step mailed with no person looking first (Logan, 2026-11-04: "no i wont look before the first day emails"). Accepted for day one, in his words: no limit on minting intents ("yes accept it for day one"), so step 6 and the day's watch read the count.

Who does what: **Logan gives the word for step 1 and for the donation in step 8 and the send in step 9, in the session that runs them.** `paintings` restarts its worker in step 7. Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] **Spencer's yes:** "Yes you may", at 15:29:35 UTC on 2026-11-04, from Kristen, answering "may we use the photos in your listings to make art of your animals for your donors?". Read by the `emails` session, which checked DKIM, SPF and DMARC as passing, and that those words are all she wrote. Its `evidence` line is in the registry, with the hash read again here against the raw file.
- [ ] Logan's link to `/privacy` has gone to Kristen, before the button opens (the moderator is reminding him).
- [ ] The commit on `<SHA>` holds, together:
  - The registry entry in `src/core/shelters.ts`: slug `spencer-pet-rescue`, `shelterExternalIds: ["rescuegroups:org:11756"]`, checked by a person, one `digify` grant with its words as `basis` and `<Message-ID> sha256:<hex>` as `evidence`.
  - An ADR-0028 amendment on §5 and §6: a listing's photo under this grant, citing the reply.
  - An ADR-0004 note: Logan's words above change what its photo-rights confirmation and disclosure rest on, and they name that.
  - Spencer's withdrawal term: the newer rule, "A gift already made can still get its painting", from Logan directly: "use the newer rule for spencers". The thread shows the older term, "we stop painting, take the paintings down and delete the photos", and her notice is his next email linking `/privacy`, with no extra sentences (Logan, to the moderator: "no in the next email to her we will just link the privacy page"). **Read `/privacy`'s withdrawal and public-page lines before he links it.**
  - The go-live: the footer's "Donations coming soon!" and `/animals/[id]`'s "When sponsoring opens" sentence removed.
- [ ] That image also holds `37f1ce1`, `604a76c`, `e018831`, the `emails` session's fixes and the plural `/thanks` lines, and "We stop taking donations" reworded.
- [ ] `paintings`' fixes to the head-fallback path and its log throttle are on topdog, for step 7's checkout.
- [ ] CI green on `<SHA>`. Ship bar on `<SHA>`, in a temporary checkout at exactly that sha: vitest twice, typecheck, `npm run e2e`.
- [ ] e2e against the published app image, Every.org set to production. The published worker image boots on a throwaway database.
- [ ] Any new migration rehearsed on a scratch restore of the newest dump, then dropped.
- [ ] `git diff 12c451f <SHA> -- Caddyfile docker-compose.prod.yml` prints nothing, or this entry gains the step.
- [ ] Every.org's API read on the day: `spencer-pet-rescue`'s `hasAdmin` and `donationsEnabled` both true, and its EIN `86-1172833`, as read on 2026-11-02.
- [ ] A listing with Commons-tested painting behaviour: `paintings`' Commons run passed on a listing-shaped job.
- [ ] `pass` unlocked by Logan.
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log shows `== exit`.
- [ ] The moderator holds the card, and the art worker and tunnel are up: `pgrep -fc '[m]onsterpaws-home-worker'` prints 1.
- [ ] The deadline: a yes by about 22:00 UTC leaves room before 2026-11-05 02:00 UTC. After that Logan decides, and the crew backup stands.

## Steps

### 0. The raw message into the vault
The hash fits one exact file, the Gmail API's raw message, held in the `emails` session's scratchpad. It holds her address and Logan's phone number, so it never enters this repo (ADR-0029 as amended 2026-10-27).

    RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ENDPOINT="$(pass show cloudflare/r2-vault-endpoint | head -n1)" \
    RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(pass show cloudflare/r2-vault-access-key-id | head -n1)" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(pass show cloudflare/r2-vault-secret-access-key | head -n1)" \
    sh -c 'rclone copyto <that file> "r2:monsterpaws-vault/consent/rescuegroups:org:11756-2026-11-04.eml" && rclone cat "r2:monsterpaws-vault/consent/rescuegroups:org:11756-2026-11-04.eml" | sha256sum'
Verify: the hash starts `302eaa800a84e56d`, the registry's.
Stop if: it differs. Nothing in the button depends on this step, but the evidence does.
Rollback: `rclone deletefile`.

### 1. Record what is running — this is the rollback, and it closes the button
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 && cp .env .env.before-0029 && chmod 600 .env.before-0029 &&
      docker compose -f docker-compose.prod.yml ps --format "{{.Service}} {{.Image}} {{.Status}}" &&
      for k in ART_SWEEP EMAIL_SWEEP WORKER_MODE EMAIL_LIVE; do printf "%s " $k; grep -c "^$k=" .env; done'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG` is `0989a18cf020f1211dde8a2d8dd2e24c1ef4ea2a` or a later recorded sha; `ART_SWEEP` and `EMAIL_LIVE` count `1`; `EMAIL_SWEEP` and `WORKER_MODE` count `0`; health 200.
Rollback: n/a — the record.

### 2. Read what's there
    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \""' <<'SQL'
    SELECT 'nonprofits', count(*) FROM shelter_nonprofits;
    SELECT 'spencer available', count(*) FROM animals WHERE shelter_external_id = 'rescuegroups:org:11756' AND status = 'available';
    SELECT 'intents', count(*) FROM donation_intents;
    SELECT 'keepsakes', count(*) FROM keepsake;
    SELECT 'sends', count(*) FROM painting_email_sends;
    SELECT 'suppressions', count(*) FROM email_suppressions;
    SELECT 'migrations', count(*) FROM drizzle.__drizzle_migrations;
    SQL
Verify: `nonprofits 0`; Spencer's count recorded; intents, keepsakes and sends `0`; the migration count recorded.
Stop if: any intent, keepsake or send already exists: find out why first.
Rollback: n/a — a read.

### 3. Pull the release, one SSH session; nothing restarts
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<FULL SHA>/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images'
Verify: the checkout at this entry's commit; app and worker resolve to `<SHA>` and are pulled; all three still run the old containers.
Rollback: `IMAGE_TAG` back to step 1's sha; `git checkout <step 1's sha>`, then `git checkout topdog` later.

### 4. Migrate if there's anything new, while the old images serve
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml run --rm --no-deps worker npx drizzle-kit migrate; \
      docker run --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -c \"SELECT count(*) FROM drizzle.__drizzle_migrations\""'
Verify: the count equals the sha's `drizzle/*.sql`, read back; health 200 on the old sha.
Rollback: forward only.

### 5. Spencer's row, then the timed roll, which opens the button
Both are needed for a Sponsor button: the row does nothing without the grant in the new image, and `sponsorNonprofit` reads both. It's a fact table, so this row is the only one on production, and it's written by hand here because the outreach tool has never run there.

    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At"' <<'SQL'
    INSERT INTO shelter_nonprofits (shelter_external_id, everyorg_slug, ein, source, fetched_at, everyorg_claim, claim_checked_at)
    VALUES ('rescuegroups:org:11756', 'spencer-pet-rescue', '86-1172833', 'Every.org API, read on the day; the admin, by name, in her reply', now(), 'claimed', now());
    SQL
    : > roll.log; ( for i in $(seq 1 180); do curl -sS -m 40 -o /dev/null -w '%{http_code} %{time_total}\n' -X POST --data x \
        https://monsterpaws.org/api/webhooks/everyorg/wrong >> roll.log 2>&1 & sleep 0.5; done; wait ) & L=$!
    sleep 5; date -u +%T; ssh root@$IP 'cd monsterpaws && time docker compose -f docker-compose.prod.yml up -d app worker'; date -u +%T; wait $L
    cut -d' ' -f1 roll.log | sort | uniq -c; sort -k2 -n roll.log | tail -1
    curl -fsS https://monsterpaws.org/api/health
Verify: `INSERT 0 1`; every line 404, the slowest under 30 s; health 200 on `<SHA>`; the worker up 20 s on with no `fatal`.
Stop if: any 5xx, or the worker restarting.
Rollback: `IMAGE_TAG` back to step 1's sha and `up -d app worker`, after listing `/spool`. **That closes the button**, since the old image holds no grant; the row stays and does nothing.

### 6. Live: the button is on Spencer's animals and nobody else's
    S=$(ssh root@$IP '...one available animals.id for rescuegroups:org:11756...'); O=$(ssh root@$IP '...one available animals.id for any other shelter...')
    for p in / /animals /privacy /claim /thanks "/animals/$S" "/animals/$S/sponsor" "/animals/$O"; do curl -s -o /dev/null -w "$p %{http_code}\n" https://monsterpaws.org$p; done
    curl -s -o /dev/null -w "another shelter's sponsor %{http_code}\n" https://monsterpaws.org/animals/$O/sponsor
    curl -s -o /dev/null -w "test-gift %{http_code}\n" https://monsterpaws.org/test-gift/anything
    curl -s https://monsterpaws.org/animals/$S | grep -cE "has not partnered|Not affiliated|When sponsoring opens"
    curl -s https://monsterpaws.org/animals/$O | grep -cE "has not partnered"
    curl -s https://monsterpaws.org/ | grep -c "Donations coming soon"
    curl -s https://monsterpaws.org/animals/$S/sponsor | grep -cE "Our thank-you|try to paint"
    curl -s https://monsterpaws.org/privacy | sed 's/<[^>]*>//g' | grep -ciE "\bgifts?\b|\baccount\b"
And the donate link, by reading what a sponsor form submits: `method=card,paypal`, production's Every.org and the production token, with no value printed.
Verify: all 200 except another shelter's sponsor page and `test-gift`, 404; the partner lines count `0` on Spencer's and at least `1` on the other; footer `0`; sponsor wording at least `1`; `/privacy` `0`. **Logan opens a listing himself.**
Stop if: another shelter's Sponsor page answers 200. Roll back.
Rollback: step 5's.

### 7. `paintings` restarts the worker from a checkout holding the grant
`keepsakeShare` reads `SHELTERS` from its own code, and publish refuses without this. SIGTERM by PID, then 0028's step 8 command, from an export of `<SHA>` or later.
Verify: its two first lines; no error after 2 minutes; 1 connection as `home_worker`.
Rollback: SIGTERM. Gifts wait, and the sweep alerts after 30 minutes.

### 8. Logan's first real donation, watched
On his word, in a real browser, by card or PayPal, to one of Spencer's animals, with his own address. Then read, with no address printed:
- **The webhook:** `decided recorded`, the donation row, `closed_at`, its delay from `donationDate`.
- **The sweep, within 60 s:** one keepsake, its facts on `grant:spencer-pet-rescue:digify`, no `source_photo`; one `art.generate` job carrying `photos`.
- **The worker:** the job taken, detection on the listing's photo, 4 `art` facts in about 5 minutes, published under the token.
- **`/thanks`:** waiting, then "we're trying to paint".
- **Better Stack:** a count, and any error read by key name.
**Logan looks at the four paintings at `media.monsterpaws.org`.**
Stop if: the paintings are wrong enough that he says so: `EMAIL_SWEEP` stays off, and it's his call.
Rollback: none for the gift. It's his own money, to Spencer.

### 9. One send by hand, on his yes
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml exec -T worker npm run email -- send-owed --keepsake <id>' </dev/null
Verify: the mail in his inbox, with the share link and the unsubscribe; `painting_email_sends.sent_at` set; Resend's `email.delivered` row; **`donation_intents.donor_email` now null**, which proves the webhook's erase. `/thanks`: "on their way" and "You can view the paintings here."
Rollback: none for a sent mail.

### 10. The UI chat's live checks on that set
- `/share/<token>/1/painting.jpg?x=1` answers 200 with `no-store`.
- `/_next/image?url=/share/<token>/1/painting.jpg&w=640&q=75` answers 400.
- GET `/share/<token>/1/painting.jpg?` twice, then a takedown, then GET: a 404 shows the purge reaches the bare `?`, and if it doesn't, the one-day limit covers it. **That takes the real set down, so run this part on a throwaway set unless Logan says otherwise.**

### 11. `EMAIL_SWEEP=on`, last
This starts real mail with no person looking (Logan, 2026-11-04).

    ssh root@$IP 'cd monsterpaws && printf "EMAIL_SWEEP=on\n" >> .env && grep -c ^EMAIL_SWEEP= .env && docker compose -f docker-compose.prod.yml up -d worker && rm -f .env.before-0029'
Verify: `1`; the worker up; its log shows no `EMAIL_SWEEP=on but not started`; `npm run email -- list` shows nothing owed.
Rollback: delete the line, `up -d worker`, and mail stops.

## Run
<filled in as it happens>

## Follow-ups
- The day's watch: the mint count, Better Stack, and Logan reading the bucket's new sets.
- `everyorg/test-page-secret` leaves `pass`.
- The stuck-keepsake alert, slice C with `bank` back, and the by-hand deletion tool: `doc/issues.md` and the plan.
- Who keeps the worker up after the deadline, and whether the button stays open: Logan.
