import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startSponsorship } from "@/app/animals/[id]/sponsor/actions";
import { hasGrant, shelterByExternalId } from "@/core/shelters";
import { closeDb, type Db } from "@/db/client";
import { animalIdentities, animals, donationIntents, shelterNonprofits } from "@/db/schema";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateCorpus, truncateDonor } from "./support/db";

// The grant skip's whole safety is that the skip and the host read one value: no path
// through the action may reach www.every.org without a grant (ADR-0002 as amended 2026-11-02).
const redirect = vi.hoisted(() => vi.fn());
const setCookie = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: setCookie }) }));

// Not a real organisation's key, so this stays a shelter with no grant once SHELTERS has entries.
const SHELTER = "rescuegroups:org:no-grant-on-record";
const RECENT = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe.skipIf(SKIP_DB_TESTS)("the Sponsor action with no permission to paint on record", () => {
  let db: Db;
  let animalId: number;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    await truncateDonor(db);
    const [row] = await db
      .insert(animals)
      .values({ name: "Rex", species: "dog", status: "available", shelterExternalId: SHELTER, orgName: "Happy Tails" })
      .returning({ id: animals.id });
    animalId = row.id;
    await db.insert(animalIdentities).values({ animalId, source: "rescuegroups", externalId: "rg-1", lastSeenAt: RECENT, sourceUpdatedAt: RECENT });
    await db.insert(shelterNonprofits).values({
      shelterExternalId: SHELTER,
      everyorgSlug: "happy-tails",
      ein: "36-4219778",
      source: "test",
      fetchedAt: RECENT,
      everyorgClaim: "claimed",
    });
    redirect.mockImplementation((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url });
    });
    vi.stubEnv("EVERYORG_WEBHOOK_TOKEN", "tok");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeDb();
  });

  const submit = () => {
    const form = new FormData();
    form.set("animalId", String(animalId));
    form.set("amount", "5");
    form.set("email", "pat@example.org");
    form.set("seenUnlisted", "1");
    return startSponsorship(form);
  };

  it("is about a shelter with no grant, or this suite would prove nothing", () => {
    expect(hasGrant(shelterByExternalId(SHELTER), "digify")).toBe(false);
  });

  it("on production mints nothing and goes back to the animal, never to www.every.org", async () => {
    vi.stubEnv("EVERYORG_ENV", "production");
    await expect(submit()).rejects.toMatchObject({ url: `/animals/${animalId}` });
    expect(await db.select().from(donationIntents)).toEqual([]);
    expect(setCookie).not.toHaveBeenCalled();
  });

  describe("the branches a donor can hit", () => {
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      data.set("animalId", String(animalId));
      data.set("amount", "5");
      data.set("email", "pat@example.org");
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      return data;
    };
    const urlFrom = (data: FormData) =>
      startSponsorship(data).then(
        () => {
          throw new Error("expected a redirect");
        },
        (err: { url: string }) => err.url,
      );

    beforeEach(() => {
      vi.stubEnv("EVERYORG_ENV", "staging");
    });

    it("never puts a bad address in the URL it sends the donor back on", async () => {
      const url = await urlFrom(form({ email: "pat@" }));
      expect(url).toBe(`/animals/${animalId}/sponsor?amount=5&problem=email`);
      expect(await db.select().from(donationIntents)).toEqual([]);
    });

    it("says so first when the animal just left the listings, and mints nothing", async () => {
      await db.update(animals).set({ status: "adopted" });
      expect(await urlFrom(form({}))).toBe(`/animals/${animalId}/sponsor?amount=5`);
      expect(await db.select().from(donationIntents)).toEqual([]);
    });

    it("lets them carry on once they've seen it, leaving for the listings since this page is gone", async () => {
      await db.update(animals).set({ status: "adopted" });
      const url = new URL(await urlFrom(form({ seenUnlisted: "1" })));
      expect(url.searchParams.get("exit_url")).toBe("https://monsterpaws.org/animals");
      expect(await db.select().from(donationIntents)).toHaveLength(1);
    });

    it("leaves a listed animal's exit on its own page", async () => {
      const url = new URL(await urlFrom(form({})));
      expect(url.searchParams.get("exit_url")).toBe(`https://monsterpaws.org/animals/${animalId}`);
    });
  });

  it("on staging reaches staging.every.org and nothing else", async () => {
    vi.stubEnv("EVERYORG_ENV", "staging");
    const error: { url: string } = await submit().then(
      () => {
        throw new Error("expected a redirect");
      },
      (err) => err,
    );
    expect(new URL(error.url).origin).toBe("https://staging.every.org");
    expect(await db.select().from(donationIntents)).toHaveLength(1);
  });
});
