import { createHash, createHmac } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/everyorg/[secret]/route";
import { mintIntentId } from "@/core/donate/intent";
import { MAX_BODY_BYTES, receiveWebhook, redactHeaders, secretMatches } from "@/core/donate/webhook";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, donations, donationStats, everyorgWebhookPayloads } from "@/db/schema";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateDonor } from "./support/db";

/**
 * The trust boundary of ADR-0027 §4. Every.org's webhook is unsigned, so what is
 * pinned here is what a delivery can NOT do: reach a donation without an open
 * intent for the right nonprofit, or count one twice.
 *
 * Fixture provenance: the keys and value formats are those of real deliveries, Logan's
 * staging card gifts of 2026-11-02 (read by Claude, and differing from the docs: `amount`
 * "2", `frequency` "ONCE", `paymentMethod` "STRIPE", an `event` key, and an `address` when
 * the donor enters one). `privateNote` and `publicTestimony` are the docs' own names, not
 * yet seen on a delivery. Every value here is synthetic, and the amounts are this suite's own.
 */

const SLUG = "happy-tails";
const EIN = "36-4219778";

function delivery(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "donation.completed",
    chargeId: "charge-1",
    firstName: "Pat",
    lastName: "Example",
    email: "pat@example.org",
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

describe("what a raw row keeps of the headers (ADR-0027 as amended 2026-10-22)", () => {
  const secrets = { authToken: "AUTHTOKEN123", pathSecret: "PATHSECRET456" };

  it("marks our auth token wherever it arrives, so we learn whether Every.org sends it", () => {
    expect(redactHeaders([["authorization", "Bearer AUTHTOKEN123"]], secrets)).toEqual({ authorization: "[our auth token]" });
    expect(redactHeaders([["x-every-token", "AUTHTOKEN123"]], secrets)).toEqual({ "x-every-token": "[our auth token]" });
  });

  it("never keeps our path secret or any credential header", () => {
    expect(redactHeaders([["x-original-url", "/api/webhooks/everyorg/PATHSECRET456"]], secrets)).toEqual({
      "x-original-url": "[our path secret]",
    });
    expect(redactHeaders([["authorization", "Bearer someone-else"], ["cookie", "a=b"]], secrets)).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
    });
  });

  it("keeps the rest as sent", () => {
    expect(redactHeaders([["user-agent", "every.org/1"], ["content-type", "application/json"]], secrets)).toEqual({
      "user-agent": "every.org/1",
      "content-type": "application/json",
    });
  });
});

describe("the path secret (ADR-0027 §4)", () => {
  it("matches only itself, and nothing when unset", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches("", "abc")).toBe(false);
    expect(secretMatches("", undefined)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("undefined", undefined)).toBe(false);
  });
});

describe.skipIf(SKIP_DB_TESTS)("a delivery against the database (ADR-0027 §4)", () => {
  let db: Db;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
  });

  beforeEach(async () => {
    await truncateDonor(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function openIntent(overrides: { slug?: string; ein?: string } = {}): Promise<string> {
    const id = mintIntentId();
    await db.insert(donationIntents).values({
      id,
      animalSource: "rescuegroups",
      animalExternalId: "rg-7",
      nonprofitSlug: overrides.slug ?? SLUG,
      nonprofitEin: overrides.ein ?? EIN,
    });
    return id;
  }

  const receive = (body: string) => receiveWebhook(db, { body, headers: [["user-agent", "t"]], secrets: {} });

  async function counts() {
    const n = async (table: typeof donations | typeof donationStats | typeof everyorgWebhookPayloads) =>
      (await db.select({ n: count() }).from(table))[0].n;
    return { payloads: await n(everyorgWebhookPayloads), donations: await n(donations), stats: await n(donationStats) };
  }

  const closedAt = async (id: string) =>
    (await db.select({ closedAt: donationIntents.closedAt }).from(donationIntents).where(eq(donationIntents.id, id)))[0].closedAt;

  it("records a matched gift: the donation, the anonymous stat, the intent closed, all from one delivery", async () => {
    const intent = await openIntent();
    const result = await receive(delivery({ partnerDonationId: intent }));
    expect(result.outcome).toBe("recorded");

    const [donation] = await db.select().from(donations);
    expect(donation).toMatchObject({
      intentId: intent,
      webhookPayloadId: result.payloadId,
      chargeId: "charge-1",
      amount: "25.00",
      netAmount: "24.15",
      currency: "USD",
      frequency: "ONCE",
      nonprofitSlug: SLUG,
      nonprofitEin: "364219778",
      nonprofitName: "Happy Tails",
    });
    expect(donation.donatedAt.toISOString()).toBe("2026-03-15T23:30:00.000Z");
    expect(await closedAt(intent)).not.toBeNull();
  });

  it("writes a stats row holding no donor, dated by day only (ADR-0027 §6)", async () => {
    await receive(delivery({ partnerDonationId: await openIntent() }));
    const [stat] = await db.select().from(donationStats);
    expect(stat).toEqual({
      id: expect.any(Number),
      animalSource: "rescuegroups",
      animalExternalId: "rg-7",
      nonprofitSlug: SLUG,
      amount: "25.00",
      currency: "USD",
      frequency: "ONCE",
      donatedOn: "2026-03-15",
    });
  });

  it("stores the delivery's named fields before believing any of them", async () => {
    const intent = await openIntent();
    await receive(delivery({ partnerDonationId: intent }));
    const [row] = await db.select().from(everyorgWebhookPayloads);
    expect(JSON.parse(row.body)).toEqual({
      event: "donation.completed",
      chargeId: "charge-1",
      partnerDonationId: intent,
      amount: "25",
      netAmount: "24.15",
      currency: "USD",
      frequency: "ONCE",
      donationDate: "2026-03-15T23:30:00.000Z",
      paymentMethod: "STRIPE",
      toNonprofit: { slug: SLUG, ein: "364219778", name: "Happy Tails" },
      droppedKeys: ["email", "firstName", "lastName"],
    });
    expect(row.partnerDonationId).toBe(intent);
  });

  it("keeps no donor in a raw row, whatever the outcome (ADR-0027 as amended 2026-11-02)", async () => {
    const donor = {
      firstName: "Pat",
      lastName: "Lastname-Example",
      email: "pat@example.org",
      address: { streetAddress: "12 Real Street", city: "Realville", state: "CA", postalCode: "90210", country: "US" },
      privateNote: "a private word",
      publicTestimony: "a public word",
    };
    const intent = await openIntent();
    const bodies = [
      delivery({ ...donor, partnerDonationId: intent }),
      delivery({ ...donor, partnerDonationId: intent, event: "donation.pending" }),
      delivery({ ...donor, partnerDonationId: mintIntentId() }),
      delivery({ ...donor }),
      delivery({ ...donor, partnerDonationId: intent, amount: "lots" }),
    ];
    for (const body of bodies) await receive(body);

    const rows = await db.select().from(everyorgWebhookPayloads);
    expect(rows).toHaveLength(bodies.length);
    const stored = JSON.stringify(rows);
    for (const word of ["Pat", "Lastname-Example", "pat@example.org", "12 Real Street", "Realville", "90210", "a private word", "a public word"]) {
      expect(stored, word).not.toContain(word);
    }
    expect(JSON.parse(rows[0].body).droppedKeys).toEqual(["address", "email", "firstName", "lastName", "privateNote", "publicTestimony"]);
  });

  it("names a new field without keeping its value, even inside a field it keeps", async () => {
    await receive(delivery({ partnerDonationId: await openIntent(), cardholder: "Pat Example", paymentMethod: { holder: "Pat Example" }, toNonprofit: { slug: SLUG, ein: "364219778", name: "Happy Tails", contact: "Pat Example" } }));
    const [row] = await db.select().from(everyorgWebhookPayloads);
    expect(row.body).not.toContain("Pat Example");
    expect(JSON.parse(row.body).droppedKeys).toEqual(["cardholder", "email", "firstName", "lastName", "paymentMethod", "toNonprofit.contact"]);
  });

  it("keeps only a keyed hash and the size of a body it can't read, and does nothing with it", async () => {
    const junks = ["not json from pat@example.org", "", "[1,2]", "null", '"pat@example.org"'];
    const key = "pathsecret123";
    for (const junk of junks) {
      const { outcome } = await receiveWebhook(db, { body: junk, headers: [], secrets: { pathSecret: key } });
      expect(outcome, junk).toBe("unparsable");
    }
    expect(await counts()).toEqual({ payloads: 5, donations: 0, stats: 0 });
    const rows = await db.select().from(everyorgWebhookPayloads).orderBy(everyorgWebhookPayloads.id);
    expect(rows.every((row) => row.partnerDonationId === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("pat@example.org");
    expect(JSON.parse(rows[0].body)).toEqual({
      unreadable: { hmac: createHmac("sha256", key).update(junks[0]).digest("hex"), bytes: Buffer.byteLength(junks[0]) },
    });
    // A bare hash of a short body can be guessed, the reason a suppression refuses one (ADR-0027 as amended 2026-10-22).
    expect(rows[4].body).not.toContain(createHash("sha256").update(junks[4]).digest("hex"));
  });

  it("drops a named field whose value doesn't fit, and any key that is itself an address", async () => {
    await receive(
      delivery({
        partnerDonationId: await openIntent(),
        paymentMethod: "Pat Example <pat@example.org>",
        "pat@example.org": 1,
        toNonprofit: { slug: SLUG, ein: "364219778", name: "Happy Tails <pat@example.org>" },
      }),
    );
    const [row] = await db.select().from(everyorgWebhookPayloads);
    expect(row.body).not.toContain("pat@example.org");
    expect(row.body).not.toContain("Pat Example");
    expect(JSON.parse(row.body).droppedKeys).toEqual(expect.arrayContaining(["[unnamed]", "paymentMethod", "toNonprofit.name"]));
  });

  it("keeps an address out of a header too", async () => {
    await receiveWebhook(db, { body: "{}", headers: [["x-sender", "pat@example.org"]], secrets: {} });
    const [row] = await db.select().from(everyorgWebhookPayloads);
    expect(JSON.stringify(row.headers)).not.toContain("pat@example.org");
  });

  it("treats a partner id that isn't our id's shape as no id, since a donor can edit it in the link", async () => {
    expect((await receive(delivery({ partnerDonationId: "pat@example.org" }))).outcome).toBe("no_partner_id");
    const [row] = await db.select().from(everyorgWebhookPayloads);
    expect(row.partnerDonationId).toBeNull();
    expect(JSON.stringify(row)).not.toContain("pat@example.org");
  });

  it("keeps the delivery and changes nothing else when deciding fails, all or nothing (ADR-0027 §4)", async () => {
    const intent = await openIntent();
    // The transaction's LAST write fails, so a donation or a stat written outside it would show.
    await db.execute(sql`alter table donation_intents add constraint test_never check (closed_at is null) not valid`);
    try {
      const result = await receive(delivery({ partnerDonationId: intent }));
      expect(result.outcome).toBe("decision_failed");
      expect(result.code).toBe("23514");
      expect(await counts()).toEqual({ payloads: 1, donations: 0, stats: 0 });
      expect(await closedAt(intent)).toBeNull();
      const [row] = await db.select().from(everyorgWebhookPayloads);
      expect(row.id).toBe(result.payloadId);
    } finally {
      await db.execute(sql`alter table donation_intents drop constraint test_never`);
    }
    expect((await receive(delivery({ partnerDonationId: intent }))).outcome, "a retry can still land").toBe("recorded");
  });

  it("acts only on a completed gift: any other event, or none, is kept and the intent stays open", async () => {
    const intent = await openIntent();
    for (const event of ["donation.pending", "donation.refunded", "", null, undefined]) {
      const outcome = (await receive(delivery({ partnerDonationId: intent, event }))).outcome;
      expect(outcome, String(event)).toBe("other_event");
    }
    expect(await counts()).toEqual({ payloads: 5, donations: 0, stats: 0 });
    expect(await closedAt(intent)).toBeNull();
  });

  it("keeps a delivery naming no intent, and acts on neither", async () => {
    expect((await receive(delivery())).outcome).toBe("no_partner_id");
    expect((await receive(delivery({ partnerDonationId: mintIntentId() }))).outcome).toBe("no_intent");
    expect(await counts()).toEqual({ payloads: 2, donations: 0, stats: 0 });
  });

  it("refuses a delivery for another nonprofit, by slug or by EIN, and leaves the intent open", async () => {
    const intent = await openIntent();
    const bySlug = delivery({ partnerDonationId: intent, toNonprofit: { slug: "other", ein: "364219778", name: "Other" } });
    const byEin = delivery({ partnerDonationId: intent, toNonprofit: { slug: SLUG, ein: "111111111", name: "Happy Tails" } });
    expect((await receive(bySlug)).outcome).toBe("nonprofit_mismatch");
    expect((await receive(byEin)).outcome).toBe("nonprofit_mismatch");
    expect(await counts()).toEqual({ payloads: 2, donations: 0, stats: 0 });
    expect(await closedAt(intent)).toBeNull();
  });

  it("matches an EIN however it is punctuated", async () => {
    const hyphenated = delivery({ partnerDonationId: await openIntent(), toNonprofit: { slug: SLUG, ein: "36-4219778", name: "Happy Tails" } });
    expect((await receive(hyphenated)).outcome).toBe("recorded");
  });

  it("counts a replay once: the delivery kept, nothing else written", async () => {
    const intent = await openIntent();
    const body = delivery({ partnerDonationId: intent });
    expect((await receive(body)).outcome).toBe("recorded");
    expect((await receive(body)).outcome).toBe("replay");
    expect(await counts()).toEqual({ payloads: 2, donations: 1, stats: 1 });
  });

  it("keeps a new charge on a closed intent, unacted on: a monthly gift's shape is unconfirmed", async () => {
    const intent = await openIntent();
    await receive(delivery({ partnerDonationId: intent }));
    expect((await receive(delivery({ partnerDonationId: intent, chargeId: "charge-2" }))).outcome).toBe("closed_intent");
    expect(await counts()).toEqual({ payloads: 2, donations: 1, stats: 1 });
  });

  it("won't take a charge already recorded elsewhere, and leaves this intent open", async () => {
    await receive(delivery({ partnerDonationId: await openIntent() }));
    const second = await openIntent();
    expect((await receive(delivery({ partnerDonationId: second }))).outcome).toBe("charge_on_other_intent");
    expect(await counts()).toEqual({ payloads: 2, donations: 1, stats: 1 });
    expect(await closedAt(second)).toBeNull();
  });

  it("won't call a closed intent's delivery a replay when the charge is another intent's", async () => {
    const first = await openIntent();
    await receive(delivery({ partnerDonationId: first }));
    const second = await openIntent();
    await receive(delivery({ partnerDonationId: second, chargeId: "charge-2" }));
    expect((await receive(delivery({ partnerDonationId: first, chargeId: "charge-2" }))).outcome).toBe("closed_intent");
    expect(await counts()).toEqual({ payloads: 3, donations: 2, stats: 2 });
  });

  it("keeps a delivery with broken fields and leaves its intent open", async () => {
    const intent = await openIntent();
    for (const broken of [
      { amount: "lots" },
      { amount: 25 },
      { amount: "0" },
      { toNonprofit: { slug: SLUG, ein: "evil-36-42-19778-corp", name: "Happy Tails" } },
      { donationDate: "+275760-09-13T00:00:00.000Z" },
      { donationDate: "1" },
      { frequency: "Pat Example" },
      { chargeId: "Pat Example <pat@example.org>" },
      { chargeId: "" },
      { currency: "usd" },
      { donationDate: "soon" },
      { frequency: "" },
      { toNonprofit: null },
      { toNonprofit: { slug: SLUG } },
    ]) {
      expect((await receive(delivery({ partnerDonationId: intent, ...broken }))).outcome, JSON.stringify(broken)).toBe("bad_fields");
    }
    expect((await counts()).donations).toBe(0);
    expect(await closedAt(intent)).toBeNull();
  });

  it("reads a thousands comma, since nothing has shown what a $1,000 gift looks like", async () => {
    const result = await receive(delivery({ partnerDonationId: await openIntent(), amount: "1,000.00", netAmount: "978.00" }));
    expect(result.outcome).toBe("recorded");
    const [donation] = await db.select().from(donations);
    expect(donation).toMatchObject({ amount: "1000.00", netAmount: "978.00" });
    expect((await db.select().from(donationStats))[0].amount).toBe("1000.00");
  });

  it("accepts a missing net amount", async () => {
    const result = await receive(delivery({ partnerDonationId: await openIntent(), netAmount: undefined }));
    expect(result.outcome).toBe("recorded");
    expect((await db.select().from(donations))[0].netAmount).toBeNull();
  });

  it("settles racing deliveries of one charge as one gift, without the row lock it would not", async () => {
    // Warm the pool first: on a cold one, connecting serialises the three and hides a missing lock.
    await Promise.all(Array.from({ length: 6 }, () => db.execute(sql`select pg_sleep(0.02)`)));
    for (let round = 0; round < 5; round += 1) {
      const body = delivery({ partnerDonationId: await openIntent(), chargeId: `charge-race-${round}` });
      const outcomes = (await Promise.all([receive(body), receive(body), receive(body)])).map((r) => r.outcome).sort();
      expect(outcomes, `round ${round}`).toEqual(["recorded", "replay", "replay"]);
    }
    expect(await counts()).toEqual({ payloads: 15, donations: 5, stats: 5 });
  });

  describe("through the route", () => {
    const SECRET = "routesecret123";
    const post = (secret: string, body: string, headers: Record<string, string> = {}) =>
      POST(new Request(`https://example.test/api/webhooks/everyorg/${secret}`, { method: "POST", body, headers }), {
        params: Promise.resolve({ secret }),
      });

    beforeEach(() => {
      vi.stubEnv("EVERYORG_WEBHOOK_SECRET", SECRET);
      vi.stubEnv("EVERYORG_AUTH_TOKEN", "authtoken123");
    });

    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("answers a wrong secret as if nothing lived here, storing nothing", async () => {
      const response = await post("wrong", delivery({ partnerDonationId: await openIntent() }));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect((await counts()).payloads).toBe(0);
    });

    it("refuses everyone when the secret is unset", async () => {
      vi.stubEnv("EVERYORG_WEBHOOK_SECRET", "");
      expect((await post("", "{}")).status).toBe(404);
      expect((await post("undefined", "{}")).status).toBe(404);
      expect((await counts()).payloads).toBe(0);
    });

    it("records a good delivery and answers 200 with no body, its auth token marked", async () => {
      const response = await post(SECRET, delivery({ partnerDonationId: await openIntent() }), { authorization: "Bearer authtoken123" });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
      expect(await counts()).toEqual({ payloads: 1, donations: 1, stats: 1 });
      const [row] = await db.select().from(everyorgWebhookPayloads);
      expect(row.headers.authorization).toBe("[our auth token]");
    });

    it("answers 200 to what it keeps but won't act on, naming nobody in its log", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const response = await post(SECRET, delivery({ partnerDonationId: mintIntentId() }));
      expect(response.status).toBe(200);
      expect(await counts()).toEqual({ payloads: 1, donations: 0, stats: 0 });
      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain("no_intent");
      expect(logged).not.toContain("pat@example.org");
      expect(logged).not.toContain("Example");
      warn.mockRestore();
    });

    it("names the stored row when deciding fails, and never says it wasn't stored", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await db.execute(sql`alter table donation_intents add constraint test_never check (closed_at is null) not valid`);
      try {
        const response = await post(SECRET, delivery({ partnerDonationId: await openIntent() }));
        expect(response.status).toBe(500);
        const [row] = await db.select().from(everyorgWebhookPayloads);
        const logged = error.mock.calls.flat().join(" ");
        expect(logged).toContain(`stored, not decided: payload ${row.id}, 23514`);
        expect(logged).not.toContain("not stored");
      } finally {
        await db.execute(sql`alter table donation_intents drop constraint test_never`);
        error.mockRestore();
      }
    });

    it("records a real delivery that starts with a byte-order mark", async () => {
      const response = await post(SECRET, `\uFEFF${delivery({ partnerDonationId: await openIntent() })}`);
      expect(response.status).toBe(200);
      expect(await counts()).toEqual({ payloads: 1, donations: 1, stats: 1 });
    });

    it("reads a multibyte character split across chunks", async () => {
      const bytes = new TextEncoder().encode(delivery({ partnerDonationId: await openIntent(), toNonprofit: { slug: SLUG, ein: "364219778", name: "Café Tails" } }));
      const split = bytes.indexOf(0xc3) + 1;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, split));
          controller.enqueue(bytes.slice(split));
          controller.close();
        },
      });
      const request = new Request(`https://example.test/api/webhooks/everyorg/${SECRET}`, { method: "POST", body: stream, duplex: "half" } as RequestInit);
      expect((await POST(request, { params: Promise.resolve({ secret: SECRET }) })).status).toBe(200);
      expect((await db.select().from(donations))[0].nonprofitName).toBe("Café Tails");
    });

    it("stops reading past the size limit when no length is declared", async () => {
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(32 * 1024));
          if (pulled > 100) controller.close();
        },
      });
      const request = new Request(`https://example.test/api/webhooks/everyorg/${SECRET}`, { method: "POST", body: stream, duplex: "half" } as RequestInit);
      const response = await POST(request, { params: Promise.resolve({ secret: SECRET }) });
      expect(response.status).toBe(413);
      expect(pulled).toBeLessThan(10);
      expect((await counts()).payloads).toBe(0);
    });

    it("stores nothing past the size limit", async () => {
      const big = "x".repeat(MAX_BODY_BYTES + 1);
      expect((await post(SECRET, big)).status).toBe(413);
      expect((await post(SECRET, "{}", { "content-length": String(MAX_BODY_BYTES + 1) })).status).toBe(413);
      expect((await counts()).payloads).toBe(0);
    });
  });
});
