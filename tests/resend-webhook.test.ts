import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, emailSuppressions, keepsake, paintingEmailSends, resendWebhookEvents } from "@/db/schema";
import { receiveResendEvent, verifyResendSignature } from "@/core/email/resend-webhook";
import { paintingMailState } from "@/core/email/painting-state";
import { exactDigest, inboxDigest, isSuppressed } from "@/core/email/suppression";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateDonor } from "./support/db";

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

const KEY = "test-key-never-used-anywhere-real";
const SECRET = `whsec_${Buffer.from("resend-test-signing-secret").toString("base64")}`;
const ADDRESS = "pat+gift@example.org";

function signed(body: string, id = "msg_1", at = Date.now()) {
  const timestamp = String(Math.floor(at / 1000));
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
  const signature = `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
  return { id, timestamp, signature };
}

describe("the Svix signature", () => {
  // Fixture provenance: docs.svix.com/receiving/verifying-payloads/how-manual, read 2026-11-03: its own test vector.
  it("verifies Svix's published test vector, at its own time", () => {
    const vector = {
      secret: "whsec_plJ3nmyCDGBKInavdOK15jsl",
      body: '{"event_type":"ping","data":{"success":true}}',
      headers: { id: "msg_loFOjxBNrRLzqYUf", timestamp: "1731705121", signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" },
    };
    expect(verifyResendSignature(vector.body, vector.headers, vector.secret, 1731705121_000)).toBe(true);
  });

  it("accepts a good signature among several, in the space-delimited list", () => {
    const good = signed("{}");
    const headers = { ...good, signature: `v1,bm9wZQ== v2,bm9wZQ== ${good.signature}` };
    expect(verifyResendSignature("{}", headers, SECRET)).toBe(true);
  });

  it("refuses a changed body, a changed id, another secret and missing headers", () => {
    const good = signed("{}");
    expect(verifyResendSignature('{"a":1}', good, SECRET)).toBe(false);
    expect(verifyResendSignature("{}", { ...good, id: "msg_2" }, SECRET)).toBe(false);
    expect(verifyResendSignature("{}", good, `whsec_${Buffer.from("other").toString("base64")}`)).toBe(false);
    expect(verifyResendSignature("{}", { ...good, signature: null }, SECRET)).toBe(false);
    expect(verifyResendSignature("{}", { ...good, timestamp: "not-a-time" }, SECRET)).toBe(false);
  });

  it("refuses a timestamp outside the tolerance, so a captured delivery can't be replayed", () => {
    const old = Date.now() - 6 * 60 * 1000;
    expect(verifyResendSignature("{}", signed("{}", "msg_1", old), SECRET)).toBe(false);
    expect(verifyResendSignature("{}", signed("{}", "msg_1", Date.now() - 4 * 60 * 1000), SECRET)).toBe(true);
  });
});

describe.skipIf(SKIP_DB_TESTS)("what an event does (ADR-0027 as amended 2026-11-02, ADR-0035)", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });
  beforeEach(async () => {
    await truncateDonor(db);
    await intent("intent-a", ADDRESS);
    const [row] = await db
      .insert(keepsake)
      .values({ intentId: "intent-a", shareToken: "tok", snapshottedAt: new Date() })
      .returning({ id: keepsake.id });
    await db.insert(paintingEmailSends).values({ keepsakeId: row.id, claimedAt: new Date(), sentAt: new Date(), providerId: "re_1" });
  });
  afterAll(async () => {
    await closeDb();
  });

  async function intent(id: string, donorEmail: string | null, accountId?: number) {
    await db.insert(donationIntents).values({
      id,
      animalSource: "rescuegroups",
      animalExternalId: id,
      nonprofitSlug: "quiet-hollow",
      nonprofitEin: "000000000",
      donorEmail,
      accountId,
    });
  }

  const addressOf = async (id: string) => (await db.select().from(donationIntents)).find((row) => row.id === id)?.donorEmail;
  const event = (type: string, extra: Record<string, unknown> = {}, to = ADDRESS) =>
    JSON.stringify({ type, created_at: "2026-11-04T00:00:00Z", data: { email_id: "re_1", to: [to], ...extra } });
  const receive = (id: string, body: string) => receiveResendEvent(db, id, body, KEY);

  it("erases on email.delivered, and writes no suppression", async () => {
    expect(await receive("m1", event("email.delivered"))).toBe("erased");
    expect(await addressOf("intent-a")).toBeNull();
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
  });

  it("never erases on email.sent, which fires before any delivery is tried", async () => {
    expect(await receive("m1", event("email.sent"))).toBe("ignored");
    expect(await addressOf("intent-a")).toBe(ADDRESS);
  });

  it("keeps the address on a delay", async () => {
    await receive("m1", event("email.delivery_delayed"));
    expect(await addressOf("intent-a")).toBe(ADDRESS);
  });

  it("a delivery of a mail we don't know erases nothing", async () => {
    await intent("intent-b", "sam@example.org");
    expect(await receive("m1", JSON.stringify({ type: "email.delivered", data: { email_id: "someone-else", to: ["sam@example.org"] } }))).toBe("ignored");
    expect(await addressOf("intent-b")).toBe("sam@example.org");
  });

  it("a permanent bounce suppresses the exact address and erases this gift's, leaving the rest of the inbox", async () => {
    await intent("intent-b", "pat@example.org");
    expect(await receive("m1", event("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed", message: "x" } }))).toBe("bounced");
    const [row] = await db.select().from(emailSuppressions);
    expect(row.reason).toBe("bounce");
    expect(row.emailHmac).toBe(exactDigest(ADDRESS, KEY));
    expect(await addressOf("intent-a")).toBeNull();
    expect(await addressOf("intent-b")).toBe("pat@example.org");
    expect(await isSuppressed(db, "pat@example.org", KEY)).toBe(false);
  });

  it.each([["Transient"], ["Undetermined"], ["Temporary"], ["temporary"], [undefined]])(
    "a soft or unnamed bounce (%s) writes no permanent row and keeps the address",
    async (bounceType) => {
      expect(await receive("m1", event("email.bounced", bounceType ? { bounce: { type: bounceType } } : {}))).toBe("ignored");
      expect(await db.select().from(emailSuppressions)).toHaveLength(0);
      expect(await addressOf("intent-a")).toBe(ADDRESS);
    },
  );

  it("Resend's own list refusing the mail counts as a permanent bounce", async () => {
    expect(await receive("m1", event("email.suppressed"))).toBe("bounced");
    expect((await db.select().from(emailSuppressions))[0].reason).toBe("bounce");
    expect(await addressOf("intent-a")).toBeNull();
  });

  it("marks the send bounced, which is what lets /thanks take a new address", async () => {
    await receive("m1", event("email.bounced", { bounce: { type: "Permanent" } }));
    const [row] = await db.select().from(paintingEmailSends);
    expect(row.refusedCode).toBe("bounced");
    expect(await paintingMailState(db, "intent-a")).toBe("bounced");
  });

  it("a delivery to the old address leaves a corrected one alone", async () => {
    await db.update(donationIntents).set({ donorEmail: "fixed@example.org" });
    expect(await receive("m1", event("email.delivered"))).toBe("ignored");
    expect(await addressOf("intent-a")).toBe("fixed@example.org");
  });

  it("a bounce of the old address keeps a corrected one and clears the row, so that one gets its mail", async () => {
    await db.update(donationIntents).set({ donorEmail: "fixed@example.org" });
    expect(await receive("m1", event("email.bounced", { bounce: { type: "Permanent" } }))).toBe("suppressed");
    expect(await addressOf("intent-a")).toBe("fixed@example.org");
    expect(await db.select().from(paintingEmailSends)).toHaveLength(0);
  });

  it("reports a failed send and keeps the address", async () => {
    expect(await receive("m1", event("email.failed"))).toBe("failed");
    expect(await addressOf("intent-a")).toBe(ADDRESS);
  });

  it("a complaint stops the whole inbox and erases every gift of it", async () => {
    await intent("intent-b", "pat@example.org");
    await intent("intent-c", "sam@example.org");
    expect(await receive("m1", event("email.complained"))).toBe("suppressed");
    const [row] = await db.select().from(emailSuppressions);
    expect(row.reason).toBe("complaint");
    expect(row.emailHmac).toBe(inboxDigest(ADDRESS, KEY));
    expect(await addressOf("intent-a")).toBeNull();
    expect(await addressOf("intent-b")).toBeNull();
    expect(await addressOf("intent-c")).toBe("sam@example.org");
  });

  it("does one delivery once: a retry keeps its svix-id", async () => {
    await receive("m1", event("email.delivered"));
    await db.update(donationIntents).set({ donorEmail: "fixed@example.org" });
    expect(await receive("m1", event("email.delivered"))).toBe("replay");
    expect(await addressOf("intent-a")).toBe("fixed@example.org");
  });

  it("keeps no address in the event's row", async () => {
    await receive("m1", event("email.complained"));
    const rows = await db.select().from(resendWebhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ svixId: "m1", eventType: "email.complained", emailId: "re_1" });
    expect(JSON.stringify(rows)).not.toContain("example.org");
  });

  it("a signed body that won't parse, or isn't an object, stores nothing", async () => {
    expect(await receive("m1", "not json")).toBe("unreadable");
    expect(await receive("m2", "null")).toBe("unreadable");
    expect(await receive("m3", "7")).toBe("unreadable");
    expect(await db.select().from(resendWebhookEvents)).toHaveLength(0);
  });

  describe("the route", () => {
    let route: typeof import("@/app/api/webhooks/resend/route");
    const post = (body: string, headers: Record<string, string>) =>
      route.POST(
        new Request("https://monsterpaws.org/api/webhooks/resend", {
          method: "POST",
          body,
          headers: { "svix-id": headers.id, "svix-timestamp": headers.timestamp, "svix-signature": headers.signature },
        }),
      );

    beforeAll(async () => {
      // The route calls getDb() with no argument, so it reads this; never the dev database (ADR-0017).
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      route = await import("@/app/api/webhooks/resend/route");
    });
    beforeEach(() => {
      process.env.RESEND_WEBHOOK_SECRET = SECRET;
      process.env.EMAIL_SUPPRESSION_KEY = KEY;
    });
    afterAll(() => {
      delete process.env.RESEND_WEBHOOK_SECRET;
      delete process.env.EMAIL_SUPPRESSION_KEY;
    });

    it("acts on a good signature over the raw body", async () => {
      const body = event("email.delivered");
      expect((await post(body, signed(body))).status).toBe(200);
      expect(await addressOf("intent-a")).toBeNull();
    });

    it("raises an alert a person sees on a bounce of a painting, with no address in it", async () => {
      captureMessage.mockClear();
      const body = event("email.bounced", { bounce: { type: "Permanent" } });
      expect((await post(body, signed(body))).status).toBe(200);
      expect(captureMessage).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(captureMessage.mock.calls)).toContain("bounced");
      expect(JSON.stringify(captureMessage.mock.calls)).not.toContain("example.org");
    });

    it("a tampered body stores nothing and erases nothing", async () => {
      const body = event("email.delivered");
      const response = await post(body.replace("re_1", "re_2"), signed(body));
      expect(response.status).toBe(401);
      expect(await db.select().from(resendWebhookEvents)).toHaveLength(0);
      expect(await addressOf("intent-a")).toBe(ADDRESS);
    });

    it("answers as if nothing lived here until the secret is set", async () => {
      delete process.env.RESEND_WEBHOOK_SECRET;
      const body = event("email.delivered");
      expect((await post(body, signed(body))).status).toBe(404);
      expect(await addressOf("intent-a")).toBe(ADDRESS);
    });

    it("asks for a retry with no suppression key, rather than lose the event", async () => {
      delete process.env.EMAIL_SUPPRESSION_KEY;
      const body = event("email.bounced");
      expect((await post(body, signed(body))).status).toBe(503);
      expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    });
  });
});
