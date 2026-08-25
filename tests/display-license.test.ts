import { describe, expect, it } from "vitest";
import {
  AGGREGATOR_LICENSES,
  isDisplayLicensed,
  licenseProblems,
  pickLicensedDisplay,
  type AggregatorLicense,
} from "@/core/display";
import { PERMISSIONS, type ShelterEntry } from "@/core/shelters";
import type { Source } from "@/core/sources";

/**
 * The failure this suite exists to catch is not a cosmetic one: a page
 * rendering a shelter's prose or photo without a grant is a consent violation
 * (ADR-0006 as amended, ADR-0015 decision 3). Every case below asserts the
 * DENY side, because default-deny is the whole property.
 */

const ASOF = new Date("2026-09-01T00:00:00Z");

function shelter(over: Partial<ShelterEntry> & { slug: string }): ShelterEntry {
  return {
    name: over.slug,
    siteUrl: "https://example.org",
    listingsUrl: "https://example.org/adopt",
    tier: "first-party-scrape",
    goldenFixture: null,
    grants: [],
    ...over,
  };
}

const grant = (over: Partial<ShelterEntry["grants"][number]> = {}) => ({
  permission: "display" as const,
  granter: "Dana Ruiz, director",
  grantedAt: "2026-08-01",
  basis: "you can put our dogs on your site",
  evidence: "doc/consent/example.md",
  ...over,
});

const CONSENTED = [shelter({ slug: "happy-tails", grants: [grant()] })];
const row = (source: Source, animalId = 1) => ({ animalId, source });

describe("a date we cannot read is not a license", () => {
  it("denies an unparseable grantedAt instead of licensing all of history", () => {
    // `Date.parse` returns NaN and every NaN comparison is false, so an
    // unguarded `grantedAt > asOf` check skips and the window reads open
    // forever — a typo'd consent date would license a shelter's prose.
    const typo = [shelter({ slug: "happy-tails", grants: [grant({ grantedAt: "next tuesday" })] })];
    expect(isDisplayLicensed("scrape:happy-tails", ASOF, typo)).toBe(false);
    expect(isDisplayLicensed("scrape:happy-tails", new Date("1900-01-01"), typo)).toBe(false);

    const typoKey: AggregatorLicense[] = [{ ...AGGREGATOR_LICENSES[0], grantedAt: "" }];
    expect(isDisplayLicensed("rescuegroups", ASOF, [], typoKey)).toBe(false);
  });

  it("denies an unparseable revokedAt — a revocation we cannot read is still a revocation", () => {
    const typo = [shelter({ slug: "happy-tails", grants: [grant({ revokedAt: "last week" })] })];
    expect(isDisplayLicensed("scrape:happy-tails", ASOF, typo)).toBe(false);
  });

  it("takes effect ON the date, in both directions", () => {
    // The boundary the doc comment calls load-bearing: revocation is
    // effective from its own date, and a grant is not retroactive.
    const day = new Date("2026-08-15T00:00:00Z");
    const revoked = [shelter({ slug: "happy-tails", grants: [grant({ revokedAt: "2026-08-15" })] })];
    expect(isDisplayLicensed("scrape:happy-tails", day, revoked)).toBe(false);

    const granted = [shelter({ slug: "happy-tails", grants: [grant({ grantedAt: "2026-08-15" })] })];
    expect(isDisplayLicensed("scrape:happy-tails", day, granted)).toBe(true);
    expect(isDisplayLicensed("scrape:happy-tails", new Date("2026-08-14T23:59:59Z"), granted)).toBe(
      false,
    );
  });

  it("holds every recorded license to an ISO date and one row per source", () => {
    expect(licenseProblems()).toEqual([]);
    expect(
      licenseProblems([
        { ...AGGREGATOR_LICENSES[0], grantedAt: "08/02/2026" },
        { ...AGGREGATOR_LICENSES[0], evidence: " " },
      ]),
    ).toEqual([
      "rescuegroups: grantedAt '08/02/2026' is not an ISO date",
      "duplicate license for 'rescuegroups'",
      "rescuegroups: license has no evidence pointer",
    ]);
  });
});

describe("aggregator-display is the key's license, never a shelter permission (ADR-0006 as amended)", () => {
  it("is not in the shelter permission list, and cannot be granted as one", () => {
    // Conflating the two is the named trap: a shelter cannot grant us the
    // aggregator's license, and our key cannot consent on a shelter's behalf.
    expect(PERMISSIONS).not.toContain("aggregator-display");
    const impostor = [shelter({ slug: "happy-tails", grants: [grant({ permission: "scrape" })] })];
    expect(isDisplayLicensed("scrape:happy-tails", ASOF, impostor)).toBe(false);
  });

  it("licenses rescuegroups from the recorded key grant", () => {
    expect(isDisplayLicensed("rescuegroups", ASOF, [])).toBe(true);
    expect(AGGREGATOR_LICENSES.every((l) => l.evidence.trim().length > 0)).toBe(true);
  });

  it("denies rescuegroups once the key license is revoked, and before it was granted", () => {
    const revoked: AggregatorLicense[] = [
      { ...AGGREGATOR_LICENSES[0], revokedAt: "2026-08-20" },
    ];
    expect(isDisplayLicensed("rescuegroups", ASOF, [], revoked)).toBe(false);
    // Asking as of a date before the grant answers what we were allowed to
    // render then, not what we are allowed to render now.
    expect(isDisplayLicensed("rescuegroups", new Date("2026-07-01"), [], AGGREGATOR_LICENSES)).toBe(
      false,
    );
  });

  it("denies a source that holds no license at all, however trusted its tier", () => {
    // `shelterluv` is tier 1 — the most trusted source there is, and licensed
    // to show nothing. Trust rank must never be read as permission.
    expect(isDisplayLicensed("shelterluv", ASOF, [])).toBe(false);
    expect(isDisplayLicensed("petango", ASOF, [])).toBe(false);
    expect(isDisplayLicensed("manual", ASOF, [])).toBe(false);
  });
});

describe("a scrape source is licensed by its shelter's display grant, or not at all", () => {
  it("allows a consented shelter's own source", () => {
    expect(isDisplayLicensed("scrape:happy-tails", ASOF, CONSENTED)).toBe(true);
  });

  it("denies against the real registry when the caller passes none", () => {
    // The shape every page will call: no registry argument, so the checked-in
    // (and today empty) SHELTERS applies. Defaulting to allow here would
    // license every scraped shelter at once.
    expect(isDisplayLicensed("scrape:happy-tails")).toBe(false);
    expect(pickLicensedDisplay([row("scrape:happy-tails")])).toBeNull();
  });

  it("denies an unknown shelter — an entry we never wrote is not consent", () => {
    expect(isDisplayLicensed("scrape:never-heard-of-them", ASOF, CONSENTED)).toBe(false);
  });

  it("denies a shelter whose grant is revoked, or not yet granted as of the render", () => {
    const revoked = [
      shelter({ slug: "happy-tails", grants: [grant({ revokedAt: "2026-08-15" })] }),
    ];
    expect(isDisplayLicensed("scrape:happy-tails", ASOF, revoked)).toBe(false);
    expect(isDisplayLicensed("scrape:happy-tails", new Date("2026-07-15"), CONSENTED)).toBe(false);
  });

  it("denies a shelter that consented to being scraped but not to being shown", () => {
    // Three separate gates: crawling is not displaying (ADR-0006 as amended).
    const scrapeOnly = [
      shelter({ slug: "happy-tails", grants: [grant({ permission: "scrape" })] }),
    ];
    expect(isDisplayLicensed("scrape:happy-tails", ASOF, scrapeOnly)).toBe(false);
  });

  it("denies a malformed scrape source rather than reading past the prefix", () => {
    expect(isDisplayLicensed("scrape:Happy_Tails" as Source, ASOF, CONSENTED)).toBe(false);
    expect(isDisplayLicensed("scrape:" as Source, ASOF, CONSENTED)).toBe(false);
  });
});

describe("pickLicensedDisplay — a row we merely hold is not a row we may render", () => {
  it("refuses a set of rows spanning two animals rather than picking one", () => {
    const rows = [row("rescuegroups", 1), row("rescuegroups", 2)];
    expect(() => pickLicensedDisplay(rows, ASOF, CONSENTED)).toThrow(/more than one animal/);
  });

  it("returns null when nothing on the animal is licensed", () => {
    expect(pickLicensedDisplay([row("scrape:happy-tails")], ASOF, [])).toBeNull();
    expect(pickLicensedDisplay([], ASOF, CONSENTED)).toBeNull();
  });

  it("picks the licensed row and never falls through to an unlicensed one", () => {
    const rows = [row("scrape:no-consent"), row("rescuegroups")];
    expect(pickLicensedDisplay(rows, ASOF, CONSENTED)?.source).toBe("rescuegroups");
  });

  it("prefers the shelter's own words over the aggregator's copy of them", () => {
    const rows = [row("rescuegroups"), row("scrape:happy-tails")];
    expect(pickLicensedDisplay(rows, ASOF, CONSENTED)?.source).toBe("scrape:happy-tails");
  });

  it("drops back to the aggregator when the shelter's grant is revoked", () => {
    const revoked = [
      shelter({ slug: "happy-tails", grants: [grant({ revokedAt: "2026-08-15" })] }),
    ];
    const rows = [row("rescuegroups"), row("scrape:happy-tails")];
    expect(pickLicensedDisplay(rows, ASOF, revoked)?.source).toBe("rescuegroups");
  });

  it("returns null for every row once both licenses end", () => {
    const revokedKey: AggregatorLicense[] = [{ ...AGGREGATOR_LICENSES[0], revokedAt: "2026-08-20" }];
    const rows = [row("rescuegroups"), row("scrape:happy-tails")];
    expect(pickLicensedDisplay(rows, ASOF, [], revokedKey)).toBeNull();
  });
});
