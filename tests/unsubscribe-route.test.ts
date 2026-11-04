import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, emailSuppressions } from "@/db/schema";
import { unsubscribeToken } from "@/core/email/suppression";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateDonor } from "./support/db";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

const KEY = "test-key-never-used-anywhere-real";
const TOKEN = unsubscribeToken("pat@example.org", KEY);
const URL_BASE = `https://monsterpaws.org/unsubscribe/${TOKEN}`;
const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

// The route calls getDb() with no argument, so it reads this; never the dev database (ADR-0017).
process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(SKIP_DB_TESTS)("the unsubscribe route acts only on POST (ADR-0035, question 6)", () => {
  let db: Db;
  let route: typeof import("@/app/unsubscribe/[token]/route");

  beforeAll(async () => {
    db = testDb();
    route = await import("@/app/unsubscribe/[token]/route");
  });
  beforeEach(async () => {
    process.env.EMAIL_SUPPRESSION_KEY = KEY;
    await truncateDonor(db);
    await db.insert(donationIntents).values({
      id: "a",
      animalSource: "rescuegroups",
      animalExternalId: "1",
      nonprofitSlug: "quiet-hollow",
      nonprofitEin: "000000000",
      donorEmail: "pat@example.org",
    });
  });
  afterAll(async () => {
    delete process.env.EMAIL_SUPPRESSION_KEY;
    await closeDb();
  });

  const post = (body: string, token = TOKEN) =>
    route.POST(new Request(URL_BASE, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }), ctx(token));
  const state = async () => ({
    suppressions: (await db.select().from(emailSuppressions)).length,
    address: (await db.select().from(donationIntents))[0].donorEmail,
  });

  it("a GET, the scanner's prefetch, writes no suppression and erases nothing", async () => {
    const response = await route.GET(new Request(URL_BASE), ctx());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/unsubscribe/${TOKEN}/confirm`);
    expect(await state()).toEqual({ suppressions: 0, address: "pat@example.org" });
  });

  it("a mail client's one-click POST writes it, erases the address, and answers blank", async () => {
    const response = await post("List-Unsubscribe=One-Click");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(await state()).toEqual({ suppressions: 1, address: null });
  });

  it("the page's button writes it and goes on to the done page", async () => {
    const response = await post("confirm=yes");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/unsubscribe/${TOKEN}/confirm?done=1`);
    expect(await state()).toEqual({ suppressions: 1, address: null });
  });

  it("any other body changes nothing", async () => {
    expect((await post("")).status).toBe(400);
    expect((await post("anything=else")).status).toBe(400);
    expect(await state()).toEqual({ suppressions: 0, address: "pat@example.org" });
  });

  it("a token this key never made, or junk, changes nothing", async () => {
    expect((await post("confirm=yes", `${"0".repeat(64)}-${"0".repeat(32)}`)).status).toBe(404);
    expect((await post("confirm=yes", "junk")).status).toBe(404);
    expect((await route.GET(new Request(URL_BASE), ctx("junk"))).status).toBe(404);
    expect(await state()).toEqual({ suppressions: 0, address: "pat@example.org" });
  });

  it("with no key, nothing is written", async () => {
    delete process.env.EMAIL_SUPPRESSION_KEY;
    expect((await post("confirm=yes")).status).toBe(503);
    expect(await state()).toEqual({ suppressions: 0, address: "pat@example.org" });
  });
});
