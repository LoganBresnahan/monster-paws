# ADR-0033: The poll bridge — the poll runs on the droplet, only RescueGroups' requests leave through home

Status: accepted (2026-10-28). Logan's call 2026-10-28, after oplog 0005.

## Context
RescueGroups refuses every connection from the droplet's address (oplog
0001, step 7): two DNS blocklists carry it — Spamhaus PBL and UCEPROTECT
Level 3, which lists all of DigitalOcean's AS14061 and is not removable per
address (roadmap, Launch). Until RescueGroups allowlists the droplet, the
daily poll (ADR-0009, ADR-0014 as amended) cannot run there, and
`/api/health` turns 503 27 h after the last complete poll.

The bridge since 2026-10-27 is `scripts/poll-via-home.sh`: the worker image
runs on Logan's machine and writes to Managed Postgres through an SSH tunnel
to the droplet. Every write crosses home → droplet → database, so the poll
is round-trip bound — ~335 listings a minute, 6 h 11 min for 63,435
(oplog 0001), where the same poll against a local database takes ~15 min.
On 2026-10-28 the database connection through that tunnel dropped 1 h 29
min in and the run died with it (oplog 0005; `doc/issues.md`, Ops). Six
hours is a long window for a home connection to stay up.

The poll's only outbound HTTP is `fetchPage` in
`src/core/ingest/rescuegroups.ts`; the database is raw TCP. The worker
image runs Node 24, whose `fetch` honours `HTTPS_PROXY` when
`NODE_USE_ENV_PROXY=1` — and, with the flag set and the proxy down, fails
rather than going direct (tested 2026-10-28 on `c45e085`).

## Decision
1. **The poll runs on the droplet; only RescueGroups' requests leave through
   home.** `scripts/poll-via-bridge.sh` starts `scripts/rg-proxy.ts`, an
   HTTPS CONNECT proxy on home's loopback, opens one SSH connection to the
   droplet carrying a reverse forward to it, and over that connection runs
   the droplet's own worker image (`IMAGE_TAG`), `.env` and CA with
   `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` at the forward. The database
   connection is droplet → Managed Postgres, as for the scheduled job.
2. **The proxy is never an open proxy.** It binds 127.0.0.1, allows CONNECT
   to exactly `api.rescuegroups.org:443`, and refuses every other host,
   port and plain-HTTP request. TLS runs end to end between the worker and
   RescueGroups; the proxy sees only the CONNECT line, so the API key never
   crosses it in the clear.
3. **No app code and no deploy.** The proxy is environment on a one-shot
   container; the scheduled worker is untouched and keeps failing at 07:00
   until the allowlist, as designed.
4. **`poll-via-home.sh` stays** as the fallback (standing tools stay): it
   needs no remote forwarding and no proxy, only the tunnel.
5. **One SSH connection per run** — the droplet's ufw `LIMIT` on 22/tcp
   refuses a source after 6 connections in 30 s.
6. **The first run is by hand**, by Logan in his own terminal under an
   oplog entry (ADR-0023): it proves the droplet's sshd forwarding and the
   real `.env` before anything runs unattended.
7. **Then nightly, unattended — the next step, built after the first run.**
   - *Home starts it*, because the house opens no port: a Windows Task
     Scheduler task at 07:00 UTC running `wsl.exe -d monsterpaws-dev` with
     the bridge, rather than a systemd timer inside the distro, which fires
     only while the distro happens to be running. Either way it fires only
     while Windows and WSL are up; Logan's machine is on around the clock
     (2026-10-28), and the heartbeat says when it is not.
   - *Unattended credentials*: the droplet's address from an ssh config
     host, not `pass` and `doctl`; a dedicated key whose `authorized_keys`
     line is `restrict,command="<the droplet half of the bridge>",
     permitlisten="127.0.0.1:18443"`. A key taken from the home box can
     start a poll and open that one listener, never a shell. The droplet
     half moves from the script's heredoc into a checked-in script on the
     droplet, so the forced command is a path. The heartbeat ping stays on
     the droplet, from its `.env`, so home holds no secret but that key.
   - *Where it runs*: ADR-0004 as amended 2026-10-05 puts home production
     under the dedicated account in `monsterpaws-prod`, not built yet. Until
     it is, the task runs in `monsterpaws-dev` — acceptable because the key
     can do nothing but this — and moves when that distro exists.
   - *The droplet's own 07:00 schedule is switched off* once the task takes
     over: until the allowlist it only fails, and it is noise in the error
     log.
   - *Monitoring*: the poll heartbeat (499765) and the `/api/health` keyword
     monitor (4995794) are unpaused after the first unattended night
     completes, under their own oplog entry. The 27 h stale window in
     `src/core/health.ts` holds a nightly run with 3 h of slack.

## Consequences
- A dropped home connection now costs a page fetch, not a write: `fetchPage`
  has no retry, so the run ends before stage 5 and nothing is marked gone
  (ADR-0014); the data is append-only, and the run is repeated.
- The run should take close to the dev poll's ~15 min plus page latency
  through home, so it fits a sitting rather than a night.
- Only the DO token comes out of `pass` at home; every other secret stays in
  the droplet's `.env` and is handed to the container by `--env-file`.
- The droplet's sshd must allow remote forwarding; `ExitOnForwardFailure`
  makes a refusal fail the run at the first connection, before anything runs.
- Anything else on the droplet's loopback can reach RescueGroups through the
  forward while a run is open — and nothing else.
- The worker's missing `Pool` error handler (`doc/issues.md`, Ops) still
  matters on the droplet, at the droplet's lower odds of a dropped connection.

## Alternatives
- **Keep the tunnel poll.** Rejected: 6 h round-trip bound, and 2026-10-28
  showed one dropped connection ends it.
- **A proxy library or dependency (e.g. `proxy-chain`, squid in a
  container).** Rejected: a CONNECT allowlist is a few dozen lines of `node:http`
  and `node:net`, and a general proxy's configuration is where an open relay
  comes from.
- **A SOCKS proxy via `ssh -R` dynamic forwarding.** Rejected: Node's
  `fetch` takes an HTTP proxy, not SOCKS, without a dependency; and a
  dynamic forward allows any destination.
- **A VPN or residential egress for the droplet.** Rejected: a standing
  service and its cost for a gap that ends with one allowlist.
- **A retry in `fetchPage`.** Not instead — it needs a deploy, and a retry
  does not shorten the run. A later change, not this decision.

## Revisit triggers
- RescueGroups allowlists the droplet: retire both bridges to standing
  tools, turn the droplet's own schedule back on and the home task off.
- `monsterpaws-prod` is built (ADR-0004 as amended): move the nightly task
  and its key there.
- Home down on a night costs a stale health check and a heartbeat alert:
  if that happens more than rarely, the bridge needs a home that stays up.
- A second source the droplet cannot reach: widen the allowlist by exact
  host:port in `rg-proxy.ts`, never by pattern.
- Node changes `NODE_USE_ENV_PROXY` semantics: re-prove that a dead proxy
  fails the run rather than going direct.
