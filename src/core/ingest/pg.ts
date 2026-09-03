import { and, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals, eventLog, rawPayloads } from "@/db/schema";
import type { Observation, StoredObservation } from "@/core/ingest/observation";
import {
  MERGED_FIELDS,
  inLifecycleOrder,
  type AnimalCandidate,
  type AnimalClaims,
  type AnimalFields,
  type CanonicalWriter,
  type EntityResolver,
  type IngestEvent,
  type IngestStages,
  type LifecycleStore,
  type Normalizer,
  type RawStore,
} from "@/core/ingest/pipeline";
import type { Claim } from "@/core/trust";
import { mergeClaims, viableFirstObservation } from "@/core/ingest/merge";
import type { Source } from "@/core/sources";

/**
 * Postgres stage-1 store (ADR-0009). Behaviour must match the in-memory
 * reference in `memory.ts` — the two diverging means tests stop describing
 * production.
 */
export function createPgRawStore(db: Db): RawStore {
  return {
    async persist<P>(obs: Observation<P>) {
      return db.transaction(async (tx) => {
        // Compare against the LATEST row only: a payload that reverts A→B→A is
        // a real change and must append a third row, never match the older A.
        const [latest] = await tx
          .select({
            id: rawPayloads.id,
            contentHash: rawPayloads.contentHash,
            fetchedAt: rawPayloads.fetchedAt,
          })
          .from(rawPayloads)
          .where(
            and(eq(rawPayloads.source, obs.source), eq(rawPayloads.externalId, obs.externalId)),
          )
          .orderBy(desc(rawPayloads.id))
          .limit(1);

        if (latest && latest.contentHash === obs.contentHash) {
          // The one sanctioned UPDATE on this append-only table (ADR-0009):
          // an unchanged payload only moves last_seen — never touch any other
          // column here, or a correction becomes a mutation.
          await tx
            .update(rawPayloads)
            .set({ lastSeen: obs.fetchedAt })
            .where(eq(rawPayloads.id, latest.id));
          // The stored observation IS the existing raw row — its fetchedAt, not
          // this poll's, or provenance points at a row that doesn't exist (ADR-0013).
          return {
            stored: { ...obs, rawId: latest.id, fetchedAt: latest.fetchedAt },
            inserted: false,
          };
        }

        // Two pollers racing the same source would both miss the read and both
        // insert. Tolerated, not solved: ADR-0009 runs one poll job per source,
        // and a duplicate raw row is inert — it normalizes to identical claims.
        const [row] = await tx
          .insert(rawPayloads)
          .values({
            source: obs.source,
            externalId: obs.externalId,
            payload: obs.payload as never,
            contentHash: obs.contentHash,
            fetchedAt: obs.fetchedAt,
            lastSeen: obs.fetchedAt,
          })
          .returning({ id: rawPayloads.id });

        return { stored: { ...obs, rawId: row.id }, inserted: true };
      });
    },
  };
}

/** Replay input: the corpus rows for one source, oldest first (ADR-0009). */
export async function loadStoredObservations(
  db: Db,
  source: string,
): Promise<StoredObservation<unknown>[]> {
  const rows = await db
    .select()
    .from(rawPayloads)
    .where(eq(rawPayloads.source, source as never))
    .orderBy(rawPayloads.id);

  return rows.map((row) => ({
    rawId: row.id,
    source: row.source,
    externalId: row.externalId,
    payload: row.payload,
    contentHash: row.contentHash,
    fetchedAt: row.fetchedAt,
  }));
}

/** Exact (source, externalId) identity — v1 of stage 3 (ADR-0013). */
export function createPgEntityResolver(db: Db): EntityResolver {
  return {
    async resolve(candidate: AnimalCandidate) {
      const [row] = await db
        .select({ animalId: animalIdentities.animalId })
        .from(animalIdentities)
        .where(
          and(
            eq(animalIdentities.source, candidate.source),
            eq(animalIdentities.externalId, candidate.externalId),
          ),
        )
        .limit(1);
      return { animalId: row?.animalId ?? null };
    },
  };
}

type Provenance = Record<string, { source: Source; fetchedAt: string; rawId?: number }>;
type AnimalRow = typeof animals.$inferSelect;

/** Rebuild the per-field claims a row currently holds, from value + provenance. */
function currentClaimsOf(row: AnimalRow): AnimalClaims {
  const provenance = row.provenance as Provenance;
  const claims: Record<string, Claim<unknown>> = {};
  for (const field of MERGED_FIELDS) {
    const stamp = provenance[field];
    if (!stamp) continue;
    claims[field] = {
      value: row[field],
      source: stamp.source,
      fetchedAt: new Date(stamp.fetchedAt),
      rawId: stamp.rawId,
    };
  }
  return claims as AnimalClaims;
}

/**
 * Stage 4 against Postgres (ADR-0013). The merge itself is `mergeClaims` —
 * shared with the in-memory writer, never re-implemented here. `animals` is
 * derived and mutable; `event_log` is not: append only, and only inside the
 * same transaction as the row it describes.
 */
export function createPgCanonicalWriter(db: Db): CanonicalWriter {
  return {
    async apply(candidate: AnimalCandidate, animalId: number | null) {
      return db.transaction(async (tx) => {
        const isNew = animalId === null;
        if (isNew && !viableFirstObservation(candidate.claims)) {
          throw new Error(
            `first observation of ${candidate.source}:${candidate.externalId} lacks name or species`,
          );
        }
        const existing = isNew
          ? undefined
          : (
              await tx.select().from(animals).where(eq(animals.id, animalId)).limit(1).for("update")
            )[0];
        if (!isNew && !existing) {
          throw new Error(`animal ${animalId} resolved but not found`);
        }

        const merged = mergeClaims(existing ? currentClaimsOf(existing) : {}, candidate.claims, candidate.rawId);
        const provenance: Provenance = existing ? { ...(existing.provenance as Provenance) } : {};
        const values: Partial<Record<keyof AnimalFields, unknown>> = {};
        for (const field of merged.touched) {
          const winner = merged.claims[field] as Claim<unknown>;
          values[field] = winner.value;
          provenance[field] = {
            source: winner.source,
            fetchedAt: winner.fetchedAt.toISOString(),
            rawId: winner.rawId,
          };
        }

        let id: number;
        if (isNew) {
          const [row] = await tx
            .insert(animals)
            .values({ ...(values as typeof animals.$inferInsert), provenance })
            .returning({ id: animals.id });
          id = row.id;
          // A new identity's last sighting is the raw row's `last_seen`, not
          // this write's clock: on a rebuild the write is long after the
          // sighting, and the next disappearance would cite a false date
          // (ADR-0014).
          const [raw] = await tx
            .select({ lastSeen: max(rawPayloads.lastSeen) })
            .from(rawPayloads)
            .where(
              and(
                eq(rawPayloads.source, candidate.source),
                eq(rawPayloads.externalId, candidate.externalId),
              ),
            );
          await tx.insert(animalIdentities).values({
            animalId: id,
            source: candidate.source,
            externalId: candidate.externalId,
            lastSeenAt: raw?.lastSeen ?? merged.occurredAt ?? new Date(0),
            sourceUpdatedAt: candidate.sourceUpdatedAt ?? null,
          });
        } else {
          id = animalId;
          // Written on any touched field, not only a changed value: a same-value
          // claim from a higher tier must still take provenance, or the next
          // lower-tier poll outranks nothing and clobbers it (ADR-0013).
          if (merged.touched.length > 0) {
            await tx
              .update(animals)
              .set({ ...(values as Partial<typeof animals.$inferInsert>), provenance, updatedAt: new Date() })
              .where(eq(animals.id, id));
          }
          // Upkeep, not a fact: an UPDATE on a derived table like the
          // `last_seen_at` touch beside it, outside `provenance`, and never its
          // own event — a source editing its record is not an `animal.updated`
          // (ADR-0003, ADR-0015 as amended). Scoped to THIS source's identity:
          // one source's diligence must never refresh another's neglect.
          if (candidate.sourceUpdatedAt !== undefined) {
            await tx
              .update(animalIdentities)
              .set({ sourceUpdatedAt: candidate.sourceUpdatedAt })
              .where(
                and(
                  eq(animalIdentities.source, candidate.source),
                  eq(animalIdentities.externalId, candidate.externalId),
                ),
              );
          }
        }

        // Expression, not facts: outside the merge, outside `provenance`, and
        // never its own event — a description edited upstream is not an
        // `animal.updated`, and event_log rows are permanent (ADR-0015,
        // ADR-0003). The display write touches no column of `animals`; a
        // display-only edit still moves `updated_at`, because the new raw row
        // re-stamps every claim's provenance (ADR-0013) — pages show
        // `last_seen_at`, not this. Last write per (animal, source) wins, and
        // replay rebuilds the row identically because every value comes off
        // the stored observation, never the write clock.
        if (candidate.display) {
          await tx
            .insert(animalDisplay)
            .values({ animalId: id, source: candidate.source, ...candidate.display })
            // `set` is the whole DisplayContent, never a hand-listed subset: a
            // field enumerated here and forgotten there would reach new rows
            // and never the re-polled ones, silently and per-source.
            .onConflictDoUpdate({
              target: [animalDisplay.animalId, animalDisplay.source],
              set: candidate.display,
            });
        }

        const emitted: IngestEvent[] = [];
        if (merged.occurredAt && (isNew || merged.changed.length > 0)) {
          emitted.push({
            kind: isNew ? "animal.seen" : "animal.updated",
            source: candidate.source,
            subjectType: "animal",
            subjectId: String(id),
            data: { rawId: candidate.rawId, externalId: candidate.externalId, changed: merged.changed },
            occurredAt: merged.occurredAt,
          });
          await tx.insert(eventLog).values(emitted);
        }

        return { animalId: id, events: emitted, conflicted: merged.conflicted };
      });
    },
  };
}

/**
 * Stage 5 against Postgres (ADR-0014). Same rules as the in-memory store;
 * every state change and its event share one transaction.
 */
/** A Postgres array literal, so the whole list binds as ONE parameter (drizzle would spread it). */
function pgTextArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export function createPgLifecycleStore(db: Db): LifecycleStore {
  return {
    async reconcile(source: Source, seen: ReadonlySet<string>, at: Date) {
      // One array parameter, never one `$n` per id: the nationwide feed is
      // ~65k animals and Postgres binds at most 65,535 parameters (ADR-0014).
      const inSeen = sql`${animalIdentities.externalId} = ANY(${pgTextArray([...seen])}::text[])`;
      const notInSeen = sql`NOT (${inSeen})`;
      return db.transaction(async (tx) => {
        const emitted: IngestEvent[] = [];
        const bySource = eq(animalIdentities.source, source);

        // A run older than the newest sighting would write a disappearance
        // that predates a presence — refuse rather than record it (ADR-0014).
        const [{ newest }] = await tx
          .select({ newest: max(animalIdentities.lastSeenAt) })
          .from(animalIdentities)
          .where(bySource);
        if (newest && at < newest) {
          throw new Error(`reconcile at ${at.toISOString()} predates last sighting ${newest.toISOString()}`);
        }

        const wasGone = await tx
          .select({
            animalId: animalIdentities.animalId,
            externalId: animalIdentities.externalId,
            disappearedAt: animalIdentities.disappearedAt,
          })
          .from(animalIdentities)
          .where(and(bySource, isNotNull(animalIdentities.disappearedAt), inSeen));
        for (const id of wasGone) {
          emitted.push({
            kind: "animal.reappeared",
            source,
            subjectType: "animal",
            subjectId: String(id.animalId),
            data: { externalId: id.externalId, disappearedAt: id.disappearedAt },
            occurredAt: at,
          });
        }
        await tx
          .update(animalIdentities)
          .set({ disappearedAt: null, lastSeenAt: at })
          .where(and(bySource, inSeen));

        const gone = await tx
          .update(animalIdentities)
          .set({ disappearedAt: at })
          .where(and(bySource, isNull(animalIdentities.disappearedAt), notInSeen))
          .returning({
            animalId: animalIdentities.animalId,
            externalId: animalIdentities.externalId,
            lastSeenAt: animalIdentities.lastSeenAt,
          });
        for (const id of gone) {
          emitted.push({
            kind: "animal.disappeared",
            source,
            subjectType: "animal",
            subjectId: String(id.animalId),
            data: { externalId: id.externalId, lastSeenAt: id.lastSeenAt },
            occurredAt: at,
          });
        }

        const ordered = inLifecycleOrder(emitted);
        if (ordered.length > 0) await tx.insert(eventLog).values(ordered);
        return { events: ordered };
      });
    },
  };
}

/** The five stages wired to one database — what the worker and replay run. */
export function createPgStages(db: Db, normalizers: Normalizer[]): IngestStages {
  return {
    rawStore: createPgRawStore(db),
    normalizers: new Map(normalizers.map((n) => [n.source, n])),
    resolver: createPgEntityResolver(db),
    writer: createPgCanonicalWriter(db),
    lifecycle: createPgLifecycleStore(db),
  };
}
