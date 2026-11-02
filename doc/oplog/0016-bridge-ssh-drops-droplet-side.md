# 0016: Why the bridge's SSH connection drops — the droplet's side, reads only

Status: planned
Planned: 2026-11-02
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

## Follow-ups
