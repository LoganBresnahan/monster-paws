import { rankOf, tierOf, type Source } from "@/core/sources";

/**
 * One source's assertion about one field at one time — never trusted on its
 * own (ADR-0006). A value only becomes canonical by winning resolution, so
 * never strip a claim down to its `value` before then.
 *
 * Carries the source, never a tier or a rank: both are derived on read, and a
 * persisted rank would freeze the hierarchy as it stood at write time
 * (ADR-0006 as amended).
 */
export interface Claim<T = unknown> {
  value: T;
  source: Source;
  fetchedAt: Date;
  /** the raw row this was derived from — set by the writer, never by a normalizer */
  rawId?: number;
}

/**
 * Pick the winning claim: lowest tier rank wins; within a tier, the most
 * recently fetched; on an exact fetchedAt tie, the later raw row (ADR-0013)
 * — without that, two rows stamped the same instant flip on every replay and
 * each flip is a permanent event. Only then first argument wins: call it
 * `resolveClaim(incoming, current)`, so a re-derivation of the SAME raw row
 * (a fixed normalizer on replay) can repair a bad value (ADR-0009).
 */
export function resolveClaim<T>(a: Claim<T>, b: Claim<T>): Claim<T> {
  const ra = rankOf(tierOf(a.source));
  const rb = rankOf(tierOf(b.source));
  if (ra !== rb) return ra < rb ? a : b;
  if (b.fetchedAt.getTime() !== a.fetchedAt.getTime()) {
    return b.fetchedAt.getTime() > a.fetchedAt.getTime() ? b : a;
  }
  if (a.rawId !== undefined && b.rawId !== undefined && a.rawId !== b.rawId) {
    return b.rawId > a.rawId ? b : a;
  }
  return a;
}

/** Fold a set of observed claims down to the single trusted value. */
export function resolveClaims<T>(claims: Claim<T>[]): Claim<T> | undefined {
  if (claims.length === 0) return undefined;
  return claims.reduce((winner, next) => resolveClaim(winner, next));
}

/** Two claims from different tiers — a cross-tier disagreement is a conflict in either direction; staleness within a tier is not (ADR-0013). */
export function crossTier(a: Claim<unknown>, b: Claim<unknown>): boolean {
  return tierOf(a.source) !== tierOf(b.source);
}
