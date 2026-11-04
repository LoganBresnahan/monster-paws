import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, emailSuppressions, keepsake, keepsakeFact, paintingEmailSends } from "@/db/schema";
import { CREW_BASIS, FACT } from "@/core/keepsake";
import { CLAIM_WINDOW_MS, loadOwedPaintings, type OwedPainting, paintingJpeg, runPaintingEmailTick, sendOwedPaintings, type SweepOptions } from "@/core/email/painting-sweep";
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

  it("skips an erased address", async () => {
    const sender = sending();
    expect((await run(sender, { owed: [owed({ to: null })] })).noAddress).toBe(1);
    expect(sender.send).not.toHaveBeenCalled();
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
});
