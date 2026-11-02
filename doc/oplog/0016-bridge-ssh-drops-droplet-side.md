# 0016: Why the bridge's SSH connection drops — the droplet's side, reads only

Status: run
Planned: 2026-11-02 · Run: 2026-11-02 15:45 – 15:46 UTC
Why: ADR-0033 as amended 2026-10-30; roadmap: Launch (3b); doc/issues.md,
Ops. The nightly of 2026-11-02 completed on its second attempt. Attempt 1's
`ssh` exited 255 at 07:09:39 UTC after 204 pages
(`var/nightly/2026-11-02.log`). That is the second such drop in four days,
after oplog 0012's rerun (2026-10-30 14:21:15 UTC, page 104). Each time the
proxy was healthy to the end. On 11-02 the droplet's CONNECTs reached home
until 07:09:36, so the link was alive three seconds before it went, and the
keepalive (45 s to give up) did not end it. Nothing at home logged a thing:
Windows' System, NetworkProfile, WLAN and DHCP logs and WSL's journal are
empty of network events between 07:05 and 07:16 UTC. Better Stack opened an
incident for heartbeat 499765 that morning.
Commit deployed: n/a — reads only; nothing on the droplet, the database or
the buckets changes

0012 read `journalctl -u ssh`, which holds only the accept lines. Once a
session opens, its sshd process logs under the session's scope, so the line
that says how a connection ended was never read. This entry reads sshd by
its syslog identifier, which follows the process wherever it lives, for
both drops, beside docker's and the kernel's lines for the same minutes.
The nightly key logs in as root (oplog 0009). Then it reads Better Stack's
account of the 11-02 incident. The droplet half pings `/fail` after its
container ends, with nobody left to print the result, so the incident's
start time is the only witness that attempt 1's ping arrived.

What each answer would mean:
- `Connection reset by <ip>` or `Read error … Connection reset by peer`:
  the droplet received a reset, from home or the path between.
- `Timeout, client not responding`: the droplet's own keepalive ended it.
- `Broken pipe` or `packet_write_wait`: the droplet could not write.
- `Received disconnect` or `Disconnected from user root`: home's ssh closed
  it, so the cause is on this side after all.
- A kernel line in the minute (a virtio or NIC reset, `nf_conntrack: table
  full`, OOM): the droplet's side.
- Nothing: still unknown, and the retry stays the answer.

## Prerequisites
- [ ] `pass` unlocked (the DO token for the address; Better Stack's uptime
      token).
- [ ] No other SSH session to the droplet open from here.
- [ ] Outside the quiet window: not from 06:45 UTC until the night's log
      shows `== exit`.

## Steps
### 1. The droplet's logs for both drops (one root session, reads only)

    export DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1)
    IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | awk '$1 == "monsterpaws" {print $2}')
    ssh -o ConnectTimeout=10 root@$IP 'bash -s' <<'EOF' | sed -E 's/([0-9]{1,3}\.){3}[0-9]{1,3}/<ip>/g; s/([0-9a-f]{1,4}(:[0-9a-f]{1,4})*)?::[0-9a-f:]*/<ip6>/g;
      s/([0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}/<ip6>/g'
    for w in "2026-10-30 14:15:00|2026-10-30 14:25:00" "2026-11-02 07:05:00|2026-11-02 07:20:00"; do
      s=${w%|*}; u=${w#*|}; echo "== $s – $u UTC"
      j() { journalctl -q -o short-iso-precise --utc --since="$s UTC" --until="$u UTC" "$@"; }
      j -t sshd -t sshd-session | grep -vE '\[preauth\]|[Ii]nvalid user|authenticating user|kex_exchange_identification|banner exchange|Unable to negotiate|maximum authentication'
      j -u docker -u containerd
      j -k | grep -v '\[UFW BLOCK\]'
    done
    echo "== now"; uptime; free -m | sed -n 2,3p; ls /var/run/reboot-required 2>/dev/null
    docker ps -a --filter name=monsterpaws-bridge-poll --format '{{.Names}} {{.Status}}'
    ip -s link show eth0 | sed -n '3,6p'
    EOF

Scanners' failed logins and ufw's ordinary blocks are filtered out. ufw's
`LIMIT BLOCK` lines for 22/tcp stay in. Every address is redacted before it
reaches the terminal.
Verify: the session that ended at 14:21:15 and the one that ended at
07:09:39 each have a closing line, read against the list above. Docker's
lines put each container's end against home's ssh exit (0012 found 14:21:16,
one second after). No leftover `monsterpaws-bridge-poll` container (attempt
2 ran under that name, so none is expected). eth0's error and drop counters
are recorded as they stand.
Rollback: none needed — reads only.
Stop and tell Logan if: a leftover container is listed, or a kernel line
shows the droplet in trouble (OOM, a NIC reset, a full conntrack table).
That is a change to make under its own entry, not this one.

### 2. Better Stack's account of the 11-02 incident (reads only)

    U=$(pass show betterstack/uptime-token)
    curl -fsS -H "Authorization: Bearer $U" "https://uptime.betterstack.com/api/v3/incidents?from=2026-11-02&to=2026-11-02" \
      | jq -r '.data[] | [.id, .attributes.name, .attributes.cause, .attributes.started_at, (.attributes.resolved_at // "-")] | @tsv'
    curl -fsS -H "Authorization: Bearer $U" https://uptime.betterstack.com/api/v2/heartbeats/499765 | jq -r '.data.attributes.status'

Every heartbeat read is filtered with `jq`, because the API returns the ping
URL in it.
Verify: one incident for heartbeat 499765, started within a minute or so of
07:09:39 (attempt 1's `/fail` reached it) and resolved at about 07:40:44 by
attempt 2's ping; no incident for monitor 4995794 (health never went
stale); the heartbeat `up`. Anything else is recorded as it stands.
Rollback: none needed — reads only.

## Run

Run by Claude on Logan's word ("pass is unlocked lets see what happened",
after "commit"), from `~/monsterpaws` at `109df8e`: `pass` unlocked, no
other session to the droplet, outside the quiet window (the night's
`== exit 0` at 07:40:44).

**1** 15:45:44–15:45:49 UTC, one root session, every address redacted. Both
drops end on the same line, logged by the session's own sshd:

    2026-10-30T14:21:15.821123+0000 sshd[922794]: ssh_dispatch_run_fatal: Connection from user root <ip> port 18272: message authentication code incorrect
    2026-11-02T07:09:39.245531+0000 sshd[941047]: ssh_dispatch_run_fatal: Connection from user root <ip> port 20274: message authentication code incorrect

Neither answer on the plan's list. The droplet's sshd received a packet from
home whose MAC, SSH's integrity check on every packet, did not verify, and
it ends the connection on that by design. Bytes changed somewhere between
home's ssh and the droplet's sshd, in a way TCP's 16-bit checksum let
through. So the drop is corruption on the home → droplet direction, which
carries nearly all the traffic (every page, about 0.5 GB a night), not a
reset or a timeout. As a rough rate, that is two corrupted packets in about
3 GB sent since the first full poll on 2026-10-28.
- Docker logged the poll container's end 0.28 s after the first
  (14:21:16.098) and 0.32 s after the second (07:09:39.561): the session
  closed, and the poll went with it. Attempt 2's session was accepted at
  07:14:39.863. The 10-30 session (sshd[922794]) was 0012's rerun, accepted
  at 14:16:30.
- No kernel line in either window: no OOM, NIC reset, conntrack or ufw
  `LIMIT` block. eth0 since boot (94 days): 0 errors and 0 dropped on RX
  (21.7M packets) and TX (19.4M).
- No leftover `monsterpaws-bridge-poll` container.
- Everything else in the windows is scanners on 22/tcp ("Connection reset
  by", "Connection closed by" from other addresses), and 0012's own keyless
  session at 14:15, which closed cleanly.
- Now: up 94 days, load 0.32, 467 MB available, 232 MB of swap in use;
  `/var/run/reboot-required` is still present (0012's follow-up).

**2** 15:46:16–15:46:17 UTC:

    1044965319  ingest.poll — RescueGroups daily 07:00 UTC  Reported failure  2026-11-02T07:09:39.951Z  2026-11-02T07:40:44.535Z
    up

Attempt 1's `/fail` arrived 0.7 s after the MAC error, and attempt 2's ping
resolved the incident at 07:40:44. No incident for monitor 4995794.

Read at home afterwards (not production, read-only, kept here because it
bears on the answer): Windows' WHEA-Logger has one event since 10-26, the
fatal machine check of the crash at 10-26 01:50 UTC (Kernel-Power 41), and
none at either drop. Hyper-V VmSwitch's errors (id 15) are port-restore
failures at each boot (10-20, 10-21, 10-26), none at either drop. Memory
without ECC logs nothing on a flipped bit, so silence here clears nothing.

What it means: the kind of fault is known, and the place is not. Candidates
on the home → droplet path: the home box's memory, the WSL2 virtual network
between the distro and Windows, the router, the ISP. The droplet's receive
path is the least likely, with zero NIC errors in 94 days. The retry absorbs
a drop; three in one night would fail it.

Logan's call: "sounds like its doing its job then. i'm okay with some
failures because we recover". The retry is the answer, and the place is not
hunted.

## Follow-ups
- Only if a night fails on three drops: find the place by sending a few GB
  of random bytes to the droplet through ssh, once from WSL and once from
  Windows' own `ssh.exe`, which skips WSL's virtual network. That gets its
  own entry. A memory test on the home box is in the same case.
- The droplet's pending kernel reboot (0012's follow-up), still open.
