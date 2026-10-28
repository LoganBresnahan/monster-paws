# 0006: Poll via the bridge — the first run, by hand

Status: run
Planned: 2026-10-28 · Run: 2026-10-28 20:11 – 20:22 UTC (out of memory on the droplet; not rerun)
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

**1, started** 20:11:47 UTC, by Logan in his own terminal from
`~/monsterpaws` at `9bde630`, no flags, output teed to
`var/poll-via-bridge-2026-10-28.log`; the proxy's log
`var/rg-proxy-20261028T201147Z.log`. The droplet half printed
`polling on the droplet, RescueGroups through home — worker image c45e085,
2026-10-28T20:11:49Z` — so the droplet's sshd allowed the reverse forward
and the real `.env` passed the name and quote checks. The two
`.env not found` lines are Node's notice for `--env-file-if-exists`, as in
0005. First page through the proxy 20:11:53.

**The bridge is proved.** 454 page tunnels, all CONNECT to
`api.rescuegroups.org:443`, 0 refused, 0 proxy errors, ~325 MB in, the last
at 20:22:36 — ~45,400 listings in under 11 min, ~4,200 a minute against the
tunnel's ~335.

**1, out of memory** ~20:22:40 UTC, 651 s into the worker:

    <--- Last few GCs --->
    [30:…]   651174 ms: Mark-Compact 476.3 (481.2) -> 473.3 (481.2) MB, … scavenge might not succeed
    [30:…]   652174 ms: Mark-Compact 475.0 (481.2) -> 473.2 (480.2) MB, … scavenge might not succeed
    FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory

V8's heap on the 1 GB droplet tops out near 480 MB, and `runIngest`
(`src/core/ingest/pipeline.ts`) holds every `StoredObservation`, payload
and all, in `stored` until the feed is exhausted before it runs stages 2–4
— memory grows with the feed (`doc/issues.md`, Ops). At home the heap is
sized on home RAM, which is why 0001 completed. The script exited with the
failed run (no summary, no `heartbeat pinged`, no closing line); its trap
stopped the proxy and closed the SSH master — nothing listens on 18443 here
and no bridge process is left. Nothing on the droplet was touched by hand.

Left behind: raw payloads for the ~45k fetched (stage 1 persists as it
goes; append-only, correct); stages 2–4 and stage 5 never ran for this run,
so no animal changed and nothing was marked gone. Health after: still 503,
`lastCompletePollAt 2026-10-27T08:27:06Z`, `pollStale true`; `/animals`
200 — the app was unaffected. Not rerun under this entry: the next poll
gets its own entry.

## Follow-ups
- `doc/issues.md`, Ops: `runIngest` buffers the whole feed, so the poll runs
  out of memory on the droplet — the bridge's and, once RescueGroups
  allowlists it, the droplet's own scheduled poll. The fix streams stages
  2–4 inside the fetch loop; it needs a deploy, and the nightly bridge
  (ADR-0033 decision 7) waits on it.
- The next production poll, in its own entry: the bridge after that fix, or
  `scripts/poll-via-home.sh` as tonight's fallback — Logan's call.
