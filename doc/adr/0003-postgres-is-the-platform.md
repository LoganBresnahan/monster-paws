# ADR-0003: Postgres is the platform (data, queue, search, vector index)

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
