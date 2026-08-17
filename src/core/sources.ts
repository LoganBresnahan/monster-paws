/**
 * Trust tiers, ordered most- to least-trusted (ADR-0006 as amended). Rank is
 * this array's index: inserting a tier is moving a line, with no renumbering
 * and no gap budget. Never persist the rank — persist the tier name, or
 * reordering silently rewrites the meaning of every provenance row already
 * written.
 */
export const TIERS = ["shelter-api", "first-party-scrape", "aggregator", "manual"] as const;
export type Tier = (typeof TIERS)[number];

/** Sources with a fixed identity — one integration each, known at compile time. */
export const FIXED_SOURCES = ["shelterluv", "petango", "rescuegroups", "manual"] as const;
export type FixedSource = (typeof FIXED_SOURCES)[number];

/**
 * A consented first-party scrape, one identity per shelter (ADR-0006 as
 * amended). Per-shelter identity is what makes consent revocation a
 * `WHERE source = …` set operation instead of a hunt.
 */
export type ScrapeSource = `scrape:${string}`;

/**
 * Open by construction: onboarding a shelter must not need a schema change.
 * The closed **tier** list carries the exhaustiveness this union gave up.
 */
export type Source = FixedSource | ScrapeSource;

const FIXED_SOURCE_TIERS: Record<FixedSource, Tier> = {
  shelterluv: "shelter-api",
  petango: "shelter-api",
  rescuegroups: "aggregator",
  manual: "manual",
};

/**
 * Shelter slugs are the registry's natural key and end up inside a persisted
 * source string, so the grammar is load-bearing: a slug containing `:` would
 * make `scrape:<slug>` ambiguous to parse and split one shelter's corpus in
 * two.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function scrapeSource(slug: string): ScrapeSource {
  if (!isValidSlug(slug)) {
    throw new Error(`invalid shelter slug '${slug}': expected lowercase kebab-case`);
  }
  return `scrape:${slug}`;
}

export function isScrapeSource(source: string): source is ScrapeSource {
  return source.startsWith("scrape:") && isValidSlug(source.slice("scrape:".length));
}

/** The shelter slug a scrape source belongs to, or `null` for every other source. */
export function shelterSlugOf(source: Source): string | null {
  return isScrapeSource(source) ? source.slice("scrape:".length) : null;
}

/**
 * Unknown sources throw rather than defaulting: a typo'd source silently
 * landing in the bottom tier would let junk outrank nothing and quietly lose
 * every conflict, which reads as "no data" instead of "broken ingest".
 */
export function tierOf(source: Source): Tier {
  if (isScrapeSource(source)) return "first-party-scrape";
  const tier = FIXED_SOURCE_TIERS[source as FixedSource];
  if (!tier) throw new Error(`unknown source '${source}': no tier assigned`);
  return tier;
}

/** Lower is more trusted. Derived on read — never stored (ADR-0006 as amended). */
export function rankOf(tier: Tier): number {
  const rank = TIERS.indexOf(tier);
  if (rank < 0) throw new Error(`unknown tier '${tier}'`);
  return rank;
}
