import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ThanksPage from "@/app/thanks/page";
import { intentRef } from "@/core/donate/intent";
import { closeDb, type Db } from "@/db/client";
import { keepsake, paintingEmailSends, animalDisplay, animalIdentities, animals, donationIntents } from "@/db/schema";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateCorpus, truncateDonor } from "./support/db";

/**
 * What the page says to whom. Anyone can open this URL, and it shows an address, so each
 * case is one a mocked action test can't see (ADR-0027 as amended 2026-11-02).
 */

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookie.value ? { value: cookie.value } : undefined) }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), redirect: vi.fn(), notFound: vi.fn() }));

const ADDRESS = "pat@example.org";
const INTENT = "abcDEF123_-abcDEF123_-";
const RECENT = new Date(Date.now() - 24 * 60 * 60 * 1000);
const PHOTO = "https://cdn.rescuegroups.org/photo.jpg";
const PIXEL = "https://tracker.rescuegroups.org/pixel.gif";

describe.skipIf(SKIP_DB_TESTS)("the thank-you page", () => {
  let db: Db;
  let animalId: number;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    await truncateDonor(db);
    cookie.value = INTENT;
    const [row] = await db
      .insert(animals)
      .values({ name: "Rex", species: "dog", status: "available", shelterExternalId: "rescuegroups:org:1", orgName: "Happy Tails" })
      .returning({ id: animals.id });
    animalId = row.id;
    await db.insert(animalIdentities).values({ animalId, source: "rescuegroups", externalId: "rg-1", lastSeenAt: RECENT, sourceUpdatedAt: RECENT });
    await db.insert(animalDisplay).values({
      animalId,
      source: "rescuegroups",
      photos: [{ url: PHOTO, width: 600, height: 800 }],
      trackerUrl: PIXEL,
      fetchedAt: RECENT,
    } as typeof animalDisplay.$inferInsert);
    await db.insert(donationIntents).values({
      id: INTENT,
      animalSource: "rescuegroups",
      animalExternalId: "rg-1",
      nonprofitSlug: "happy-tails",
      nonprofitEin: "36-4219778",
      donorEmail: ADDRESS,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeDb();
  });

  const render = async (query: Record<string, string> = {}) =>
    renderToStaticMarkup(await ThanksPage({ searchParams: Promise.resolve(query) }));

  it("shows a stranger with no cookie no address and no gift", async () => {
    cookie.value = undefined;
    const html = await render();
    expect(html).not.toContain(ADDRESS);
    expect(html).not.toContain("Bookmark");
    expect(html).toContain("find a gift");
  });

  it("never says money moved until the webhook recorded it", async () => {
    const html = await render();
    expect(html).toContain("waiting for Every.org");
    expect(html).not.toContain("on its way");
  });

  it("shows the cookie holder the address, asks them to check it, and says how long the page lasts", async () => {
    const html = await render();
    expect(html).toContain(ADDRESS);
    expect(html).toContain("the only place we");
    expect(html).toContain("only lasts 30 days after your gift, and only in this browser");
    expect(html).not.toContain(INTENT);
  });

  it("names the gift it showed in the form, by a reference and never the id", async () => {
    const html = await render();
    expect(html).toContain(`value="${intentRef(INTENT)}"`);
    expect(html).not.toContain(INTENT);
  });

  it("shows no address, form or bookmark line once the address is erased", async () => {
    await db.update(donationIntents).set({ donorEmail: null }).where(eq(donationIntents.id, INTENT));
    const html = await render();
    expect(html).not.toContain("Not the right address");
    expect(html).not.toContain("Bookmark");
  });

  describe("once the painting's mail exists (ADR-0027 as amended 2026-11-02, decision 4)", () => {
    async function sendRow(row: { sentAt?: Date; refusedCode?: string }) {
      const [made] = await db.insert(keepsake).values({ intentId: INTENT, shareToken: "tok", snapshottedAt: new Date() }).returning({ id: keepsake.id });
      await db.insert(paintingEmailSends).values({ keepsakeId: made.id, claimedAt: new Date(), providerId: "re_1", ...row });
    }

    it("after a bounce, says it couldn't be delivered and takes a new address, with the old one gone", async () => {
      await sendRow({ sentAt: new Date(), refusedCode: "bounced" });
      await db.update(donationIntents).set({ donorEmail: null }).where(eq(donationIntents.id, INTENT));
      const html = await render();
      expect(html).toContain("couldn&#x27;t deliver");
      expect(html).toContain('name="email"');
      expect(html).not.toContain("teaching our painter");
    });

    it("once sent, says it's on its way, with no form and no Saved. from a stale URL", async () => {
      await sendRow({ sentAt: new Date() });
      const html = await render({ saved: "1" });
      expect(html).toContain("on its way");
      expect(html).not.toContain("Saved.");
      expect(html).not.toContain("Not the right address");
      expect(html).not.toContain('name="email"');
      expect(html).not.toContain("teaching our painter");
    });

    it("says a late change wasn't saved, in the words that are true", async () => {
      await sendRow({ sentAt: new Date() });
      expect(await render({ problem: "sent" })).toContain("wasn&#x27;t saved");
    });
  });

  it("refuses a suppressed address in decision 7's words", async () => {
    expect(await render({ problem: "suppressed" })).toContain("We can&#x27;t send email to that address");
  });

  it("doesn't say saved from a bookmarked URL once the address is gone", async () => {
    expect(await render({ saved: "1" })).toContain("Saved.");
    await db.update(donationIntents).set({ donorEmail: null }).where(eq(donationIntents.id, INTENT));
    expect(await render({ saved: "1" })).not.toContain("Saved.");
  });

  it("shows a listed animal's photo, pixel and page", async () => {
    const html = await render();
    expect(html).toContain("photo.jpg");
    expect(html).toContain(PIXEL.replace("https://", ""));
    expect(html).toContain(`href="/animals/${animalId}"`);
  });

  it("offers the full list beside a listed animal's page, so a donor can keep browsing", async () => {
    const html = await render();
    expect(html).toContain('href="/animals"');
    expect(html).toContain("See more animals");
  });

  it("closes the photo, the pixel and the link once the listing is gone: a gift outlives it (ADR-0015 decision 3)", async () => {
    await db.update(animals).set({ status: "adopted" });
    const html = await render();
    expect(html).not.toContain("photo.jpg");
    expect(html).not.toContain(PIXEL.replace("https://", ""));
    expect(html).not.toContain(`href="/animals/${animalId}"`);
    expect(html).toContain("See adoptable animals");
    expect(html).not.toContain("See more animals");
    expect(html).toContain(ADDRESS);
  });
});
