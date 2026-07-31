import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rawPayloads } from "@/db/schema";
import type { Observation, StoredObservation } from "@/core/ingest/observation";
import type { RawStore } from "@/core/ingest/pipeline";

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
          .select({ id: rawPayloads.id, contentHash: rawPayloads.contentHash })
          .from(rawPayloads)
          .where(
            and(eq(rawPayloads.source, obs.source), eq(rawPayloads.externalId, obs.externalId)),
          )
          .orderBy(desc(rawPayloads.id))
          .limit(1);

        if (latest && latest.contentHash === obs.contentHash) {
          await tx
            .update(rawPayloads)
            .set({ lastSeen: obs.fetchedAt })
            .where(eq(rawPayloads.id, latest.id));
          return { stored: { ...obs, rawId: latest.id }, inserted: false };
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
