# 0012: Rerun the failed nightly poll of 2026-10-30

Status: run
Planned: 2026-10-30 · Run: 2026-10-30 14:15 – 14:27 UTC (step 1; step 2 failed; step 3 not run)
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

Run by Claude on Logan's word ("commit" and "go"), from `~/monsterpaws` at
`233c62d`. Logan, on the key: "it doesn't change anything. its just a
setting", so the value in the droplet's `.env` is unchanged.

**1** 14:15:14–14:15:18 UTC, one root session, no guard batch running:

    api.rescuegroups.org curl: (56) OpenSSL SSL_read: Connection reset by peer, errno 104 000
    rescuegroups.org curl: (56) OpenSSL SSL_read: Connection reset by peer, errno 104 000
    example.com 200

The block stands: no HTTP answer from either RescueGroups host, and
`example.com` 200. This was curl `(56)`, a reset while reading, where the
plan expected launch's `(35)`, a reset mid-handshake. Under TLS 1.3 the
client counts the handshake done once it has sent its Finished, so the
reset may now land a step later than at launch. It is still a reset with no
response, and a keyless one, so the key's setting is not what decides it.

**2** started 14:16:29 UTC (proxy up, `var/rg-proxy-20261030T141629Z.log`).
The droplet half printed `polling on the droplet, RescueGroups through home
— worker image 40cb846, 2026-10-30T14:16:31Z`. At 14:21:15, after 104 pages,
`poll-via-bridge.sh` exited **255**, ssh's own code for a lost connection,
and printed nothing else: no summary, no heartbeat line. The last tunnel had
closed cleanly at 14:21:13.679 (859,309 B), so no page was in flight; the
droplet was storing page 104 when the connection went. The proxy logged no
errors, and nothing was left on this machine or port 18443. This is not the
night's failure. That one was a cut page with the SSH connection standing,
which reported `/fail` itself; this time the whole connection dropped.

Step 3 was not run: both incidents are still open, and health still reads
`pollStale: true`. The plan's response to a dropped connection, after the
five-minute wait: one root session at 14:26:29–14:26:32 UTC, which also read
the droplet's logs. **No leftover** `monsterpaws-bridge-poll` container.
Memory 415 MB available, 216 MB of swap in use, up 91 days. Read-only:
- The droplet did not end it. No OOM or kill in the kernel log since 06:00,
  and no ufw blocks 14:15–14:30. Docker logged the poll container's end at
  14:21:16.098, a second **after** home's ssh exited, so the connection went
  first and the poll followed when its session closed. That fits a drop on
  the network path between here and the droplet, which nothing on either
  end logged.
- The night's cut page fits the proxy race in doc/issues.md. The proxy
  logged RescueGroups' close of the last tunnel at 07:06:26.337, and docker
  logged the container's end at 07:06:26.544, 0.2 s later.
- apt ran 06:29–06:32 UTC, before the nightly: unattended-upgrades installed
  a new kernel, so a reboot is pending. Nothing touched docker or ssh.
- `journalctl -u ssh` holds only the accept lines; a session's close is
  logged under its own scope, so the drop's own line was not read.

Two failures in a row, two different ways, so per the plan this entry stops
here. Logan's call ("ok i agree"): fix it now. The whole run is retried at home,
because nothing inside the run survives a dropped connection, and the
proxy's close is fixed. Then rerun under a new entry.

## Follow-ups
- The fix: ADR-0033 as amended 2026-10-30 (`scripts/poll-nightly.sh`
  retries the whole run; `scripts/rg-proxy.ts` ends the client instead of
  destroying it), then its own entry to rerun with it.
- With the next deploy: `fetchPage` retries a page, and the CLI prints
  `err.cause` (doc/issues.md).
- The droplet's pending kernel reboot, its own entry.
