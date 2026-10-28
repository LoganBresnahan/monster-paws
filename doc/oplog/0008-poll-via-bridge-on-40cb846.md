# 0008: Poll via the bridge on `40cb846` — the poll that turns health green

Status: planned
Planned: 2026-10-28 · Run: —
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

## Follow-ups
