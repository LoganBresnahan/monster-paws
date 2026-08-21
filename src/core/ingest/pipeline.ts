import type { Claim } from "@/core/trust";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import type { Source } from "@/core/sources";

/** The fields of `animals` a normalizer can assert — its whole output surface. */
export interface AnimalFields {
  name: string;
  species: string;
  breed: string | null;
  status: string;
  sex: string | null;
  ageGroup: string | null;
  birthDate: Date | null;
  /**
   * Most sources estimate a birth date rather than knowing it. Never render a
   * birthDate as exact without consulting this — an estimate presented as fact
   * is the quiet kind of lie provenance exists to prevent.
   */
  isBirthDateExact: boolean | null;
  shelterExternalId: string | null;
  photoKeys: string[];
}

/**
 * Each field carries its own source + fetchedAt so the merge can resolve them
 * independently (ADR-0006 trust hierarchy) — never collapse this to a flat
 * record with one provenance stamp for the row.
 */
export type AnimalClaims = {
  [K in keyof AnimalFields]?: Claim<AnimalFields[K]>;
};

/** A normalized observation, still tied to the exact fetch it came from. */
export interface AnimalCandidate {
  source: Source;
  externalId: string;
  rawId: number;
  claims: AnimalClaims;
}

/** `animal.disappeared` is inferred from absence, never from a payload (ADR-0009). */
export type IngestEventKind = "animal.seen" | "animal.updated" | "animal.disappeared";

export interface IngestEvent {
  kind: IngestEventKind;
  source: Source;
  subjectType: "animal";
  subjectId: string;
  data: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * Stage 1 — persist raw, deduped by contentHash. Returns one stored
 * observation per input; `inserted` false means the payload was unchanged and
 * only `last_seen` moved.
 */
export interface RawStore {
  persist<P>(obs: Observation<P>): Promise<{ stored: StoredObservation<P>; inserted: boolean }>;
}

/**
 * Stage 2 — per-source mapping. Async because LLM extraction is a normalizer
 * like any other (ADR-0009 as amended): it reads vaulted HTML off the stored
 * observation, so a prompt fix is repaired by replay, never by re-fetching.
 */
export interface Normalizer<P = unknown> {
  readonly source: Source;
  normalize(obs: StoredObservation<P>): Promise<AnimalClaims>;
}

/** Stage 3 — match a candidate to an existing canonical animal, or `null` for new. */
export interface EntityResolver {
  resolve(candidate: AnimalCandidate): Promise<{ animalId: number | null }>;
}

/**
 * Stage 4 — merge into canonical + emit events. Must be idempotent: replaying
 * an unchanged observation emits nothing, or the sacred event_log fills with
 * phantom `animal.updated` rows that no correction can remove (ADR-0003).
 */
export interface CanonicalWriter {
  apply(
    candidate: AnimalCandidate,
    animalId: number | null,
  ): Promise<{ animalId: number; events: IngestEvent[] }>;
}

export interface IngestStages {
  rawStore: RawStore;
  /** keyed by source — the pluggability seam (ADR-0009) */
  normalizers: Map<Source, Normalizer>;
  resolver: EntityResolver;
  writer: CanonicalWriter;
}

export interface IngestFailure {
  externalId: string;
  stage: "persist" | "normalize" | "resolve" | "write";
  error: string;
}

/** Counts the phase-6 health gates read; no gate logic lives here yet. */
export interface IngestRunReport {
  source: Source;
  observed: number;
  persisted: number;
  deduped: number;
  normalized: number;
  events: IngestEvent[];
  failures: IngestFailure[];
}

function emptyReport(source: Source): IngestRunReport {
  return {
    source,
    observed: 0,
    persisted: 0,
    deduped: 0,
    normalized: 0,
    events: [],
    failures: [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stages 2–4 over already-persisted observations. One bad observation is
 * recorded and skipped — never throw out of the loop, or a single malformed
 * payload silently truncates the run and the gates see a healthy short batch.
 */
async function runDerivedStages(
  stored: StoredObservation<unknown>[],
  stages: IngestStages,
  report: IngestRunReport,
): Promise<IngestRunReport> {
  for (const obs of stored) {
    const normalizer = stages.normalizers.get(obs.source);
    if (!normalizer) {
      report.failures.push({
        externalId: obs.externalId,
        stage: "normalize",
        error: `no normalizer registered for source '${obs.source}'`,
      });
      continue;
    }

    let claims: AnimalClaims;
    try {
      claims = await normalizer.normalize(obs);
    } catch (error) {
      report.failures.push({
        externalId: obs.externalId,
        stage: "normalize",
        error: messageOf(error),
      });
      continue;
    }
    report.normalized += 1;

    const candidate: AnimalCandidate = {
      source: obs.source,
      externalId: obs.externalId,
      rawId: obs.rawId,
      claims,
    };

    let animalId: number | null;
    try {
      ({ animalId } = await stages.resolver.resolve(candidate));
    } catch (error) {
      report.failures.push({
        externalId: obs.externalId,
        stage: "resolve",
        error: messageOf(error),
      });
      continue;
    }

    try {
      const { events } = await stages.writer.apply(candidate, animalId);
      report.events.push(...events);
    } catch (error) {
      report.failures.push({
        externalId: obs.externalId,
        stage: "write",
        error: messageOf(error),
      });
    }
  }

  return report;
}

/** Full run: fetch → persist → derived stages. */
export async function runIngest(
  adapter: SourceAdapter<unknown>,
  stages: IngestStages,
): Promise<IngestRunReport> {
  const report = emptyReport(adapter.source);
  const stored: StoredObservation<unknown>[] = [];

  for await (const obs of adapter.fetch()) {
    report.observed += 1;
    try {
      const result = await stages.rawStore.persist(obs);
      if (result.inserted) report.persisted += 1;
      else report.deduped += 1;
      stored.push(result.stored);
    } catch (error) {
      report.failures.push({
        externalId: obs.externalId,
        stage: "persist",
        error: messageOf(error),
      });
    }
  }

  return runDerivedStages(stored, stages, report);
}

/**
 * Replay stages 2–4 over the retained corpus (ADR-0009) — how a mapper or
 * extraction-prompt bug is fixed retroactively, with no source contact.
 * Shares the same stage path as `runIngest`: if these ever diverge, replay
 * stops proving anything about production.
 */
export async function replay(
  source: Source,
  stored: StoredObservation<unknown>[],
  stages: IngestStages,
): Promise<IngestRunReport> {
  const report = emptyReport(source);
  report.observed = stored.length;
  report.deduped = stored.length;
  return runDerivedStages(stored, stages, report);
}
