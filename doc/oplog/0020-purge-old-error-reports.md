# 0020: Old error reports purged, by lowering `errors_retention` to 1 day and restoring it

Status: abandoned
Planned: 2026-11-02 · Run: 2026-11-02 23:54 – 23:55 UTC, stopped at step 2
Why: ADR-0010 as amended 2026-11-02. Logan, 2026-11-02: "yeah we can purge. prod visits have been
nothing but that and there is no interactivity yet", and "yeah change retention to 1 day".
Commit deployed: n/a — the droplet, the database and the buckets do not change

What this changes: one setting on Better Stack's Errors application `monsterpaws`, down and back, and
through it the reports stored before oplog 0019's roll. The application, its id and its DSN stay.

Why this way. Better Stack's docs (read 2026-11-02, Errors API and MCP pages) describe no way to delete
reports short of `DELETE /api/v2/applications/{id}`, and they don't say what that does to the DSN, which
is built into the browser bundle (`NEXT_PUBLIC_SENTRY_DSN`, a build arg in `ci.yml`). Recreating the
application is ruled out for that reason, and no write goes through MCP's `query`. `errors_retention` is
the documented setting left. The docs state no minimum and don't say when deletion runs, so how soon this
takes is measured here.

Read ahead of this entry, 2026-11-02 about 22:29–22:32 UTC, through `https://mcp.betterstack.com` with
`betterstack/telemetry-token`, counts and key names only: 36 reports in 90 days. 16 are `production` with a
public address: `app`/`node` 6 (2 addresses, 2026-10-27, each naming `cf-connecting-ip`), `app`/`javascript`
4 (2 addresses, 2026-10-28 and 29), `worker`/`node` 6 (1 address, no request). 20 are `spike`, 2026-09-29
and 30. No cookie in any. `errors_retention` 90, `ingesting_paused` false.

Who does what: Claude runs the reads and the settings calls, on Logan's word, straight after 0019's step 7.

## Prerequisites
- [ ] Oplog 0019 is through step 7 with no stop: its proof's report has been read, because the drop below
      could delete it. Note 0019's step 5 time as `<roll>`: reports before it are the ones to purge.
- [ ] `pass` unlocked by Logan (`betterstack/telemetry-token`, the DO token for `$IP`).

## Steps

### 1. Read the evidence of what is being purged
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    T=$(pass show betterstack/telemetry-token | head -n1)
    BETTERSTACK_TELEMETRY_TOKEN=$T DROPLET_IP=$IP node scripts/error-report-counts.mjs now-90d <roll>
    curl -s -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications/2778816 \
      | jq -c '.data.attributes | {name, errors_retention, ingesting_paused}'
Verify: the table, counts only, in Run, as the record of what this entry removes. It measures ADR-0010's "most
likely the droplet's own": the 6 worker reports read `droplet`, or that sentence is wrong and a new entry says
so. `errors_retention` is the value step 5 restores, read here and not remembered.
Rollback: n/a — reads.

### 2. Try the setting on a scratch application, so the first refusal isn't on the live one
    S=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      -d '{"name":"oplog-0020-scratch","platform":"next_js_errors","errors_retention":90}' \
      https://errors.betterstack.com/api/v2/applications | jq -r .data.id)
    if [ -z "$S" ] || [ "$S" = null ] || [ "$S" = 2778816 ]; then
      echo "STOP: no scratch application"
    else
      for days in 1 90; do curl -s -o /dev/null -w "$days %{http_code}\n" -X PATCH -H "Authorization: Bearer $T" \
        -H "Content-Type: application/json" -d "{\"errors_retention\":$days}" \
        https://errors.betterstack.com/api/v2/applications/$S; done
      curl -s -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications/$S | jq .data.attributes.errors_retention
      curl -s -o /dev/null -w "delete %{http_code}\n" -X DELETE -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications/$S
    fi
    curl -s -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications | jq -r '.data[].attributes.name'
The guard is there because that `DELETE` is the one destructive call in this entry: it must be impossible to
aim at the live application.
Verify: both PATCHes 2xx, it reads back `90`, delete 204, and the names list holds only `monsterpaws`.
Stop if the create is refused, for example by a plan limit on applications: that says nothing about the setting,
so run nothing further and tell Logan.
Stop if: either PATCH is refused. A plan that won't let it rise again would silently cost us error history
at a lowered value, so step 3 doesn't run: Logan emails support instead, and his privacy decision returns to
him. If 1 is refused for being too low, stop too; a higher value is a new decision, not this entry.
Rollback: delete the scratch application.

### 3. Lower it on the live application
    curl -s -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      -d '{"errors_retention":1}' https://errors.betterstack.com/api/v2/applications/2778816 \
      | jq -c '.data.attributes | {name, errors_retention, ingesting_paused}'
Record the time. While it holds, new reports last about a day too, including anything Logan's first gifts
raise, so read them promptly. Alerts still fire.
Verify: `errors_retention` 1, `ingesting_paused` false, same `name`.
Rollback: step 5.

### 4. Wait, and read until the old reports are gone, for at most 48 hours
    BETTERSTACK_TELEMETRY_TOKEN=$T DROPLET_IP=$IP node scripts/error-report-counts.mjs now-90d <roll>
Read it twice a day at most: nothing says when deletion runs.
Verify: no rows.
If reports remain after 48 hours: run step 5 anyway, since a low setting costs history every day it stays. Then
Logan emails hello@betterstack.com asking them to delete application 2778816's reports before `<roll>`, and
his "don't add anything to the privacy page about previous reports" returns to him, because it rested on this
purge happening.
Rollback: step 5.

### 5. Restore it
    curl -s -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      -d '{"errors_retention":<step 1's value>}' https://errors.betterstack.com/api/v2/applications/2778816 \
      | jq -c '.data.attributes | {name, errors_retention, ingesting_paused}'
Verify: `errors_retention` is step 1's value. Its token and DSN are unchanged: `betterstack/errors-dsn` still
works in step 6.
Rollback: none needed; this is the rollback.

### 6. Prove a fresh report still arrives, one SSH session
From the droplet, so the report can hold only the droplet's address, through the worker's own DSN, writing no row:

    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml exec -T worker node -e "
      const S = require(\"@sentry/node\");
      S.init({ dsn: process.env.SENTRY_DSN, environment: \"oplog-0020\" });
      S.captureMessage(\"oplog 0020: ingest check\");
      S.close(5000);"'
    # up to ten minutes later:
    BETTERSTACK_TELEMETRY_TOKEN=$T DROPLET_IP=$IP node scripts/error-report-counts.mjs now-1h now
It is expected if this raises a Better Stack alert: the alert will say `oplog 0020: ingest check`.
Verify: one `oplog-0020` row, `address_kind` `none` or `droplet`. It stays and ages out in its own time.
Stop if: nothing arrives after ten minutes: ingest is what the setting must not have touched, so look at the
application in the dashboard before anything else.
Rollback: none needed.

## Run
**Prerequisites.** Oplog 0019 through step 7 at 23:54:32 UTC, its proof's report read, with no stop. `<roll>` is
2026-11-02T23:53:20Z. Run on Logan's "go!", which followed being told the purge runs if the proof is clean.

**1.** 23:54:55. Reports before `<roll>`, counts only:

| env | component | platform | address_kind | reports | distinct_addresses | days |
| --- | --- | --- | --- | --- | --- | --- |
| production | app | javascript | public | 4 | 2 | 2026-10-28 to 29 |
| production | app | node | public | 6 | 2 | 2026-10-27 |
| production | worker | node | droplet | 6 | 1 | 2026-10-27 to 28 |
| spike | app | javascript | public | 2 | 1 | 2026-09-29 to 30 |
| spike | app | node | loopback | 18 | 1 | 2026-09-29 to 30 |

No report holds a cookie. The 6 worker reports read `droplet`, so ADR-0010's "most likely the droplet's own" is now
measured. `errors_retention` 90, `ingesting_paused` false.

**2.** 23:55:06. **Stopped.** The scratch application was created, `PATCH 1` answered **422**, `PATCH 90` answered
200, it read back 90, delete 204, and the names list held only `monsterpaws`. The command's `-o /dev/null` threw away
the 422's body, so the minimum is still unknown. As the step says, 1 being refused stops the entry, and a higher
value is a new decision.

**3–6.** Not run. At 23:55:34 the live application read `errors_retention` 90, `ingesting_paused` false, and health
was 200 on `cc8ca32`. No report was removed, and the old reports stay until a new entry or their 90 days.

## Follow-ups
- Oplog 0022: 7 days instead, on Logan's word. N days clears the 16 production reports about N days after 2026-10-29,
  so 30 wouldn't be done until late November.
- Logan's "don't add anything to the privacy page about previous reports" rested on a purge happening, so it comes back
  to him if 0022 fails.
