import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mintIntentId } from "@/core/donate/intent";
import { receiveWebhook } from "@/core/donate/webhook";
import {
  ART_GENERATE,
  ART_QUEUE_OPTIONS,
  artFilePath,
  artJobOptions,
  artKey,
  CREW_BASIS,
  crewExternalId,
  FACT,
  mintShareToken,
  snapshotKeepsake,
  sweepKeepsakes,
  type SendArtJob,
} from "@/core/keepsake";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, keepsake, keepsakeFact } from "@/db/schema";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateDonor } from "./support/db";

const SLUG = "a-staging-nonprofit";
const EIN = "12-3456789";

function deliveryFor(intentId: string, chargeId: string): string {
  return JSON.stringify({
    event: "donation.completed",
    chargeId,
    partnerDonationId: intentId,
    firstName: "Pat",
    lastName: "Example",
    email: "pat@example.org",
    toNonprofit: { slug: SLUG, ein: "123456789", name: "A Staging Nonprofit" },
    amount: "5",
    netAmount: "4.50",
    currency: "USD",
    frequency: "ONCE",
    donationDate: "2026-11-03T12:00:00.000Z",
    paymentMethod: "STRIPE",
  });
}

describe("the keepsake contract, away from a database (ADR-0035 decision 9)", () => {
  it("mints a share token of 128 bits, each its own", () => {
    const token = mintShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(mintShareToken()).not.toBe(token);
  });

  it("dedupes on a slot, because pg-boss ignores a key alone on a standard queue", () => {
    expect(artJobOptions(7)).toEqual({ singletonKey: "keepsake:7", singletonSeconds: 3600 });
  });

  it("keeps art inside the store and refuses to run without one", () => {
    expect(artFilePath(artKey(7, 1), "/store")).toBe("/store/keepsakes/7/1.jpg");
    expect(() => artFilePath("../../etc/passwd", "/store")).toThrow("leaves the store");
    expect(() => artFilePath(artKey(7, 1), "")).toThrow("ART_STORE_DIR");
  });

  it("is never switched on by the droplet's compose (ADR-0028 §6)", () => {
    expect(readFileSync("docker-compose.prod.yml", "utf8")).not.toContain("ART_SWEEP");
  });
});

describe.skipIf(SKIP_DB_TESTS)("the keepsake sweep (ADR-0035 decisions 6 and 9)", () => {
  let db: Db;
  const sends: { keepsakeId: number; options: ReturnType<typeof artJobOptions> }[] = [];
  const send: SendArtJob = async (_name, data, options) => {
    sends.push({ keepsakeId: data.keepsakeId, options });
    return "job";
  };

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
  });

  beforeEach(async () => {
    await truncateDonor(db);
    sends.length = 0;
  });

  afterAll(async () => {
    await closeDb();
  });

  async function intentFor(animalSource: "manual" | "rescuegroups", animalExternalId: string): Promise<string> {
    const id = mintIntentId();
    await db.insert(donationIntents).values({ id, animalSource, animalExternalId, nonprofitSlug: SLUG, nonprofitEin: EIN, donorEmail: "pat@example.org" });
    return id;
  }

  async function recorded(animalSource: "manual" | "rescuegroups", animalExternalId: string): Promise<string> {
    const id = await intentFor(animalSource, animalExternalId);
    const { outcome } = await receiveWebhook(db, { body: deliveryFor(id, `charge-${id}`), headers: [], secrets: {} });
    expect(outcome).toBe("recorded");
    return id;
  }

  it("gives one keepsake to a webhook and two sweeps at once, and one set of facts", async () => {
    const intentId = await recorded("manual", crewExternalId("plum"));
    await Promise.all([sweepKeepsakes(db, send), sweepKeepsakes(db, send)]);
    await sweepKeepsakes(db, send);

    const rows = await db.select().from(keepsake);
    expect(rows).toHaveLength(1);
    expect(rows[0].intentId).toBe(intentId);
    expect(rows[0].shareToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(rows[0].shareToken).not.toBe(intentId);

    const facts = await db.select().from(keepsakeFact).where(eq(keepsakeFact.keepsakeId, rows[0].id));
    expect(Object.fromEntries(facts.map((fact) => [fact.field, fact.value]))).toEqual({
      [FACT.name]: "Plum",
      [FACT.species]: "dog",
      [FACT.kind]: "Cane Corso",
      [FACT.age]: "4 months",
      [FACT.sex]: "male",
      [FACT.sourcePhoto]: { pet: "plum", photo: null },
    });
    expect(new Set(facts.map((fact) => fact.basis))).toEqual(new Set([CREW_BASIS]));
  });

  it("leaves a share token that is each keepsake's own", async () => {
    await recorded("manual", crewExternalId("plum"));
    await recorded("manual", crewExternalId("marty"));
    await sweepKeepsakes(db, send);
    const rows = await db.select({ token: keepsake.shareToken }).from(keepsake);
    expect(new Set(rows.map((row) => row.token)).size).toBe(2);
  });

  it("writes nothing for a gift not yet recorded: tonight's signal is the webhook alone", async () => {
    await intentFor("manual", crewExternalId("plum"));
    expect(await sweepKeepsakes(db, send)).toEqual({ written: 0, sent: 0 });
    expect(await db.select().from(keepsake)).toEqual([]);
  });

  it("never paints a listing or a gift with no animal, recorded or not (ADR-0028 §6)", async () => {
    const listing = await recorded("rescuegroups", "rg-7");
    const testGift = await recorded("manual", "test-gift");
    const unknown = await recorded("manual", crewExternalId("nobody"));
    expect(await sweepKeepsakes(db, send)).toEqual({ written: 0, sent: 0 });
    expect(await snapshotKeepsake(db, listing)).toBeNull();
    expect(await snapshotKeepsake(db, testGift)).toBeNull();
    expect(await snapshotKeepsake(db, unknown)).toBeNull();
    expect(await db.select().from(keepsake)).toEqual([]);
  });

  it("sends until art exists, so a lost job is sent again, and never after", async () => {
    await recorded("manual", crewExternalId("plum"));
    await sweepKeepsakes(db, send);
    await sweepKeepsakes(db, send);
    expect(sends).toHaveLength(2);
    const [{ id }] = await db.select({ id: keepsake.id }).from(keepsake);
    expect(sends[0]).toEqual({ keepsakeId: id, options: artJobOptions(id) });

    await db.insert(keepsakeFact).values({ keepsakeId: id, field: FACT.art, value: { key: artKey(id, 1), candidate: 1 }, basis: CREW_BASIS, snapshottedAt: new Date() });
    expect(await sweepKeepsakes(db, send)).toEqual({ written: 0, sent: 0 });
  });

  it("really gets one job from pg-boss 12.26.3 for many ticks, and a key alone would not", async () => {
    const boss = new PgBoss({ connectionString: TEST_DATABASE_URL, supervise: false, schedule: false });
    boss.on("error", () => {});
    await boss.start();
    try {
      const queue = `${ART_GENERATE}.test.${Date.now()}`;
      await boss.createQueue(queue, ART_QUEUE_OPTIONS);
      const first = await boss.send(queue, { keepsakeId: 7 }, artJobOptions(7));
      const second = await boss.send(queue, { keepsakeId: 7 }, artJobOptions(7));
      expect(first).toBeTruthy();
      expect(second).toBeNull();
      expect(await boss.send(queue, { keepsakeId: 8 }, artJobOptions(8))).toBeTruthy();

      const keyOnly = await boss.send(queue, { keepsakeId: 9 }, { singletonKey: "keepsake:9" });
      const keyOnlyAgain = await boss.send(queue, { keepsakeId: 9 }, { singletonKey: "keepsake:9" });
      expect(keyOnly).toBeTruthy();
      expect(keyOnlyAgain).toBeTruthy();
      await boss.deleteQueue(queue);
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
