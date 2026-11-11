# 0036: The art worker and its tunnel back up, after a WSL update shut the box's VM down

Status: run
Planned: 2026-11-11 · Run: 2026-11-11 16:21–16:25 UTC
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
- **Step 1** (16:22): `npm run db:up`; `monsterpaws-db-1` and `monsterpaws-mailpit-1` up.
- **Step 2** (16:22): `lines: 0`, so no `keepsake.sweep` report since 2026-11-10 06:00 UTC and no painting waiting. Two deviations:
  - The entry's `doctl` line ran with `DIGITALOCEAN_ACCESS_TOKEN="$(pass show digitalocean/api-token | head -n1)"`, which the entry left out.
  - A second SSH session confirmed that `grep` hadn't hidden an error about the container's name. `monsterpaws-worker-1` had been up 2 days, and its last two sweep lines were `"written":1,"sent":1,"stalled":0`, from Logan's two donations of 2026-11-09 (oplog 0035). `.env` had `ART_SWEEP=on` (1).
- **Step 3** (16:22): nothing was already running, and both greps printed 1. The export printed was `/home/oof/monsterpaws-art-a933820`, and no new export was made.
- **Step 4** (16:22:51): the tunnel was started, and the check printed `home_worker`.
- **Step 5** (16:23:00): this start's log shows `art store bound to database defaultdb` and `art.generate registered (WORKER_MODE=art)`.
  - `var/art-worker.sid` is 7486, and its session lists `npm run worker`, `sh -c tsx …`, tsx's node, the worker's node and esbuild.
  - `var/art-worker-export` already named `/home/oof/monsterpaws-art-a933820`.
  - Step 2 counted no paintings waiting, so there is no `art.generate` line to wait for.

## Follow-ups
- A WSL update from Windows Update shuts the VM down without warning, and the worker with it. The only thing that would have said so is the 30-minute alert, and that fires only once a paid painting is waiting. Logan picks between a line in infra.md's restart list, an alert for the worker itself, or both; nothing is changed until then.
- `doc/issues.md`'s freeze entry: its closing condition, a clean week, has held for 16 days since the 2026-10-26 boot, by `/gpu-health` at 16:16 UTC. The box never slept in that time. Deleting the entry is Logan's call.
