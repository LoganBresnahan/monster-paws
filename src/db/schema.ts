import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Source } from "@/core/sources";

/**
 * Append-only (ADR-0003): rows here are never UPDATEd or DELETEd —
 * corrections are new rows. Two sanctioned exceptions, both source-scoped,
 * which is why every row is source-tagged: `rescuegroups` rows are
 * set-deletable on ToS termination (ADR-0006), and a `scrape:<slug>` set is
 * deletable when that shelter revokes consent (ADR-0006 as amended). Store
 * the source name — never a tier or a rank, which reordering would rewrite.
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
    /** no default — a status nobody asserted is null, and null is "don't show" (ADR-0013) */
    status: text("status"),
    sex: text("sex"),
    ageGroup: text("age_group"),
    birthDate: timestamp("birth_date", { withTimezone: true }),
    /** never render birth_date as exact when this is false — most sources estimate it */
    isBirthDateExact: boolean("is_birth_date_exact"),
    /** the registry slug (`src/core/shelters.ts`) — natural key for the future `shelters` table */
    shelterExternalId: text("shelter_external_id"),
    /**
     * Where the animal is listed — facts with provenance like any other claim
     * (ADR-0015). Never populate these from `animal_display`: that layer is
     * licensed expression, and a license is not a fact about the animal.
     */
    orgName: text("org_name"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
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
  (t) => [
    index("animals_status_idx").on(t.status),
    // Browse's filters and its longest-listed-first sort (ADR-0015). The sort
    // key is `created_at` — first canonical write, not first listing — so a
    // full canonical rebuild would reshuffle the order; that is the browse
    // page's column to revisit, not this index's.
    index("animals_status_created_idx").on(t.status, t.createdAt),
    index("animals_species_idx").on(t.species),
    index("animals_state_idx").on(t.state),
    index("animals_shelter_external_idx").on(t.shelterExternalId),
  ],
);

/**
 * Which source identities a canonical animal owns (ADR-0013). Derived like
 * `animals`; rebuilt by replay. Never put `source`/`external_id` on `animals`
 * itself — a row with one source stamp can't be merged across sources later.
 */
export const animalIdentities = pgTable(
  "animal_identities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    animalId: integer("animal_id")
      .notNull()
      .references(() => animals.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    externalId: text("external_id").notNull(),
    /** newest complete run that observed it (ADR-0014) */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** null while present; set by the run whose feed lacked it — never by a payload (ADR-0014) */
    disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("animal_identities_source_ext_uq").on(t.source, t.externalId),
    // `animal_id` leads because `visibleAnimals` correlates per animal and
    // only then tests presence and freshness — the column order ADR-0015
    // Consequences names indexes the wrong direction for that subquery.
    index("animal_identities_visibility_idx").on(t.animalId, t.disappearedAt, t.lastSeenAt),
  ],
);

/**
 * What a source lets us SHOW — one row per (animal, source), upserted by
 * stage 4 (ADR-0015). Never merge these into `animals`: a description is not
 * a fact competing in `resolveClaim`, it is expression rendered only while a
 * license holds — `aggregator-display` for `rescuegroups`, a shelter's
 * `display` grant for `scrape:<slug>`. Derived and purgeable: a terminated
 * license deletes this source's rows and pages fall back to facts (ADR-0006).
 */
export const animalDisplay = pgTable(
  "animal_display",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    animalId: integer("animal_id")
      .notNull()
      .references(() => animals.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    /** the shelter's own words — rendered verbatim as a quotation, never edited (ADR-0015) */
    description: text("description"),
    /**
     * Hotlinked source URLs, in the order the source listed them — never R2
     * keys and never fetched into R2, which the display license does not cover
     * (ADR-0006 as amended). `animals.photo_keys` is the R2 column and stays
     * separate.
     */
    photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
    listingOrg: text("listing_org"),
    trackerUrl: text("tracker_url"),
    /** the observation's fetch time, never the write's — or replay rebuilds a different row */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("animal_display_animal_source_uq").on(t.animalId, t.source)],
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
