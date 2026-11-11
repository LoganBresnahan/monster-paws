# 0036: The art worker and its tunnel back up, after a WSL update shut the box's VM down

Status: planned
Planned: 2026-11-11 · Run: —
Why: production's donations are painted only by the art worker on this box (ADR-0004 as amended 2026-10-05). Windows Update installed WSL 3.0.5.0 (kernel 6.18.58.1) at 2026-11-10 06:09 UTC and shut the VM down to do it, and the tunnel and the worker don't come back by themselves (`doc/infra.md`, After a restart of this box)
Commit deployed: n/a — the worker restarts from the export it last ran, `~/monsterpaws-art-a933820` (oplog 0035), whose `SHELTERS` equals topdog's

## Prerequisites
- [x] Logan's word: "pass is unlocked lets get the worker back up now" (2026-11-11)
- [x] `pass` unlocked: `pass show digitalocean/api-token | wc -c` printed 72
- [x] `/gpu-health` at 16:16 UTC (the list's step 2): fit, smoke green twice at ~78 TFLOPS warm, 0 leaked; no 6008/41/WHEA since the 10-26 boot; the restart was the WSL update, not a crash
- [x] Outside the nightly window and the 08:30 UTC backup: 11-11's log says `== exit 0` at 07:38 UTC

## Steps
Every step is `doc/infra.md`, After a restart of this box, run as it stands there; nothing here copies it.

### 1. The list's step 1: the local database and Mailpit
Verify: `docker ps` shows `monsterpaws-db-1` and `monsterpaws-mailpit-1` up.
Rollback: none needed — local only; production never reads them.

### 2. Before anything starts: how many paintings production's sweep says are waiting
One SSH session, read only:

    IP=$(doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'docker logs monsterpaws-worker-1 --since 2026-11-10T06:00:00Z 2>&1 | grep "\"keepsake.sweep\"" | tail -n 3 | cut -c1-200'

Verify: the last line's `stalled` is the count waiting (the sweep logs only when it has something to say, so no line means none was).
Rollback: none — a read.

### 3. The list's step 3: nothing already running, the hosts line, the export
Verify: no `ALREADY RUNNING`, both greps print 1, and the export printed is `~/monsterpaws-art-a933820` (no new export is made).
Rollback: none — reads.

### 4. The list's step 4: the tunnel, from that export
Verify: the list's check prints `home_worker`.
Rollback: signal the tunnel's process by its exact PID from `ps`; never `pgrep -f`.

### 5. The list's step 5: the art worker, from that export, one worker
Verify: the list's two lines in this start's part of the log, and `var/art-worker.sid` names a session whose `ps` lists `npm run worker`, `sh -c tsx …` and the worker's node processes. If step 2 counted paintings waiting, an `art.generate` line `"status":"painted"` for each, within the hour (the sweep sends a waiting job again within the hour).
Rollback: the list's stop by session.

## Run

## Follow-ups
