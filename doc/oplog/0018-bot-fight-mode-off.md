# 0018: Bot Fight Mode off for the zone, so Every.org's webhook can land

Status: run
Planned: 2026-11-02 · Run: 2026-11-02 about 17:11 – 17:31 UTC
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
- [x] Oplog 0017's Run is committed (`e9ee694` on topdog), so this entry cites a frozen
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
From `~/monsterpaws-donate`, level with topdog at `231c4ef`. Two real staging deliveries
landed, so the setting was what blocked the first gift. Results match the Verify lines
except where marked **Differed**.

**1. The click.** Logan, by about 17:11 UTC, before this entry was committed.
**Differed:** the audit log was not read (Logan: "i didn't check the audit log but that's
fine"), so the time is his report.

**2. The two settings, about 17:30.** Logan: "all the cloudflare stuff is good", answering
the ask to read Bot Fight Mode off and the managed ruleset on.

**3. The site.** Read at 17:15:52 and again at 17:30:49, the same both times:

    {"monitor":"4995720","status":"up","paused":false}
    {"monitor":"4995794","status":"up","paused":false}
    GET https://monsterpaws.org/ 200
    GET https://monsterpaws.org/api/health 200

**4. Real staging gifts.** Both through http://localhost:3027/animals/90745 with the test
card, to the dev database. Field names and non-personal values only.

| Gift | `donationDate` | Received | `amount` | `netAmount` | Extras | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 17:14:45 | 17:14:49 | `2` | `1.66` | none | recorded |
| 2 | 17:23:39 | 17:23:43 | `5` | `4.62` | a $0.75 tip to Every.org, an address, "share my support publicly" | recorded |

- **The auth token rode on both POSTs**, in `Authorization`: two of two, card gifts only.
- **Body keys, gift 1:** `amount chargeId currency donationDate email event firstName
  frequency lastName netAmount partnerDonationId paymentMethod toNonprofit`. Gift 2 adds
  `address` (`city country postalCode state streetAddress`).
- **Against the docs:** `amount` is `2`, not `2.00` style. `frequency` is `ONCE`, not
  `One-time`. `paymentMethod` is `STRIPE`. `event` is `donation.completed`, a key the docs
  don't list. No tip field, testimony or note, public support ticked or not.
- **Neither of our secrets** is in either stored row, and none reached the dev server's log.

Logan opened `/thanks` locally after these gifts: "the thanks page looks good".

**Differed:**
- **The return address.** With `success_url` `http://localhost:3027/thanks`, gift 1's donor
  landed on another charity's page on Every.org. For gift 2 it was
  `https://monsterpaws.org/thanks`, and the redirect worked. Which of https or the domain
  Every.org needs is unproven.
- **Gift 2's rows were deleted from the dev database** at 17:25, because the address was
  real: its stats row, donation, raw payload and intent. A first attempt at 17:24 did
  nothing (`docker exec` without `-i` passes no stdin) and a count caught it. Nothing from
  the body was printed or written anywhere else.
- **One slip:** reading gift 1's headers printed `cf-warp-tag-id`, the tunnel's id, into
  the session transcript, against 0017's "nothing prints the tunnel's ID". It is not in the
  repo, and it is not a credential on its own.

The first gift's blocked delivery (16:53:41) never came back: its intent was still open at
17:30, with the setting off and the tunnel up from 17:11. So no retry landed in that window,
and the export shows none to 17:02. Treat a failed delivery as lost.

**5. Down, 17:30:49.** `npm run hooks -- status`: `tunnel down`.

## Follow-ups
- Read Cloudflare's firewall events and the droplet's load about a week on (2026-11-09):
  what was being challenged now reaches the origin. Heavier probing than the 57 a day
  seen here is the reason to look again at a paid plan or a Worker in front of the hook.
- `doc/issues.md`'s entry is deleted with this Run. The Server Action entry stays, for
  the production roll's smoke.
- Production's gifts still have to show the auth token on bank and donor-advised-fund
  gifts, what `event` they send, and the real minimum.
