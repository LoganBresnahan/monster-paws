import { describe, expect, it } from "vitest";
import { browseSearch, DEFAULT_SORT, NO_FILTERS, parseRadius } from "@/core/facets";
import { milesBetween, zipPoint, zipsWithin } from "@/core/geo";

// The zip radius (ADR-0015 as amended 2026-10-26): Census ZCTA centres, and
// for a zip the Census does not map — a PO Box — the nearest mapped zip
// sharing its first three digits.
describe("zip places and distances", () => {
  it("places a mapped zip, and measures miles between two", () => {
    const lincolnPark = zipPoint("60614")!;
    const evanston = zipPoint("60201")!;
    expect(lincolnPark.lat).toBeCloseTo(41.92, 1);
    // Lincoln Park to Evanston is about 8 miles by map, centre to centre.
    expect(milesBetween(lincolnPark, evanston)).toBeGreaterThan(5);
    expect(milesBetween(lincolnPark, evanston)).toBeLessThan(11);
  });

  it("places a PO Box zip near its sectional center, and never outside it", () => {
    // 95106 is a San Jose PO Box zip with no ZCTA; it lands in San Jose, not elsewhere.
    const poBox = zipPoint("95106")!;
    expect(poBox).not.toBeNull();
    expect(milesBetween(poBox, zipPoint("95110")!)).toBeLessThan(15);
    expect(zipPoint("00000")).toBeNull();
    expect(zipPoint("6061")).toBeNull();
  });

  it("keeps only the candidates inside the radius, a zip+4 by its first five", () => {
    const origin = zipPoint("60614")!;
    expect(zipsWithin(origin, 25, ["60614", "60201", "90210", "99999"])).toEqual(["60614", "60201"]);
    expect(zipPoint("60614-1234")).toEqual(zipPoint("60614"));
  });
});

describe("browse URLs", () => {
  it("writes only what differs from the defaults, and miles only beside a zip", () => {
    const base = { ...NO_FILTERS, zip: null, miles: parseRadius(null), shelter: null, sort: DEFAULT_SORT };
    expect(browseSearch(base).toString()).toBe("");
    expect(browseSearch({ ...base, miles: 50 }).toString()).toBe("");
    expect(browseSearch({ ...base, age: "Senior", zip: "60614", miles: 50, shelter: "s1" }).toString()).toBe(
      "age=Senior&zip=60614&miles=50&shelter=s1",
    );
    expect(parseRadius("7")).toBe(25);
  });
});
