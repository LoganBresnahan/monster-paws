import { isValidSlug, scrapeSource, type ScrapeSource, type Tier } from "@/core/sources";

/**
 * Three separate gates (ADR-0006 as amended): a shelter may welcome being
 * listed and object to being crawled nightly. Never infer one from another.
 */
export const PERMISSIONS = ["scrape", "display", "digify"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Consent is a record, not a boolean (ADR-0006 as amended): a bare flag
 * asserts consent without evidence — the same unfalsifiable failure mode as
 * an unattributed golden fixture. To revoke, set `revokedAt`; never delete a
 * grant, or the registry stops being the history of the relationship.
 */
export interface Grant {
  permission: Permission;
  /** the person who granted it, and their role at the shelter */
  granter: string;
  /** ISO date */
  grantedAt: string;
  /** what they actually agreed to, in their words — not our summary of it */
  basis: string;
  /** pointer to the evidence: the email or thread, under doc/consent/ */
  evidence: string;
  revokedAt?: string;
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
export function isActive(grant: Grant, asOf: Date): boolean {
  if (Date.parse(grant.grantedAt) > asOf.getTime()) return false;
  return grant.revokedAt === undefined || Date.parse(grant.revokedAt) > asOf.getTime();
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
      if (Number.isNaN(Date.parse(grant.grantedAt))) {
        problems.push(`${where}: unparseable grantedAt '${grant.grantedAt}'`);
      }
      if (grant.revokedAt !== undefined && Number.isNaN(Date.parse(grant.revokedAt))) {
        problems.push(`${where}: unparseable revokedAt '${grant.revokedAt}'`);
      }
      if (!grant.evidence.trim()) problems.push(`${where}: grant has no evidence pointer`);
      if (!grant.granter.trim()) problems.push(`${where}: grant has no granter`);
    }
  }

  return problems;
}
