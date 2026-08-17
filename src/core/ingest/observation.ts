import type { Source } from "@/core/sources";

/**
 * The one contract every source emits (ADR-0009). Adapters implement only
 * this fetch edge; never add a source-specific field here — the moment the
 * pipeline can tell sources apart, "any source can die without touching
 * downstream code" stops being true.
 */
export interface Observation<P = unknown> {
  source: Source;
  externalId: string;
  /** verbatim from the source — normalizing here would poison the corpus */
  payload: P;
  fetchedAt: Date;
  /** canonical-JSON hash of `payload`; the dedup key (ADR-0009) */
  contentHash: string;
}

/**
 * An observation read back out of the corpus — what replay feeds the stages.
 * `rawId` is what makes every derived row traceable to one fetch (ADR-0009).
 */
export interface StoredObservation<P = unknown> extends Observation<P> {
  rawId: number;
}

/**
 * The only per-source code (ADR-0009). Adding a source is one adapter plus
 * one normalizer — never a pipeline edit.
 */
export interface SourceAdapter<P = unknown> {
  readonly source: Source;
  fetch(): AsyncIterable<Observation<P>>;
}
