import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestGift } from "@/app/test-gift/[secret]/actions";
import TestGiftPage from "@/app/test-gift/[secret]/page";
import { sponsorNonprofit } from "@/core/donate/intent";
import { TEST_GIFT } from "@/core/donate/test-gift";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, shelterNonprofits } from "@/db/schema";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateDonor } from "./support/db";

// The one exception to "no permission, no button", so it must open for the secret and
// nothing else, and never hand the secret to Every.org (ADR-0027 as amended 2026-11-02).
const redirect = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() => vi.fn());
const setCookie = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect, notFound }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: setCookie }) }));

const SECRET = "testpagesecret123";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const good = { secret: SECRET, amount: "2", email: "pat@example.org" };

describe.skipIf(SKIP_DB_TESTS)("the hidden test gift page", () => {
  let db: Db;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
  });

  beforeEach(async () => {
    await truncateDonor(db);
    redirect.mockImplementation((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url });
    });
    notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.stubEnv("EVERYORG_ENV", "production");
    vi.stubEnv("EVERYORG_WEBHOOK_TOKEN", "tok");
    vi.stubEnv("EVERYORG_TEST_PAGE_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeDb();
  });

  const urlFrom = (action: Promise<void>) =>
    action.then(
      () => {
        throw new Error("expected a redirect");
      },
      (err: { url: string }) => err.url,
    );

  const render = (secret: string) =>
    TestGiftPage({ params: Promise.resolve({ secret }), searchParams: Promise.resolve({}) });

  it("answers 404 to anything but the secret, and to everything when it is unset", async () => {
    await expect(render(SECRET)).resolves.toBeTruthy();
    await expect(render("wrong")).rejects.toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("EVERYORG_TEST_PAGE_SECRET", "");
    await expect(render("")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render("undefined")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers 404 when no Every.org is configured", async () => {
    vi.stubEnv("EVERYORG_ENV", "");
    await expect(render(SECRET)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("refuses the action without the secret: it is a public endpoint of its own", async () => {
    expect(await urlFrom(startTestGift(form({ ...good, secret: "wrong" })))).toBe("/");
    expect(await urlFrom(startTestGift(form({ amount: "2", email: "pat@example.org" })))).toBe("/");
    vi.stubEnv("EVERYORG_TEST_PAGE_SECRET", "");
    expect(await urlFrom(startTestGift(form({ ...good, secret: "" })))).toBe("/");
    expect(await db.select().from(donationIntents)).toEqual([]);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("refuses a bad amount or address, and writes nothing", async () => {
    expect(await urlFrom(startTestGift(form({ ...good, amount: "1" })))).toBe(`/test-gift/${SECRET}?problem=form`);
    expect(await urlFrom(startTestGift(form({ ...good, email: "pat" })))).toBe(`/test-gift/${SECRET}?problem=form`);
    expect(await db.select().from(donationIntents)).toEqual([]);
  });

  it("gives to the one named nonprofit on www.every.org, and the secret never goes with it", async () => {
    const url = new URL(await urlFrom(startTestGift(form({ ...good, slug: "other", nonprofit: "other" }))));
    expect(url.origin).toBe("https://www.every.org");
    expect(url.pathname).toBe("/spencer-pet-rescue");
    expect(url.toString()).not.toContain(SECRET);
    expect(url.searchParams.get("exit_url")).toBe("https://monsterpaws.org/");

    const [intent] = await db.select().from(donationIntents).where(eq(donationIntents.id, url.searchParams.get("partner_donation_id")!));
    expect(intent).toMatchObject({
      animalSource: TEST_GIFT.source,
      animalExternalId: "test-gift",
      nonprofitSlug: "spencer-pet-rescue",
      nonprofitEin: "86-1172833",
      donorEmail: "pat@example.org",
    });
    expect(setCookie).toHaveBeenCalledOnce();
  });

  it("opens no Sponsor button: its nonprofit being claimed is no permission to paint", async () => {
    await db.insert(shelterNonprofits).values({
      shelterExternalId: "rescuegroups:org:test-gift-nonprofit",
      everyorgSlug: TEST_GIFT.nonprofit.slug,
      ein: TEST_GIFT.nonprofit.ein,
      source: "test",
      fetchedAt: new Date(),
      everyorgClaim: "claimed",
    });
    expect(await sponsorNonprofit(db, "rescuegroups:org:test-gift-nonprofit", { everyorgEnv: "production" })).toBeNull();
  });
});
