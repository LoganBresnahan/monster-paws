import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spokenAnimalName } from "@/core/email/animal-name";
import { mintIntentId } from "@/core/donate/intent";
import { artKey, CREW_BASIS, crewExternalId, FACT, grantBasis, mintShareToken } from "@/core/keepsake";
import { keepsakeShare, shelterShareTokens } from "@/core/share/keepsake";
import type { ShelterEntry } from "@/core/shelters";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, keepsake, keepsakeFact } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateDonor } from "./support/db";

const SLUG = "a-staging-nonprofit";
const NOW = new Date("2026-11-04T12:00:00Z");
const pathOf = (key: string) => `/store/${key}`;
const shelterEntry = (grantedAt: string, revokedAt?: string): readonly ShelterEntry[] => [
  {
    slug: "happy-tails",
    name: "Happy Tails",
    siteUrl: "https://example.org",
    listingsUrl: "https://example.org/dogs",
    tier: "aggregator",
    shelterExternalIds: ["rescuegroups:org:1"],
    grants: [{ permission: "digify", grantedAt, ...(revokedAt ? { revokedAt } : {}) }],
  } as unknown as ShelterEntry,
];

describe.skipIf(SKIP_DB_TESTS)("what a keepsake publishes (ADR-0036)", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });
  beforeEach(async () => {
    await truncateDonor(db);
  });
  afterAll(async () => {
    await closeDb();
  });

  async function intent(animalExternalId: string): Promise<string> {
    const id = mintIntentId();
    await db.insert(donationIntents).values({
      id,
      animalSource: "manual",
      animalExternalId,
      nonprofitSlug: SLUG,
      nonprofitEin: "12-3456789",
      donorEmail: "pat@example.org",
    } as typeof donationIntents.$inferInsert);
    return id;
  }

  async function seeded(options: {
    basis?: string;
    facts?: Record<string, string>;
    candidates?: number[];
  }): Promise<{ id: number; token: string }> {
    const { basis = CREW_BASIS, facts = { [FACT.name]: "Beetle", [FACT.kind]: "Bloodhound" }, candidates = [1, 2, 3, 4] } = options;
    const intentId = await intent(crewExternalId("beetle"));
    const token = mintShareToken();
    const [{ id }] = await db.insert(keepsake).values({ intentId, shareToken: token, snapshottedAt: NOW }).returning({ id: keepsake.id });
    await db.insert(keepsakeFact).values([
      ...Object.entries(facts).map(([field, value]) => ({ keepsakeId: id, field, value, basis, snapshottedAt: NOW })),
      ...candidates.map((candidate) => ({ keepsakeId: id, field: FACT.art, value: { key: artKey(id, candidate), candidate }, basis, snapshottedAt: NOW })),
    ]);
    return { id, token };
  }

  const read = (id: number, registry: readonly ShelterEntry[] = []) =>
    keepsakeShare(db, id, { speak: spokenAnimalName, registry, asOf: NOW, pathOf });

  it("reads the token and the four files from the keepsake's own rows", async () => {
    const { id, token } = await seeded({});
    const share = await read(id);
    expect(share.token).toBe(token);
    expect(share.manifest).toEqual({ name: "Beetle", kind: "Bloodhound" });
    expect(share.files).toEqual([1, 2, 3, 4].map((n) => `/store/keepsakes/${id}/${n}.jpg`));
  });

  it("orders the files by candidate, whatever order the facts were written in", async () => {
    const { id } = await seeded({ candidates: [3, 1, 4, 2] });
    expect((await read(id)).files).toEqual([1, 2, 3, 4].map((n) => `/store/keepsakes/${id}/${n}.jpg`));
  });

  it("refuses one that doesn't exist", async () => {
    await expect(read(987654)).rejects.toThrow(/doesn't exist/);
  });

  it.each([[[1, 2, 3]], [[1, 2, 3, 3]], [[1, 2, 3, 5]]])("refuses candidates %j", async (candidates) => {
    const { id } = await seeded({ candidates });
    await expect(read(id)).rejects.toThrow(/candidates 1 to 4/);
  });

  it("says what to call the animal, keeps a kind as published, and omits an empty one", async () => {
    const dirty = await seeded({ facts: { [FACT.name]: "Sparrow (Courtesy Post) Foster or Adopt Me!", [FACT.kind]: "  Domestic Short Hair / Mixed  " } });
    expect((await read(dirty.id)).manifest).toEqual({ name: "Sparrow", kind: "Domestic Short Hair / Mixed" });
    const bare = await seeded({ facts: { [FACT.name]: "Sparrow", [FACT.kind]: "   " } });
    expect((await read(bare.id)).manifest).toEqual({ name: "Sparrow" });
  });

  it("calls an animal 'This animal' when its listing holds no name at all", async () => {
    const { id } = await seeded({ facts: { [FACT.name]: "A310627" } });
    expect((await read(id)).manifest.name).toBe("This animal");
  });

  it("carries a shelter's name for the credit, under a grant held today", async () => {
    const { id } = await seeded({ basis: grantBasis("happy-tails"), facts: { [FACT.name]: "Rex", [FACT.shelter]: "Happy Tails" } });
    const share = await read(id, shelterEntry("2026-10-01T00:00:00Z"));
    expect(share.manifest).toEqual({ name: "Rex", shelter: "Happy Tails" });
  });

  it("gives no public page once the shelter has withdrawn, though the gift predates it", async () => {
    const { id } = await seeded({ basis: grantBasis("happy-tails"), facts: { [FACT.name]: "Rex" } });
    await expect(read(id, shelterEntry("2026-10-01T00:00:00Z", "2026-11-04T00:00:00Z"))).rejects.toThrow(/no digify grant today/);
    await expect(read(id, [])).rejects.toThrow(/no digify grant today/);
  });

  // On production this runs as home_worker, which must never reach a donor's address: run it under the real grants.
  it("stays inside what the home worker's role may read", async () => {
    const { id, token } = await seeded({});
    const role = "share_test_home_worker";
    await db.execute(sql.raw(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`));
    const grants = readFileSync("scripts/home-worker-grants.sql", "utf8")
      .split("\n")
      .filter((line) => /^GRANT .* ON (keepsake|keepsake_fact)\b/.test(line) || /^GRANT USAGE ON SCHEMA public\b/.test(line));
    expect(grants.length).toBeGreaterThanOrEqual(3);
    for (const grant of grants) await db.execute(sql.raw(grant.replace(':"role"', role)));

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
      const share = await keepsakeShare(tx as unknown as Db, id, { speak: spokenAnimalName, registry: [], asOf: NOW, pathOf });
      expect(share.token).toBe(token);
      expect(await shelterShareTokens(tx as unknown as Db, "monster-paws-crew")).toEqual([token]);
      // The proof the role is really on: the table the tool must never touch is refused here.
      const refused = await tx.execute(sql.raw("SELECT count(*) FROM donations")).catch((err: Error) => err);
      expect(refused).toBeInstanceOf(Error);
      expect(String((refused as Error & { cause?: Error }).cause?.message ?? refused)).toMatch(/permission denied/);
    });
  });

  it("finds every share resting on one shelter's grant, and no other's", async () => {
    const one = await seeded({ basis: grantBasis("happy-tails"), facts: { [FACT.name]: "Rex" } });
    const two = await seeded({ basis: grantBasis("happy-tails"), facts: { [FACT.name]: "Fido" } });
    await seeded({ basis: grantBasis("another-shelter"), facts: { [FACT.name]: "Rover" } });
    await seeded({});
    expect((await shelterShareTokens(db, "happy-tails")).sort()).toEqual([one.token, two.token].sort());
    expect(await shelterShareTokens(db, "nobody")).toEqual([]);
  });
});
