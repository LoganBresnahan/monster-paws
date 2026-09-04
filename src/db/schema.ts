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
import type { DisplayPhoto } from "@/core/ingest/pipeline";
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
     * When the source listed the animal — a claim like any other, and the ONLY
     * column browse's "longest-listed first" may sort by. Never substitute
     * `created_at`: that is when our INSERT ran, and on a backfill it is one
     * timestamp for the whole corpus (ADR-0015 as amended).
     */
    listedAt: timestamp("listed_at", { withTimezone: true }),
    /**
     * Where the animal is listed — facts with provenance like any other claim
     * (ADR-0015). Never populate these from `animal_display`: that layer is
     * licensed expression, and a license is not a fact about the animal.
     */
    orgName: text("org_name"),
    /**
     * The listing organization's own site, promoted only when the source
     * published something that parses as a host (ADR-0015 as amended). Never
     * build one from an org id: a link back to the wrong shelter is worse than
     * the name alone, which is what a null here renders.
     */
    orgUrl: text("org_url"),
    /** the animal's page on the source's own site, when published — attribution, not decoration (ADR-0015 as amended) */
    listingUrl: text("listing_url"),
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
    // Browse's filters and its longest-listed-first sort (ADR-0015 as
    // amended). All three columns, in this order: the keyset cursor compares
    // `(listed_at, id)` and the sort orders by it, so an index that stops
    // short of `id` leaves the tiebreaker to a re-sort. `listed_at` is null
    // for any source that does not publish a listing date — those rows sort
    // last and are not reachable by cursor. Measured 2026-09-03 on a 64k
    // synthetic corpus: browse page 1 is 0.98 ms and a deep filtered keyset
    // page 0.61 ms, both an ordered index scan with no sort node.
    index("animals_status_listed_idx").on(t.status, t.listedAt, t.id),
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
    /**
     * When the source last touched its own record — upkeep, not a fact about
     * the animal, which is why it lives here per-source and never merges into
     * `animals` (ADR-0015 as amended). `last_seen_at` says we saw the record;
     * this says someone maintained it, and only the second one distinguishes a
     * dog waiting ten years from a listing abandoned eight years ago.
     */
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("animal_identities_source_ext_uq").on(t.source, t.externalId),
    // `animal_id` leads because `visibleAnimals` correlates per animal and
    // only then tests presence and freshness — the column order ADR-0015
    // Consequences names indexes the wrong direction for that subquery.
    // Every column `visibleAnimals` tests, so the correlated EXISTS stays an
    // index-only scan. Measured 2026-09-03 on a 64k synthetic corpus
    // (throwaway db, dropped after): 0.20 ms warm against 0.24 ms for the
    // three-column version — indistinguishable at this size. The fourth column
    // is here for the probe shape, not for that number; drop it and each
    // candidate row costs a heap fetch, which grows with the table.
    index("animal_identities_visibility_idx").on(
      t.animalId,
      t.disappearedAt,
      t.lastSeenAt,
      t.sourceUpdatedAt,
    ),
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
     * Hotlinked source URLs with the pixel size of each, in the order the
     * source listed them — never R2 keys and never fetched into R2, which the
     * display license does not cover (ADR-0006 as amended).
     * `animals.photo_keys` is the R2 column and stays separate.
     *
     * The dimensions are what let a page reserve a photo's exact shape before
     * it loads: without them the frame is a guess, and a guess either crops the
     * animal or letterboxes it (ADR-0015 as amended 2026-09-04). Never store a
     * dimension we computed or defaulted — an invented shape is worse than no
     * shape, because the page trusts it.
     */
    photos: jsonb("photos").$type<DisplayPhoto[]>().notNull().default([]),
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
