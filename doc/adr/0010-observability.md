# ADR-0010: Observability — structured logs, Postgres as metrics, boring alerts

## Context
Solo-operated production system on a 1GB droplet (~$7/mo budget). The
soon-to-exist worker (ADR-0009) can fail *silently* — a poller that stops
polling breaks nothing visible. Need: enough signal to notice and diagnose,
zero new infrastructure to babysit, free tiers only.

## Decision

**Logs: structured JSON to stdout; the platform collects.**
- **pino** in app and worker (dependency arrives with first real worker
  code). Every line JSON: `level`, `msg`, `component`, correlation id
  (request id / job id via AsyncLocalStorage), durations as fields.
- Docker captures stdout; compose sets json-file rotation (10MB × 3 files
  per container) so the 25GB disk never fills with logs.
- Reading logs = `ssh + docker logs` (runbook). **No log-shipping agent**
  on a 1GB box in v1.

**What gets logged (the contract, grown with each feature):**
- Request logs: method, path, status, duration, request id (app).
- Job logs: job name, id, attempt, outcome, duration (worker/pg-boss).
- **Poller run summaries**: source, items seen/changed/deduped, health-gate
  verdicts, duration — logged AND persisted as rows (see metrics).
- External API calls: service, endpoint, status, latency, cost-relevant
  units (Replicate seconds, LLM tokens).
- Errors: stack + correlation id, never swallowed.
- Domain history is NOT logs: it lives in event_log (ADR-0009) — logs are
  disposable operations data, the event log is sacred product data.

**Dev/prod parity — logs are the agentic-development feedback loop.**
- One schema, two sinks: pino emits JSON in every environment; pretty
  output is a pipe (`| pino-pretty`), never a format switch. Dev tees to
  `.logs/dev.log` (gitignored) — the agent reads/greps/jqs that file with
  the same queries that work on `docker logs` in prod.
- Machine-keyed events over prose: `event: "ingest.run.completed"` with
  typed fields; `msg` is for humans, structure carries the facts.
- The strongest parity is Postgres: ingest_runs / job tables / event_log
  answer identical SQL in dev and prod — verification queries written
  during development ARE the production diagnostics.

**Log hygiene — redaction over encryption.**
- At-rest log encryption is the wrong lever (a compromised box reads
  encrypted logs; the platform layer covers stolen-disk). The right lever:
  secrets and PII never enter logs. pino `redact` kills authorization/
  key/token-shaped fields at the serializer; convention: **log
  identifiers, never identities** (donorId, never email/name). Clean logs
  stay shareable — with the agent, contributors, bug reports.

**Retention rationale.** Size-bounds the box (20MB × 3/container — a disk
safety valve whose time-window floats with traffic); time-bounds the
archive (14–30 days, arriving with the aggregation tier when the revisit
trigger fires). Long-term value never lives in logs — that's the
sacred/derived split doing retention policy for us.

**Metrics: Postgres is the metrics warehouse (ADR-0003 doctrine).**
- Operational counters live as queryable rows: pg-boss job tables +
  `ingest_runs` (per-run summary written by the pipeline). Dashboards are
  SQL queries before they are ever a Grafana panel.
- Host metrics: **DO metrics agent** (installed 2026-07-30) + alert
  policies: CPU >80%/10m, memory >90%/10m, disk >85%/10m → email.

**Errors: Sentry free tier**, adopted with the first worker feature (DSN in
.env; Next.js + worker SDK init). Aggregation, release tagging via sha,
email on new issue — the solo-dev safety net.

**Uptime: external check** hitting `/api/health` (app returns ok + build
sha; extended later to include DB reachability and last-poller-run age so
the silent-poller failure becomes externally visible). Free checker (DO
Uptime or UptimeRobot) pinging through Cloudflare.

**Tracing: none in v1.** A monolith + worker on one box doesn't need
distributed tracing; correlation ids + duration fields give the joins.
OTel arrives only if a real cross-service latency mystery exists.

## Consequences
- Zero new always-on infrastructure; everything is stdout, Postgres rows,
  or someone's free tier.
- Log queries are grep-shaped until volume demands more (revisit below).
- Poller health is double-covered: `ingest_runs` rows (queryable, gates)
  + health endpoint age check (externally alertable).

## Alternatives
- Self-hosted Loki/Grafana: rejected — RAM and ops on a 1GB box for a
  solo reader.
- Hosted log aggregation now (Axiom/Grafana Cloud free): deferred, not
  rejected — pino transports make it a config change, the designated
  path when ssh+grep stops scaling.
- Full OTel from day one: rejected — ceremony without a consumer.

## Revisit triggers
- Debugging requires cross-referencing logs older than rotation keeps.
- More than ~2 incidents/month where grep is the bottleneck → add Axiom or
  Grafana Cloud via pino transport.
- A second service/box appears → revisit OTel.

## Amendment (2026-09-28): a failed job must reach a person, and a daily brief is read by Claude

Prompted by an incident, not a plan. The first poll after 24 days away
disappeared ~21k of 85k identities in one run; stage 5 overflowed the stack
building a single INSERT for that event wave and rolled back. In dev the crash
was one line in a log file. In production the same failure would have been a
pg-boss job failing, retrying and failing again, while the site aged out of
its 8-day visibility window one animal at a time — and nothing above would have
told anyone. Three of this ADR's decisions would each have caught it, and none
is built: `ingest_runs`, the health endpoint's poller-age check, Sentry. This
amendment sharpens what "built" must mean, and adds the reading layer.

### 1. Two channels, by latency — never one channel for both

- **Minutes: things a person must act on today.** A failed or missing poll,
  the site down, a new error class. These go straight from the platform to
  email: Sentry on a new issue, the external uptime check on `/api/health`
  (which must include `lastCompletePollAt` and fail when it is older than one
  poll interval plus slack), and the existing DO host alerts. **No LLM in this
  path** — an alert that waits for a scheduled agent is not an alert.
- **Daily: things a person should know this week.** Run counts, failures,
  the visible-animal count, the disappearance rate, job-queue depth, the
  supply-side numbers the roadmap says to watch. This is a brief, and a brief
  is where an LLM earns its place: it reads the numbers against the roadmap's
  carry-ins and says what changed.

### 2. The brief is three pieces, and the worker owns the facts

1. **`ops.daily` job** (worker, pg-boss cron): reads `ingest_runs`, the pg-boss
   job tables and the projection counts, and writes ONE JSON summary row
   (`ops_daily`, append-only — a correction is tomorrow's row) plus a
   structured log line. Postgres stays the metrics warehouse.
2. **`GET /api/ops/daily`** (app): returns the latest row, behind a bearer
   token in `.env`. Ops counters only — never a donor, a shelter contact or an
   animal's prose — so a leaked token embarrasses nobody and the endpoint can
   be read from outside the box.
3. **A Claude routine** (claude.ai scheduled cloud agent, daily, on Logan's
   subscription) fetches the endpoint and writes the brief. A routine runs in
   Anthropic's cloud with no access to the droplet, the database or local
   files: the endpoint is the only way it sees anything, which is why piece 2
   exists at all.

### 3. Delivery is a connector or a commit, decided when built

A routine cannot email on its own. Either a Gmail connector is attached at
claude.ai (the routine sends the brief) or the routine commits the brief to
`doc/ops/` and GitHub's own notification carries it. The second needs nothing
new and leaves a history in the repo; prefer it unless the inbox turns out to
matter. Either way the brief is derived, disposable operations data — never
product data, never read by anything donor-facing.

### 4. Two rules the incident adds to "what gets logged"

- **A job's terminal failure is an event, not a log line**: pg-boss's failed
  state must surface in `/api/health` and in Sentry, because docker logs are
  read only by someone already looking.
- **The ratio gate is a rate, not a share** (roadmap phase 9 carry-in): a
  complete run may legitimately disappear a quarter of the identity table
  after weeks away. Gate on disappearances per day since the last COMPLETE
  run, and record that run's date in `ingest_runs` so the gate has a
  denominator.

### Consequences (added)

- One new table (`ops_daily`), one new job, one new endpoint, one new secret.
  No new infrastructure; the routine is a claude.ai feature.
- Sentry, the uptime check and the health extension move from "arrives with
  the first worker feature" to **owed before the first production deploy that
  turns the poller on**. (Corrected 2026-09-28: this first read "the poller
  has been running in production since 2026-08, so they are already late". It
  has never run there — production is still the v0.1.0 landing page with no
  database behind it, `doc/infra.md` step 6 — so they are owed, not overdue.)
- Sits on the roadmap as its own item once item 3 closes; this amendment is
  the decision, not the build.

### Revisit triggers (added)

- The daily brief says nothing anyone acts on for a month → drop the routine
  and keep the endpoint; the numbers are still the diagnostics.
- A second reader for the brief appears (a shelter partner, a contributor) →
  the token becomes per-reader, and the endpoint gets rate limiting.
- The brief starts wanting per-animal detail → stop; that is a product
  surface, and it belongs to the donor feed (ADR-0020), not ops.

## Amendment (2026-09-29): Better Stack is the provider; the Sentry SDK is the seam

The decisions above name "Sentry free tier" for errors and "DO Uptime or
UptimeRobot" for the external check, and the 2026-09-28 amendment adds a
heartbeat for the silent poller. Compared on 2026-09-29 against the live
pricing pages (Sentry, Better Stack, Honeybadger, UptimeRobot), one free tier
now covers all three needs with headroom.

### 1. Better Stack for errors, uptime and heartbeats
Free tier as read that day: 100,000 exceptions/month kept 90 days, 10 uptime
monitors at 3-minute checks, 10 heartbeats, one status page, and no one-user
limit. Sentry's free tier fits exactly one cron monitor and one uptime monitor —
`ops.daily` would be the first thing we paid for — and UptimeRobot's free tier
has no heartbeats at all. One account, one alert policy, email delivery.

### 2. The code speaks Sentry's SDK, so the provider is a DSN
The app uses `@sentry/nextjs` and the worker `@sentry/node`, pointed at the
Better Stack DSN — Better Stack ingests the Sentry protocol. Moving to Sentry
(or GlitchTip) later is an `.env` change, never a rewrite. Never import a
Better Stack–specific client for errors.

### 3. Heartbeats are URL pings, not SDK check-ins
The worker requests the heartbeat URL after a complete poll and `<url>/fail` on
failure. No SDK in that path: a worker too broken to load its SDK still gets
reported, by silence.

### 4. Settings, fixed here so a wizard cannot change them
- Tracing sample rate **0** (decision above: no tracing in v1).
- Session Replay **off** — it records visitors' sessions: a privacy cost for no
  current need.
- `sendDefaultPii: false` plus a `beforeSend` scrub — identifiers, never
  identities (decision above).
- Every event carries `release` = the build sha and `environment`; development
  events never alert.
- **One** Errors application for app and worker, told apart by a `component`
  tag. 100k/month is ample headroom, and one application is one alert policy.

### 5. Provisioned by API from team tokens — never a global token
Two team-scoped tokens (telemetry, uptime) create every resource; a global
token would add only cross-team, billing and usage reach. Tokens themselves
cannot be minted by API, so the CI source-map token is made by hand and kept
separate from the dev one, to be revoked alone. What exists, and the commands
that rebuild it, live in `doc/infra.md` (registry, step 6d).

### Consequences (added)
- Built 2026-09-29: the Errors application, a keyword monitor on
  `/api/health` beside the hand-made one on `/`, and the poll heartbeat —
  created **paused**, because the poller has never run in production and an
  unpaused heartbeat would alert every morning. It is unpaused in the deploy
  that turns the poller on.
- Not built yet: the SDK integration, the worker's pings, and the
  `/api/health` extension (`lastCompletePollAt`) — roadmap item 7c.
- **Source maps are unproven for this stack.** Better Stack accepts uploads
  through Sentry's build tooling, but documents no Next.js path, and our build
  is Turbopack. The first 7c slice proves it with one deliberate error; server
  code and the `tsx` worker read fine without maps, so only the client island
  depends on it.

### Alternatives (added)
- **Sentry + UptimeRobot** — the original shape. Strongest Next.js
  integration; rejected on free-tier fit (one cron monitor, one seat, a second
  vendor for uptime). The SDK choice in §2 keeps it one DSN away.
- **Honeybadger** — similar quotas, 15-day retention, and its own SDK: lock-in
  for nothing Better Stack lacks.
- **Self-hosted Sentry or GlitchTip** — rejected: neither fits a 1GB droplet.

### Revisit triggers (added)
- Better Stack's free tier shrinks below what §1 relies on → switch the DSN to
  Sentry, re-home uptime and the heartbeat.
- Source maps cannot be made to work → a client-side error is unreadable;
  weigh Sentry for the app alone.
- A second person needs access → confirm the free tier still carries seats.

## Amendment (2026-09-30): source maps are uploaded by their own CI job, and server frames carry no context lines

The 2026-09-29 amendment left source maps "unproven for this stack". A
two-day probe — events sent at will, read back through Better Stack's SQL API
(`remote(t606375_monsterpaws_exceptions)` and the `_s3` archive,
`_row_type = 4`) — proved them, and found two behaviours of Better Stack that
Sentry does not share.

### Findings
1. **A frame that already carries source lines is never source-mapped.** The
   Sentry Node SDK's `ContextLines` integration attaches lines read from the
   local file; it skips very long lines, which is why Next's large vendor chunks
   resolved and our small route chunks never did. Proven with one captured
   event sent twice: with context lines, unresolved; without, resolved to
   `src/app/api/spike-error/route.ts:3:13`.
2. **Bundle "assembly" is slow and happens on their side** — 1.5 to 10 minutes
   per upload, even for a single file. The CLI stops waiting after ~5 minutes
   ("Artifact bundle assembly timed out"), and processing continues without it.
   An error that arrives before processing finishes is stored unresolved, and
   stays that way.
3. Not the cause, each ruled out by a controlled probe: bracketed file names
   (`[root-of-the-server]__…`), index-format maps, URL-encoded map references,
   the plugin's upload versus the CLI's. All 46 probed files from a real upload
   resolved once findings 1 and 2 were out of the way.
4. Better Stack implements Sentry's API partially: `/store/` answers 200 and
   discards the event (only `/envelope/` stores); release delete and
   set-commits answer 404. Nothing we ship depends on those.

### Decisions
1. **`ContextLines` is off in the app server's SDK** (`src/instrumentation.ts`).
   The lines it attaches are minified chunk code anyway. The worker keeps it: it
   runs TypeScript directly through `tsx`, has no maps, and its lines are real
   source.
2. **The image build never talks to the error service.** Next emits browser
   maps (`productionBrowserSourceMaps`), the plugin's upload is disabled, and
   `scripts/sourcemaps.sh inject` stamps debug IDs offline inside the Docker
   build, syncs them into the standalone server, exports JS + maps through a
   `sourcemaps` stage, and deletes the browser maps so the image never serves
   them.
3. **CI's `sourcemaps` job uploads that export** — the same build's maps, never
   a second `next build` — and retries until Better Stack confirms processing.
   A slow or absent vendor can delay readable traces; it can never fail or stall
   an image build.
4. **`/deploy` and every op-log entry require that job green for the sha being
   rolled.** A gate, not a timer: "wait ten minutes" is exactly the kind of rule
   that gets forgotten on a busy day.

### Consequences (added)
- Three CI jobs: `verify → images → sourcemaps`. Only `images` blocks a
  deploy's artifacts; `sourcemaps` blocks the deploy itself, by the rule above.
- Images are sha-tagged only; `:latest` is gone (oplog 0002).
- The SDK choice (§2 of 2026-09-29) survives intact: both findings live in
  config and one script, and a move to Sentry reverses neither harmfully.

### Revisit triggers (added)
- Better Stack source-maps frames that carry context lines → re-enable
  `ContextLines` in the app server.
- Processing regularly exceeds six CLI waits (~30 minutes) → raise the retry
  count, or report it to Better Stack with the timings above. The first full
  run (2026-09-30, 33 MB export) confirmed on attempt 4 of 4, after 15 minutes —
  which is why the limit is six.

## Amendment (2026-09-30): what `/api/health` promises

The 2026-09-28 amendment says the endpoint "must include `lastCompletePollAt`
and fail when it is older than one poll interval plus slack". Building it
fixed four things that sentence left open.

### Decisions
1. **`ingest_runs` is the record, written by `runIngest` itself** — one
   append-only row per run that reached its end, from the worker's job and the
   CLI's hand-run poll alike. Never from replay (it fetches nothing), never for
   a run that threw (Sentry and the heartbeat's `/fail` carry those). A row is
   `complete` only when stage 5 reconciled — a caller's `complete: true` over
   an empty feed is not. Not derived from `max(last_seen_at)`: that column is
   rebuildable, and the disappearance-rate gate needs a per-run denominator
   anyway.
2. **Slack is the heartbeat's grace: 24 h + 3 h = 27 h.** The uptime check and
   the heartbeat alert on the same missed poll, and neither fires while its
   retries are still inside the window.
3. **The oldest source wins.** The endpoint ages each source's newest complete
   run and reports the oldest, so one live source never masks a dead one.
4. **503 unless the database answers and the poll is fresh — including when
   `DATABASE_URL` is unset.** The landing page was the only build that ran
   without a database; for anything after it, a missing one is a broken deploy.
   The body names which failed (`db`: up / down / unconfigured, `pollStale`),
   and one keyword monitor on `"ok":true` carries both alerts.

### Consequences (added)
- The endpoint is 503 from a fresh database's migration until its first complete
  poll. The launch pauses the monitor across that window (oplog 0001, steps 6–8).
- `/api/health` reads one indexed aggregate per request, behind a 5-second
  timeout that reports `db: "down"` rather than hanging the checker.
- Not built: pg-boss's failed-job state in the endpoint (2026-09-28 §4). The
  heartbeat's `/fail` on the last attempt, plus staleness here, covers the poll;
  the next job that matters gets it with `ops.daily`.
