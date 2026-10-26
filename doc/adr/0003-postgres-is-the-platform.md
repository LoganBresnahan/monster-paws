# ADR-0003: Postgres is the platform (data, queue, search, vector index)

> Amended by ADR-0006: RescueGroups-derived rows are source-tagged and
> set-deletable (ToS purge obligation) — the one sanctioned exception to
> append-only.
>
> Amended 2026-10-26: the off-DigitalOcean dump is nightly, not weekly, and
> production starts from an empty database — see the amendment below.

## Context
The corpus — listings across sources, care events, attestations, donations —
is the long-term asset and future RAG substrate, collected before the AI use
case is chosen. Candidate architectures sprawl: Redis for queues, a hosted
vector DB for embeddings, a search service.

## Decision
One DO Managed Postgres (PITR) holds everything: relational tables, an
**append-only** event log, raw API payloads verbatim in JSONB, full-text
search, pgvector (HNSW) embeddings, and the job queue (pg-boss). Drizzle as
ORM. Rules: raw/event rows are never UPDATEd/DELETEd (corrections are new
rows); embeddings are derived data (each row carries `embedding_model`,
rebuildable by batch re-embed); animal facts resolve by trust tier
(shelter API > platform-widget scrape > aggregator API), then recency, with
source + fetched_at on every fact. Images live in R2, keys in the DB; signed
attestations are additionally mirrored to R2 as flat files so claims verify
even if we cease to exist. Weekly pg_dump to R2 outside DO's ecosystem.

## Consequences
- One system to back up, one transactional boundary; index and source of
  truth cannot drift. Hybrid search (vector + FTS) comes free.
- No Redis/Pinecone bills or ops. pgvector is ample below ~10M vectors.
- Managed Postgres is the single biggest line item (~$15/mo) — deliberately,
  because the append-only corpus is irreplaceable.

## Alternatives
- BullMQ+Redis (old plan): rejected — second service for no gain at this scale.
- Dedicated vector DB: rejected below ~10M vectors / serious QPS.
- Self-hosted Postgres + WAL-G to R2: viable, ~$15/mo cheaper, but backup
  discipline becomes a human factor; rejected for the primary store.

## Revisit triggers
- ~10M+ vectors or vector QPS pgvector can't serve.
- Queue throughput beyond Postgres-as-queue comfort (~hundreds of jobs/sec).

## Amendment (2026-10-26): nightly off-DO dump; production starts fresh

### Context
Before the launch (oplog 0001), Logan walked the backup story and two things
needed settling. DigitalOcean backs a Managed Postgres cluster up once a day
and keeps 7 days; a restore makes a new cluster, and **destroying the cluster
destroys its backups** (DO docs, read 2026-10-26), so an account loss or a
deleted cluster takes every DO copy with it — the off-DO dump above is the
only copy that survives that. Whether our size (db-s-1vcpu-1gb) gets
point-in-time restore or only the daily backups is unconfirmed: one third
party says PITR needs a larger plan, DO's page does not say. And the dev
database holds every poll since 2026-08-25 (the disappearances, the listing
changes), which production would not have.

### Decision
1. **The dump to the R2 vault is nightly** (Logan), at 08:30 UTC after the
   07:00 poll, by `scripts/backup-db.sh` from the droplet's cron, pinging its
   own Better Stack heartbeat. Weekly would lose up to a week of donor data
   once donations land; the cost difference is cents.
2. **The vault key never enters the droplet's `.env`.** Compose hands `.env`
   to the app and the worker, and the worker parses untrusted data daily
   (ADR-0011); the key lives in `.env.backup`, read only by the backup script.
3. **Production starts from an empty database** (Logan): migrations, then a
   first poll. The dev corpus since 2026-08-25 stays where it is, in the dev
   database and its `var/dumps/` copies (ADR-0017), and is never restored
   into production.

### Consequences
- Production's history begins at launch: an animal adopted before then never
  appears there as a disappearance.
- What our plan gets from DO (daily only, or PITR) is read off the cluster's
  Backups tab at launch and recorded in oplog 0001.
- A dump nobody has restored is not yet a backup: a restore drill (pull one
  from R2 into a scratch database, compare row counts) and a retention rule
  for the vault's `pgdump/` prefix follow the launch (roadmap, Launch).
