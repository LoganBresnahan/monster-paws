import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatEin, matchEin, normalizeOrgName, parseBmfCsv } from "@/core/outreach/ein-match";

/**
 * The EIN matcher over a hand-made BMF excerpt (tests/fixtures/README.md):
 * what is pinned is that the right row comes FIRST for the ways a shelter's
 * listed name differs from its legal one, and that a shelter the file does
 * not hold comes back as nothing (ADR-0029 §2). Logan confirms every match;
 * the ranking only decides what he reads first.
 */
const ROWS = parseBmfCsv(readFileSync(path.resolve("tests/fixtures/irs-bmf-sample.csv"), "utf8"));

const first = (q: Parameters<typeof matchEin>[0]) => matchEin(q, ROWS).map((c) => c.row.name);

describe("ADR-0029 IRS BMF EIN matcher", () => {
  it("reads the IRS layout, quoted names and the care-of line included", () => {
    expect(ROWS).toHaveLength(9);
    const paws = ROWS.find((r) => r.ein === "363333333")!;
    expect(paws).toMatchObject({ name: "PAWS CHICAGO", city: "CHICAGO", state: "IL", subsection: "03", ntee: "D20" });
    expect(ROWS.find((r) => r.ein === "36888888")!.name).toBe("ST HUBERT'S COMPANIONS, INC");
    expect(ROWS.find((r) => r.ein === "362222222")!.ico).toBe("% JANE DOE");
  });

  it("fails loudly on a file whose layout changed, rather than matching nothing", () => {
    expect(() => parseBmfCsv("EIN,ORGANIZATION_NAME,CITY\n1,X,Y")).toThrow(/no NAME column/);
  });

  it("prints an EIN the way the IRS and Every.org do, restoring a leading zero the file dropped", () => {
    expect(formatEin("361111111")).toBe("36-1111111");
    expect(formatEin("36888888")).toBe("03-6888888");
    expect(formatEin("36-1111111")).toBe("36-1111111");
    expect(() => formatEin("1234567890")).toThrow(/not an EIN/);
  });

  it("ignores legal form, case and punctuation, and keeps the words that tell shelters apart", () => {
    expect(normalizeOrgName("PAWS Chicago, Inc.")).toEqual(["PAWS", "CHICAGO"]);
    expect(normalizeOrgName("The Animal Welfare League of Elmwood NFP")).toEqual(["ANIMAL", "WELFARE", "LEAGUE", "ELMWOOD"]);
    expect(normalizeOrgName("Paws & Claws")).toEqual(["PAWS", "CLAWS"]);
    expect(normalizeOrgName("% JANE DOE")).toEqual(["JANE", "DOE"]);
  });

  it("puts the listed name's own row first, its near-namesake second, and never another state's", () => {
    const candidates = matchEin({ name: "Quiet Hollow Rescue", city: "Northbrook", state: "IL" }, ROWS);
    expect(candidates.map((c) => [c.row.name, c.ein])).toEqual([
      ["QUIET HOLLOW RESCUE INC", "36-1111111"],
      ["QUIET HOLLOW ANIMAL RESCUE NFP", "36-2222222"],
    ]);
    expect(candidates[0].reasons).toEqual(["same name", "same city", "NTEE D20 (animal-related)", "501(c)(3)"]);
    expect(candidates[1].reasons).toContain("in care of JANE DOE");
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
  });

  it("prefers the body to its foundation when the listing names the body", () => {
    expect(first({ name: "PAWS Chicago", city: "Chicago", state: "IL" })).toEqual(["PAWS CHICAGO", "PAWS CHICAGO FOUNDATION"]);
  });

  it("matches a listing whose words are in another order", () => {
    expect(first({ name: "Elmwood Animal Welfare League", city: "Elmwood", state: "IL" })[0]).toBe(
      "ANIMAL WELFARE LEAGUE OF ELMWOOD",
    );
  });

  it("breaks a tie on the city when the rescue files from elsewhere", () => {
    // Same words, no city: the Skokie row still ranks below the Northbrook one
    // only because the listing's city is Northbrook. Without a city, both
    // surface and the person decides.
    const noCity = matchEin({ name: "Quiet Hollow Rescue", city: null, state: "IL" }, ROWS);
    expect(noCity.map((c) => c.row.city)).toEqual(["NORTHBROOK", "SKOKIE"]);
    expect(noCity[0].reasons).not.toContain("same city");
  });

  it("returns nothing for a shelter the file does not hold, never its least-wrong neighbour", () => {
    expect(first({ name: "Sunny Meadows Horse Sanctuary", city: "Elmwood", state: "IL" })).toEqual([]);
    // One shared word ("Elmwood") with three rows is not a candidate.
    expect(first({ name: "Elmwood Cat Haven", city: "Elmwood", state: "IL" })).toEqual([]);
  });
});
