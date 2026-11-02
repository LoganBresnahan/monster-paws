# 0018: Bot Fight Mode off for the zone, so Every.org's webhook can land

Status: planned
Planned: 2026-11-02 · Run: —
Why: ADR-0027 as amended 2026-11-02; oplog 0017, "The unproven part"; `doc/issues.md`,
Ops; roadmap: Accounts and donating (item 4). Logan's choice, 2026-11-02.
Commit deployed: n/a — the droplet, the database and the buckets do not change

What is known. Logan's staging gift went through our donate link at 16:53 UTC.
Cloudflare's firewall export (Logan's download, kept out of this repo because it holds
visitors' addresses) shows one `POST` to the webhook's real path at 16:53:41, answered
`managed_challenge` by `ruleId: bot_fight_mode`, from Amazon's AS16509, user agent
`node`, HTTP/1.1, unsampled. Nothing reached the tunnel or
`everyorg_webhook_payloads`. A server can't solve a challenge, so with this setting on
no delivery lands, on staging or in production. Cloudflare's docs say it can't be
skipped by WAF custom rules or Page Rules; only Super Bot Fight Mode, on a paid plan,
can.

What the setting was doing, in that export (24 hours to 17:02 UTC): 57 other challenges,
53 from Microsoft's network, the commonest paths probes like `/admin.php/m1.php`. The 277
blocked exploit attempts came from the managed ruleset (`source: firewallManaged`), a
separate setting this entry must leave on. One day is thin, so the follow-up reads it
again.

**The click came before this entry was committed.** Logan turned the setting off on his
own call, having read the evidence above, and said so at about 17:11 UTC ("bot fight mode
is off now"). So ADR-0023's order was not met for that one step, and nobody read the
settings page first. The setting's earlier state is still on record: the export's
`bot_fight_mode` challenge at 16:53:41 shows it was on then. The managed ruleset's is too:
its 277 blocks ran up to 11:41 UTC. Nothing needs undoing: the choice was his.

Who does what: `cloudflare/dns-token` gets 403 on `bot_management`, so the setting can
only be read and changed in the dashboard, by Logan. Claude runs the other reads and
records what Logan reports. Dashboard paths are as of 2026-11-02 and may differ:
monsterpaws.org → Security → Settings.

## Prerequisites
- [x] Oplog 0017's Run is committed (`e9ee694` on `donate`), so this entry cites a frozen
      record.
- [x] The baseline, read at about 17:07 UTC, before the click: monitors 4995720 and
      4995794 `up`, not paused; `https://monsterpaws.org/` and `/api/health` answer `200`.
      The same reads for step 3:

      U=$(pass show betterstack/uptime-token)
      for m in 4995720 4995794; do
        curl -s -H "Authorization: Bearer $U" "https://uptime.betterstack.com/api/v2/monitors/$m" \
          | jq -c --arg m "$m" '{monitor:$m, status:.data.attributes.status, paused:.data.attributes.paused}'
      done
      for p in / /api/health; do
        curl -s -o /dev/null -w "GET https://monsterpaws.org$p %{http_code}\n" "https://monsterpaws.org$p"
      done

## Steps

### 1. Bot Fight Mode off (Logan, already done)
Made before this entry was committed; see above.

Verify: step 2.
Rollback: Logan turns it back on. That blocks every delivery again, on staging and in
production.

### 2. Read both settings now (Logan)
Bot Fight Mode, and the managed ruleset (Cloudflare Free Managed Ruleset, or whatever the
dashboard calls the rules behind `source: firewallManaged`). AI crawlers stay as they are
(`doc/infra.md`, a deliberate setting).

Also the account audit log (Manage Account → Audit Log), if it shows the change: its time
beats a remembered one. If it doesn't, the Run uses Logan's report and says so.

Verify: Logan reads Bot Fight Mode off and the managed ruleset **still on**. The decision
rests on that second read.
Rollback: step 1's.

### 3. The site is unchanged
The reads in the prerequisites, again.

Verify: both monitors `up` and not paused; both GETs `200`.
Rollback: step 1's.

### 4. A real staging gift, the only proof
A curl from home proves nothing here, as 0017 says: home's POST passed with the setting
on. With the dev server on 127.0.0.1:3027 and `npm run hooks -- up`, Logan gives through
http://localhost:3027/animals/90745 with the test card, name and email shared.

    docker exec monsterpaws-db-1 psql -U monsterpaws -d monsterpaws -tAc \
      "select id, partner_donation_id is not null, received_at from everyorg_webhook_payloads order by id desc limit 1"
    docker exec monsterpaws-db-1 psql -U monsterpaws -d monsterpaws -tAc \
      "select count(*) from donations; select count(*) from donation_intents where closed_at is not null"
    docker exec monsterpaws-db-1 psql -U monsterpaws -d monsterpaws -tAc \
      "select k, case when v in ('[our auth token]','[redacted]') then v else '(present)' end from everyorg_webhook_payloads, jsonb_each_text(headers) as h(k, v) order by id desc, k"
    docker exec monsterpaws-db-1 psql -U monsterpaws -d monsterpaws -tAc \
      "select string_agg(k, ' ' order by k) from everyorg_webhook_payloads, lateral jsonb_object_keys(body::jsonb) k group by id order by id desc limit 1"

Verify: a payload row, a donation and a closed intent; `/thanks` turns to "Your $N is on
its way". The Run records whether the auth token rode on the POST, and the body's key
names and the header names. It never records a value from them.
Rollback: step 1's, and the entry says turning it off did not help.

### 5. Down when the session ends

    npm run hooks -- down

Verify: `npm run hooks -- status` says `tunnel down`.
Rollback: `npm run hooks -- up`.

## Run
<added on the day>

## Follow-ups
- Read Cloudflare's firewall events and the droplet's load about a week on (2026-11-09):
  what was being challenged now reaches the origin. Heavier probing than the 57 a day
  seen here is the reason to look again at a paid plan or a Worker in front of the hook.
- `doc/issues.md`'s entry is deleted once a delivery lands.
