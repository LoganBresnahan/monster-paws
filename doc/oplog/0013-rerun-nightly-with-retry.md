# 0013: Rerun the nightly with the retry — the poll that turns health green again

Status: run
Planned: 2026-10-30 · Run: 2026-10-30 14:39 – 15:10 UTC
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

Run by Claude on Logan's word ("go"), from `~/monsterpaws` at `8c364bf`,
the fix committed and the tree clean. Nothing on 18443, no SSH session open
and no guard batch, at 14:39:01 UTC.

**1** started 14:39:09 UTC (proxy log `var/rg-proxy-20261030T143909Z.log`);
the droplet half printed `polling on the droplet, RescueGroups through home
— worker image 40cb846, 2026-10-30T14:39:11Z`. It completed on the
**first attempt**, 15:04:48 UTC, 25 min 39 s, with no `-- attempt` line.
It passed page 104, where 0012's rerun dropped, at about 14:43:

    {"source":"rescuegroups","observed":64400,"persisted":4956,"deduped":59444,
     "normalized":64400,"conflicted":0,"disappearanceRatePerDay":0.0234,
     "events":{"animal.seen":2337,"animal.updated":348,"animal.reappeared":9,
     "animal.disappeared":2044},"failures":0}
    heartbeat pinged
    finished 2026-10-30T15:04:48Z; the proxy's tunnels: 644 allowed, 0 refused
    == exit 0 2026-10-30T15:04:48Z

A complete run. Stage 5 measured 2.3%/day over the 31.6 h since the last
complete run (2026-10-29 07:26), under the gate, and marked 2,044 gone. That
is about twice a normal night's 1,037, because it covers a day and a third.
644 tunnels, ~417 MB in, 0 proxy errors, 0 refused. A single clean run
shows the fix does no harm, but proves nothing about the retry or the
race: the retry never fired, and the race was proved by the test.

Verify: health **200**, `{"ok":true,"db":"up","lastCompletePollAt":
"2026-10-30T15:04:47.764Z","pollStale":false,"sha":"40cb846…"}`.

**2** 15:05:00 UTC: heartbeat 499765 `up`; incident 1042503943 (the poll
heartbeat) **Resolved** 15:04:48 by the run's own ping. Monitor 4995794
was still `down`: it last checked at 15:03:24, before the run completed.
Read again until it resolved: at 15:10:09 incident 1042623559 (the health
monitor) was **Resolved** 15:09:34, monitor 4995794 `up` (checked 15:09:33).
No new incident opened: no attempt failed, so nothing pinged `/fail`. Both
of the day's incidents are closed.

## Follow-ups
- Tonight's nightly, 2026-10-31 07:00 UTC, is the wrapper's first
  unattended run: read `var/nightly/2026-10-31.log` for `-- attempt` lines
  and the closing `== exit 0`.
- The first nightly after 2026-11-01 should still start at 07:00 UTC
  (oplog 0010's follow-up, still open).
- With the next deploy: `fetchPage`'s page retry and the CLI's `err.cause`
  (doc/issues.md, Ops).
- The droplet's pending kernel reboot (oplog 0012), its own entry.
