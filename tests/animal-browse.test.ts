import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BROWSE_EXCLUSIONS,
  BROWSE_PAGE_SIZE,
  NO_FILTERS,
  NO_SCOPE,
  encodeCursor,
  facetOptions,
  loadBrowsePage,
  loadCardDisplay,
  loadFacetGrid,
  loadShelter,
  loadShelterZips,
  parseCursor,
  parseSort,
  pickRandomAnimalId,
  type BrowseExclusion,
} from "@/core/browse";
import { loadAnimalDetail } from "@/core/animals";
import type { ShelterExclusion } from "@/core/shelters";
import type { Source } from "@/core/sources";
import { closeDb, type Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateCorpus } from "./support/db";

/**
 * What browse is allowed to show, and in what order (ADR-0015 as amended).
 * The properties here are the ones a render cannot show you: that the keyset
 * window neither skips nor repeats an animal when the set changes underneath
 * it, that the curated exclusion sits BESIDE the visibility predicate rather
 * than inside it, and that a filter is only ever offered for a value the
 * corpus holds.
 */

const NOW = new Date("2026-03-15T12:00:00Z");
const AGG: Source = "rescuegroups";
/** `aggregator-display` was granted 2026-08-02 — a display pick before that date is unlicensed. */
const LICENSED = new Date("2026-09-04T12:00:00Z");

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/** The four excluded ids all sit at the head of the sort, so the fixture puts its own there too. */
const EXCLUSION: BrowseExclusion = {
  source: AGG,
  externalId: "admin-1",
  name: "ADOPTION-Read First",
  why: "a fixture standing in for the real administrative listings",
};

describe("ADR-0015 browse sort (as amended 2026-10-05)", () => {
  it("defaults to newest, and treats an unknown or missing value as the default", () => {
    expect(parseSort("longest")).toBe("longest");
    expect(parseSort("newest")).toBe("newest");
    for (const raw of [null, undefined, "", "LONGEST", "cutest"]) expect(parseSort(raw)).toBe("newest");
  });
});

describe("ADR-0015 browse cursor", () => {
  it("round-trips a row's sort key", () => {
    const cursor = { listedAt: new Date("2013-04-27T00:00:00.000Z"), id: 63963 };
    expect(parseCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each(["", "nonsense", "2013-04-27T00:00:00.000Z", ",12", "2013-04-27T00:00:00.000Z,x", "not-a-date,12"])(
    "reads %o as page one rather than as an error",
    (raw) => {
      // A cursor is a shared URL and a full canonical rebuild breaks every one
      // in the wild — that must cost a reader a page of animals, not a 500.
      expect(parseCursor(raw)).toBeNull();
    },
  );

  it("keeps the exclusion list keyed by source and external id, never by our own ids", () => {
    // `animals.id` is reassigned by a canonical rebuild, so an id list would
    // silently start hiding six animals chosen at random.
    for (const exclusion of BROWSE_EXCLUSIONS) {
      expect(exclusion.externalId).toMatch(/^\d+$/);
      expect(exclusion.why.trim()).not.toBe("");
    }
  });
});

describe.skipIf(SKIP_DB_TESTS)("ADR-0015 browse page", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  interface Seed {
    name: string;
    listedAt: Date | null;
    species?: string;
    state?: string | null;
    externalId?: string;
    status?: string | null;
    lastSeenAt?: Date;
    sourceUpdatedAt?: Date | null;
    age?: string;
    sex?: string;
    shelter?: string;
    org?: string;
    zip?: string;
  }

  async function seed(rows: Seed[]): Promise<Map<string, number>> {
    const ids = new Map<string, number>();
    for (const [i, row] of rows.entries()) {
      const [animal] = await db
        .insert(animals)
        .values({
          name: row.name,
          species: row.species ?? "dog",
          status: row.status === undefined ? "available" : row.status,
          state: row.state === undefined ? "TX" : row.state,
          listedAt: row.listedAt,
          ageGroup: row.age ?? null,
          sex: row.sex ?? null,
          shelterExternalId: row.shelter ?? null,
          orgName: row.org ?? null,
          postalCode: row.zip ?? null,
        })
        .returning({ id: animals.id });
      await db.insert(animalIdentities).values({
        animalId: animal.id,
        source: AGG,
        externalId: row.externalId ?? `rg-${i}`,
        lastSeenAt: row.lastSeenAt ?? daysBefore(1),
        sourceUpdatedAt: row.sourceUpdatedAt === undefined ? daysBefore(30) : row.sourceUpdatedAt,
      });
      ids.set(row.name, animal.id);
    }
    return ids;
  }

  function names(page: { animals: { name: string }[] }): string[] {
    return page.animals.map((a) => a.name);
  }

  it("sorts newest-listed first by default, and longest-listed first on request", async () => {
    await seed([
      { name: "New", listedAt: new Date("2025-01-01T00:00:00Z") },
      { name: "Ancient", listedAt: new Date("2009-01-01T00:00:00Z") },
      { name: "Middle", listedAt: new Date("2018-01-01T00:00:00Z") },
    ]);
    expect(names(await loadBrowsePage(db, NO_FILTERS, null, NOW, []))).toEqual(["New", "Middle", "Ancient"]);
    expect(names(await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "longest"))).toEqual([
      "Ancient",
      "Middle",
      "New",
    ]);
  });

  // Descending puts a null date FIRST in Postgres: an undated animal would lead
  // the newest page (ADR-0015 as amended 2026-10-05).
  it("never opens newest-first on an animal no source dated", async () => {
    await seed([
      { name: "Dated", listedAt: new Date("2025-01-01T00:00:00Z") },
      { name: "Undated", listedAt: null },
    ]);
    expect(names(await loadBrowsePage(db, NO_FILTERS, null, NOW, []))).toEqual(["Dated"]);
  });

  it("pages newest-first by keyset without skipping or repeating", async () => {
    const listed = (n: number) => new Date(`20${10 + n}-01-01T00:00:00Z`);
    await seed(Array.from({ length: 6 }, (_, i) => ({ name: `A${i}`, listedAt: listed(i) })));
    const first = await loadBrowsePage(db, NO_FILTERS, null, NOW, []);
    const boundary = first.animals[2];
    const next = await loadBrowsePage(db, NO_FILTERS, { listedAt: boundary.listedAt!, id: boundary.id }, NOW, []);
    expect(names(first)).toEqual(["A5", "A4", "A3", "A2", "A1", "A0"]);
    expect(names(next)).toEqual(["A2", "A1", "A0"]);
  });

  it("hides an animal the one visibility predicate hides", async () => {
    await seed([
      { name: "Adopted", listedAt: daysBefore(400), status: "adopted" },
      { name: "Unseen", listedAt: daysBefore(401), lastSeenAt: daysBefore(30) },
      { name: "Abandoned", listedAt: daysBefore(402), sourceUpdatedAt: daysBefore(800) },
      { name: "Unmaintained", listedAt: daysBefore(403), sourceUpdatedAt: null },
      { name: "Real", listedAt: daysBefore(404) },
    ]);
    const page = await loadBrowsePage(db, NO_FILTERS, null, NOW, []);
    expect(names(page)).toEqual(["Real"]);
  });

  it("pages by keyset without skipping or repeating when a row is adopted out mid-window", async () => {
    const listed = (n: number) => new Date(`20${10 + n}-01-01T00:00:00Z`);
    const ids = await seed(
      Array.from({ length: 6 }, (_, i) => ({ name: `A${i}`, listedAt: listed(i) })),
    );

    const first = await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "longest");
    const boundary = first.animals[2];
    // Whoever is left of the boundary is gone by the time the reader clicks —
    // exactly what an offset window turns into a silently skipped animal.
    await db
      .update(animals)
      .set({ status: "adopted" })
      .where(eq(animals.id, ids.get("A1")!));

    const next = await loadBrowsePage(
      db,
      NO_FILTERS,
      { listedAt: boundary.listedAt!, id: boundary.id },
      NOW,
      [],
      "longest",
    );
    expect(names(first)).toEqual(["A0", "A1", "A2", "A3", "A4", "A5"]);
    expect(names(next)).toEqual(["A3", "A4", "A5"]);
  });

  it("uses the id as the tiebreaker so a shared listing date cannot straddle the cursor", async () => {
    // The 2026-08-25 backfill wrote thousands of rows sharing a timestamp: a
    // cursor without a unique tiebreaker skips or repeats inside the tie group.
    const same = new Date("2015-06-01T00:00:00Z");
    await seed([
      { name: "Tie A", listedAt: same },
      { name: "Tie B", listedAt: same },
      { name: "Tie C", listedAt: same },
    ]);
    const all = await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "longest");
    const second = all.animals[1];
    const next = await loadBrowsePage(db, NO_FILTERS, { listedAt: same, id: second.id }, NOW, [], "longest");
    expect(names(next)).toEqual(["Tie C"]);
  });

  it("fills a page and reports a cursor only while another animal is behind it", async () => {
    // BROWSE_PAGE_SIZE + 1 rows: the probe row is what says "there is more"
    // without a second count over the same predicate.
    await seed(
      Array.from({ length: BROWSE_PAGE_SIZE + 1 }, (_, i) => ({
        name: `A${String(i).padStart(2, "0")}`,
        listedAt: new Date(NOW.getTime() - (BROWSE_PAGE_SIZE + 1 - i) * 24 * 60 * 60 * 1000),
      })),
    );

    const first = await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "longest");
    expect(first.animals).toHaveLength(BROWSE_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const last = await loadBrowsePage(db, NO_FILTERS, parseCursor(first.nextCursor), NOW, [], "longest");
    expect(names(last)).toEqual([`A${BROWSE_PAGE_SIZE}`]);
    expect(last.nextCursor).toBeNull();
  });

  // "Surprise me" (ADR-0015 as amended 2026-10-05): the same conditions as the
  // page, so a roll can never open an animal browse would hide.
  it("picks a random animal only from what the filtered browse would show", async () => {
    const ids = await seed([
      { name: "Visible pig", listedAt: daysBefore(10), species: "pig", state: "WV" },
      { name: "Adopted pig", listedAt: daysBefore(11), species: "pig", state: "WV", status: "adopted" },
      { name: "Abandoned pig", listedAt: daysBefore(12), species: "pig", state: "WV", sourceUpdatedAt: daysBefore(800) },
      { name: "Dog", listedAt: daysBefore(13), species: "dog", state: "WV" },
    ]);
    for (let roll = 0; roll < 20; roll++) {
      expect(await pickRandomAnimalId(db, { ...NO_FILTERS, species: "pig" }, NOW, [])).toBe(ids.get("Visible pig"));
    }
    expect(await pickRandomAnimalId(db, { ...NO_FILTERS, species: "pig", state: "TX" }, NOW, [])).toBeNull();
  });

  // Previous (ADR-0015 as amended 2026-10-05): a shared deep link has no Back.
  for (const sort of ["newest", "longest"] as const) {
    it(`walks back from page two to exactly page one (${sort})`, async () => {
      await seed(
        Array.from({ length: BROWSE_PAGE_SIZE + 5 }, (_, i) => ({
          name: `A${String(i).padStart(2, "0")}`,
          listedAt: new Date(NOW.getTime() - (i + 1) * 24 * 60 * 60 * 1000),
        })),
      );
      const one = await loadBrowsePage(db, NO_FILTERS, null, NOW, [], sort);
      expect(one.prevCursor).toBeNull();
      const two = await loadBrowsePage(db, NO_FILTERS, { after: parseCursor(one.nextCursor)! }, NOW, [], sort);
      expect(two.animals).toHaveLength(5);
      expect(two.nextCursor).toBeNull();

      const back = await loadBrowsePage(db, NO_FILTERS, { before: parseCursor(two.prevCursor)! }, NOW, [], sort);
      expect(names(back)).toEqual(names(one));
      expect(back.prevCursor).toBeNull();
      expect(back.nextCursor).toBe(one.nextCursor);
      // The teaser under Next names the next page's first animals, however the reader arrived.
      expect(one.nextNames).toEqual(names(two).slice(0, 3));
      expect(back.nextNames).toEqual(names(two).slice(0, 3));
      expect(two.nextNames).toEqual([]);
    });
  }

  it("offers no Previous once every animal above the page has left", async () => {
    const ids = await seed(
      Array.from({ length: 3 }, (_, i) => ({ name: `A${i}`, listedAt: new Date(`201${i}-01-01T00:00:00Z`) })),
    );
    const top = await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "longest");
    const cursor = { listedAt: top.animals[0].listedAt!, id: top.animals[0].id };
    await db.update(animals).set({ status: "adopted" }).where(eq(animals.id, ids.get("A0")!));
    const rest = await loadBrowsePage(db, NO_FILTERS, { after: cursor }, NOW, [], "longest");
    expect(names(rest)).toEqual(["A1", "A2"]);
    expect(rest.prevCursor).toBeNull();
  });

  it("filters by species and state", async () => {
    await seed([
      { name: "Texas dog", listedAt: daysBefore(10), species: "dog", state: "TX" },
      { name: "Texas cat", listedAt: daysBefore(11), species: "cat", state: "TX" },
      { name: "Nevada dog", listedAt: daysBefore(12), species: "dog", state: "NV" },
    ]);
    const page = await loadBrowsePage(db, { ...NO_FILTERS, species: "dog", state: "TX" }, null, NOW, []);
    expect(names(page)).toEqual(["Texas dog"]);
  });

  it("drops a curated non-animal listing from browse while its detail page still resolves", async () => {
    // The exclusion composes BESIDE `visibleAnimals`, never inside it: a detail
    // page linked from anywhere must still resolve (ADR-0015 decision 2), and
    // the real fix is ADR-0021's verdict, not this list.
    const ids = await seed([
      { name: "ADOPTION-Read First", listedAt: daysBefore(6000), externalId: "admin-1" },
      { name: "Rex", listedAt: daysBefore(5000), externalId: "rg-real" },
    ]);
    const page = await loadBrowsePage(db, NO_FILTERS, null, NOW, [EXCLUSION]);
    expect(names(page)).toEqual(["Rex"]);
    expect(await loadAnimalDetail(db, ids.get("ADOPTION-Read First")!, NOW)).not.toBeNull();
  });

  it("drops every listing of a shelter that opted out — browse, detail, random and the shelter view alike (ADR-0029 §5)", async () => {
    // The opposite of the browse exclusion above: a shelter's "take our
    // listings down" composes INSIDE `visibleAnimals`, so no page can reach
    // its animals by any route — including the detail page a reader has
    // bookmarked. An animal with no organisation key is untouched.
    const optOut: ShelterExclusion = {
      shelterExternalId: "rescuegroups:org:77",
      name: "Quiet Hollow Rescue",
      askedBy: "a fixture standing in for the shelter's director",
      askedAt: "2026-03-10",
      evidence: "doc/consent/fixture-quiet-hollow-2026-03-10.md",
    };
    const ids = await seed([
      { name: "Hidden", listedAt: daysBefore(1), shelter: "rescuegroups:org:77", org: "Quiet Hollow Rescue" },
      { name: "Rex", listedAt: daysBefore(2), shelter: "rescuegroups:org:78", org: "Other Rescue" },
      { name: "Orphan", listedAt: daysBefore(3), shelter: undefined },
    ]);
    const excl = [optOut];
    expect(names(await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "newest", NO_SCOPE, excl))).toEqual(["Rex", "Orphan"]);
    expect(await loadAnimalDetail(db, ids.get("Hidden")!, NOW, excl)).toBeNull();
    expect(await loadAnimalDetail(db, ids.get("Orphan")!, NOW, excl)).not.toBeNull();
    const scope = { shelter: "rescuegroups:org:77", zips: null };
    for (let roll = 0; roll < 5; roll++) {
      expect(await pickRandomAnimalId(db, NO_FILTERS, NOW, [], scope, excl)).toBeNull();
    }
    expect(await loadShelter(db, "rescuegroups:org:77", NOW, [], excl)).toBeNull();
    expect(facetOptions(await loadFacetGrid(db, NOW, [], NO_SCOPE, excl), NO_FILTERS).species).toEqual([
      { value: "dog", count: 2 },
    ]);
    // And without the registry entry, the same rows are all visible: the
    // list is the only thing hiding them.
    expect(names(await loadBrowsePage(db, NO_FILTERS, null, NOW, []))).toEqual(["Hidden", "Rex", "Orphan"]);
  });

  it("offers a filter only for a value the visible corpus holds, and never the junk state", async () => {
    await seed([
      { name: "Texas dog", listedAt: daysBefore(10), species: "dog", state: "TX" },
      { name: "Texas cat", listedAt: daysBefore(11), species: "cat", state: "TX" },
      { name: "Nevada dog", listedAt: daysBefore(12), species: "dog", state: "NV" },
      // Replay cannot retract a claim, so junk states outlive the normalizer
      // that stopped asserting them — 27 animals still carry `T`.
      { name: "Junk state", listedAt: daysBefore(13), species: "dog", state: "T" },
      { name: "Hidden", listedAt: daysBefore(14), species: "iguana", state: "OR", status: "adopted" },
    ]);
    const grid = await loadFacetGrid(db, NOW, []);

    const all = facetOptions(grid, NO_FILTERS);
    expect(all.species).toEqual([
      { value: "dog", count: 3 },
      { value: "cat", count: 1 },
    ]);
    expect(all.states.map((s) => s.value)).toEqual(["NV", "TX"]);

    // Counted under the OTHER menu's selection, so "cat (1)" beside a chosen
    // state is a promise about that state.
    const inTexas = facetOptions(grid, { ...NO_FILTERS, state: "TX" });
    expect(inTexas.species).toEqual([
      { value: "cat", count: 1 },
      { value: "dog", count: 1 },
    ]);
  });

  // ADR-0015 as amended 2026-10-26: age and sex are menus like kind and state,
  // each counted under the others' picks.
  it("filters by age and sex, and counts each menu under the others", async () => {
    await seed([
      { name: "Old girl", listedAt: daysBefore(10), age: "Senior", sex: "Female" },
      { name: "Old boy", listedAt: daysBefore(11), age: "Senior", sex: "Male" },
      { name: "Pup", listedAt: daysBefore(12), age: "Baby", sex: "Female" },
    ]);
    const page = await loadBrowsePage(db, { ...NO_FILTERS, age: "Senior", sex: "Female" }, null, NOW, []);
    expect(names(page)).toEqual(["Old girl"]);

    const grid = await loadFacetGrid(db, NOW, []);
    expect(facetOptions(grid, NO_FILTERS).ages.map((a) => a.value)).toEqual(["Baby", "Senior"]);
    expect(facetOptions(grid, { ...NO_FILTERS, sex: "Female" }).ages).toEqual([
      { value: "Baby", count: 1 },
      { value: "Senior", count: 1 },
    ]);
    expect(facetOptions(grid, { ...NO_FILTERS, age: "Senior" }).sexes).toEqual([
      { value: "Female", count: 1 },
      { value: "Male", count: 1 },
    ]);
  });

  // The scope narrows the page, the menus' counts and the random pick alike.
  it("scopes browse to one shelter, and names it from its visible animals", async () => {
    const ids = await seed([
      { name: "Paws A", listedAt: daysBefore(10), shelter: "s1", org: "Paws Rescue" },
      { name: "Paws B", listedAt: daysBefore(11), shelter: "s1", org: "Paws Rescue", species: "cat" },
      { name: "Elsewhere", listedAt: daysBefore(12), shelter: "s2", org: "Other Rescue" },
      { name: "Gone", listedAt: daysBefore(13), shelter: "s1", org: "Paws Rescue", status: "adopted" },
    ]);
    const scope = { shelter: "s1", zips: null };
    expect(names(await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "newest", scope))).toEqual(["Paws A", "Paws B"]);
    expect(facetOptions(await loadFacetGrid(db, NOW, [], scope), NO_FILTERS).species).toEqual([
      { value: "cat", count: 1 },
      { value: "dog", count: 1 },
    ]);
    expect(await loadShelter(db, "s1", NOW, [])).toEqual({ id: "s1", name: "Paws Rescue", count: 2 });
    expect(await loadShelter(db, "nobody", NOW, [])).toBeNull();
    for (let roll = 0; roll < 10; roll++) {
      expect(await pickRandomAnimalId(db, { ...NO_FILTERS, species: "cat" }, NOW, [], scope)).toBe(ids.get("Paws B"));
      expect(await pickRandomAnimalId(db, NO_FILTERS, NOW, [], { shelter: "s2", zips: null })).toBe(ids.get("Elsewhere"));
    }
  });

  // A radius is a list of shelter zips, matched on the first five characters
  // (zip+4 included); an empty list is an empty page, never every animal.
  it("scopes browse to a set of zips, and a radius reaching none shows nothing", async () => {
    await seed([
      { name: "Lincoln Park", listedAt: daysBefore(10), zip: "60614" },
      { name: "Plus four", listedAt: daysBefore(11), zip: "60614-1234" },
      { name: "Far", listedAt: daysBefore(12), zip: "90210" },
    ]);
    expect(await loadShelterZips(db, NOW)).toEqual(expect.arrayContaining(["60614", "90210"]));
    const near = await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "newest", { shelter: null, zips: ["60614"] });
    expect(names(near)).toEqual(["Lincoln Park", "Plus four"]);
    const none = await loadBrowsePage(db, NO_FILTERS, null, NOW, [], "newest", { shelter: null, zips: [] });
    expect(names(none)).toEqual([]);
  });

  it("gives a card its photo only from a licensed display row", async () => {
    const ids = await seed([
      { name: "Rex", listedAt: daysBefore(10) },
      { name: "Ghost", listedAt: daysBefore(11) },
    ]);
    await db.insert(animalDisplay).values([
      {
        animalId: ids.get("Rex")!,
        source: AGG,
        photos: [{ url: "https://cdn.example/rex.jpg", width: 500, height: 400 }],
        fetchedAt: NOW,
      },
      {
        // A scrape source with no display grant: held, never rendered.
        animalId: ids.get("Ghost")!,
        source: "scrape:nobody" as Source,
        photos: [{ url: "https://cdn.example/ghost.jpg", width: 500, height: 400 }],
        fetchedAt: NOW,
      },
    ]);

    // After 2026-08-02, when `aggregator-display` was granted: the picker is
    // asked whether a license held AT a moment, so a display assertion dated
    // before the grant is testing the window, not the pick.
    const display = await loadCardDisplay(db, [ids.get("Rex")!, ids.get("Ghost")!], LICENSED);
    expect(display.get(ids.get("Rex")!)?.photos[0].url).toBe("https://cdn.example/rex.jpg");
    expect(display.get(ids.get("Ghost")!)).toBeUndefined();
  });
});
