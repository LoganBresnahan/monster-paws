# 0022: Old error reports purged, by lowering `errors_retention` to 7 days and restoring it

Status: planned
Planned: 2026-11-03 · Run: —
Why: ADR-0010 as amended 2026-11-02; oplog 0020, which stopped because Better Stack refused 1 day. Logan,
2026-11-03: "7 is fine to get rid of what we collected".
Commit deployed: n/a — the droplet, the database and the buckets do not change

What this changes: one setting on Better Stack's Errors application `monsterpaws`, down and back, and through
it the reports stored before oplog 0019's roll (`<roll>`, 2026-11-02T23:53:20Z). The application, its id and its
DSN stay. Why this route, and what those reports hold, is in oplog 0020.

How long: N days clears the 16 production reports about N days after their last day, 2026-10-29, so about
2026-11-05. Nothing says when deletion runs, so this entry stays open until step 6, and no later than 2026-11-08.
While the setting is low, a new report lasts 7 days, which costs nothing in that time.

Who does what: Claude runs the reads and the settings calls, on Logan's word. Steps 5–7 run on a later day, and the
roadmap's Launch row says so until this entry freezes, because a setting left at 7 silently costs history.

## Prerequisites
- [ ] Oplog 0019's proof read, done at 23:54:32 UTC on 2026-11-02: the proof's report can age out with the rest.
- [ ] `pass` unlocked by Logan (`betterstack/telemetry-token`, the DO token for `$IP`).

## Steps

### 1. Read what is there, and the value to restore
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    T=$(pass show betterstack/telemetry-token | head -n1)
    BETTERSTACK_TELEMETRY_TOKEN=$T DROPLET_IP=$IP node scripts/error-report-counts.mjs now-90d 2026-11-02T23:53:20Z
    curl -s -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications/2778816 \
      | jq -c '.data.attributes | {name, errors_retention, ingesting_paused}'
Verify: the same table as 0020's step 1; `errors_retention` is the value step 6 restores, read here and not
remembered.
Rollback: n/a — reads.

### 2. Try the value on a scratch application, printing any refusal
    S=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      -d '{"name":"oplog-0022-scratch","platform":"next_js_errors","errors_retention":90}' \
      https://errors.betterstack.com/api/v2/applications | jq -r '.data.id // empty')
    if [ -z "$S" ] || [ "$S" = 2778816 ]; then
      echo "STOP: no scratch application"
    else
      for days in 7 90; do
        R=$(curl -s -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
          -d "{\"errors_retention\":$days}" -w '\n%{http_code}' https://errors.betterstack.com/api/v2/applications/$S)
        msg=$(printf '%s' "${R%$'\n'*}" | jq -c '.errors // .error // .message // "accepted"' 2>/dev/null)
        echo "$days ${R##*$'\n'} ${msg:-not JSON}"
      done
      curl -s -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications/$S | jq .data.attributes.errors_retention
      curl -s -o /dev/null -w "delete %{http_code}\n" -X DELETE -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications/$S
    fi
    curl -s -H "Authorization: Bearer $T" https://errors.betterstack.com/api/v2/applications | jq -r '.data[].attributes.name'
Each line prints `<days> <code> <message>`, so a refusal names its limit, which is what this step is for.
Verify: both 2xx and `"accepted"`, it reads back `90`, delete 204, and the names list holds only `monsterpaws`.
Stop if: 7 is refused. Print what Better Stack says the limit is, and take it to Logan: a higher value is a new
decision, and past about 7 days support is the better route. Stop too if the create is refused or `$S` fails the
guard, which says nothing about the setting. The `DELETE` is this entry's one destructive call, and the guard makes
it impossible to aim at the live application.
Rollback: delete the scratch application.

### 3. Lower it on the live application
    curl -s -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      -d '{"errors_retention":7}' https://errors.betterstack.com/api/v2/applications/2778816 \
      | jq -c '.data.attributes | {name, errors_retention, ingesting_paused}'
Verify: `errors_retention` 7, `ingesting_paused` false, same `name`. Record the time.
Rollback: step 6.

### 4. Prove a fresh report still arrives, straight after the drop, one SSH session
If lowering it broke ingest, we'd be blind during Logan's gifts, which is exactly when a `bad_fields` alert matters.
From the droplet, so the report can hold only the droplet's address, through the worker's own DSN, writing no row. It
is expected if this raises a Better Stack alert: the alert will say `oplog 0022: ingest check`.

    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml exec -T worker node -e "
      const S = require(\"@sentry/node\");
      S.init({ dsn: process.env.SENTRY_DSN, environment: \"oplog-0022\" });
      S.captureMessage(\"oplog 0022: ingest check\");
      S.close(5000);"'
    # up to ten minutes later:
    BETTERSTACK_TELEMETRY_TOKEN=$T DROPLET_IP=$IP node scripts/error-report-counts.mjs now-1h now
Verify: one `oplog-0022` row, `address_kind` `none` or `droplet`.
Stop if: nothing arrives after ten minutes: ingest is what the setting must not have touched, so run step 6 at once,
then look at the application in the dashboard.
Rollback: none needed.

### 5. Wait, and read until the old reports are gone, until 2026-11-08 at the latest
This and what follows run on a later day, so `pass` must be unlocked by Logan again, and `$T` and `$IP` re-read as in
step 1.

    BETTERSTACK_TELEMETRY_TOKEN=$T DROPLET_IP=$IP node scripts/error-report-counts.mjs now-90d 2026-11-02T23:53:20Z
Read it once a day at most, from 2026-11-05.
Verify: no rows.
If reports remain on 2026-11-08: run step 6 anyway. Then Logan emails hello@betterstack.com asking them to delete
application 2778816's reports before `<roll>`, and his "don't add anything to the privacy page about previous reports"
returns to him, because it rested on this purge happening.
Rollback: step 6.

### 6. Restore it
    curl -s -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      -d '{"errors_retention":<step 1's value>}' https://errors.betterstack.com/api/v2/applications/2778816 \
      | jq -c '.data.attributes | {name, errors_retention, ingesting_paused}'
Verify: `errors_retention` is step 1's value.
Rollback: none needed; this is the rollback.

### 7. Prove a fresh report still arrives, after the restore, one SSH session
Step 4's check again, clear of 06:00–08:30 UTC because of the droplet's ufw `LIMIT` and the nightly work. The freezing
commit removes the Launch row's line.

    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml exec -T worker node -e "
      const S = require(\"@sentry/node\");
      S.init({ dsn: process.env.SENTRY_DSN, environment: \"oplog-0022\" });
      S.captureMessage(\"oplog 0022: ingest check\");
      S.close(5000);"'
    # up to ten minutes later:
    BETTERSTACK_TELEMETRY_TOKEN=$T DROPLET_IP=$IP node scripts/error-report-counts.mjs now-1h now
Verify: one `oplog-0022` row, `address_kind` `none` or `droplet`.
Stop if: nothing arrives after ten minutes: ingest is what the setting must not have touched, so look at the
application in the dashboard before anything else.
Rollback: none needed.

## Run

## Follow-ups
