# 0009: The nightly bridge poll — the restricted key, the droplet half, the Windows task

Status: planned
Planned: 2026-10-28 · Run: —
Why: ADR-0033 decision 7 and its amendment "as built" (2026-10-28, night);
roadmap: Launch (3b). Health is green to 2026-10-30 00:45 UTC (oplog 0008);
the first nightly at 2026-10-29 07:00 UTC keeps it green from then on.
Commit deployed: n/a — no image changes; the droplet's checkout moves to
topdog's head for `scripts/bridge-poll-droplet.sh`, and the task runs
`~/monsterpaws` at topdog

What changes: a new key at home (`~/.ssh/monsterpaws-bridge`, its master copy
in `pass`), an ssh config host `monsterpaws-bridge`, one line in the
droplet's `/root/.ssh/authorized_keys`, the droplet's checkout pulled (no
restart — no service reads the new script), and a Windows scheduled task
for Logan's account. The heartbeat (499765) and the health monitor
(4995794) stay paused; unpausing them is the next entry, after the first
unattended night completes.

Proved before this entry, never against production: the key line on a
throwaway OpenSSH 9.6p1 (Ubuntu 24.04) running the real droplet script with
`docker` and `curl` stubbed — a shell command, flags and a PTY all end in
the poll or the preflight; `-R` on another port or a public address, `-L`
and `-D` refused; `permitopen="none"` disables the whole line ("invalid
permission port"), so the line names a closed port. The droplet script's
`check`, root and `--from-key` modes against a fake droplet with the real
`40cb846` worker image and the dev database.

## Prerequisites
- [ ] topdog in `~/monsterpaws` at the nightly-bridge commit and this entry,
      pushed (the droplet pulls it), with `node_modules`.
- [ ] `pass` unlocked (the DO token, the key's master copy).
- [ ] No other SSH session to the droplet open; steps ~30 s apart (ufw
      `LIMIT` on 22/tcp: 6 connections in 30 s).
- [ ] No bridge poll running; not within an hour of 07:00 or 08:30 UTC.

## Steps

### 1. Record — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && git log --oneline -1 && wc -l < ~/.ssh/authorized_keys &&
      grep -c monsterpaws-bridge ~/.ssh/authorized_keys; ls scripts/bridge-poll-droplet.sh 2>&1'
Verify: checkout `650caa3`; the line count; 0 `monsterpaws-bridge` lines;
no `bridge-poll-droplet.sh` yet.
Rollback: n/a — this is the record.

### 2. The key and the host, at home
    ssh-keygen -q -t ed25519 -N '' -C monsterpaws-bridge -f ~/.ssh/monsterpaws-bridge
    pass insert -m digitalocean/droplet-bridge-key < ~/.ssh/monsterpaws-bridge
    printf '\nHost monsterpaws-bridge\n  HostName %s\n  User root\n  IdentityFile ~/.ssh/monsterpaws-bridge\n  IdentitiesOnly yes\n' "$IP" >> ~/.ssh/config
Verify: the key is mode 600; `pass show digitalocean/droplet-bridge-key |
head -1` is the OpenSSH private-key header (never printed further);
`ssh -G monsterpaws-bridge` names user root and the key (the address not
printed). The droplet's host key is already in `known_hosts` under its
address.
Rollback: remove the `Host monsterpaws-bridge` block, the key pair, and the
`pass` entry.

### 3. The droplet: pull, and add the key's line, one SSH session
    LINE="restrict,port-forwarding,permitlisten=\"127.0.0.1:18443\",permitopen=\"127.0.0.1:9\",command=\"/root/monsterpaws/scripts/bridge-poll-droplet.sh --from-key\" $(cat ~/.ssh/monsterpaws-bridge.pub)"
    printf '%s\n' "$LINE" | ssh root@$IP 'cd monsterpaws && git pull --ff-only && test -x scripts/bridge-poll-droplet.sh &&
      cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.before-0009 && cat >> ~/.ssh/authorized_keys &&
      grep -c monsterpaws-bridge ~/.ssh/authorized_keys && git log --oneline -1'
Verify: the checkout at topdog's head; the script executable; exactly 1
`monsterpaws-bridge` line; a copy of the old file beside it. Nothing
restarted.
Rollback: `cp ~/.ssh/authorized_keys.before-0009 ~/.ssh/authorized_keys`
(Logan's own key line is untouched either way); `git checkout 650caa3`.

### 4. Prove the key's path — the preflight, no poll
    BRIDGE_SSH_HOST=monsterpaws-bridge scripts/poll-via-bridge.sh --check
Verify: `bridge preflight ok on the droplet — worker image 40cb846, .env and
CA present` — the key authenticated, the reverse forward was accepted, and
the forced command ran (the preflight, because the verb was `check`).
Rollback: step 3's.

### 5. Prove the key refuses what it must, one connection
    ssh -o ExitOnForwardFailure=yes -N -R 127.0.0.1:18444:127.0.0.1:1 monsterpaws-bridge
Verify: `Error: remote port forwarding failed for listen port 18444`.
Rollback: step 3's.

### 6. The Windows task
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w scripts/windows/register-nightly-poll.ps1)"
Verify: `Monster Paws nightly poll: Ready, next run 2026-10-29 07:00:00Z`.
Rollback: `powershell.exe -NoProfile -Command "Unregister-ScheduledTask
-TaskName 'Monster Paws nightly poll' -Confirm:\$false"`.

### 7. The first unattended night (read the next morning)
`var/nightly/2026-10-29.log` ends `== exit 0`, with a summary of ~60–85k
observed, 0 failures, no `lifecycleSkipped`, `heartbeat pinged`; health 200
with `lastCompletePollAt` near 07:00 UTC. Then the next entry unpauses
heartbeat 499765 and monitor 4995794. If it failed: health is still green
to 2026-10-30 00:45 UTC — a bridge poll by hand under a new entry, and the
log says why.

## Run

## Follow-ups
