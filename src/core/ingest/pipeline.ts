import type { Claim } from "@/core/trust";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import type { Source } from "@/core/sources";

/** The fields of `animals` a normalizer can assert — its whole output surface. */
export interface AnimalFields {
  name: string;
  species: string;
  breed: string | null;
  /** null = unknown: never defaulted, and a page must not show an animal whose status nobody asserted (ADR-0013) */
  status: string | null;
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
  /**
   * When the SOURCE first listed the animal — never when we first wrote the
   * row, which is `animals.created_at` and is a fact about our INSERT
   * (ADR-0015 as amended). Browse's default sort reads this and nothing else.
   */
  listedAt: Date | null;
  /** where it is listed — facts, so browse can filter by state and a page can say where (ADR-0015) */
  orgName: string | null;
  /**
   * The listing organization's own site. A fact about where the animal is
   * listed, like `orgName` beside it — and the thing ADR-0015 decision 5 and
   * the RescueGroups key application both promise: a public page that links
   * BACK to the organization. Never a URL we assembled from an id or a slug.
   */
  orgUrl: string | null;
  /**
   * This animal's own page on the source's site, when the source publishes one
   * (18.6% of the RescueGroups corpus). Distinct from `orgUrl`: it is where a
   * donor reads the listing we are showing a copy of, which is the closest
   * thing to attribution there is. Never assembled from an id — the URLs are
   * per-organization subdomains, so a built one points at the wrong shelter.
   */
  listingUrl: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  photoKeys: string[];
}

/** The only fields the merge touches, in the one order both writers iterate (ADR-0013). */
export const MERGED_FIELDS = [
  "name",
  "species",
  "breed",
  "status",
  "sex",
  "ageGroup",
  "birthDate",
  "isBirthDateExact",
  "shelterExternalId",
  "listedAt",
  "orgName",
  "orgUrl",
  "listingUrl",
  "city",
  "state",
  "postalCode",
  "photoKeys",
] as const satisfies readonly (keyof AnimalFields)[];

/**
 * Each field carries its own source + fetchedAt so the merge can resolve them
 * independently (ADR-0006 trust hierarchy) — never collapse this to a flat
 * record with one provenance stamp for the row.
 */
export type AnimalClaims = {
  [K in keyof AnimalFields]?: Claim<AnimalFields[K]>;
};

/**
 * What a source lets us show, as opposed to what it asserts (ADR-0015). Kept
 * off `AnimalClaims` on purpose: routed through the merge a description would
 * compete in `resolveClaim` as if it were a breed, and provenance would call
 * it a fact. Never widen `AnimalFields` with a field from here.
 */
export interface DisplayPhoto {
  /** hotlink target, read from the source — never R2 and never built (ADR-0006 as amended) */
  url: string;
  /**
   * The pixel size OF THIS URL, taken from the same variant the URL came from
   * (ADR-0015 as amended 2026-09-04) — pairing one variant's URL with
   * another's dimensions renders every photo at the wrong shape. Present or
   * the photo is dropped: 73,833 of 73,833 RescueGroups pictures publish both,
   * so a missing one means the payload changed shape, not that a shelter took
   * an unusual photo.
   */
  width: number;
  height: number;
}

export interface DisplayContent {
  /** the shelter's words, verbatim — a normalizer may drop it, never edit it */
  description: string | null;
  /** what to hotlink, in the order the source listed them */
  photos: DisplayPhoto[];
  listingOrg: string | null;
  trackerUrl: string | null;
  /** the observation's fetchedAt, never the write clock — replay must rebuild an identical row */
  fetchedAt: Date;
}

/** A normalized observation, still tied to the exact fetch it came from. */
export interface AnimalCandidate {
  source: Source;
  externalId: string;
  rawId: number;
  claims: AnimalClaims;
  /** absent when the source licenses us nothing to show — the page then has only facts */
  display?: DisplayContent;
  /**
   * When this source last touched ITS record. Never a claim and never merged:
   * it describes a source's upkeep, not the animal, so a second source's
   * diligence must never resolve away a first source's neglect. Lands on
   * `animal_identities` beside `last_seen_at`, which is the same shape — ours
   * says we saw the record, this says someone maintained it (ADR-0015 as
   * amended).
   */
  sourceUpdatedAt?: Date | null;
}

/**
 * `animal.disappeared` / `animal.reappeared` are inferred from absence and
 * return, never from a payload (ADR-0009, ADR-0014).
 */
export type IngestEventKind =
  | "animal.seen"
  | "animal.updated"
  | "animal.disappeared"
  | "animal.reappeared";

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
  normalize(obs: StoredObservation<P>): Promise<NormalizedAnimal>;
}

/** A normalizer's whole output: facts that merge, and expression that never does (ADR-0015). */
export interface NormalizedAnimal {
  claims: AnimalClaims;
  display?: DisplayContent;
  sourceUpdatedAt?: Date | null;
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
  ): Promise<{
    animalId: number;
    events: IngestEvent[];
    /** fields where a lower-tier incoming claim disagreed with canonical — counted, never logged as an event (ADR-0013) */
    conflicted: (keyof AnimalFields)[];
  }>;
}

/**
 * Stage 5 — per-source presence (ADR-0014). Runs only after a COMPLETE fetch:
 * called on a partial run it would disappear every animal the run skipped,
 * permanently, so `runIngest` gates it and replay never calls it.
 */
export interface LifecycleStore {
  reconcile(
    source: Source,
    seen: ReadonlySet<string>,
    at: Date,
  ): Promise<{ events: IngestEvent[]; clockSteppedBackMs?: number }>;
}

/**
 * The reconcile clock, ordered by the data rather than by the wall clock
 * (ADR-0014 as amended). ADR-0014's invariant — a disappearance is never dated
 * before a presence — is what `max(at, newest)` states directly, so the clamp
 * IS the rule and needs no threshold to sit behind.
 *
 * Never reintroduce a tolerance that throws past some size. The step size here
 * is accumulated RTC drift, so it grows with the time between the host's
 * resyncs: any fixed bound is a number waiting to be exceeded, and exceeding it
 * would discard a complete 64k poll for a machine's bookkeeping. A run that is
 * complete and did not see an animal means that animal is gone, whatever the
 * clock believes.
 */
export function resolveReconcileAt(
  at: Date,
  newest: Date | null,
): { at: Date; clockSteppedBackMs: number } {
  if (!newest || at >= newest) return { at, clockSteppedBackMs: 0 };
  return { at: newest, clockSteppedBackMs: newest.getTime() - at.getTime() };
}

/**
 * One order for stage-5 events in every store (ADR-0014): reappearances
 * first, then disappearances, each by externalId — so the reference and
 * production can be compared row for row.
 */
export function inLifecycleOrder(events: IngestEvent[]): IngestEvent[] {
  const rank = (e: IngestEvent) => (e.kind === "animal.reappeared" ? 0 : 1);
  return [...events].sort(
    (a, b) => rank(a) - rank(b) || String(a.data.externalId).localeCompare(String(b.data.externalId)),
  );
}

export interface IngestStages {
  rawStore: RawStore;
  /** keyed by source — the pluggability seam (ADR-0009) */
  normalizers: Map<Source, Normalizer>;
  resolver: EntityResolver;
  writer: CanonicalWriter;
  lifecycle: LifecycleStore;
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
  /** lower-tier claims that disagreed with the canonical value (ADR-0013) */
  conflicted: number;
  /** why stage 5 did not run, when it did not (ADR-0014) */
  lifecycleSkipped?: string;
  /**
   * How far the wall clock stepped backward during the run, when it did — a
   * corrected run, never a silent one (ADR-0014 as amended). A number here
   * repeatedly is a broken clock on the host, not a quirk of the feed.
   */
  clockSteppedBackMs?: number;
  events: IngestEvent[];
  failures: IngestFailure[];
}

export interface RunOptions {
  /**
   * The caller's word that the fetch covered the source's whole feed
   * (ADR-0014). Never default this to true at a call site that can truncate.
   */
  complete: boolean;
  /** the reconcile clock — stage-5 events are dated by it, never by a payload (ADR-0014) */
  now?: () => Date;
}

function emptyReport(source: Source): IngestRunReport {
  return {
    source,
    observed: 0,
    persisted: 0,
    deduped: 0,
    normalized: 0,
    conflicted: 0,
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

    let normalized: NormalizedAnimal;
    try {
      normalized = await normalizer.normalize(obs);
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
      claims: normalized.claims,
      display: normalized.display,
      sourceUpdatedAt: normalized.sourceUpdatedAt,
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
      const { events, conflicted } = await stages.writer.apply(candidate, animalId);
      report.events.push(...events);
      report.conflicted += conflicted.length;
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

/**
 * Full run: fetch → persist → derived stages → lifecycle. An adapter error
 * propagates: a short batch reported as a run is how a partial fetch would
 * reach stage 5 and disappear everything it skipped (ADR-0014).
 */
export async function runIngest(
  adapter: SourceAdapter<unknown>,
  stages: IngestStages,
  options: RunOptions,
): Promise<IngestRunReport> {
  const report = emptyReport(adapter.source);
  const stored: StoredObservation<unknown>[] = [];
  const seen = new Set<string>();

  for await (const obs of adapter.fetch()) {
    report.observed += 1;
    seen.add(obs.externalId);
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

  await runDerivedStages(stored, stages, report);

  if (!options.complete) {
    report.lifecycleSkipped = "run declared partial by caller";
  } else if (seen.size === 0) {
    // An empty feed is an outage until proven otherwise — reconciling it
    // would disappear every animal the source has (ADR-0014).
    report.lifecycleSkipped = "run observed nothing";
  } else {
    const at = (options.now ?? (() => new Date()))();
    const { events, clockSteppedBackMs } = await stages.lifecycle.reconcile(
      adapter.source,
      seen,
      at,
    );
    report.events.push(...events);
    if (clockSteppedBackMs) report.clockSteppedBackMs = clockSteppedBackMs;
  }

  return report;
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
