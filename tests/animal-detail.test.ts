import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lastSeenOf, loadAnimalDetail } from "@/core/animals";
import type { Source } from "@/core/sources";
import { closeDb, type Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateCorpus } from "./support/db";

/**
 * What the detail page is allowed to read (ADR-0015). The loader is tested
 * rather than the page because these are the properties a render cannot show
 * you: that the visibility predicate is composed rather than reimplemented,
 * and that a disappeared source never contributes to "last checked".
 */

const NOW = new Date("2026-03-15T12:00:00Z");
const AGG: Source = "rescuegroups";
const SHELTER: Source = "shelterluv";

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function eqId(id: number) {
  return sql`${animals.id} = ${id}`;
}

describe.skipIf(SKIP_DB_TESTS)("ADR-0015 detail loader", () => {
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

  async function seedVisible(): Promise<number> {
    const [row] = await db
      .insert(animals)
      .values({ name: "Rex", species: "dog", status: "available", orgName: "Happy Tails" })
      .returning({ id: animals.id });
    await db.insert(animalIdentities).values({
      animalId: row.id,
      source: AGG,
      externalId: `rg-${row.id}`,
      lastSeenAt: daysBefore(1),
      sourceUpdatedAt: daysBefore(30),
    });
    return row.id;
  }

  it("returns the animal, its live identities and its display rows", async () => {
    const id = await seedVisible();
    await db.insert(animalDisplay).values({
      animalId: id,
      source: AGG,
      description: "A very good dog.",
      photos: [{ url: "https://cdn.example.org/rex.jpg", width: 500, height: 400 }],
      listingOrg: "Happy Tails",
      trackerUrl: "https://track.example.org/rex.gif",
      fetchedAt: daysBefore(1),
    });

    const detail = await loadAnimalDetail(db, id, NOW);
    expect(detail?.animal.name).toBe("Rex");
    expect(detail?.identities).toHaveLength(1);
    expect(detail?.display[0].description).toBe("A very good dog.");
  });

  // The 404 (ADR-0015 decision 2). If this ever returns a row, the page is
  // serving a card for an animal we can no longer vouch for.
  it("returns null for an animal browse would not show", async () => {
    const id = await seedVisible();
    await db.update(animals).set({ status: "adopted" }).where(eqId(id));
    expect(await loadAnimalDetail(db, id, NOW)).toBeNull();
  });

  it("returns null for an id that does not exist", async () => {
    expect(await loadAnimalDetail(db, 987654321, NOW)).toBeNull();
  });

  it("drops a disappeared identity, so 'last checked' cannot come from one", async () => {
    const id = await seedVisible();
    await db.insert(animalIdentities).values({
      animalId: id,
      source: SHELTER,
      externalId: `sl-${id}`,
      lastSeenAt: NOW,
      disappearedAt: NOW,
      sourceUpdatedAt: NOW,
    });

    const detail = await loadAnimalDetail(db, id, NOW);
    expect(detail?.identities.map((i) => i.source)).toEqual([AGG]);
    expect(lastSeenOf(detail!.identities)).toEqual(daysBefore(1));
  });
});

describe("lastSeenOf", () => {
  it("is the newest live sighting, and null when nothing is live", () => {
    expect(lastSeenOf([])).toBeNull();
    expect(
      lastSeenOf([{ lastSeenAt: daysBefore(9) }, { lastSeenAt: daysBefore(2) }]),
    ).toEqual(daysBefore(2));
  });
});
