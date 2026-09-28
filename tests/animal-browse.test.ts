import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BROWSE_EXCLUSIONS,
  BROWSE_PAGE_SIZE,
  NO_FILTERS,
  encodeCursor,
  facetOptions,
  loadBrowsePage,
  loadCardDisplay,
  loadFacetGrid,
  parseCursor,
  type BrowseExclusion,
} from "@/core/browse";
import { loadAnimalDetail } from "@/core/animals";
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

  it("sorts longest-listed first, by the source's date", async () => {
    await seed([
      { name: "New", listedAt: new Date("2025-01-01T00:00:00Z") },
      { name: "Ancient", listedAt: new Date("2009-01-01T00:00:00Z") },
      { name: "Middle", listedAt: new Date("2018-01-01T00:00:00Z") },
    ]);
    const page = await loadBrowsePage(db, NO_FILTERS, null, NOW, []);
    expect(names(page)).toEqual(["Ancient", "Middle", "New"]);
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

    const first = await loadBrowsePage(db, NO_FILTERS, null, NOW, []);
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
    const all = await loadBrowsePage(db, NO_FILTERS, null, NOW, []);
    const second = all.animals[1];
    const next = await loadBrowsePage(db, NO_FILTERS, { listedAt: same, id: second.id }, NOW, []);
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

    const first = await loadBrowsePage(db, NO_FILTERS, null, NOW, []);
    expect(first.animals).toHaveLength(BROWSE_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const last = await loadBrowsePage(db, NO_FILTERS, parseCursor(first.nextCursor), NOW, []);
    expect(names(last)).toEqual([`A${BROWSE_PAGE_SIZE}`]);
    expect(last.nextCursor).toBeNull();
  });

  it("filters by species and state", async () => {
    await seed([
      { name: "Texas dog", listedAt: daysBefore(10), species: "dog", state: "TX" },
      { name: "Texas cat", listedAt: daysBefore(11), species: "cat", state: "TX" },
      { name: "Nevada dog", listedAt: daysBefore(12), species: "dog", state: "NV" },
    ]);
    const page = await loadBrowsePage(db, { species: "dog", state: "TX" }, null, NOW, []);
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
    const inTexas = facetOptions(grid, { species: null, state: "TX" });
    expect(inTexas.species).toEqual([
      { value: "cat", count: 1 },
      { value: "dog", count: 1 },
    ]);
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
