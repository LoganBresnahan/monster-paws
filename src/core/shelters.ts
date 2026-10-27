import { isValidSlug, scrapeSource, type ScrapeSource, type Tier } from "@/core/sources";

/**
 * Three separate gates (ADR-0006 as amended): a shelter may welcome being
 * listed and object to being crawled nightly. Never infer one from another.
 */
export const PERMISSIONS = ["scrape", "display", "digify"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** A start and an optional end — a `Grant`, or the API-key license of `display.ts`. */
export interface ConsentWindow {
  /** ISO date */
  grantedAt: string;
  /** ISO date; absent while the window is open */
  revokedAt?: string;
}

/**
 * Consent is a record, not a boolean (ADR-0006 as amended): a bare flag
 * asserts consent without evidence — the same unfalsifiable failure mode as
 * an unattributed golden fixture. To revoke, set `revokedAt`; never delete a
 * grant, or the registry stops being the history of the relationship.
 */
export interface Grant extends ConsentWindow {
  permission: Permission;
  /** the person who granted it, and their role at the shelter */
  granter: string;
  /** what they actually agreed to, in their words — not our summary of it */
  basis: string;
  /** pointer to the evidence: the email or thread, under doc/consent/ */
  evidence: string;
}

export interface ShelterEntry {
  /** natural key — also the `scrape:<slug>` source identity and the future `shelters` row */
  slug: string;
  name: string;
  siteUrl: string;
  /** the listings index a scrape starts from */
  listingsUrl: string;
  tier: Tier;
  /** hand-checked expected output for this site, or `null` until onboarding writes one */
  goldenFixture: string | null;
  grants: Grant[];
}

/**
 * The registry lives in git, not in a table: consent is a legal artifact, so
 * a commit records who granted what, when, and on what basis. The `shelters`
 * table is deferred to roadmap item 4/7 and stays a mechanical migration as
 * long as `slug` remains the natural key.
 *
 * Empty until roadmap item 5 (local consent outreach) — we hold no grants yet,
 * and an entry without one is a shelter we may not scrape.
 */
export const SHELTERS: readonly ShelterEntry[] = [];

export function shelterBySlug(
  slug: string,
  registry: readonly ShelterEntry[] = SHELTERS,
): ShelterEntry | undefined {
  return registry.find((s) => s.slug === slug);
}

export function sourceOf(shelter: ShelterEntry): ScrapeSource {
  return scrapeSource(shelter.slug);
}

/**
 * A grant is active from `grantedAt` until `revokedAt`. Revocation takes
 * effect on its date, so an `asOf` in the past still reads as granted — that
 * is what makes it possible to ask whether a page we rendered last month was
 * licensed at the time.
 */
export function isActive(window: ConsentWindow, asOf: Date): boolean {
  // An unparseable date DENIES. `Date.parse` returns NaN and every NaN
  // comparison is false, so reading these dates without the guard makes a
  // typo'd `grantedAt` read as licensed at every instant in history — the one
  // failure direction this gate must never have.
  const granted = Date.parse(window.grantedAt);
  if (Number.isNaN(granted) || granted > asOf.getTime()) return false;
  if (window.revokedAt === undefined) return true;
  const revoked = Date.parse(window.revokedAt);
  return !Number.isNaN(revoked) && revoked > asOf.getTime();
}

/**
 * The gate every scrape, render, and generation must pass. Default-deny: an
 * unknown shelter, an unlisted permission, and a revoked grant are all
 * indistinguishable here on purpose.
 */
export function hasGrant(
  shelter: ShelterEntry | undefined,
  permission: Permission,
  asOf: Date = new Date(),
): boolean {
  if (!shelter) return false;
  return shelter.grants.some((g) => g.permission === permission && isActive(g, asOf));
}

export function sheltersWithGrant(
  permission: Permission,
  asOf: Date = new Date(),
  registry: readonly ShelterEntry[] = SHELTERS,
): ShelterEntry[] {
  return registry.filter((s) => hasGrant(s, permission, asOf));
}

/**
 * Structural check run as a unit test, not at import time — a malformed entry
 * should fail the build, not a request. Grants are not validated for truth;
 * only the registry's shape is checkable here.
 */
/**
 * ISO dates only, checked rather than assumed: `Date.parse` reads
 * `08/02/2026` as LOCAL midnight and `2026-08-02` as UTC midnight, so a
 * US-style grant date would answer "were we licensed on day X" differently
 * depending on the droplet's timezone.
 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/;

/** Shared by the shelter registry and the API-key licenses of `display.ts`. */
export function windowProblems(window: ConsentWindow, where: string): string[] {
  const problems: string[] = [];
  if (!ISO_DATE.test(window.grantedAt)) {
    problems.push(`${where}: grantedAt '${window.grantedAt}' is not an ISO date`);
  }
  if (window.revokedAt !== undefined && !ISO_DATE.test(window.revokedAt)) {
    problems.push(`${where}: revokedAt '${window.revokedAt}' is not an ISO date`);
  }
  return problems;
}

/**
 * A shelter that asked us to take its listings down (ADR-0029 §5). An opt-out
 * is a consent record like a grant, so it lives here in the repository and
 * never in a table: who asked, when, and the email it came in. Never delete an
 * entry — a shelter that later says yes gets a grant beside it, and the
 * registry stays the history of the relationship.
 */
export interface ShelterExclusion {
  /** the organisation's key as `animals.shelter_external_id` carries it, e.g. `rescuegroups:org:3077` — never our ids */
  shelterExternalId: string;
  /** the organisation's name as listed, so a reviewer can find it again */
  name: string;
  /** who asked, and their role at the shelter */
  askedBy: string;
  /** ISO date the request arrived */
  askedAt: string;
  /** pointer to the evidence: the email, under doc/consent/ */
  evidence: string;
}

/**
 * Applied INSIDE `visibleAnimals` (ADR-0029 §5), unlike `BROWSE_EXCLUSIONS`:
 * "take our listings down" closes browse, detail, "Surprise me" and the
 * donation path alike, and the outreach list skips the shelter. Committed and
 * deployed the day the request arrives.
 */
export const SHELTER_EXCLUSIONS: readonly ShelterExclusion[] = [];

/** The shape `animals.shelter_external_id` takes: `<source>:org:<id>` (src/core/ingest/rescuegroups.ts). */
const SHELTER_KEY = /^[a-z0-9-]+(?::[a-z0-9-]+)?:org:[^\s]+$/;

export function exclusionProblems(
  exclusions: readonly ShelterExclusion[] = SHELTER_EXCLUSIONS,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const exclusion of exclusions) {
    const where = `exclusion ${exclusion.shelterExternalId}`;
    if (!SHELTER_KEY.test(exclusion.shelterExternalId)) {
      problems.push(`${where}: not a '<source>:org:<id>' shelter key`);
    }
    if (seen.has(exclusion.shelterExternalId)) problems.push(`${where}: duplicate`);
    seen.add(exclusion.shelterExternalId);
    if (!ISO_DATE.test(exclusion.askedAt)) {
      problems.push(`${where}: askedAt '${exclusion.askedAt}' is not an ISO date`);
    }
    if (!exclusion.askedBy.trim()) problems.push(`${where}: has no askedBy`);
    if (!exclusion.evidence.trim()) problems.push(`${where}: has no evidence pointer`);
  }
  return problems;
}

export function registryProblems(registry: readonly ShelterEntry[] = SHELTERS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const shelter of registry) {
    if (!isValidSlug(shelter.slug)) {
      problems.push(`slug '${shelter.slug}' is not lowercase kebab-case`);
    }
    if (seen.has(shelter.slug)) problems.push(`duplicate slug '${shelter.slug}'`);
    seen.add(shelter.slug);

    for (const grant of shelter.grants) {
      const where = `${shelter.slug}/${grant.permission}`;
      problems.push(...windowProblems(grant, where));
      if (!grant.evidence.trim()) problems.push(`${where}: grant has no evidence pointer`);
      if (!grant.granter.trim()) problems.push(`${where}: grant has no granter`);
    }
  }

  return problems;
}
