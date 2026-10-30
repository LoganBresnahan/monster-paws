# 0013: Rerun the nightly with the retry — the poll that turns health green again

Status: planned
Planned: 2026-10-30
Why: ADR-0033 as amended 2026-10-30, ADR-0014; roadmap: Launch (3b). The
nightly of 2026-10-30 failed (a cut page at 131), and so did its rerun by
hand (the SSH connection dropped at page 104, oplog 0012). Health has been
503 with `pollStale: true` since 10:27:33 UTC; heartbeat 499765's incident
1042503943 and monitor 4995794's incident 1042623559 are open.
Commit deployed: n/a — the worker image is the droplet's `IMAGE_TAG`,
`40cb846`; the scripts run from `~/monsterpaws` at topdog, with the fix

What is new since 0012 is all at home: `scripts/poll-nightly.sh` retries the
whole run (up to three attempts, five minutes apart, inside the 3 h bound,
never after exit 2), and `scripts/rg-proxy.ts` no longer cuts a page's tail.
This entry runs the wrapper itself, by hand, exactly as the Windows task
does: the nightly key, nothing from `pass`, nothing on the droplet changed.
Its lines append to `var/nightly/2026-10-30.log`, after the morning's
failed block. Expect ~27 min if the first attempt completes, and at most
~1 h 30 min for three.

## Prerequisites
- [ ] The fix committed on topdog in `~/monsterpaws`; `node_modules`
      present; nothing on 127.0.0.1:18443.
- [ ] No other SSH session to the droplet open from here.
- [ ] Not within an hour of 07:00 or 08:30 UTC; no guard batch running (the
      card is held for a manual production poll).

## Steps
### 1. The nightly wrapper, by hand

    cd ~/monsterpaws && scripts/poll-nightly.sh; tail -n 20 var/nightly/2026-10-30.log

Verify: a new `== nightly poll` block. The droplet half prints `polling on
the droplet, RescueGroups through home — worker image 40cb846`. The
summary reports ~64k observed, 0 failures, no `lifecycleSkipped`;
`heartbeat pinged`; ~641 tunnels with 0 refused; the block ends
`== exit 0`. Any `-- attempt N exited <rc>` lines are retries working as
built: record each one and its proxy log. Then
`https://monsterpaws.org/api/health` returns 200 with this run's
`lastCompletePollAt` and `pollStale: false`.
Rollback: none needed. The data is append-only, and every failed attempt is
a partial run that stage 5 never counts. Stop and tell Logan if:
- the block ends anything but `== exit 0`: three attempts failed, or exit 2
  (the gate, which only Logan clears with `--max-daily-disappearance`, as a
  root run through `pass`, oplog 0008's path), or the 3 h bound.
- an attempt fails with a cut page (`terminated`) again: the proxy fix did
  not hold.

### 2. Both incidents resolved (reads only)

    U=$(pass show betterstack/uptime-token)
    curl -fsS -H "Authorization: Bearer $U" "https://uptime.betterstack.com/api/v3/incidents?from=2026-10-30&to=2026-10-30" \
      | jq -r '.data[] | [.id, .attributes.name, .attributes.status, (.attributes.resolved_at // "-")] | @tsv'
    curl -fsS -H "Authorization: Bearer $U" https://uptime.betterstack.com/api/v2/heartbeats/499765 | jq -r '.data.attributes.status'

Verify: heartbeat 499765 `up`; incidents 1042503943 and 1042623559
resolved, plus any new `/fail` incident a retried attempt opened. Filter
every heartbeat read with `jq`, because the API returns the ping URL in it.

## Run

## Follow-ups
