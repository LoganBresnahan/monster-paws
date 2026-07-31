import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Source tiers (ADR-0006). Tier 1: shelter-issued keys. Tier 2: aggregator.
 * Every fact carries its source; conflicts resolve by tier, then recency.
 */
export const SOURCES = ["shelterluv", "petango", "rescuegroups", "manual"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Append-only (ADR-0003): rows here are never UPDATEd or DELETEd —
 * corrections are new rows. One sanctioned exception (ADR-0006): rows with
 * source = 'rescuegroups' are set-deletable to honor the ToS purge
 * obligation, which is why every row is source-tagged.
 */
export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").$type<Source>().notNull(),
    externalId: text("external_id").notNull(), // the source system's id
    payload: jsonb("payload").notNull(), // verbatim, never normalized here
    /** canonical-JSON digest of `payload` — the dedup key (ADR-0009) */
    contentHash: text("content_hash").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    /**
     * The one sanctioned UPDATE on this table (ADR-0009): an unchanged payload
     * touches last_seen instead of writing a duplicate row. Never widen this
     * exception — any other column mutated here destroys the corpus.
     */
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    insertedAt: timestamp("inserted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("raw_payloads_source_ext_idx").on(t.source, t.externalId)],
);

/** Append-only event log — same rules as raw_payloads. */
export const eventLog = pgTable(
  "event_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(), // e.g. animal.seen, donation.completed, attestation.published
    source: text("source").$type<Source>(),
    subjectType: text("subject_type").notNull(), // animal | shelter | donation | attestation
    subjectId: text("subject_id").notNull(),
    data: jsonb("data").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    insertedAt: timestamp("inserted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("event_log_subject_idx").on(t.subjectType, t.subjectId)],
);

/**
 * Canonical animal records — the OUTPUT of the normalizer/entity-resolution
 * over raw_payloads. Mutable (it's derived data, rebuildable from the
 * corpus), but every fact-bearing column has source + fetchedAt provenance
 * in `provenance`.
 */
export const animals = pgTable(
  "animals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    species: text("species").notNull(),
    breed: text("breed"),
    status: text("status").notNull().default("available"),
    shelterExternalId: text("shelter_external_id"),
    // photo KEYS only — images live in R2, never in the DB (ADR-0003)
    photoKeys: jsonb("photo_keys").$type<string[]>().notNull().default([]),
    /** per-field { source, fetchedAt } — the trust hierarchy's working data */
    provenance: jsonb("provenance").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("animals_status_idx").on(t.status)],
);

/**
 * Embeddings are DERIVED data (ADR-0003): rebuildable from the corpus,
 * every row carries embedding_model. The vector column itself arrives with
 * the pgvector migration once ingestion exists — the discipline is encoded
 * now.
 */
export const embeddings = pgTable("embeddings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  chunk: text("chunk").notNull(),
  dimensions: integer("dimensions").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
