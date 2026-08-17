import { describe, expect, it } from "vitest";
import {
  FIXED_SOURCES,
  TIERS,
  isScrapeSource,
  rankOf,
  scrapeSource,
  shelterSlugOf,
  tierOf,
} from "@/core/sources";

describe("source taxonomy (ADR-0006 as amended)", () => {
  it("orders tiers shelter-api > first-party-scrape > aggregator > manual", () => {
    expect([...TIERS]).toEqual(["shelter-api", "first-party-scrape", "aggregator", "manual"]);
    expect(rankOf("shelter-api")).toBeLessThan(rankOf("first-party-scrape"));
    expect(rankOf("first-party-scrape")).toBeLessThan(rankOf("aggregator"));
    expect(rankOf("aggregator")).toBeLessThan(rankOf("manual"));
  });

  it("assigns every fixed source a tier", () => {
    for (const source of FIXED_SOURCES) {
      expect(TIERS).toContain(tierOf(source));
    }
    expect(tierOf("shelterluv")).toBe("shelter-api");
    expect(tierOf("rescuegroups")).toBe("aggregator");
  });

  it("puts a consented scrape between the shelter API and the aggregator", () => {
    const source = scrapeSource("happy-tails-rescue");
    expect(tierOf(source)).toBe("first-party-scrape");
    expect(rankOf(tierOf(source))).toBeGreaterThan(rankOf(tierOf("shelterluv")));
    expect(rankOf(tierOf(source))).toBeLessThan(rankOf(tierOf("rescuegroups")));
  });

  it("round-trips a shelter slug through the source identity", () => {
    expect(scrapeSource("happy-tails-rescue")).toBe("scrape:happy-tails-rescue");
    expect(shelterSlugOf(scrapeSource("happy-tails-rescue"))).toBe("happy-tails-rescue");
    expect(shelterSlugOf("rescuegroups")).toBeNull();
  });

  it("rejects slugs that would make a persisted source string ambiguous", () => {
    for (const bad of ["Happy-Tails", "happy tails", "happy:tails", "-leading", "trailing-", ""]) {
      expect(() => scrapeSource(bad)).toThrow(/invalid shelter slug/);
    }
    expect(isScrapeSource("scrape:happy:tails")).toBe(false);
    expect(isScrapeSource("scrape:")).toBe(false);
  });

  it("throws on an unknown source rather than defaulting it into a tier", () => {
    expect(() => tierOf("petfinder" as never)).toThrow(/unknown source/);
    expect(() => rankOf("tier-2" as never)).toThrow(/unknown tier/);
  });
});
