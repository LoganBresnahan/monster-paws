import type { Source } from "@/db/schema";

/**
 * Trust hierarchy (ADR-0006 / CLAUDE.md): shelter-issued APIs (Tier 1) beat
 * the aggregator (Tier 2) beats manual entry. Conflicts resolve by tier,
 * then recency. Lower rank = more trusted.
 */
const TIER_RANK: Record<Source, number> = {
  shelterluv: 0,
  petango: 0,
  rescuegroups: 1,
  manual: 2,
};

export interface Fact<T = unknown> {
  value: T;
  source: Source;
  fetchedAt: Date;
}

export function tierOf(source: Source): number {
  return TIER_RANK[source];
}

/**
 * Pick the winning fact: lowest tier rank wins; within a tier, the most
 * recently fetched wins. Deterministic on ties (first argument wins) so the
 * normalizer is idempotent.
 */
export function resolveFact<T>(a: Fact<T>, b: Fact<T>): Fact<T> {
  const ra = tierOf(a.source);
  const rb = tierOf(b.source);
  if (ra !== rb) return ra < rb ? a : b;
  return b.fetchedAt.getTime() > a.fetchedAt.getTime() ? b : a;
}

/** Fold a set of observed facts down to the single trusted value. */
export function resolveFacts<T>(facts: Fact<T>[]): Fact<T> | undefined {
  if (facts.length === 0) return undefined;
  return facts.reduce((winner, next) => resolveFact(winner, next));
}
