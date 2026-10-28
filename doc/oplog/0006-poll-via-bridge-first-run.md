# 0006: Poll via the bridge — the first run, by hand

Status: planned
Planned: 2026-10-28 · Run: —
Why: ADR-0033 decisions 1–6 (the poll on the droplet, only RescueGroups'
requests through home; the first run by hand); ADR-0014 as amended, ADR-0009;
roadmap: Launch (3b). Oplog 0005's tunnel poll died 1 h 29 min in and was
not rerun.
Commit deployed: n/a on the droplet — the worker image is its current
`IMAGE_TAG`, `c45e085`; the scripts run from Logan's main checkout at the
bridge commit on topdog

Health has been 503 with `pollStale: true` since ~11:27 UTC (last complete
poll 2026-10-27 08:27:06 UTC). This run is the first of the bridge against
production, and proves the two things the local proof could not: that the
droplet's sshd allows the reverse forward, and that `docker run --env-file`
reads the droplet's real `.env` as compose does. The droplet's own 07:00
schedule still runs and is still refused by RescueGroups — expected noise in
the error log until ADR-0033 decision 7 switches it off. Nothing on the
droplet changes: no file, no service, no schedule.

Proved locally 2026-10-28, never against production: `scripts/rg-proxy.ts`
allows CONNECT to `api.rescuegroups.org:443` only (tests/rg-proxy.test.ts);
in the worker image `c45e085` against the dev database, `--max-pages 2`
through the proxy observed 200 with 0 failures and the proxy logged two
CONNECTs, and with the proxy down the poll failed (`fetch failed`) rather
than going direct; the script's droplet half, run on this machine against a
copy of the dev `.env`, completed and pinged.

## Prerequisites
- [ ] The bridge commit is on topdog in `~/monsterpaws` (not the worktree),
      with `node_modules` present — the proxy runs under its `tsx`.
- [ ] `pass` unlocked by Logan (the DO token only).
- [ ] No other SSH session to the droplet open from here; nothing else on
      127.0.0.1:18443 (`ss -ltn | grep 18443` prints nothing).
- [ ] `/api/health` answers (503 expected).

## Steps
### 1. The poll, on the droplet, RescueGroups through home

    cd ~/monsterpaws && scripts/poll-via-bridge.sh 2>&1 | tee var/poll-via-bridge-2026-10-28.log   # no flags

Verify: within seconds, the droplet half prints `polling on the droplet,
RescueGroups through home — worker image c45e085` (the forward and the
`.env` checks passed); the run summary reports ~60–85k observed, 0
failures, a complete run (no `lifecycleSkipped`); `heartbeat pinged`; the
closing line counts the proxy's tunnels with 0 refused, and
`var/rg-proxy-<stamp>.log` shows CONNECT to `api.rescuegroups.org:443` only;
`https://monsterpaws.org/api/health` returns 200 with this run's
`lastCompletePollAt` and `pollStale: false`; `https://monsterpaws.org/animals`
lists animals. Expected length: tens of minutes, not hours.
Rollback: none needed — append-only; a partial run is correct as far as it
got, and a failed run is run again. Stop and tell Logan if:
- `remote port forwarding failed` — the droplet's sshd refuses `-R`; a
  change to `sshd_config` is its own entry; tonight's fallback is
  `scripts/poll-via-home.sh` under a new entry.
- a `.env` check refuses (a missing or quoted name) — nothing ran; the fix is
  its own entry.
- the stage-5 disappearance gate refuses — `--max-daily-disappearance` only
  after Logan has checked the numbers (ADR-0014 as amended).
- the SSH connection drops mid-run — wait at least five minutes (ufw `LIMIT`
  on 22/tcp) before one session that checks for and removes a leftover
  `monsterpaws-bridge-poll` container, then run step 1 again.

## Run

## Follow-ups
