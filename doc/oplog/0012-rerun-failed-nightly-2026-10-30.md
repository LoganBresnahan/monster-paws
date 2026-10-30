# 0012: Rerun the failed nightly poll of 2026-10-30

Status: planned
Planned: 2026-10-30
Why: ADR-0033 decision 7, ADR-0014; roadmap: Launch (3b). The 07:00 UTC
nightly (oplog 0009) failed at 07:06:27 UTC after 131 pages with
`terminated` (`var/nightly/2026-10-30.log`; the cause is in doc/issues.md,
Ops). Better Stack has two open incidents: heartbeat 499765 "Reported
failure" since 07:06:27 (incident 1042503943), and monitor 4995794 "Status
503" since 10:27:33 (incident 1042623559). Health reads `ok: false`,
`pollStale: true`, last complete poll 2026-10-29 07:26:35 UTC.
Commit deployed: n/a — the worker image is the droplet's `IMAGE_TAG`,
`40cb846`; the scripts run from `~/monsterpaws` at topdog

First, one keyless look at whether RescueGroups still refuses the droplet:
Logan switched the API key from "private" to "public" on 2026-10-30. That
should change nothing, because at launch the reset came mid-TLS-handshake,
before any request carries the key, and `rescuegroups.org`'s own site, which
takes no key, reset the same way (oplog 0001, step 7). Then the run the
Windows task makes, started by hand: through the nightly key, so the poll
reads nothing from `pass` and nothing on the droplet changes. The code is
unchanged and the cause unfixed, so this run can fail the same way. A failed
run is run again once; a second failure stops, and the fix comes next.

## Prerequisites
- [ ] topdog in `~/monsterpaws` with `node_modules`; nothing on
      127.0.0.1:18443.
- [ ] No other SSH session to the droplet open from here; `pass` unlocked
      for step 1 (the DO token only).
- [ ] Not within an hour of 07:00 or 08:30 UTC; no guard batch running (the
      card is held for a manual production poll, as for the nightly).

## Steps
### 1. Does RescueGroups still reset the droplet? (keyless, one root session)

    export DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1)
    IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | awk '$1 == "monsterpaws" {print $2}')
    ssh -o ConnectTimeout=10 root@$IP 'for h in api.rescuegroups.org rescuegroups.org example.com; do printf "%s " $h; curl -sS -o /dev/null -m 15 -w "%{http_code}" https://$h/ 2>&1 | tr "\n" " "; echo; done'

No key and nothing from `.env`: a bare GET to each host's root.
Verify: as at launch, both RescueGroups hosts fail with a reset (curl
`(35)`, code `000`) and `example.com` answers 200. That means the block
stands and the key's type changed nothing on the network. If either
RescueGroups host answers with any HTTP code, the handshake completed:
tell Logan. That is ADR-0033's revisit trigger, and nothing changes in this
entry; step 2 still runs through the bridge. Wait a minute after this
session closes before step 2 opens its own (ufw `LIMIT` on 22/tcp).

### 2. The poll, through the nightly key

    cd ~/monsterpaws && BRIDGE_SSH_HOST=monsterpaws-bridge scripts/poll-via-bridge.sh 2>&1 | tee var/poll-via-bridge-2026-10-30.log

Verify: the droplet half prints `polling on the droplet, RescueGroups
through home — worker image 40cb846`; the summary reports ~64k observed,
0 failures, no `lifecycleSkipped`; `heartbeat pinged`; the closing line
counts ~641 tunnels with 0 refused; `https://monsterpaws.org/api/health`
returns 200 with this run's `lastCompletePollAt` and `pollStale: false`.
Rollback: none needed. The data is append-only, and the failed run's 131
pages are correct as far as they got. Stop and tell Logan if:
- it fails again with `terminated` or any other fetch error: two in a row
  make the fix in doc/issues.md the next step, not a third run.
- the CLI exits 2 (`the run did not complete`). The nightly key's forced
  command ignores flags, so `--max-daily-disappearance` would be a root run
  through `pass` (oplog 0008's path), and only after Logan has checked the
  numbers (ADR-0014 as amended).
- the SSH connection drops mid-run. Wait at least five minutes (ufw
  `LIMIT` on 22/tcp), then use one session to check for and remove a
  leftover `monsterpaws-bridge-poll` container.

### 3. Both incidents resolved (reads only)

    U=$(pass show betterstack/uptime-token)
    curl -fsS -H "Authorization: Bearer $U" "https://uptime.betterstack.com/api/v3/incidents?from=2026-10-30&to=2026-10-30" \
      | jq -r '.data[] | [.id, .attributes.name, .attributes.status, (.attributes.resolved_at // "-")] | @tsv'
    curl -fsS -H "Authorization: Bearer $U" https://uptime.betterstack.com/api/v2/heartbeats/499765 | jq -r '.data.attributes.status'

Verify: heartbeat 499765 `up`; incidents 1042503943 and 1042623559
resolved (the monitor checks every 3 min). Filter every heartbeat read with
`jq`, because the API returns the ping URL in it.

## Run

## Follow-ups
