import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acronymsOf, formatEin, labelMatchesName, matchConfidence, matchEin, normalizeOrgName, parseBmfCsv, websiteLabel } from "@/core/outreach/ein-match";

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
    expect(ROWS).toHaveLength(12);
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
    expect(first({ name: "PAWS Chicago", city: "Chicago", state: "IL" }).slice(0, 2)).toEqual(["PAWS CHICAGO", "PAWS CHICAGO FOUNDATION"]);
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

  it("finds a body filed under its acronym — ARF for Animal Rescue Foundation (ARF-IL) — and says so", () => {
    const candidates = matchEin({ name: "Animal Rescue Foundation (ARF-IL)", city: "Wheaton", state: "IL" }, ROWS);
    expect(candidates[0].row.name).toBe("ARF");
    expect(candidates[0].ein).toBe("36-4236669");
    expect(candidates[0].reasons).toContain("acronym ARF");
    expect(candidates[0].via).toBe("name");
    expect(matchConfidence(candidates)).toBe("strong");
    expect(acronymsOf("Animal Rescue Foundation (ARF-IL)", "IL")).toEqual(["ARF"]);
    expect(acronymsOf("PAWS Chicago")).toEqual(["PC"]);
    expect(normalizeOrgName("A R F ANIMAL RESCUE")).toEqual(["ARF", "ANIMAL", "RESCUE"]);
    // An acronym must lead a short IRS name: CARE as a word inside a long one is not Community Animal Rescue Effort.
    const care = matchEin({ name: "Community Animal Rescue Effort", city: "Skokie", state: "IL" }, [
      ...ROWS,
      { ...ROWS[0], ein: "362327294", name: "TURNING POINT BEHAVIORAL HEALTH CARE CENTER", city: "SKOKIE", ntee: "F32" },
    ]);
    expect(care.map((c) => c.row.name)).not.toContain("TURNING POINT BEHAVIORAL HEALTH CARE CENTER");
  });

  it("finds the legal name through the listing's own website — touchedbyananimal.org for Cats-Are-Purrsons-Too — and ignores a platform's domain", () => {
    const candidates = matchEin({ name: "Cats-Are-Purrsons-Too", city: "Chicago", state: "IL", website: "http://www.touchedbyananimal.org" }, ROWS);
    expect(candidates[0].row.name).toBe("TOUCHED BY AN ANIMAL");
    expect(candidates[0].ein).toBe("36-4204496");
    expect(candidates[0].reasons).toContain("website touchedbyananimal");
    expect(matchConfidence(candidates)).toBe("strong");
    // Without the site, the name shares nothing and the city pool is all there is.
    expect(matchEin({ name: "Cats-Are-Purrsons-Too", city: "Chicago", state: "IL" }, ROWS).every((c) => c.via === "nearby")).toBe(true);

    expect(websiteLabel("http://www.touchedbyananimal.org/adopt", "IL")).toBe("touchedbyananimal");
    expect(websiteLabel("https://www.arf-il.org", "IL")).toBe("arf");
    expect(websiteLabel("https://www.facebook.com/WorldClassFelineCompanions?ref=hl")).toBeNull();
    expect(websiteLabel("http://wow.rescuegroups.org")).toBeNull();
    expect(websiteLabel("https://linktr.ee/guttercatadoptions")).toBeNull();
    expect(websiteLabel("n/a")).toBeNull();
    expect(websiteLabel(null)).toBeNull();

    expect(labelMatchesName("touchedbyananimal", "TOUCHED BY AN ANIMAL INC")).toBe(true);
    expect(labelMatchesName("animalhouseshelter", "ANIMAL HOUSE SHELTER INC")).toBe(true);
    expect(labelMatchesName("arf", "ARF")).toBe(true);
    // A short label never claims a long name that merely starts with it.
    expect(labelMatchesName("aurora", "AURORA CARES ANIMAL FOUNDATION INC")).toBe(false);
    expect(labelMatchesName("palsplacerescue", "PALS PLACE FOUNDATION")).toBe(false);
    // The label beginning with a short name is not a match: projecthopearf.org is not every Project Hope Inc.
    expect(labelMatchesName("projecthopearf", "PROJECT HOPE INC")).toBe(false);
  });

  it("offers the animal-related bodies in the listing's own city after the named ones, marked as such, and calls the match weak", () => {
    const candidates = matchEin({ name: "Wheaton Whiskers Collective", city: "Wheaton", state: "IL" }, ROWS);
    expect(candidates.map((c) => [c.row.name, c.via])).toEqual([
      ["ARF", "nearby"],
      ["ST SOPHIAS FORGOTTEN FELINES", "nearby"],
    ]);
    expect(candidates[0].reasons[0]).toContain("in the listing's city");
    expect(matchConfidence(candidates)).toBe("weak");
    expect(matchConfidence([])).toBe("none");
    // No city, no pool: the file is one state's, and a state is not a neighbourhood.
    expect(matchEin({ name: "Wheaton Whiskers Collective", city: null, state: "IL" }, ROWS)).toEqual([]);
  });

  it("names nothing for a shelter the file does not hold, never its least-wrong neighbour — only the city's animal bodies, marked", () => {
    const byName = (q: Parameters<typeof matchEin>[0]) => matchEin(q, ROWS).filter((c) => c.via === "name").map((c) => c.row.name);
    expect(byName({ name: "Sunny Meadows Horse Sanctuary", city: "Elmwood", state: "IL" })).toEqual([]);
    // One shared word ("Elmwood") with three rows is not a candidate.
    expect(byName({ name: "Elmwood Cat Haven", city: "Elmwood", state: "IL" })).toEqual([]);
    // What does come back is Elmwood's animal-related bodies, each saying why it is there, never the historical society.
    const offered = matchEin({ name: "Elmwood Cat Haven", city: "Elmwood", state: "IL" }, ROWS);
    expect(offered.map((c) => [c.row.name, c.via])).toEqual([
      ["ANIMAL WELFARE LEAGUE OF ELMWOOD", "nearby"],
      ["FRIENDS OF THE ELMWOOD DOG PARK", "nearby"],
      ["ST HUBERT'S COMPANIONS, INC", "nearby"],
    ]);
    expect(first({ name: "Sunny Meadows Horse Sanctuary", city: "Springfield", state: "IL" })).toEqual([]);
  });
});
