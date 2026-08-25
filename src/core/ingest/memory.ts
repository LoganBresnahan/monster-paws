import { mergeClaims, viableFirstObservation } from "@/core/ingest/merge";
import type { Observation, StoredObservation } from "@/core/ingest/observation";
import type {
  AnimalCandidate,
  AnimalClaims,
  CanonicalWriter,
  EntityResolver,
  IngestEvent,
  IngestStages,
  LifecycleStore,
  Normalizer,
  RawStore,
} from "@/core/ingest/pipeline";
import { inLifecycleOrder } from "@/core/ingest/pipeline";
import type { Source } from "@/core/sources";

/**
 * In-memory stage implementations: the reference behaviour the Postgres
 * stages must match, and what lets the pipeline be exercised without a
 * database. Not a mock — the dedup, merge, and event rules here are the real
 * ones (ADR-0009); only the storage is swapped.
 */

export interface MemoryAnimal {
  id: number;
  claims: AnimalClaims;
}

interface MemoryRawRow {
  rawId: number;
  source: Source;
  externalId: string;
  payload: unknown;
  fetchedAt: Date;
  contentHash: string;
  lastSeen: Date;
}

export interface MemoryIdentity {
  animalId: number;
  source: Source;
  externalId: string;
  lastSeenAt: Date;
  disappearedAt: Date | null;
}

export interface MemoryCorpus {
  rawRows: MemoryRawRow[];
  animals: Map<number, MemoryAnimal>;
  identities: Map<string, MemoryIdentity>;
  events: IngestEvent[];
  /** every stored observation, in insert order — replay's input */
  stored(): StoredObservation<unknown>[];
}

const key = (source: Source, externalId: string) => `${source}:${externalId}`;

export function createMemoryStages(normalizers: Normalizer[]): {
  stages: IngestStages;
  corpus: MemoryCorpus;
} {
  const rawRows: MemoryRawRow[] = [];
  const animals = new Map<number, MemoryAnimal>();
  const events: IngestEvent[] = [];
  const identities = new Map<string, MemoryIdentity>();
  let nextRawId = 1;
  let nextAnimalId = 1;

  const rawStore: RawStore = {
    async persist<P>(obs: Observation<P>) {
      const existing = rawRows.findLast(
        (row) => row.source === obs.source && row.externalId === obs.externalId,
      );

      // The one sanctioned mutation on the append-only corpus (ADR-0009):
      // unchanged payload touches last_seen instead of writing a duplicate row.
      if (existing && existing.contentHash === obs.contentHash) {
        existing.lastSeen = obs.fetchedAt;
        // The stored observation IS the existing raw row — its fetchedAt, not
        // this poll's, or provenance points at a row that doesn't exist (ADR-0013).
        return {
          stored: {
            ...obs,
            payload: existing.payload as P,
            rawId: existing.rawId,
            fetchedAt: existing.fetchedAt,
          },
          inserted: false,
        };
      }

      const row: MemoryRawRow = {
        rawId: nextRawId++,
        source: obs.source,
        externalId: obs.externalId,
        payload: obs.payload,
        fetchedAt: obs.fetchedAt,
        contentHash: obs.contentHash,
        lastSeen: obs.fetchedAt,
      };
      rawRows.push(row);
      return { stored: { ...obs, rawId: row.rawId }, inserted: true };
    },
  };

  // v1 is single-source-dominant: exact (source, externalId) identity. The
  // fuzzy cross-source matcher adds identities; it never replaces this lookup (ADR-0013).
  const resolver: EntityResolver = {
    async resolve(candidate: AnimalCandidate) {
      return { animalId: identities.get(key(candidate.source, candidate.externalId))?.animalId ?? null };
    },
  };

  const writer: CanonicalWriter = {
    async apply(candidate: AnimalCandidate, animalId: number | null) {
      const isNew = animalId === null;
      if (isNew && !viableFirstObservation(candidate.claims)) {
        throw new Error(
          `first observation of ${candidate.source}:${candidate.externalId} lacks name or species`,
        );
      }
      const animal: MemoryAnimal = isNew
        ? { id: nextAnimalId++, claims: {} }
        : animals.get(animalId)!;

      const merged = mergeClaims(animal.claims, candidate.claims, candidate.rawId);
      animal.claims = merged.claims;
      animals.set(animal.id, animal);
      if (isNew) {
        // A new identity's last sighting is the raw row's, not this write's:
        // on a rebuild the write happens long after the sighting (ADR-0014).
        const raw = rawRows.findLast(
          (row) => row.source === candidate.source && row.externalId === candidate.externalId,
        );
        identities.set(key(candidate.source, candidate.externalId), {
          animalId: animal.id,
          source: candidate.source,
          externalId: candidate.externalId,
          lastSeenAt: raw?.lastSeen ?? merged.occurredAt ?? new Date(0),
          disappearedAt: null,
        });
      }

      const emitted: IngestEvent[] = [];
      // No event when a replay reproduces what canonical already holds —
      // event_log rows are permanent, so a phantom update is uncorrectable.
      if (merged.occurredAt && (isNew || merged.changed.length > 0)) {
        emitted.push({
          kind: isNew ? "animal.seen" : "animal.updated",
          source: candidate.source,
          subjectType: "animal",
          subjectId: String(animal.id),
          data: { rawId: candidate.rawId, externalId: candidate.externalId, changed: merged.changed },
          occurredAt: merged.occurredAt,
        });
      }
      events.push(...emitted);
      return { animalId: animal.id, events: emitted, conflicted: merged.conflicted };
    },
  };

  const lifecycle: LifecycleStore = {
    async reconcile(source: Source, seen: ReadonlySet<string>, at: Date) {
      const emitted: IngestEvent[] = [];
      const event = (kind: IngestEvent["kind"], id: MemoryIdentity, data: Record<string, unknown>) =>
        emitted.push({
          kind,
          source,
          subjectType: "animal",
          subjectId: String(id.animalId),
          data: { externalId: id.externalId, ...data },
          occurredAt: at,
        });

      // Only this source's identities: absence from one feed says nothing
      // about another (ADR-0014).
      const own = [...identities.values()].filter((id) => id.source === source);
      // A run older than the newest sighting would write a disappearance
      // that predates a presence — refuse rather than record it (ADR-0014).
      const newest = own.reduce<Date | null>((m, id) => (!m || id.lastSeenAt > m ? id.lastSeenAt : m), null);
      if (newest && at < newest) {
        throw new Error(`reconcile at ${at.toISOString()} predates last sighting ${newest.toISOString()}`);
      }
      for (const id of own) {
        if (seen.has(id.externalId)) {
          if (id.disappearedAt) {
            event("animal.reappeared", id, { disappearedAt: id.disappearedAt });
            id.disappearedAt = null;
          }
          id.lastSeenAt = at;
        } else if (!id.disappearedAt) {
          event("animal.disappeared", id, { lastSeenAt: id.lastSeenAt });
          id.disappearedAt = at;
        }
      }
      const ordered = inLifecycleOrder(emitted);
      events.push(...ordered);
      return { events: ordered };
    },
  };

  const corpus: MemoryCorpus = {
    rawRows,
    animals,
    identities,
    events,
    stored: () =>
      rawRows.map((row) => ({
        source: row.source,
        externalId: row.externalId,
        payload: row.payload,
        fetchedAt: row.fetchedAt,
        contentHash: row.contentHash,
        rawId: row.rawId,
      })),
  };

  return {
    stages: {
      rawStore,
      normalizers: new Map(normalizers.map((n) => [n.source, n])),
      resolver,
      writer,
      lifecycle,
    },
    corpus,
  };
}
