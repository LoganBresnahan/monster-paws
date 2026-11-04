import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, emailSuppressions, keepsake, keepsakeFact, paintingEmailSends, resendWebhookEvents } from "@/db/schema";
import { CREW_BASIS, FACT } from "@/core/keepsake";
import { CLAIM_WINDOW_MS, loadOwedPaintings, type OwedPainting, paintingEmailTick, paintingJpeg, runPaintingEmailTick, sendOwedPaintings, type SweepOptions } from "@/core/email/painting-sweep";
import { correctDonorEmail } from "@/core/donate/intent";
import { receiveResendEvent } from "@/core/email/resend-webhook";
import { EmailSendError, type EmailSender, type OutgoingEmail } from "@/core/email/sender";
import { inboxDigest } from "@/core/email/suppression";
import { SKIP_DB_TESTS, testDb, truncateDonor } from "./support/db";

const KEY = "test-key-never-used-anywhere-real";
const ADDRESS = "pat@example.org";

describe.skipIf(SKIP_DB_TESTS)("the painting email sweep (ADR-0035)", () => {
  let db: Db;
  let keepsakeId: number;
  let png: Buffer;

  beforeAll(async () => {
    db = testDb();
    png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#4c8c4a" } }).png().toBuffer();
  });
  beforeEach(async () => {
    await truncateDonor(db);
    await db.insert(donationIntents).values({
      id: "intent-a",
      animalSource: "rescuegroups",
      animalExternalId: "1",
      nonprofitSlug: "quiet-hollow",
      nonprofitEin: "000000000",
      donorEmail: ADDRESS,
    });
    const [row] = await db
      .insert(keepsake)
      .values({ intentId: "intent-a", shareToken: "tok", snapshottedAt: new Date() })
      .returning({ id: keepsake.id });
    keepsakeId = row.id;
  });
  afterAll(async () => {
    await closeDb();
  });

  const owed = (over: Partial<OwedPainting> = {}): OwedPainting => ({
    keepsakeId,
    to: ADDRESS,
    animalName: "Beetle",
    shareToken: "tok",
    artKeys: ["a", "b", "c", "d"],
    ...over,
  });

  function run(sender: EmailSender, over: Partial<SweepOptions> = {}) {
    return sendOwedPaintings(db, {
      key: KEY,
      sender,
      origin: "https://monsterpaws.org",
      owed: [owed()],
      readArt: async () => png,
      ...over,
    });
  }

  const sending = (impl: (email: OutgoingEmail) => Promise<{ id: string }> = async () => ({ id: "re_1" })) => {
    const send = vi.fn(impl);
    return { via: "smtp", send } as EmailSender & { send: typeof send };
  };
  const row = async () => (await db.select().from(paintingEmailSends).where(eq(paintingEmailSends.keepsakeId, keepsakeId)))[0];

  it("sends four JPEGs once and records it, with no address in the row", async () => {
    const sender = sending();
    expect((await run(sender)).sent).toBe(1);
    const mail = sender.send.mock.calls[0][0];
    expect(mail.to).toBe(ADDRESS);
    expect(mail.attachments).toHaveLength(4);
    expect(mail.attachments[0].content.subarray(0, 2).toString("hex")).toBe("ffd8");
    const recorded = await row();
    expect(recorded.sentAt).not.toBeNull();
    expect(recorded.providerId).toBe("re_1");
    expect(JSON.stringify(recorded)).not.toContain("pat@");
  });

  it("keys the send on the share token and the address: never the keepsake id, and new for a new address", async () => {
    const sender = sending(async () => {
      throw new EmailSendError("network", "unknown", true);
    });
    await run(sender, { owed: [owed({ shareToken: "NIeFjmBKXcQOQzteMmfKgA" })] });
    await run(sender, { owed: [owed({ shareToken: "NIeFjmBKXcQOQzteMmfKgA" })] });
    await run(sender, { owed: [owed({ shareToken: "NIeFjmBKXcQOQzteMmfKgA", to: "new@example.org" })] });
    const [first, retry, moved] = sender.send.mock.calls.map(([mail]) => mail.idempotencyKey);
    expect(first).toMatch(/^painting-email-NIeFjmBKXcQOQzteMmfKgA-[0-9a-f]{16}$/);
    expect(retry).toBe(first);
    expect(moved).not.toBe(first);
  });

  it("a bounced gift's new address mails again, end to end", async () => {
    await db.insert(keepsakeFact).values([
      { keepsakeId, field: FACT.name, value: "Plum", basis: CREW_BASIS, snapshottedAt: new Date() },
      ...[1, 2, 3, 4].map((candidate) => ({ keepsakeId, field: FACT.art, value: { key: `k/${candidate}.jpg`, candidate }, basis: CREW_BASIS, snapshottedAt: new Date() })),
    ]);
    const sender = sending(async (mail) => ({ id: `re_${mail.to}` }));
    const tick = async () => paintingEmailTick(db, { key: KEY, sender, origin: "https://monsterpaws.org", readArt: async () => png });

    await tick();
    const bounce = JSON.stringify({ type: "email.bounced", data: { email_id: `re_${ADDRESS}`, to: [ADDRESS], bounce: { type: "Permanent" } } });
    expect(await receiveResendEvent(db, "m1", bounce, KEY)).toBe("bounced");
    expect(await loadOwedPaintings(db)).toEqual([]);

    expect(await correctDonorEmail(db, "intent-a", "fixed@example.org")).toBe("resending");
    await tick();
    expect(sender.send.mock.calls.map(([mail]) => mail.to)).toEqual([ADDRESS, "fixed@example.org"]);
    expect((await row()).sentAt).not.toBeNull();
    await tick();
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it("a second tick never mails again", async () => {
    const sender = sending();
    await run(sender);
    const report = await run(sender);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(report.sent).toBe(0);
  });

  it("refuses a suppressed address, on any spelling of an unsubscribed inbox, and records nothing", async () => {
    await db.insert(emailSuppressions).values({ emailHmac: inboxDigest(ADDRESS, KEY), reason: "unsubscribe" });
    const sender = sending();
    const report = await run(sender, { owed: [owed({ to: "Pat+x@example.org" })] });
    expect(report.suppressed).toBe(1);
    expect(sender.send).not.toHaveBeenCalled();
    expect(await row()).toBeUndefined();
  });

  it("leaves a painting it can't read owed, with no claim", async () => {
    const sender = sending();
    const report = await run(sender, { readArt: async () => { throw new Error("missing"); } });
    expect(report.artUnreadable).toBe(1);
    expect(await row()).toBeUndefined();
  });

  it("retries an unknown outcome under the same key and body, then records it", async () => {
    let calls = 0;
    const sender = sending(async () => {
      calls += 1;
      if (calls === 1) throw new EmailSendError("network", "unknown", true);
      return { id: "re_2" };
    });
    expect((await run(sender)).failures).toEqual({ network: 1 });
    expect((await row()).sentAt).toBeNull();
    expect((await run(sender)).sent).toBe(1);
    const [first, second] = sender.send.mock.calls.map(([mail]) => mail);
    expect(second).toEqual(first);
  });

  it("stops an unknown outcome once Resend's key has expired, and reports it rather than risk a second mail", async () => {
    const start = new Date("2026-11-04T00:00:00Z");
    const sender = sending(async () => {
      throw new EmailSendError("network", "unknown", true);
    });
    await run(sender, { now: start });
    const report = await run(sender, { now: new Date(start.getTime() + CLAIM_WINDOW_MS + 1) });
    expect(report.stale).toBe(1);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("keeps an earlier attempt's clock when a later attempt is refused, so a late send can't outlive Resend's key", async () => {
    const start = new Date("2026-11-04T00:00:00Z");
    const later = new Date(start.getTime() + 22 * 60 * 60 * 1000);
    const past = new Date(start.getTime() + 25 * 60 * 60 * 1000);
    let calls = 0;
    const sender = sending(async () => {
      calls += 1;
      if (calls === 1) throw new EmailSendError("network", "unknown", true);
      throw new EmailSendError("rate_limit_exceeded", "no", true);
    });
    await run(sender, { now: start });
    await run(sender, { now: later });
    expect((await row()).claimedAt).toEqual(start);
    const report = await run(sender, { now: past });
    expect(report.stale).toBe(1);
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it("erases at once when Resend reported the delivery before the send was recorded", async () => {
    await db.insert(resendWebhookEvents).values({ svixId: "m1", eventType: "email.delivered", emailId: "re_early" });
    await run(sending(async () => ({ id: "re_early" })));
    const [intent] = await db.select().from(donationIntents).where(eq(donationIntents.id, "intent-a"));
    expect(intent.donorEmail).toBeNull();
  });

  it("releases the claim when nothing left and a retry can work, so the window starts again", async () => {
    const sender = sending(async () => {
      throw new EmailSendError("rate_limit_exceeded", "no", true);
    });
    await run(sender);
    expect(await row()).toBeUndefined();
  });

  it("holds a refusal for a person, and doesn't call the provider again", async () => {
    const sender = sending(async () => {
      throw new EmailSendError("invalid_idempotent_request", "unknown", false);
    });
    await run(sender);
    expect((await row()).refusedCode).toBe("invalid_idempotent_request");
    const report = await run(sender);
    expect(report.held).toBe(1);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  describe("reading what's owed (doc/plans/demo-chain-contract.md)", () => {
    const fact = (field: string, value: unknown) => ({ keepsakeId, field, value, basis: CREW_BASIS, snapshottedAt: new Date() });
    const fourArt = () => [1, 2, 3, 4].map((candidate) => fact(FACT.art, { key: `keepsakes/${keepsakeId}/${candidate}.jpg`, candidate }));

    it("is not owed until all four candidates exist", async () => {
      await db.insert(keepsakeFact).values([fact(FACT.name, "Plum"), ...fourArt().slice(0, 3)]);
      expect(await loadOwedPaintings(db)).toEqual([]);
    });

    it("gives the address through the intent, the name, the token and four keys in candidate order", async () => {
      await db.insert(keepsakeFact).values([fact(FACT.name, "Plum"), ...fourArt().reverse()]);
      expect(await loadOwedPaintings(db)).toEqual([
        {
          keepsakeId,
          to: ADDRESS,
          animalName: "Plum",
          shareToken: "tok",
          artKeys: [1, 2, 3, 4].map((candidate) => `keepsakes/${keepsakeId}/${candidate}.jpg`),
        },
      ]);
    });

    it("stops being owed once sent, or refused, and stays owed on an unknown outcome", async () => {
      await db.insert(keepsakeFact).values([fact(FACT.name, "Plum"), ...fourArt()]);
      await db.insert(paintingEmailSends).values({ keepsakeId, claimedAt: new Date() });
      expect(await loadOwedPaintings(db)).toHaveLength(1);
      await db.update(paintingEmailSends).set({ refusedCode: "validation_error" });
      expect(await loadOwedPaintings(db)).toEqual([]);
      await db.update(paintingEmailSends).set({ refusedCode: null, sentAt: new Date() });
      expect(await loadOwedPaintings(db)).toEqual([]);
    });

    it("an erased address is not owed", async () => {
      await db.insert(keepsakeFact).values([fact(FACT.name, "Plum"), ...fourArt()]);
      await db.update(donationIntents).set({ donorEmail: null });
      expect(await loadOwedPaintings(db)).toEqual([]);
    });

    it("a keepsake with no name fact sends nothing and stays owed", async () => {
      const sender = sending();
      const report = await run(sender, { owed: [owed({ animalName: null })] });
      expect(report.incomplete).toBe(1);
      expect(sender.send).not.toHaveBeenCalled();
      expect(await row()).toBeUndefined();
    });

    it("sends nothing at all with no suppression key (ADR-0035 as amended 2026-11-03)", async () => {
      await db.insert(keepsakeFact).values([fact(FACT.name, "Plum"), ...fourArt()]);
      await expect(runPaintingEmailTick(db, {})).rejects.toThrow(/EMAIL_SUPPRESSION_KEY/);
      expect(await row()).toBeUndefined();
    });
  });

  it("leaves the Share button out when told, and still reads the art by its token", async () => {
    const sender = sending();
    const read = vi.fn<SweepOptions["readArt"]>(async () => png);
    await run(sender, { owed: [owed({ displayToken: null })], readArt: read });
    expect(read.mock.calls[0][0]).toMatchObject({ shareToken: "tok" });
    expect(sender.send.mock.calls[0][0].html).not.toContain("/share/");
  });

  it("the by-hand command sends only the keepsake it names", async () => {
    await db.insert(donationIntents).values({
      id: "intent-b",
      animalSource: "rescuegroups",
      animalExternalId: "2",
      nonprofitSlug: "quiet-hollow",
      nonprofitEin: "000000000",
      donorEmail: "sam@example.org",
    });
    const [other] = await db
      .insert(keepsake)
      .values({ intentId: "intent-b", shareToken: "tok2", snapshottedAt: new Date() })
      .returning({ id: keepsake.id });
    const rows = [keepsakeId, other.id].flatMap((id) =>
      [1, 2, 3, 4].map((candidate) => ({
        keepsakeId: id,
        field: FACT.art,
        value: { key: `keepsakes/${id}/${candidate}.jpg`, candidate },
        basis: CREW_BASIS,
        snapshottedAt: new Date(),
      })),
    );
    await db.insert(keepsakeFact).values(rows);
    expect(await loadOwedPaintings(db)).toHaveLength(2);
    expect((await loadOwedPaintings(db, { keepsakeId: other.id })).map((painting) => painting.keepsakeId)).toEqual([other.id]);
  });

  it("sends a stored JPEG untouched and re-encodes anything else", async () => {
    const jpeg = await paintingJpeg(png);
    expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(await paintingJpeg(jpeg)).toBe(jpeg);
  });

  describe("gifts that can't send yet never stop the rest", () => {
    const seeded: number[] = [];

    async function gift(n: number, address: string | null): Promise<number> {
      const intentId = `intent-walk-${n}`;
      await db.insert(donationIntents).values({
        id: intentId,
        animalSource: "rescuegroups",
        animalExternalId: `${n}`,
        nonprofitSlug: "quiet-hollow",
        nonprofitEin: "000000000",
        donorEmail: address,
      });
      const [row] = await db
        .insert(keepsake)
        .values({ intentId, shareToken: `walk-token-${n}`, snapshottedAt: new Date() })
        .returning({ id: keepsake.id });
      await db.insert(keepsakeFact).values([
        { keepsakeId: row.id, field: FACT.name, value: "Plum", basis: CREW_BASIS, snapshottedAt: new Date() },
        ...[1, 2, 3, 4].map((candidate) => ({
          keepsakeId: row.id,
          field: FACT.art,
          value: { key: `keepsakes/${row.id}/${candidate}.jpg`, candidate },
          basis: CREW_BASIS,
          snapshottedAt: new Date(),
        })),
      ]);
      return row.id;
    }

    async function walk(sender: EmailSender, readArt: SweepOptions["readArt"], ticks: number) {
      let after: number | undefined;
      const reports = [];
      for (let tick = 0; tick < ticks; tick++) {
        const report = await paintingEmailTick(
          db,
          { key: KEY, sender, origin: "https://monsterpaws.org", readArt },
          { afterKeepsakeId: after },
        );
        after = report.lastKeepsakeId ?? undefined;
        reports.push(report);
      }
      return reports;
    }

    beforeEach(() => {
      seeded.length = 0;
    });

    it("10 unreadable sets ahead of a good gift: the good one goes within two ticks", async () => {
      for (let n = 0; n < 10; n++) seeded.push(await gift(n, `stuck${n}@example.org`));
      const good = await gift(10, "good@example.org");
      const sender = sending();
      const readArt: SweepOptions["readArt"] = async (art) => {
        if (art.shareToken !== "walk-token-10") throw new Error("not published");
        return png;
      };
      await walk(sender, readArt, 2);
      expect(sender.send.mock.calls.map(([mail]) => mail.to)).toEqual(["good@example.org"]);
      expect((await db.select().from(paintingEmailSends).where(eq(paintingEmailSends.keepsakeId, good)))[0].sentAt).not.toBeNull();
    });

    it("10 suppressed gifts ahead of a good gift: the good one goes within two ticks", async () => {
      for (let n = 0; n < 10; n++) {
        const address = `stop${n}@example.org`;
        await gift(n, address);
        await db.insert(emailSuppressions).values({ emailHmac: inboxDigest(address, KEY), reason: "unsubscribe" });
      }
      await gift(10, "good@example.org");
      const sender = sending();
      await walk(sender, async () => png, 2);
      expect(sender.send.mock.calls.map(([mail]) => mail.to)).toEqual(["good@example.org"]);
    });

    it("erased gifts take no place at all", async () => {
      for (let n = 0; n < 10; n++) await gift(n, null);
      await gift(10, "good@example.org");
      const sender = sending();
      await walk(sender, async () => png, 1);
      expect(sender.send.mock.calls.map(([mail]) => mail.to)).toEqual(["good@example.org"]);
    });

    it("starts over after the end, so a gift that becomes readable is reached again", async () => {
      await gift(0, "later@example.org");
      let readable = false;
      const sender = sending();
      const readArt: SweepOptions["readArt"] = async () => {
        if (!readable) throw new Error("not published");
        return png;
      };
      const [first] = await walk(sender, readArt, 1);
      expect(first.artUnreadable).toBe(1);
      expect(first.lastKeepsakeId).toBeNull();
      readable = true;
      await walk(sender, readArt, 1);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });
  });
});
