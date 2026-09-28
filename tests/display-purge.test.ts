import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAnimalDetail } from "@/core/animals";
import { AGGREGATOR_LICENSES, pickLicensedDisplay, type AggregatorLicense } from "@/core/display";
import { purgeDisplay } from "@/core/purge";
import type { ShelterEntry } from "@/core/shelters";
import type { Source } from "@/core/sources";
import { closeDb, type Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals, eventLog, rawPayloads } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateCorpus } from "./support/db";

/**
 * The display purge (ADR-0006 decision 4, ADR-0015): one source's display rows
 * go, and nothing else does — the append-only corpus, the facts and every other
 * source's rows survive, and the page falls back to facts.
 */

const NOW = new Date("2026-10-01T12:00:00Z");
const AGG: Source = "rescuegroups";
const SCRAPE: Source = "scrape:happy-tails";

const REVOKED: readonly AggregatorLicense[] = AGGREGATOR_LICENSES.map((l) => ({
  ...l,
  revokedAt: "2026-09-30",
}));

const REVOKED_SHELTER: ShelterEntry = {
  slug: "happy-tails",
  name: "Happy Tails",
  siteUrl: "https://happytails.example.org",
  listingsUrl: "https://happytails.example.org/adopt",
  tier: "first-party-scrape",
  goldenFixture: null,
  grants: [
    {
      permission: "display",
      granter: "Pat Example, director",
      grantedAt: "2026-09-01",
      revokedAt: "2026-09-30",
      basis: "test fixture",
      evidence: "none — test fixture",
    },
  ],
};

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe.skipIf(SKIP_DB_TESTS)("ADR-0006 display purge", () => {
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

  async function seed(): Promise<number> {
    const [row] = await db
      .insert(animals)
      .values({ name: "Rex", species: "dog", status: "available", orgName: "Happy Tails" })
      .returning({ id: animals.id });
    await db.insert(animalIdentities).values({
      animalId: row.id,
      source: AGG,
      externalId: "rg-1",
      lastSeenAt: daysBefore(1),
      sourceUpdatedAt: daysBefore(30),
    });
    await db.insert(rawPayloads).values({
      source: AGG,
      externalId: "rg-1",
      payload: { id: "rg-1" },
      contentHash: "h1",
      fetchedAt: daysBefore(1),
    });
    await db.insert(eventLog).values({
      kind: "animal.seen",
      source: AGG,
      subjectType: "animal",
      subjectId: String(row.id),
      data: {},
      occurredAt: daysBefore(1),
    });
    for (const source of [AGG, SCRAPE]) {
      await db.insert(animalDisplay).values({
        animalId: row.id,
        source,
        description: `${source}'s words`,
        photos: [{ url: `https://cdn.example.org/${row.id}.jpg`, width: 500, height: 400 }],
        listingOrg: "Happy Tails",
        trackerUrl: null,
        fetchedAt: daysBefore(1),
      });
    }
    return row.id;
  }

  it("deletes only the revoked source's display rows, and leaves the corpus and facts standing", async () => {
    const id = await seed();

    expect(await purgeDisplay(db, AGG, NOW, [], REVOKED)).toBe(1);

    const left = await db.select({ source: animalDisplay.source }).from(animalDisplay);
    expect(left.map((r) => r.source)).toEqual([SCRAPE]);
    expect(await db.select().from(animals).where(eq(animals.id, id))).toHaveLength(1);
    expect(await db.select().from(animalIdentities)).toHaveLength(1);
    expect(await db.select().from(rawPayloads)).toHaveLength(1);
    expect(await db.select().from(eventLog)).toHaveLength(1);
  });

  // Without the refusal, a mistyped source or an unrecorded revocation empties
  // pages we are still licensed to show — and nothing but a re-poll refills them.
  it("refuses while the license is active, and deletes nothing", async () => {
    await seed();

    await expect(purgeDisplay(db, AGG, NOW)).rejects.toThrow(/still holds a display license/);
    expect(await db.select().from(animalDisplay)).toHaveLength(2);
  });

  it("purges a scrape source once the shelter's display grant is revoked", async () => {
    await seed();

    expect(await purgeDisplay(db, SCRAPE, NOW, [REVOKED_SHELTER])).toBe(1);
    const left = await db.select({ source: animalDisplay.source }).from(animalDisplay);
    expect(left.map((r) => r.source)).toEqual([AGG]);
  });

  // The fallback the ADR promises: the animal still renders, from facts alone.
  it("leaves the page a visible animal with no display row to pick", async () => {
    const id = await seed();
    await purgeDisplay(db, AGG, NOW, [], REVOKED);
    await purgeDisplay(db, SCRAPE, NOW, [REVOKED_SHELTER]);

    const detail = await loadAnimalDetail(db, id, NOW);
    expect(detail?.animal.name).toBe("Rex");
    expect(detail?.display).toEqual([]);
    expect(pickLicensedDisplay(detail!.display, NOW)).toBeNull();
  });
});
