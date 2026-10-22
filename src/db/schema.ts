import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
 * One row per ingest run that reached its end (ADR-0010) — the poller's own
 * record, which `/api/health` ages and the disappearance-rate gate divides by.
 * Append-only like `event_log`: never UPDATE a run, and never write one from
 * replay, which fetches nothing and so proves nothing about the feed.
 */
export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").$type<Source>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    /** true only when stage 5 reconciled — a caller's `complete: true` over an empty feed is not (ADR-0014) */
    complete: boolean("complete").notNull(),
    lifecycleSkipped: text("lifecycle_skipped"),
    observed: integer("observed").notNull(),
    persisted: integer("persisted").notNull(),
    deduped: integer("deduped").notNull(),
    normalized: integer("normalized").notNull(),
    conflicted: integer("conflicted").notNull(),
    failures: integer("failures").notNull(),
    /** event counts by kind, e.g. `{"animal.disappeared": 21034}` */
    events: jsonb("events").$type<Record<string, number>>().notNull(),
    clockSteppedBackMs: integer("clock_stepped_back_ms"),
  },
  (t) => [index("ingest_runs_source_finished_idx").on(t.source, t.finishedAt)],
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

/*
 * Donor accounts and donations (ADR-0027). These tables hold donor state, not
 * corpus: the ones marked append-only are still deleted, row by row, when
 * their account is deleted (ADR-0027 §6) — that exception never reaches
 * `raw_payloads`, `event_log` or attestations. No foreign key below cascades
 * into a donation or a keepsake: account deletion removes them in its own
 * order, after their R2 art, so an accidental DELETE errors instead of
 * spreading.
 */

export const accounts = pgTable(
  "accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** the account's only identity (ADR-0027 §2) — never an address, phone or payment detail beside it */
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** base64url, as the authenticator reported it */
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    /** synced passkeys report 0 forever — never treat a non-increasing 0 as a cloned key (ADR-0027) */
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    transports: text("transports").array(),
    backedUp: boolean("backed_up").notNull(),
    /** the donor's own label, e.g. "iCloud Keychain" (ADR-0027 §1) */
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("passkey_credentials_credential_uq").on(t.credentialId),
    index("passkey_credentials_account_idx").on(t.accountId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** a digest of the cookie's token — never the token, which would make a DB read a sign-in (ADR-0027 §2) */
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_account_idx").on(t.accountId),
  ],
);

/**
 * What a donor does BEFORE they have an account (ADR-0027 §3, §5). The id is
 * the `partner_donation_id` on the donate link and the only key a webhook is
 * matched on; until a claim sets `account_id`, the intent owns the donation
 * and its keepsake (Logan, 2026-10-22).
 */
export const donationIntents = pgTable(
  "donation_intents",
  {
    /** 128 CSPRNG bits, base64url — never sequential, since knowing it is what lets a forged webhook land (ADR-0027 §4) */
    id: text("id").primaryKey(),
    /**
     * The animal by source identity, never `animals.id`: `animals` is rebuilt
     * by replay and its ids are not stable across a rebuild (ADR-0013).
     */
    animalSource: text("animal_source").$type<Source>().notNull(),
    animalExternalId: text("animal_external_id").notNull(),
    nonprofitSlug: text("nonprofit_slug").notNull(),
    nonprofitEin: text("nonprofit_ein").notNull(),
    accountId: integer("account_id").references(() => accounts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("donation_intents_account_idx").on(t.accountId)],
);

export const signInLinks = pgTable(
  "sign_in_links",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** the address the link went to — the account may not exist until the link is used */
    email: text("email").notNull(),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    /** set on a claim link: using it binds this intent's keepsake (ADR-0027 §5) */
    intentId: text("intent_id").references(() => donationIntents.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** consumed by one `UPDATE … WHERE used_at IS NULL` on POST, never on GET — mail scanners prefetch links */
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sign_in_links_token_hash_uq").on(t.tokenHash),
    index("sign_in_links_account_idx").on(t.accountId),
  ],
);

/**
 * Every Every.org webhook call, stored before anything is believed (ADR-0027
 * §4). Append-only like `raw_payloads`, but donor-owned: account deletion
 * removes the rows that name the donor, which `raw_payloads` never allows.
 */
export const everyorgWebhookPayloads = pgTable(
  "everyorg_webhook_payloads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** the request body as text, never jsonb: an unparsable or forged body is kept too (ADR-0027 §4) */
    body: text("body").notNull(),
    /** request headers, with any carrying our auth token redacted before insert — a secret never lands in a row */
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    /** read from the body at insert, null when it doesn't parse — how deletion finds a donor's rows */
    partnerDonationId: text("partner_donation_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("everyorg_webhook_payloads_partner_idx").on(t.partnerDonationId)],
);

/** Derived from a matched webhook (ADR-0027 §4). Append-only, donor-owned. */
export const donations = pgTable(
  "donations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** not unique: a monthly gift may bring a new `chargeId` under the same intent — unconfirmed by Every.org */
    intentId: text("intent_id")
      .notNull()
      .references(() => donationIntents.id),
    webhookPayloadId: integer("webhook_payload_id")
      .notNull()
      .references(() => everyorgWebhookPayloads.id),
    /** the idempotency key: a replayed webhook inserts nothing (ADR-0027 §4) */
    chargeId: text("charge_id").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    netAmount: numeric("net_amount", { precision: 12, scale: 2 }),
    currency: text("currency").notNull(),
    frequency: text("frequency").notNull(),
    nonprofitSlug: text("nonprofit_slug").notNull(),
    nonprofitEin: text("nonprofit_ein").notNull(),
    nonprofitName: text("nonprofit_name").notNull(),
    donatedAt: timestamp("donated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("donations_charge_uq").on(t.chargeId),
    index("donations_intent_idx").on(t.intentId),
  ],
);

/**
 * The counts that survive every deletion (ADR-0027 §6). Never add a foreign
 * key, an account, an intent, a `chargeId`, a name or an email here: a row
 * with nothing that names a donor is why deletion never has to touch it.
 * Append-only and never deleted. A row is a gift, not a donor, so a count of
 * rows is "gifts", never "sponsors".
 */
export const donationStats = pgTable(
  "donation_stats",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    animalSource: text("animal_source").$type<Source>().notNull(),
    animalExternalId: text("animal_external_id").notNull(),
    nonprofitSlug: text("nonprofit_slug").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    frequency: text("frequency").notNull(),
    /** the day, never the instant — a timestamp beside an amount can point back at one donor */
    donatedOn: date("donated_on").notNull(),
  },
  (t) => [
    index("donation_stats_animal_idx").on(t.animalSource, t.animalExternalId),
    index("donation_stats_nonprofit_idx").on(t.nonprofitSlug),
  ],
);

/**
 * A donor's keepsake, written once at donation (ADR-0022 §1). Never UPDATEd;
 * the card renders from this row, its donation and its facts alone — never
 * through `animals` or `animal_display`. Donor-owned: deleted with its
 * account after its R2 art (ADR-0027 §6).
 */
export const keepsake = pgTable("keepsake", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  donationId: integer("donation_id")
    .notNull()
    .unique("keepsake_donation_uq")
    .references(() => donations.id),
  snapshottedAt: timestamp("snapshotted_at", { withTimezone: true }).notNull(),
});

/**
 * One row per keepsake field, each on exactly one named basis (ADR-0022 §2–3):
 * `grant:<slug>:<permission>` or `aggregator:<source>`. Never UPDATE — a purge
 * is a set delete by basis, and a change is a new row: the four `art`
 * candidates and every `face` pick are rows (ADR-0004 as amended 2026-10-14).
 */
export const keepsakeFact = pgTable(
  "keepsake_fact",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    keepsakeId: integer("keepsake_id")
      .notNull()
      .references(() => keepsake.id),
    field: text("field").notNull(),
    /** an art fact holds its R2 key — never the image (ADR-0003) */
    value: jsonb("value").notNull(),
    /** the basis by name, never a rank (ADR-0006 as amended) */
    basis: text("basis").notNull(),
    snapshottedAt: timestamp("snapshotted_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("keepsake_fact_keepsake_idx").on(t.keepsakeId, t.field),
    index("keepsake_fact_basis_idx").on(t.basis),
  ],
);

/**
 * Addresses we never mail again after a hard bounce or a spam complaint
 * (ADR-0027 as amended 2026-10-22). Only a keyed HMAC of the lowercased
 * address, never the address or a bare hash, which anyone can test by
 * guessing — so it outlives account deletion with nothing in it to delete.
 * Lifted only by hand, when the address's owner asks.
 */
export const emailSuppressions = pgTable("email_suppressions", {
  emailHmac: text("email_hmac").primaryKey(),
  reason: text("reason").$type<"bounce" | "complaint">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Which Every.org nonprofit receives a shelter's donations. A shelter with no
 * row gets no donate button, never a dead one (ADR-0015). Keyed by the same
 * string as `animals.shelter_external_id`, e.g. `rescuegroups:org:3077`.
 */
export const shelterNonprofits = pgTable("shelter_nonprofits", {
  shelterExternalId: text("shelter_external_id").primaryKey(),
  everyorgSlug: text("everyorg_slug").notNull(),
  ein: text("ein").notNull(),
  /** who matched it and how, e.g. "every.org search by name, checked by Logan" */
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});
