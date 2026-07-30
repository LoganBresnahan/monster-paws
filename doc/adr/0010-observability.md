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
