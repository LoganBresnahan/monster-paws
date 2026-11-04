import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import BrowsePage from "@/app/animals/page";
import { closeDb, type Db } from "@/db/client";
import { animalIdentities, animals, shelterNonprofits } from "@/db/schema";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateCorpus, truncateDonor } from "./support/db";

/**
 * /animals as a visitor gets it, over the real queries: the sponsorable shelter e2e can't have,
 * because a grant lives in the registry and its seed has none (ADR-0015 as amended 2026-11-04).
 */

const OPEN = "rescuegroups:org:open";
const OTHER = "rescuegroups:org:other";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {} }) }));
// A fixture's grant, so a real shelter withdrawing can't change what this pins.
vi.mock("@/core/shelters", async (actual) => ({
  ...(await actual<typeof import("@/core/shelters")>()),
  SHELTERS: [
    {
      slug: "open-shelter",
      name: "Open Shelter",
      siteUrl: "https://open.example",
      listingsUrl: "https://open.example/animals",
      tier: "aggregator",
      goldenFixture: null,
      shelterExternalIds: ["rescuegroups:org:open"],
      grants: [{ permission: "digify", grantedAt: "2026-01-01", granter: "A. Director", basis: "yes", evidence: "fixture" }],
    },
  ],
}));

const RECENT = new Date(Date.now() - 24 * 60 * 60 * 1000);
/** Listed oldest of the three, so only the group can put it first. */
const CORPUS = [
  { name: "Newest", species: "cat", state: "CA", ageGroup: "Senior", sex: "Female", shelterExternalId: null, listedAt: new Date("2026-03-03T00:00:00Z") },
  { name: "Middle", species: "dog", state: "TX", ageGroup: "Baby", sex: "Male", shelterExternalId: OTHER, listedAt: new Date("2026-02-02T00:00:00Z") },
  { name: "Oldest", species: "dog", state: "IL", ageGroup: "Adult", sex: "Male", shelterExternalId: OPEN, listedAt: new Date("2026-01-01T00:00:00Z") },
];
const BY_DATE = ["Newest", "Middle", "Oldest"];
const TWO_SORTS = ["Newest first", "Longest waiting"];
const THREE_SORTS = ["Sponsorable first", ...TWO_SORTS];
const TODAY_LINE = "Newest listings first";
const LEADING_LINE = "Animals you can sponsor first, then the newest listings.";

describe.skipIf(SKIP_DB_TESTS)("/animals, rendered (ADR-0015 as amended 2026-11-04)", () => {
  let db: Db;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    await truncateDonor(db);
    vi.stubEnv("EVERYORG_ENV", "production");
    vi.stubEnv("EVERYORG_WEBHOOK_TOKEN", "test-token");
    for (const [i, row] of CORPUS.entries()) {
      const [animal] = await db.insert(animals).values({ ...row, status: "available" }).returning({ id: animals.id });
      await db.insert(animalIdentities).values({
        animalId: animal.id,
        source: "rescuegroups",
        externalId: `rg-${i}`,
        lastSeenAt: RECENT,
        sourceUpdatedAt: RECENT,
      });
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await closeDb();
  });

  const claim = (shelter: string, everyorgClaim: "claimed" | "unclaimed" = "claimed") =>
    db.insert(shelterNonprofits).values({
      shelterExternalId: shelter,
      everyorgSlug: "a-shelter",
      ein: "36-4219778",
      source: "test",
      fetchedAt: RECENT,
      everyorgClaim,
    });

  async function open(query: Record<string, string> = {}) {
    const html = renderToStaticMarkup(await BrowsePage({ searchParams: Promise.resolve(query) }));
    const menu = (name: string) => {
      const options = [...(html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>(.*?)</select>`, "s"))?.[1] ?? "").matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
      return { labels: options.map((o) => o[2]), picked: options.find((o) => o[1].includes("selected"))?.[2] };
    };
    const box = html.match(/<input[^>]*name="sponsorable"[^>]*>/)?.[0];
    return {
      html,
      names: [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]),
      sort: menu("sort"),
      menu,
      box: box === undefined ? "none" : box.includes("checked") ? "ticked" : "unticked",
      clear: />Clear</.test(html),
    };
  }

  describe("with nothing sponsorable it is today's page, with the control hidden", () => {
    const cases: [string, () => Promise<unknown>][] = [
      ["no Every.org config", async () => { await claim(OPEN); vi.stubEnv("EVERYORG_ENV", ""); }],
      ["no claimed row", async () => {}],
      ["an unclaimed row", () => claim(OPEN, "unclaimed").then(() => undefined)],
      ["a claimed row with no grant", () => claim(OTHER).then(() => undefined)],
      ["a sponsorable shelter with nothing visible", async () => { await claim(OPEN); await db.update(animals).set({ shelterExternalId: OTHER }).where(eq(animals.shelterExternalId, OPEN)); }],
    ];

    it.each(cases)("%s", async (_, arrange) => {
      await arrange();
      const queries: Record<string, string>[] = [{}, { sponsorable: "1" }, { sort: "sponsorable" }];
      for (const query of queries) {
        const page = await open(query);
        expect(page.box).toBe("none");
        expect(page.sort.labels).toEqual(TWO_SORTS);
        expect(page.sort.picked).toBe("Newest first");
        expect(page.html).toContain(TODAY_LINE);
        expect(page.names).toEqual(BY_DATE);
        expect(page.clear).toBe(false);
      }
    });
  });

  describe("with a sponsorable shelter", () => {
    beforeEach(async () => {
      await claim(OPEN);
    });

    it("leads the plain list with its animals, and says so", async () => {
      const page = await open();
      expect(page.names).toEqual(["Oldest", "Newest", "Middle"]);
      expect(page.sort.labels).toEqual(THREE_SORTS);
      expect(page.sort.picked).toBe("Sponsorable first");
      expect(page.html).toContain(LEADING_LINE);
      expect(page.box).toBe("unticked");
      expect(page.clear).toBe(false);
    });

    it("gives a true date order under Newest first", async () => {
      const page = await open({ sort: "newest" });
      expect(page.names).toEqual(BY_DATE);
      expect(page.sort.labels).toEqual(THREE_SORTS);
      expect(page.sort.picked).toBe("Newest first");
      expect(page.html).toContain(TODAY_LINE);
      expect(page.clear).toBe(true);
    });

    it("keeps Longest waiting as it is", async () => {
      const page = await open({ sort: "longest" });
      expect(page.names).toEqual([...BY_DATE].reverse());
      expect(page.sort.picked).toBe("Longest waiting");
    });

    it("keeps today's order, menu and line under any other filter, whatever the URL's sort says", async () => {
      const queries: Record<string, string>[] = [{ species: "dog" }, { species: "dog", sort: "sponsorable" }];
      for (const query of queries) {
        const page = await open(query);
        expect(page.names).toEqual(["Middle", "Oldest"]);
        expect(page.sort.labels).toEqual(TWO_SORTS);
        expect(page.sort.picked).toBe("Newest first");
        expect(page.html).not.toContain(LEADING_LINE);
      }
    });

    it("the ticked box shows only that shelter's animals, and recounts the menus inside it", async () => {
      const page = await open({ sponsorable: "1" });
      expect(page.box).toBe("ticked");
      expect(page.names).toEqual(["Oldest"]);
      expect(page.sort.labels).toEqual(TWO_SORTS);
      expect(page.html).toContain(TODAY_LINE);
      expect(page.clear).toBe(true);
      expect(page.menu("species").labels).toEqual(["Any animal", "dog (1)"]);
      expect(page.menu("state").labels).toEqual(["Anywhere", "IL (1)"]);
    });

    // The verify chat's read of 6fbce04: "Anywhere" over an empty page reads as nothing anywhere.
    it.each([
      ["state", "CA", "CA (0)"],
      ["species", "cat", "cat (0)"],
      ["age", "Senior", "Senior (0)"],
      ["sex", "Female", "Female (0)"],
    ])("a %s pick the ticked box leaves empty stays in its menu at 0", async (name, value, label) => {
      const page = await open({ sponsorable: "1", [name]: value });
      expect(page.names).toEqual([]);
      expect(page.html).toContain("No animals match that yet.");
      expect(page.menu(name).picked).toBe(label);
      expect(page.box).toBe("ticked");
    });

    it("drops a value the corpus doesn't hold at all, rather than offering it at 0", async () => {
      const page = await open({ sponsorable: "1", species: "dragon" });
      expect(page.menu("species").picked).toBe("Any animal");
      expect(page.names).toEqual(["Oldest"]);
    });

    it("counts a zip it can't place as a filter: it says so, limits nothing, and can be cleared", async () => {
      const page = await open({ zip: "00000" });
      expect(page.html).toMatch(/couldn.{1,6}t place zip 00000/);
      expect(page.names).toEqual(BY_DATE);
      expect(page.sort.labels).toEqual(TWO_SORTS);
      expect(page.sort.picked).toBe("Newest first");
      expect(page.html).toMatch(/<input[^>]*name="zip"[^>]*value="00000"/);
      expect(page.clear).toBe(true);
    });

    it("doesn't take the shelters from the URL", async () => {
      const page = await open({ sponsorable: OTHER });
      expect(page.box).toBe("unticked");
      expect(page.names).toEqual(["Oldest", "Newest", "Middle"]);
    });
  });
});
