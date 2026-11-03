import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { visibleAnimalById } from "@/core/animals";
import { assertDemoDatabase, rehearsalGift, REHEARSAL_NONPROFIT, seedCrew } from "@/core/crew-seed";
import { pickLicensedDisplay } from "@/core/display";
import { loadSponsorable } from "@/core/donate/intent";
import { crewExternalId, sweepKeepsakes } from "@/core/keepsake";
import { closeDb, type Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals, keepsake, shelterNonprofits } from "@/db/schema";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateCorpus, truncateDonor } from "./support/db";

describe("the demo database (ADR-0028 §6)", () => {
  it("refuses anything but its own name, so the crew never sits beside listings", () => {
    expect(assertDemoDatabase("postgres://u:p@localhost:5432/monsterpaws_demo")).toContain("monsterpaws_demo");
    expect(() => assertDemoDatabase("postgres://u:p@localhost:5432/monsterpaws")).toThrow("refusing");
    expect(() => assertDemoDatabase(undefined)).toThrow("refusing");
  });
});

describe.skipIf(SKIP_DB_TESTS)("the seeded crew through the real pages' reads", () => {
  let db: Db;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    await truncateDonor(db);
    await db.delete(shelterNonprofits);
    await seedCrew(db, REHEARSAL_NONPROFIT);
  });

  afterAll(async () => {
    await db.delete(shelterNonprofits);
    await closeDb();
  });

  const plumId = async () => {
    const [row] = await db.select({ id: animalIdentities.animalId }).from(animalIdentities).where(eq(animalIdentities.externalId, crewExternalId("plum")));
    return row.id;
  };

  it("is sponsorable on staging and never where money is real", async () => {
    const id = await plumId();
    const staging = await loadSponsorable(db, id, { everyorgEnv: "staging" });
    expect(staging).toMatchObject({ name: "Plum", source: "manual", externalId: "crew:plum", listed: true });
    expect(staging?.nonprofit.slug).toBe(REHEARSAL_NONPROFIT.slug);
    expect(await loadSponsorable(db, id, { everyorgEnv: "production" })).toBeNull();
  });

  it("shows its own photo, under the consent record's licence", async () => {
    const id = await plumId();
    expect(await db.select({ id: animals.id }).from(animals).where(visibleAnimalById(id))).toHaveLength(1);
    const rows = await db.select().from(animalDisplay).where(eq(animalDisplay.animalId, id));
    expect(pickLicensedDisplay(rows)?.photos[0].url).toBe("/brand/crew/plum-photo.jpg");
  });

  it("seeds again without a second crew, and a new nonprofit takes", async () => {
    await seedCrew(db, { slug: "another", ein: "11-1111111", name: "Another" });
    expect(await db.select().from(animals)).toHaveLength(5);
    expect(await db.select().from(animalDisplay)).toHaveLength(5);
    const [row] = await db.select().from(shelterNonprofits);
    expect(row.everyorgSlug).toBe("another");
    expect((await db.select().from(animals))[0].orgName).toBe("Another");
  });

  it("carries a rehearsal gift from the decision to a keepsake and its job", async () => {
    await rehearsalGift(db, "beetle", "pat@example.org");
    const report = await sweepKeepsakes(db, async () => "job");
    expect(report).toEqual({ written: 1, sent: 1 });
    expect(await db.select().from(keepsake)).toHaveLength(1);
  });
});
