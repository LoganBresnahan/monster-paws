# 0037: The art worker's heartbeat armed, and the worker moved onto the code that pings it

Status: run
Planned: 2026-11-11 · Run: 2026-11-11 17:01–17:11 UTC
Why: ADR-0010 as amended 2026-11-11. A WSL update stopped the art worker for 34 hours and nothing said so (oplog 0036). Logan: "both", meaning the line in infra.md's restart list and an alert for the worker itself
Commit deployed: `dabbae7` (the heartbeat) to the art worker only, as a new export of topdog's tip; the droplet is untouched

## Prerequisites
- [x] CI green on `dabbae7`: run 43059921794, on its rerun (see Run)
- [x] `pass` unlocked (Logan, 16:21 UTC; it relocks after an hour idle)
- [x] Outside the nightly window and the 08:30 UTC backup: 17:01 UTC
- [x] The worker is between jobs: its session's `ps` lists no `guard.sh batch` (infra.md, the stop)

## Steps

### 1. The heartbeat, created paused, and its URL into `pass`
Its URL is the secret, so it goes straight from the response into `pass` and is never printed (infra.md, Better Stack):

    U=$(pass show betterstack/uptime-token)
    R=$(curl -s -X POST https://uptime.betterstack.com/api/v2/heartbeats -H "Authorization: Bearer $U" -H "Content-Type: application/json" \
      -d '{"name":"art worker — home box, a beat every 5 min","period":300,"grace":600,"email":true,"paused":true}')
    echo "$R" | jq -r '.data.attributes.url' | pass insert -m betterstack/heartbeat-art-worker > /dev/null
    echo "$R" | jq -c '.data | {id, name: .attributes.name, period: .attributes.period, grace: .attributes.grace, paused: .attributes.paused}'; unset R U
    pass show betterstack/heartbeat-art-worker | head -n1 | grep -c '^https://'

Verify: an id with period 300, grace 600 and paused true, and the last line prints 1.
Rollback: `curl -s -X DELETE` on `https://uptime.betterstack.com/api/v2/heartbeats/<id>`, and `pass rm betterstack/heartbeat-art-worker`.

### 2. A new export of topdog's tip
These are infra.md's step 3 export lines without the `if` that skips them when `SHELTERS` is unchanged, since this move is for the heartbeat. Use a long timeout for `npm ci`:

    cd ~/monsterpaws || exit 1
    S=$(git rev-parse --short=7 topdog); E=~/monsterpaws-art-$S; P="$E.partial"; rm -rf "$P"
    if [ ! -d "$E" ]; then mkdir "$P" && git archive topdog | tar -x -C "$P" && echo "$S" > "$P/EXPORTED_FROM" && touch "$P/comfyui/gpu.env" && ln -s ~/monsterpaws/var "$P/var" && (cd "$P" && npm ci) && mv "$P" "$E"; fi; echo "$E"
    grep -c ART_HEARTBEAT_MS "$E/src/worker/heartbeat.ts"; git diff --quiet a933820 topdog -- src/core/shelters.ts && echo "SHELTERS unchanged"

Verify: the export's path prints, the grep is at least 1, and `SHELTERS unchanged` prints.
Rollback: none needed; an unused export changes nothing.

### 3. Stop the worker
Use infra.md's "Stop it by its session, never by a search", with session 7486 from oplog 0036.
Verify: the first line lists `npm run worker`, `sh -c tsx …` and the worker's node processes and nothing else, and the last prints `stopped`.
Rollback: step 5 of infra.md's restart list from `~/monsterpaws-art-a933820`, as oplog 0036 ran it.

### 4. Start it from the new export, with the heartbeat
Run infra.md's restart list, step 5, from step 2's export, with one more line among its variables:

    HEARTBEAT_ART_WORKER_URL="$(pass show betterstack/heartbeat-art-worker | head -n1)" \

Verify: after 2 minutes, this start's part of the log has step 5's two lines and `[worker] art heartbeat every 5 minutes; first beat sent`. The session's `ps` runs from the new export. Then `echo <export> > ~/monsterpaws/var/art-worker-export`.
Rollback: the stop again, then step 5 from `~/monsterpaws-art-a933820` without the heartbeat line, and pause the heartbeat (step 5's call with `true`).
The tunnel stays as it is: it runs from `~/monsterpaws-art-a933820`'s script, so that export stays while it does.

### 5. Unpause the heartbeat, and read it up after the next beat

    U=$(pass show betterstack/uptime-token)
    curl -s -X PATCH -H "Authorization: Bearer $U" -H "Content-Type: application/json" -d '{"paused":false}' \
      https://uptime.betterstack.com/api/v2/heartbeats/<id> | jq -c '.data | {id, paused: .attributes.paused, status: .attributes.status}'

Then, once 6 minutes have passed, the same id read with GET, through the same `jq` filter.
Verify: `paused` false, then `status` `up`.
Rollback: the same PATCH with `true`.

## Run
- **CI** (before step 1): the first run on `dabbae7` failed in GitHub's runner. `npx playwright install --with-deps` couldn't resolve Ubuntu's package mirrors, after typecheck and both `npm test` runs had passed; `985df65` failed the same way. A rerun of the failed job was green on every job, with e2e 60 passed (20.7 s).
- **Step 1** (17:02): heartbeat `530311`, period 300, grace 600, paused true; the `pass` line printed 1. Nothing was printed with the URL.
- **Step 2** (17:02): the export is `/home/oof/monsterpaws-art-e05447a`. That was topdog's tip by then: `dabbae7`'s code plus this entry's planned commit, which is documentation only. Grep 1, `SHELTERS unchanged`.
- **Step 3** (17:02:56): session 7486 listed exactly the worker's five processes, and the stop printed `stopped`.
- **Step 4** (17:03:03): this start's log has `art store bound to database defaultdb`, `art.generate registered (WORKER_MODE=art)` and `[worker] art heartbeat every 5 minutes; first beat sent`.
  - `var/art-worker.sid` is 19302, and its session runs from `~/monsterpaws-art-e05447a`.
  - `var/art-worker-export` now names that export.
  - The tunnel was left running from oplog 0036.
- **Step 5** (17:05:20): the PATCH returned `paused` false and `status` `up` at once, so the first beat, sent while paused, counted.
  - The GET at 17:11:21 read `up`, with period 300 and grace 600.
  - This start's log had no `held`, `fatal` or `pg-boss` line.
  - The API shows no time for each ping. With a 15-minute window, that read proves the heartbeat is armed and not overdue, not that the 17:08 beat landed by itself.
- The docs follow in this entry's run commit:
  - infra.md's `pass` table has the new entry.
  - Step 5 of the restart list has the heartbeat's line and its verify line.
  - The stop says to pause the heartbeat for a planned stop.
  - Step 3's export lines are described for worker code other than `SHELTERS`.
  - The restart list ran end to end in oplog 0036, and the hosts line held across that start.
  - flows.md drops the planned marker.
  - The issues entry says the box still has to be restarted by a person, and no longer says that nothing alerts.

## Follow-ups
- `~/monsterpaws-art-a933820` stays while the tunnel runs from its script. It can go, with `~/monsterpaws-art-d15dd23` (oplog 0035), once the tunnel next starts from a newer export.
- Silence turning into an email hasn't been watched. It would take a stop of more than 15 minutes, which is Logan's call.
