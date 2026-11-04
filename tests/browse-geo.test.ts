import { describe, expect, it } from "vitest";
import { browseSearch, DEFAULT_SORT, defaultSort, keepingDefaultSort, NO_FILTERS, parseRadius, parseSort, type BrowseQuery } from "@/core/facets";
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
    expect(browseSearch({ ...base, sponsorable: false }).toString()).toBe("");
    expect(browseSearch({ ...base, sponsorable: true }).toString()).toBe("sponsorable=1");
    expect(parseRadius("7")).toBe(25);
  });

  describe("Sponsorable first (ADR-0015 as amended 2026-11-04)", () => {
    const none: BrowseQuery = { ...NO_FILTERS, zip: null, miles: parseRadius(null), shelter: null, sort: DEFAULT_SORT };
    const open: BrowseQuery = { ...none, sponsorableFirst: true, sort: "sponsorable" };
    const dogs: BrowseQuery = { ...open, species: "dog", sort: "newest" };
    const search = (query: BrowseQuery) => browseSearch(query).toString();

    it("is the default only on a plain list that offers it", () => {
      expect(defaultSort(none)).toBe("newest");
      expect(defaultSort(open)).toBe("sponsorable");
      for (const pick of [{ species: "dog" }, { state: "IL" }, { age: "Adult" }, { sex: "Male" }, { zip: "60614" }, { shelter: "s1" }, { sponsorable: true }]) {
        expect(defaultSort({ ...open, ...pick }), JSON.stringify(pick)).toBe("newest");
      }
    });

    it("is never in a URL, and Newest first is written only where it differs from the default", () => {
      expect(search(open)).toBe("");
      expect(search({ ...open, sort: "newest" })).toBe("sort=newest");
      expect(search({ ...open, sort: "longest" })).toBe("sort=longest");
      expect(search(dogs)).toBe("species=dog");
      expect(search({ ...dogs, sort: "sponsorable" })).toBe("species=dog");
      expect(search({ ...open, sponsorableFirst: false, sort: "newest" })).toBe("");
    });

    it("is never read from a URL, so what a form without JavaScript submits falls back to the default", () => {
      expect(parseSort("sponsorable")).toBe("newest");
      expect(parseSort("sponsorable", defaultSort(open))).toBe("sponsorable");
      expect(parseSort("sponsorable", defaultSort(dogs))).toBe("newest");
      expect(parseSort(null, defaultSort(open))).toBe("sponsorable");
      expect(parseSort("newest", defaultSort(open))).toBe("newest");
      expect(parseSort("cutest", defaultSort(open))).toBe("sponsorable");
    });

    it("taking off the last filter returns to the plain list, never to a pick nobody made", () => {
      expect(keepingDefaultSort(open, { ...open, species: "dog" }).sort).toBe("newest");
      expect(keepingDefaultSort(dogs, { ...dogs, species: null }).sort).toBe("sponsorable");
      // A real pick survives a filter going on, and Longest waiting survives it coming off.
      expect(keepingDefaultSort({ ...open, sort: "newest" }, { ...open, sort: "newest", species: "dog" }).sort).toBe("newest");
      expect(keepingDefaultSort({ ...dogs, sort: "longest" }, { ...dogs, sort: "longest", species: null }).sort).toBe("longest");
      // The menu itself: from Longest waiting to a true Newest first, and back to the default.
      expect(keepingDefaultSort({ ...open, sort: "longest" }, { ...open, sort: "newest" }).sort).toBe("newest");
      expect(keepingDefaultSort({ ...open, sort: "newest" }, { ...open, sort: "sponsorable" }).sort).toBe("sponsorable");
    });

    it("changes nothing when no shelter can be sponsored", () => {
      expect(keepingDefaultSort(none, { ...none, species: "dog" }).sort).toBe("newest");
      expect(keepingDefaultSort({ ...none, species: "dog" }, none).sort).toBe("newest");
      expect(search(none)).toBe("");
    });
  });
});
