import {
  hasGrant,
  isActive,
  shelterBySlug,
  windowProblems,
  type ShelterEntry,
} from "@/core/shelters";
import { isScrapeSource, shelterSlugOf, type FixedSource, type Source } from "@/core/sources";

/**
 * Which display row a page may render (ADR-0015 decision 3). Two licenses,
 * never conflated (ADR-0006 as amended 2026-08-25): `aggregator-display` is
 * held by an API KEY and covers a whole source; a shelter's `display` grant is
 * held by the shelter and covers its own scraped prose and photos. Neither is
 * a fact about the animal, so neither is ever derived from `tierOf`/`rankOf` —
 * a source being trusted says nothing about what it lets us show.
 */

/**
 * The license our own key holds, recorded like a shelter's grant and for the
 * same reason: a bare boolean would assert a license without evidence. To end
 * one, set `revokedAt` — the display rows purge with the set (ADR-0006
 * decision 4), and this file is what says the rendering stopped being allowed.
 */
export interface AggregatorLicense {
  source: FixedSource;
  /** ISO date */
  grantedAt: string;
  /** what the license actually says, in its own terms — not our summary */
  basis: string;
  /** pointer to the citable record */
  evidence: string;
  revokedAt?: string;
}

export const AGGREGATOR_LICENSES: readonly AggregatorLicense[] = [
  {
    source: "rescuegroups",
    grantedAt: "2026-08-02",
    basis:
      'API terms grant "temporary use and display in your services"; our granted key application declared display of "name, photos, breed, age, description, status, and organization info" on public pages linking back to the listing organization',
    evidence: "doc/adr/0006-rescuegroups-backbone.md §1 (amended 2026-08-25); doc/rescuegroups-api-terms.md",
  },
];

/**
 * Default-deny, exactly like `hasGrant`: an unknown source, an unlicensed one
 * and a terminated key are indistinguishable here on purpose. A page that
 * renders on anything but a `true` from this function is rendering someone
 * else's photo without a license.
 */
export function isDisplayLicensed(
  source: Source,
  asOf: Date = new Date(),
  registry?: readonly ShelterEntry[],
  licenses: readonly AggregatorLicense[] = AGGREGATOR_LICENSES,
): boolean {
  if (isScrapeSource(source)) {
    const slug = shelterSlugOf(source);
    return slug !== null && hasGrant(shelterBySlug(slug, registry), "display", asOf);
  }
  return licenses.some((l) => l.source === source && isActive(l, asOf));
}

/**
 * Structural check run as a unit test, like `registryProblems` — a malformed
 * license should fail the build, not a render. Two sources listed once each is
 * not a style rule: `isDisplayLicensed` asks whether ANY row matches, so a
 * second row for a source keeps it licensed after the first is revoked.
 */
export function licenseProblems(
  licenses: readonly AggregatorLicense[] = AGGREGATOR_LICENSES,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const license of licenses) {
    problems.push(...windowProblems(license, license.source));
    if (seen.has(license.source)) problems.push(`duplicate license for '${license.source}'`);
    seen.add(license.source);
    if (!license.evidence.trim()) problems.push(`${license.source}: license has no evidence pointer`);
  }
  return problems;
}

/**
 * v1 precedence, stated rather than derived: a shelter's own words beat an
 * aggregator's copy of them. Deliberately NOT the trust ranking — ADR-0015
 * leaves real multi-source precedence as a revisit trigger, and reusing
 * `rankOf` here would quietly make that decision by borrowing one about facts.
 */
function precedenceOf(source: Source): number {
  return isScrapeSource(source) ? 0 : 1;
}

/**
 * The licensed display row for one animal, or `null` — in which case the page
 * shows the facts and our own words, never a row it merely happens to hold.
 */
export function pickLicensedDisplay<T extends { animalId: number; source: Source }>(
  rows: readonly T[],
  asOf: Date = new Date(),
  registry?: readonly ShelterEntry[],
  licenses?: readonly AggregatorLicense[],
): T | null {
  // `animal_display` is keyed (animal_id, source), so two rows of one source
  // are two ANIMALS: picking between them by license would render a stranger's
  // photo under this animal's name. Loud, because no page can detect it.
  if (rows.some((row) => row.animalId !== rows[0].animalId)) {
    throw new Error("pickLicensedDisplay: rows span more than one animal");
  }
  const licensed = rows.filter((row) => isDisplayLicensed(row.source, asOf, registry, licenses));
  return (
    [...licensed].sort(
      (a, b) => precedenceOf(a.source) - precedenceOf(b.source) || a.source.localeCompare(b.source),
    )[0] ?? null
  );
}
