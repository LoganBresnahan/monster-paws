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
}

/**
 * Pick the winning claim: lowest tier rank wins; within a tier, the most
 * recently fetched wins. Deterministic on ties (first argument wins) so the
 * normalizer is idempotent — call it `resolveClaim(incoming, current)`, since
 * on an exact tier+fetchedAt tie the fresh derivation must win or replay can
 * never repair a bad value (ADR-0009).
 */
export function resolveClaim<T>(a: Claim<T>, b: Claim<T>): Claim<T> {
  const ra = rankOf(tierOf(a.source));
  const rb = rankOf(tierOf(b.source));
  if (ra !== rb) return ra < rb ? a : b;
  return b.fetchedAt.getTime() > a.fetchedAt.getTime() ? b : a;
}

/** Fold a set of observed claims down to the single trusted value. */
export function resolveClaims<T>(claims: Claim<T>[]): Claim<T> | undefined {
  if (claims.length === 0) return undefined;
  return claims.reduce((winner, next) => resolveClaim(winner, next));
}
