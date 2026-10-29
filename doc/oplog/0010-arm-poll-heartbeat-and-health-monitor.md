# 0010: The first unattended night read; the poll heartbeat and the health monitor armed

Status: planned
Planned: 2026-10-29 · Run: —
Why: ADR-0033 decision 7, *Monitoring*: the poll heartbeat (499765) and the
`/api/health` keyword monitor (4995794) are unpaused after the first
unattended night completes; oplog 0009 step 7 deferred that reading to
this entry. Roadmap: Launch (3b).
Commit deployed: n/a — nothing on the droplet changes; Better Stack only

Both have been paused since the launch (oplog 0001 step 6; step 8, which
would have armed them, waited on RescueGroups). Since 0007 the droplet's own
job is unscheduled, and the bridge's droplet half
(`scripts/bridge-poll-droplet.sh`) pings the heartbeat after a complete run,
`/fail` otherwise. Once both are armed, a missed or failed night alerts.

## The night, read before this entry (12:15 UTC, from `~/monsterpaws`)

`var/nightly/2026-10-29.log`, the whole file but the two `.env not found`
lines (the known, harmless notice, oplog 0005):

    == nightly poll 2026-10-29T07:00:01Z
    rg-proxy on 127.0.0.1:18443, its log in var/rg-proxy-20261029T070001Z.log
    polling on the droplet, RescueGroups through home — worker image 40cb846, 2026-10-29T07:00:05Z
    {"source":"rescuegroups","observed":64089,"persisted":3146,"deduped":60943,
     "normalized":64089,"conflicted":0,"disappearanceRatePerDay":0.0159,
     "events":{"animal.seen":1011,"animal.updated":167,"animal.reappeared":5,
     "animal.disappeared":1037},"failures":0}
    heartbeat pinged
    finished 2026-10-29T07:26:36Z; the proxy's tunnels: 641 allowed, 0 refused
    == exit 0 2026-10-29T07:26:36Z

- A complete run: 26 min 35 s, 0 failures, no `lifecycleSkipped`; stage 5
  measured 1.6%/day since 0008's run and marked 1,037 gone. The heartbeat
  ping landed on the paused heartbeat.
- The proxy's log: every line names `api.rescuegroups.org:443`.
- The Windows task: `Ready`, `LastRunTime` 2026-10-29 2:00 AM local (07:00
  UTC), `LastTaskResult 0`, `NumberOfMissedRuns 0`, `NextRunTime`
  2026-10-30 2:00 AM. `LastTaskResult` is `poll-nightly.sh`'s own exit,
  which is 0 whatever the poll did. Only the log's `== exit 0` shows the
  poll succeeded.
- `/api/health`: 200, `ok true`, `db up`, `lastCompletePollAt
  2026-10-29T07:26:35.966Z`, `pollStale false`, sha `40cb846…`.

## Prerequisites
- [ ] `pass` unlocked by Logan (`betterstack/uptime-token`,
      `betterstack/heartbeat-ingest-poll`).
- [ ] Health still 200, its `lastCompletePollAt` from a nightly.
- [ ] Not between 06:45 and 07:45 UTC, so no nightly is mid-run.
- [ ] No SSH: this entry never touches the droplet.

TRAP: never print a Better Stack heartbeat's whole `attributes`, not even a
PATCH's response. They carry its ping URL, which is the secret in
`betterstack/heartbeat-ingest-poll`. Every call below pipes through `jq`
and keeps only the fields named.
Each step runs as one shell call, so each block sets `U` itself. Without it,
a PATCH goes out with an empty bearer and gets a 401.

## Steps

### 1. Record: this is the rollback
    U=$(pass show betterstack/uptime-token)
    for r in heartbeats/499765 monitors/4995794; do
      curl -s -H "Authorization: Bearer $U" https://uptime.betterstack.com/api/v2/$r \
        | jq -c '.data | {id, name: .attributes.name, status: .attributes.status, paused_at: .attributes.paused_at}'
    done
    curl -s https://monsterpaws.org/api/health
Verify: both `status "paused"`; health 200, `lastCompletePollAt
2026-10-29T07:26:35.966Z`.
Rollback: n/a, this is the record.

### 2. The heartbeat: unpause it, then send the ping that stands for this morning's run
    U=$(pass show betterstack/uptime-token)
    curl -s -X PATCH -H "Authorization: Bearer $U" -H "Content-Type: application/json" \
      -d '{"paused":false}' https://uptime.betterstack.com/api/v2/heartbeats/499765 \
      | jq -c '.data | {id, status: .attributes.status}'
    curl -fsS -m 30 "$(pass show betterstack/heartbeat-ingest-poll)" >/dev/null && echo "heartbeat pinged"
Verify: the PATCH answers `status "pending"` or `"up"`; then `heartbeat
pinged`.
- Why the ping: 07:26's ping landed while the heartbeat was paused. Without
  one now, the heartbeat would wait for tomorrow's run.
- The ping stands for a run verified complete above. A ping by hand is
  never sent for a run that wasn't (`doc/infra.md`).
- After the ping, the heartbeat expects the next one within 27 h (24 h
  period, 3 h grace). Tomorrow's nightly sends it at ~07:27 UTC.
Rollback: the same PATCH with `{"paused":true}`.

### 3. The health monitor: unpause it
    U=$(pass show betterstack/uptime-token)
    curl -s -X PATCH -H "Authorization: Bearer $U" -H "Content-Type: application/json" \
      -d '{"paused":false}' https://uptime.betterstack.com/api/v2/monitors/4995794 \
      | jq -c '.data | {id, status: .attributes.status}'
Verify: it answers with a status that is not `"paused"`.
Rollback: the same PATCH with `{"paused":true}`.

### 4. Both up, after one 3-minute check
Run step 1's whole block again (it sets `U`), at least 3 minutes after
step 3.
Verify: both `status "up"`, `paused_at null`. If the monitor reads `down`,
read `/api/health` first:
- If health is not 200, the alert is real. Leave the monitor armed and
  tell Logan.
- If health is 200, the monitor is wrong. Pause it again, which is step 3's
  rollback, and say so in **Run**.
Rollback: steps 2 and 3's.

From here, a bad night alerts three ways:
- A failed or incomplete run pings `/fail` as soon as the CLI exits
  non-zero.
- A night with no run alerts on the heartbeat 27 h after its last ping. A
  night with no run includes Windows not logged on (oplog 0009's limit).
- The health monitor goes red 27 h after the last complete poll: from this
  morning's, 2026-10-30 10:26 UTC.

## With Run, in the same commit
These docs still describe the heartbeat as paused, so they change with Run:
- `doc/infra.md`: registry row `betterstack/heartbeat-ingest-poll`. It says
  "created paused" and "Unpause it in the same deploy that turns the poller
  on". The fix: armed by this entry, pinged by
  `scripts/bridge-poll-droplet.sh`.
- `doc/infra.md`: the monitors block's `# at the poller deploy` comment.
  Its PATCH also gains the `jq` filter from the TRAP above.
- `doc/flows.md`: the heartbeat label `(paused until oplog 0001)`.
- `doc/roadmap.md`: the Launch row's "Next".
- `doc/oplog/README.md`: this entry's index row.

## Run

## Follow-ups
