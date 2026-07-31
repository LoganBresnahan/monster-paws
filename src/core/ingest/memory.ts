import { resolveClaim, type Claim } from "@/core/trust";
import type { Observation, StoredObservation } from "@/core/ingest/observation";
import type {
  AnimalCandidate,
  AnimalClaims,
  AnimalFields,
  CanonicalWriter,
  EntityResolver,
  IngestEvent,
  IngestStages,
  Normalizer,
  RawStore,
} from "@/core/ingest/pipeline";
import type { Source } from "@/db/schema";

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

export interface MemoryCorpus {
  rawRows: MemoryRawRow[];
  animals: Map<number, MemoryAnimal>;
  events: IngestEvent[];
  /** every stored observation, in insert order — replay's input */
  stored(): StoredObservation<unknown>[];
}

const key = (source: Source, externalId: string) => `${source}:${externalId}`;

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function newestFetchedAt(claims: AnimalClaims): Date | undefined {
  let newest: Date | undefined;
  for (const claim of Object.values(claims) as Claim<unknown>[]) {
    if (!newest || claim.fetchedAt.getTime() > newest.getTime()) newest = claim.fetchedAt;
  }
  return newest;
}

export function createMemoryStages(normalizers: Normalizer[]): {
  stages: IngestStages;
  corpus: MemoryCorpus;
} {
  const rawRows: MemoryRawRow[] = [];
  const animals = new Map<number, MemoryAnimal>();
  const events: IngestEvent[] = [];
  const animalIdByExternal = new Map<string, number>();
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
        return {
          stored: { ...obs, payload: existing.payload as P, rawId: existing.rawId },
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
  // fuzzy cross-source matcher replaces this body alone (ADR-0009 phase 4).
  const resolver: EntityResolver = {
    async resolve(candidate: AnimalCandidate) {
      return { animalId: animalIdByExternal.get(key(candidate.source, candidate.externalId)) ?? null };
    },
  };

  const writer: CanonicalWriter = {
    async apply(candidate: AnimalCandidate, animalId: number | null) {
      const occurredAt = newestFetchedAt(candidate.claims);
      const isNew = animalId === null;
      const animal: MemoryAnimal = isNew
        ? { id: nextAnimalId++, claims: {} }
        : animals.get(animalId)!;

      const changed: string[] = [];
      for (const [field, incoming] of Object.entries(candidate.claims) as [
        keyof AnimalFields,
        Claim<unknown>,
      ][]) {
        const current = animal.claims[field] as Claim<unknown> | undefined;
        // Incoming first: on an exact tier+fetchedAt tie the freshly derived
        // claim must win, or replaying a fixed normalizer can never repair a
        // bad value and canonical stops being rebuildable (ADR-0009).
        const winner = current ? resolveClaim(incoming, current) : incoming;
        if (!current || !sameValue(current.value, winner.value)) changed.push(field);
        (animal.claims as Record<string, Claim<unknown>>)[field] = winner;
      }

      animals.set(animal.id, animal);
      animalIdByExternal.set(key(candidate.source, candidate.externalId), animal.id);

      const emitted: IngestEvent[] = [];
      // No event when a replay reproduces what canonical already holds —
      // event_log rows are permanent, so a phantom update is uncorrectable.
      if (occurredAt && (isNew || changed.length > 0)) {
        emitted.push({
          kind: isNew ? "animal.seen" : "animal.updated",
          source: candidate.source,
          subjectType: "animal",
          subjectId: String(animal.id),
          data: { rawId: candidate.rawId, externalId: candidate.externalId, changed },
          occurredAt,
        });
      }
      events.push(...emitted);
      return { animalId: animal.id, events: emitted };
    },
  };

  const corpus: MemoryCorpus = {
    rawRows,
    animals,
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
    },
    corpus,
  };
}
