# 0008: Poll via the bridge on `40cb846` — the poll that turns health green

Status: run
Planned: 2026-10-28 · Run: 2026-10-28 21:17 – 21:45 UTC
Why: ADR-0033 as amended 2026-10-28, ADR-0009 as amended 2026-10-28,
ADR-0014; roadmap: Launch (3b). Oplog 0006 proved the bridge and ran the
droplet out of heap at ~45k; oplog 0007 deployed the fix and switched the
droplet's own schedule off.
Commit deployed: n/a — the worker image is the droplet's `IMAGE_TAG`,
`40cb846`; the scripts run from `~/monsterpaws` at topdog

Health has been 503 with `pollStale: true` since ~11:27 UTC (last complete
poll 2026-10-27 08:27:06 UTC). This is 0006's step on the fixed image: the
same `scripts/poll-via-bridge.sh`, no flags. Nothing on the droplet changes.

Memory headroom: the full feed on this code peaked at **~284 MB RSS** (dev
poll under a 400 MB heap cap, 64,093 observed, 13 min, 2026-10-28) against
**~416 MB available** on the droplet with app, worker and caddy running
(oplog 0001) — ~130 MB of margin. Expected length: ~15 min, the dev poll's
13 plus page latency through home (0006 fetched ~4,200 listings a minute).

## Prerequisites
- [ ] topdog in `~/monsterpaws` with `node_modules` (the proxy runs under its
      `tsx`); `pass` unlocked (the DO token only).
- [ ] The droplet on `40cb846`, the schedule off (oplog 0007).
- [ ] No other SSH session to the droplet open from here; nothing on
      127.0.0.1:18443.
- [ ] Not within an hour of 07:00 or 08:30 UTC.

## Steps
### 1. The poll, on the droplet, RescueGroups through home

    cd ~/monsterpaws && scripts/poll-via-bridge.sh 2>&1 | tee var/poll-via-bridge-2026-10-28-2.log   # no flags

Verify: the droplet half prints `polling on the droplet, RescueGroups
through home — worker image 40cb846`; the run summary reports ~60–85k
observed, 0 failures, no `lifecycleSkipped`; `heartbeat pinged` (the
heartbeat is still paused, so the ping is recorded, not alerted on); the
closing line counts the proxy's tunnels with 0 refused;
`https://monsterpaws.org/api/health` returns 200 with this run's
`lastCompletePollAt` and `pollStale: false`; `https://monsterpaws.org/animals`
lists animals.
Rollback: none needed — append-only; a partial run is correct as far as it
got, and a failed run is run again. Stop and tell Logan if:
- the CLI exits 2 (`the run did not complete`) — the disappearance gate
  refused or the feed was empty; the bridge pings `/fail`;
  `--max-daily-disappearance` only after Logan has checked the numbers
  (ADR-0014 as amended).
- the heap runs out again — the fix did not hold on the droplet.
- the SSH connection drops mid-run — wait at least five minutes (ufw
  `LIMIT` on 22/tcp) before one session that checks for and removes a
  leftover `monsterpaws-bridge-poll` container, then run step 1 again.

## Run

Run by Claude on Logan's word, from `~/monsterpaws` at `650caa3`, output to
`var/poll-via-bridge-2026-10-28-2.log`, the proxy's log
`var/rg-proxy-20261028T211745Z.log`. No flags. The permission check allowed
the run (it had refused `poll-via-home.sh` from Claude in 0005).

**1, started** 21:17:45 UTC (proxy up); the droplet half printed `polling on
the droplet, RescueGroups through home — worker image 40cb846,
2026-10-28T21:17:47Z`. First page through the proxy 21:17:50.

**1, finished** 21:44:59 UTC, 27 min 12 s — past page 454, where 0006 ran
out of heap, without a stall:

    {"source":"rescuegroups","observed":64111,"persisted":5198,"deduped":58913,
     "normalized":64111,"conflicted":0,"disappearanceRatePerDay":0.0257,
     "events":{"animal.seen":3322,"animal.updated":393,"animal.disappeared":2646},
     "failures":0}
    heartbeat pinged
    finished 2026-10-28T21:44:59Z; the proxy's tunnels: 642 allowed, 0 refused

A complete run: no `lifecycleSkipped`; stage 5 measured 2.6%/day since the
2026-10-27 run, under the gate, and marked 2,646 gone. ~2,360 listings a
minute — slower than 0006's fetch-only ~4,200, since each page is now
derived before the next is fetched, and ~14× the tunnel's ~335. 642 page
tunnels, all to `api.rescuegroups.org:443`, ~415 MB in, 0 refused, 0 proxy
errors. The heartbeat ping landed on a paused heartbeat (499765), recorded
and not alerted on. The droplet's memory during the run was not measured;
the run completing past 0006's failure point is the evidence the fix held.

Verify: health **200** — `db up`, `lastCompletePollAt
2026-10-28T21:44:58.872Z`, `pollStale false`, sha `40cb846…`. `/animals`,
`?state=IL` and `?zip=60614` 200; `/animals` lists a full page (24).

## Follow-ups
- ADR-0033 decision 7, its own entry: the droplet half as a checked-in
  script, the restricted key, the ssh config host, the Task Scheduler task
  at 07:00 UTC. Until it runs, health stays green only to 27 h after this
  run — 2026-10-30 00:45 UTC.
- After the first unattended night completes: unpause heartbeat 499765 and
  monitor 4995794, their own entry.
