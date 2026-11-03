import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mintIntentId } from "@/core/donate/intent";
import { SPOOL_STALE_MS, sweepWebhookSpool } from "@/core/donate/webhook-replay";
import { prepareDelivery, receiveWebhook, storeDelivery } from "@/core/donate/webhook";
import { spoolDelivery } from "@/core/donate/webhook-spool";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, donations, donationStats, everyorgWebhookDecisions, everyorgWebhookPayloads } from "@/db/schema";
import { webhookSweepAlerts } from "@/worker/webhook-sweep";
import { SKIP_DB_TESTS, testDb, truncateDonor } from "./support/db";

/**
 * A delivery survives a database that refuses or hangs (ADR-0027 as amended 2026-11-03), because
 * Every.org states no retry. Every value is synthetic, in the shape of tests/everyorg-webhook.test.ts.
 */

const SLUG = "happy-tails";
const EIN = "36-4219778";
const secrets = { authToken: "AUTHTOKEN123", pathSecret: "PATHSECRET456" };
const HEADERS: [string, string][] = [["authorization", "Bearer AUTHTOKEN123"], ["user-agent", "every.org/1"]];

function delivery(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "donation.completed",
    chargeId: "charge-1",
    firstName: "Pat",
    lastName: "Example",
    email: "pat@example.org",
    address: { streetAddress: "123 Main St", city: "Springfield" },
    toNonprofit: { slug: SLUG, ein: "364219778", name: "Happy Tails" },
    amount: "25",
    netAmount: "24.15",
    currency: "USD",
    frequency: "ONCE",
    donationDate: "2026-03-15T23:30:00.000Z",
    paymentMethod: "STRIPE",
    ...overrides,
  });
}

/** Refuses the way a failover does, with the donor's data in the message the way a failed query does. */
const refusing = {
  insert: () => ({
    values: () => ({
      returning: async () => {
        throw Object.assign(new Error('Failed query: params: {"email":"pat@example.org"}'), { cause: { code: "57P01" } });
      },
    }),
  }),
} as unknown as Db;

const hanging = {
  insert: () => ({ values: () => ({ returning: () => new Promise(() => {}) }) }),
} as unknown as Db;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "webhook-spool-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const files = async () => (await readdir(dir)).filter((name) => name.endsWith(".json"));
const later = (ms = 60_000) => new Date(Date.now() + ms);

describe("when the database can't take a delivery", () => {
  it("writes a file holding no donor, and says spooled", async () => {
    const result = await receiveWebhook(refusing, { body: delivery(), headers: HEADERS, secrets }, { spoolDir: dir });
    expect(result).toEqual({ payloadId: null, outcome: "spooled", code: "57P01" });

    const [name] = await files();
    const text = await readFile(path.join(dir, name), "utf8");
    for (const donor of ["Pat", "Example", "pat@example.org", "123 Main St", "Springfield", "AUTHTOKEN123"]) {
      expect(text, donor).not.toContain(donor);
    }
    expect(JSON.parse(text).headers.authorization).toBe("[our auth token]");
  });

  it("treats a hang as a failure, on its own clock, not Cloudflare's", async () => {
    const started = Date.now();
    const result = await receiveWebhook(hanging, { body: delivery(), headers: HEADERS, secrets }, { spoolDir: dir, clockMs: 50 });
    expect(result.outcome).toBe("spooled");
    expect(result.code).toBe("clock_expired");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await files()).toHaveLength(1);
  });

  it("leaves no half-written file for a replay to read", async () => {
    await receiveWebhook(refusing, { body: delivery(), headers: HEADERS, secrets }, { spoolDir: dir });
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("throws with no spool configured, so the route answers 500 as it always did", async () => {
    await expect(receiveWebhook(refusing, { body: delivery(), headers: HEADERS, secrets })).rejects.toThrow();
  });

  it("throws when the file can't be written either", async () => {
    const notADirectory = path.join(dir, "file");
    await writeFile(notADirectory, "");
    await expect(receiveWebhook(refusing, { body: delivery(), headers: HEADERS, secrets }, { spoolDir: notADirectory })).rejects.toThrow();
  });
});

describe("what a sweep alerts on", () => {
  it("names counts and codes, and marks what would repeat", () => {
    const alerts = webhookSweepAlerts({ replayed: 0, decided: { nonprofit_mismatch: 1, recorded: 2 }, staleFiles: 2, failure: "57P01" });
    expect(alerts.map((a) => [a.message, a.repeats])).toEqual([
      ["webhook spool: 2 delivery files past 10 minutes", true],
      ["webhook sweep failed: 57P01", true],
      ["everyorg webhook kept, not acted on: nonprofit_mismatch", false],
    ]);
  });

  it("stays silent on a quiet sweep", () => {
    expect(webhookSweepAlerts({ replayed: 1, decided: { recorded: 1 }, staleFiles: 0, failure: null })).toEqual([]);
  });
});

describe.skipIf(SKIP_DB_TESTS)("the sweep", () => {
  let db: Db;
  beforeAll(() => {
    db = testDb();
  });
  beforeEach(async () => {
    await truncateDonor(db);
  });
  afterAll(async () => {
    await truncateDonor(db);
    await closeDb();
  });

  const openIntent = async () => {
    const id = mintIntentId();
    await db.insert(donationIntents).values({ id, animalSource: "rescuegroups", animalExternalId: "1", nonprofitSlug: SLUG, nonprofitEin: EIN });
    return id;
  };
  const counts = async () => ({
    payloads: (await db.select({ n: count() }).from(everyorgWebhookPayloads))[0].n,
    decisions: (await db.select({ n: count() }).from(everyorgWebhookDecisions))[0].n,
    donations: (await db.select({ n: count() }).from(donations))[0].n,
    stats: (await db.select({ n: count() }).from(donationStats))[0].n,
  });
  const spool = (body: string) => spoolDelivery(dir, prepareDelivery({ body, headers: HEADERS, secrets }));

  it("turns a file into the row a direct delivery would have written, with the same decision", async () => {
    const intent = await openIntent();
    const body = delivery({ partnerDonationId: intent, newField: "x" });
    const direct = await receiveWebhook(db, { body, headers: HEADERS, secrets });
    const [directRow] = await db.select().from(everyorgWebhookPayloads);
    const [directDecision] = await db.select().from(everyorgWebhookDecisions);
    expect(directDecision.outcome).toBe("recorded");
    expect(direct.outcome).toBe("recorded");

    await truncateDonor(db);
    const reopened = await db.insert(donationIntents).values({ id: intent, animalSource: "rescuegroups", animalExternalId: "1", nonprofitSlug: SLUG, nonprofitEin: EIN }).returning();
    expect(reopened).toHaveLength(1);
    await spool(body);
    const report = await sweepWebhookSpool(db, dir, later());
    expect(report).toEqual({ replayed: 1, decided: { recorded: 1 }, staleFiles: 0, failure: null });
    expect(await files()).toEqual([]);

    const [spooledRow] = await db.select().from(everyorgWebhookPayloads);
    expect(spooledRow.body).toBe(directRow.body);
    expect(JSON.parse(spooledRow.body).droppedKeys).toEqual(["address", "email", "firstName", "lastName", "newField"]);
    expect(spooledRow.headers).toEqual(directRow.headers);
    expect(spooledRow.headers.authorization).toBe("[our auth token]");
    expect(spooledRow.partnerDonationId).toBe(directRow.partnerDonationId);
    const [spooledDecision] = await db.select().from(everyorgWebhookDecisions);
    expect(spooledDecision.outcome).toBe(directDecision.outcome);
  });

  it("keeps the time it was received, never the time it was replayed", async () => {
    const row = prepareDelivery({ body: delivery(), headers: HEADERS, secrets });
    const received = new Date("2026-03-16T00:00:00.000Z");
    await spoolDelivery(dir, { ...row, receivedAt: received });
    await sweepWebhookSpool(db, dir, later());
    const [stored] = await db.select().from(everyorgWebhookPayloads);
    expect(stored.receivedAt.toISOString()).toBe(received.toISOString());
  });

  it("makes one donation from a late insert plus its replay, or from any number of sweeps", async () => {
    const intent = await openIntent();
    const body = delivery({ partnerDonationId: intent });
    await storeDelivery(db, prepareDelivery({ body, headers: HEADERS, secrets }));
    await spool(body);
    await sweepWebhookSpool(db, dir, later());
    await sweepWebhookSpool(db, dir, later());
    expect(await counts()).toEqual({ payloads: 2, decisions: 2, donations: 1, stats: 1 });
  });

  it("survives two sweeps racing over the same undecided row", async () => {
    const intent = await openIntent();
    await storeDelivery(db, prepareDelivery({ body: delivery({ partnerDonationId: intent }), headers: HEADERS, secrets }));
    await Promise.all([sweepWebhookSpool(db, dir, later()), sweepWebhookSpool(db, dir, later())]);
    expect(await counts()).toEqual({ payloads: 1, decisions: 1, donations: 1, stats: 1 });
  });

  it("decides a row whose decision failed the first time", async () => {
    const intent = await openIntent();
    await db.execute(sql`alter table donation_intents add constraint test_never check (closed_at is null) not valid`);
    try {
      const failed = await receiveWebhook(db, { body: delivery({ partnerDonationId: intent }), headers: HEADERS, secrets });
      expect(failed.outcome).toBe("decision_failed");
      expect(await counts()).toEqual({ payloads: 1, decisions: 0, donations: 0, stats: 0 });
    } finally {
      await db.execute(sql`alter table donation_intents drop constraint test_never`);
    }
    const report = await sweepWebhookSpool(db, dir, later());
    expect(report.decided).toEqual({ recorded: 1 });
    expect(await counts()).toEqual({ payloads: 1, decisions: 1, donations: 1, stats: 1 });
  });

  it("never re-decides what leaves an intent open", async () => {
    const mismatch = await openIntent();
    await receiveWebhook(db, {
      body: delivery({ partnerDonationId: mismatch, toNonprofit: { slug: "someone-else", ein: "111111111", name: "Other" } }),
      headers: HEADERS,
      secrets,
    });
    const first = await openIntent();
    const second = await openIntent();
    await receiveWebhook(db, { body: delivery({ partnerDonationId: first }), headers: HEADERS, secrets });
    const onOther = await receiveWebhook(db, { body: delivery({ partnerDonationId: second }), headers: HEADERS, secrets });
    expect(onOther.outcome).toBe("charge_on_other_intent");

    const outcomes = (await db.select().from(everyorgWebhookDecisions)).map((row) => row.outcome).sort();
    expect(outcomes).toEqual(["charge_on_other_intent", "nonprofit_mismatch", "recorded"]);
    const report = await sweepWebhookSpool(db, dir, later());
    expect(report).toEqual({ replayed: 0, decided: {}, staleFiles: 0, failure: null });
  });

  it("records every early outcome, so nothing that opens no intent is ever swept again", async () => {
    const intent = await openIntent();
    const results = [
      await receiveWebhook(db, { body: "not json", headers: [], secrets }),
      await receiveWebhook(db, { body: delivery(), headers: [], secrets }),
      await receiveWebhook(db, { body: delivery({ partnerDonationId: intent, event: "donation.started" }), headers: [], secrets }),
      await receiveWebhook(db, { body: delivery({ partnerDonationId: intent, amount: "free" }), headers: [], secrets }),
    ];
    expect(results.map((r) => r.outcome)).toEqual(["unparsable", "no_partner_id", "other_event", "bad_fields"]);
    expect((await counts()).decisions).toBe(4);
    expect((await sweepWebhookSpool(db, dir, later())).decided).toEqual({});
  });

  it("leaves a row still inside its own request alone", async () => {
    const intent = await openIntent();
    await storeDelivery(db, prepareDelivery({ body: delivery({ partnerDonationId: intent }), headers: HEADERS, secrets }));
    expect((await sweepWebhookSpool(db, dir)).decided).toEqual({});
    expect((await counts()).decisions).toBe(0);
  });

  it("keeps the files and reports when the database is still down, past the limit only", async () => {
    await spool(delivery());
    await spool(delivery({ chargeId: "charge-2" }));
    const fresh = await sweepWebhookSpool(refusing, dir, later());
    expect(fresh).toMatchObject({ replayed: 0, staleFiles: 0, failure: "57P01" });
    const old = await sweepWebhookSpool(refusing, dir, later(SPOOL_STALE_MS + 1_000));
    expect(old).toMatchObject({ replayed: 0, staleFiles: 2, failure: "57P01" });
    expect(await files()).toHaveLength(2);
  });

  it("reports a file it can't read, leaves it, and still replays the others", async () => {
    await writeFile(path.join(dir, "0-broken.json"), "{ half a file");
    await spool(delivery());
    const report = await sweepWebhookSpool(db, dir, later(SPOOL_STALE_MS + 1_000));
    expect(report.replayed).toBe(1);
    expect(report.staleFiles).toBe(1);
    expect(await files()).toEqual(["0-broken.json"]);
  });

  it("clears a half-written file only once it is old, and never replays one", async () => {
    await writeFile(path.join(dir, "1-unfinished.tmp"), "{");
    await sweepWebhookSpool(db, dir, later());
    expect(await readdir(dir)).toEqual(["1-unfinished.tmp"]);
    await sweepWebhookSpool(db, dir, later(2 * 60 * 60 * 1000));
    expect(await readdir(dir)).toEqual([]);
    expect((await counts()).payloads).toBe(0);
  });

  it("won't let a payload be deleted before its decision, so a deletion can't leave one behind", async () => {
    await receiveWebhook(db, { body: "not json", headers: [], secrets });
    await expect(db.delete(everyorgWebhookPayloads).where(eq(everyorgWebhookPayloads.id, 1))).rejects.toThrow();
  });
});
