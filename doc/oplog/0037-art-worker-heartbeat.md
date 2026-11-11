# 0037: The art worker's heartbeat armed, and the worker moved onto the code that pings it

Status: planned
Planned: 2026-11-11 · Run: —
Why: ADR-0010 as amended 2026-11-11. A WSL update stopped the art worker for 34 hours and nothing said so (oplog 0036). Logan: "both", meaning the line in infra.md's restart list and an alert for the worker itself
Commit deployed: `dabbae7` (the heartbeat) to the art worker only, as a new export of topdog's tip; the droplet is untouched

## Prerequisites
- [ ] CI green on `dabbae7`
- [ ] `pass` unlocked (Logan, 16:21 UTC; it relocks after an hour idle)
- [ ] Outside the nightly window and the 08:30 UTC backup
- [ ] The worker is between jobs: its session's `ps` lists no `guard.sh batch` (infra.md, the stop)

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

## Follow-ups
