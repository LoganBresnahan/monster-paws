import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, emailSuppressions } from "@/db/schema";
import {
  exactDigest,
  hasTokenShape,
  inboxDigest,
  inboxOfToken,
  isSuppressed,
  normaliseInbox,
  suppressionKey,
  unsubscribe,
  unsubscribeToken,
} from "@/core/email/suppression";
import { SKIP_DB_TESTS, testDb, truncateDonor } from "./support/db";

const KEY = "test-key-never-used-anywhere-real";

describe("the inbox normaliser (ADR-0035, decision 8)", () => {
  it.each([
    ["Pat@Example.org", "pat@example.org"],
    ["pat+gifts@example.org", "pat@example.org"],
    ["pat.smith@example.org", "pat.smith@example.org"],
    ["p.a.t@gmail.com", "pat@gmail.com"],
    ["P.A.T+gifts@GoogleMail.com", "pat@gmail.com"],
  ])("%s is %s", (address, inbox) => {
    expect(normaliseInbox(address)).toBe(inbox);
  });
});

describe("the digests (ADR-0027 as amended 2026-10-22)", () => {
  it("is keyed: another key gives another digest, and the address isn't in it", () => {
    expect(inboxDigest("pat@example.org", KEY)).not.toBe(inboxDigest("pat@example.org", "another-key"));
    expect(inboxDigest("pat@example.org", KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps a bounce exact and an unsubscribe across the whole inbox", () => {
    expect(exactDigest("pat+a@example.org", KEY)).not.toBe(exactDigest("pat@example.org", KEY));
    expect(inboxDigest("pat+a@example.org", KEY)).toBe(inboxDigest("pat@example.org", KEY));
  });

  it("reads no key from an empty setting, so nothing can send without one", () => {
    expect(suppressionKey({})).toBeNull();
    expect(suppressionKey({ EMAIL_SUPPRESSION_KEY: "" })).toBeNull();
    expect(suppressionKey({ EMAIL_SUPPRESSION_KEY: KEY })).toBe(KEY);
  });
});

describe("the unsubscribe token (ADR-0035, question 6)", () => {
  const token = unsubscribeToken("pat@example.org", KEY);

  it("carries the inbox's digest, not the address", () => {
    expect(hasTokenShape(token)).toBe(true);
    expect(token).not.toContain("pat");
    expect(inboxOfToken(token, KEY)).toBe(inboxDigest("pat@example.org", KEY));
  });

  it("is the same for every spelling of an inbox", () => {
    expect(unsubscribeToken("pat+x@example.org", KEY)).toBe(token);
  });

  it("refuses a made-up digest, a changed mac, another key's token and junk", () => {
    const [digest, mac] = token.split("-");
    expect(inboxOfToken(`${"0".repeat(64)}-${mac}`, KEY)).toBeNull();
    expect(inboxOfToken(`${digest}-${"0".repeat(32)}`, KEY)).toBeNull();
    expect(inboxOfToken(token, "another-key")).toBeNull();
    expect(inboxOfToken("junk", KEY)).toBeNull();
  });
});

describe.skipIf(SKIP_DB_TESTS)("the never-mail list (ADR-0027 as amended 2026-10-22)", () => {
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

  async function intent(id: string, donorEmail: string | null) {
    await db.insert(donationIntents).values({
      id,
      animalSource: "rescuegroups",
      animalExternalId: "1",
      nonprofitSlug: "quiet-hollow",
      nonprofitEin: "000000000",
      donorEmail,
    });
  }

  const addressOf = async (id: string) =>
    (await db.select().from(donationIntents)).find((row) => row.id === id)?.donorEmail;

  it("refuses an exact bounce, without touching the rest of the inbox", async () => {
    await db.insert(emailSuppressions).values({ emailHmac: exactDigest("pat+x@example.org", KEY), reason: "bounce" });
    expect(await isSuppressed(db, "PAT+x@example.org", KEY)).toBe(true);
    expect(await isSuppressed(db, "pat@example.org", KEY)).toBe(false);
  });

  it("a bounce on the plain address says nothing about a tagged one", async () => {
    await db.insert(emailSuppressions).values({ emailHmac: exactDigest("pat@example.org", KEY), reason: "bounce" });
    expect(await isSuppressed(db, "pat@example.org", KEY)).toBe(true);
    expect(await isSuppressed(db, "pat+new@example.org", KEY)).toBe(false);
  });

  it("an unsubscribe stops every spelling, writes one row with no address, and erases only that inbox", async () => {
    await intent("a", "pat@example.org");
    await intent("b", "Pat+gift@example.org");
    await intent("c", "sam@example.org");
    await intent("d", null);

    expect(await unsubscribe(db, unsubscribeToken("pat@example.org", KEY), KEY)).toEqual({ erased: 2 });

    expect(await addressOf("a")).toBeNull();
    expect(await addressOf("b")).toBeNull();
    expect(await addressOf("c")).toBe("sam@example.org");
    const rows = await db.select().from(emailSuppressions);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("unsubscribe");
    expect(JSON.stringify(rows)).not.toContain("pat");
    expect(await isSuppressed(db, "pat+other@example.org", KEY)).toBe(true);
    expect(await isSuppressed(db, "sam@example.org", KEY)).toBe(false);
  });

  it("a second click changes nothing", async () => {
    const token = unsubscribeToken("pat@example.org", KEY);
    await unsubscribe(db, token, KEY);
    expect(await unsubscribe(db, token, KEY)).toEqual({ erased: 0 });
    expect(await db.select().from(emailSuppressions)).toHaveLength(1);
  });

  it("a token this key never made writes nothing and erases nothing", async () => {
    await intent("a", "pat@example.org");
    expect(await unsubscribe(db, `${"0".repeat(64)}-${"0".repeat(32)}`, KEY)).toBeNull();
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    expect(await addressOf("a")).toBe("pat@example.org");
  });
});
