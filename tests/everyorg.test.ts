import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimOf,
  everyorgClient,
  everyorgClientFromEnv,
  parseNonprofit,
  recordShelterNonprofit,
  type EveryorgNonprofit,
} from "@/core/outreach/everyorg";
import { closeDb, type Db } from "@/db/client";
import { shelterNonprofits } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateDonor } from "./support/db";

/**
 * The Every.org client on recorded response shapes (read live 2026-10-27;
 * see the module comment) and the one writer of `shelter_nonprofits`
 * (ADR-0029 §2). What is pinned: the claim is a tri-state that never rounds
 * up, a missing EIN is a normal null, and a re-check replaces the row.
 */

/** The fields Every.org's `nonprofit` record carries that we read, as PAWS Chicago's came back. */
const pawsChicago = {
  data: {
    nonprofit: {
      id: "x",
      name: "PAWS Chicago",
      primarySlug: "paws-chicago",
      ein: "364219778",
      hasAdmin: true,
      donationsEnabled: true,
      websiteUrl: "http://pawschicago.org",
      locationAddress: "Chicago, Illinois, 60614 United States",
      profileUrl: "https://www.every.org/paws-chicago",
    },
  },
};

const borderTails = {
  data: {
    nonprofit: {
      id: "y",
      name: "Border Tails Rescue",
      primarySlug: "border-tails-rescue",
      ein: "850940489",
      hasAdmin: false,
      donationsEnabled: true,
      websiteUrl: null,
      locationAddress: "NORTHBROOK, IL",
      profileUrl: "https://www.every.org/border-tails-rescue",
    },
  },
};

describe("ADR-0029 Every.org nonprofit lookup", () => {
  it("reads the claim as a tri-state and never rounds a missing one up to claimed", () => {
    expect(claimOf({ hasAdmin: true })).toBe("claimed");
    expect(claimOf({ hasAdmin: false })).toBe("unclaimed");
    expect(claimOf({})).toBe("unknown");
    expect(claimOf({ hasAdmin: "true" })).toBe("unknown");
    expect(claimOf({ hasAdmin: 1 })).toBe("unknown");
  });

  it("parses the record into what the ask and the match need", () => {
    expect(parseNonprofit(pawsChicago)).toEqual({
      slug: "paws-chicago",
      ein: "36-4219778",
      name: "PAWS Chicago",
      claim: "claimed",
      profileUrl: "https://www.every.org/paws-chicago",
      websiteUrl: "http://pawschicago.org",
      locationAddress: "Chicago, Illinois, 60614 United States",
    });
    expect(parseNonprofit(borderTails)).toMatchObject({ slug: "border-tails-rescue", claim: "unclaimed", websiteUrl: null });
    expect(() => parseNonprofit({ data: { nonprofit: { name: "X" } } })).toThrow(/shape changed/);
    expect(() => parseNonprofit({ nonprofit: pawsChicago.data.nonprofit })).toThrow(/shape changed/);
  });

  it("asks by the EIN's digits with the key, treats 404 as no nonprofit, and anything else as an error", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("/nonprofit/364219778?")) return Response.json(pawsChicago);
      if (String(url).includes("/nonprofit/000000001?")) return new Response("", { status: 404 });
      return new Response("", { status: 500 });
    }) as typeof fetch;
    const client = everyorgClient({ apiKey: "k&y", fetchImpl, baseUrl: "https://api.test/v0.2" });

    expect((await client.nonprofitByEin("36-4219778"))?.slug).toBe("paws-chicago");
    expect(await client.nonprofitByEin("000000001")).toBeNull();
    await expect(client.nonprofitByEin("00-0000002")).rejects.toThrow(/answered 500 for EIN 00-0000002/);
    expect(calls[0]).toBe("https://api.test/v0.2/nonprofit/364219778?apiKey=k%26y");
  });

  it("refuses to build a client without the key", () => {
    expect(() => everyorgClientFromEnv({})).toThrow(/EVERYORG_API_KEY/);
  });
});

describe.skipIf(SKIP_DB_TESTS)("ADR-0029 shelter_nonprofits writer", () => {
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

  it("writes a checked match with its source, and a re-check replaces the row rather than adding one", async () => {
    const first: EveryorgNonprofit = parseNonprofit(borderTails);
    const at = new Date("2026-11-01T10:00:00Z");
    await recordShelterNonprofit(db, { shelterExternalId: "rescuegroups:org:3077", nonprofit: first, checkedBy: "Logan", fetchedAt: at });

    const later = new Date("2026-11-20T10:00:00Z");
    await recordShelterNonprofit(db, {
      shelterExternalId: "rescuegroups:org:3077",
      nonprofit: { ...first, claim: "claimed" },
      checkedBy: "Logan",
      fetchedAt: later,
    });

    const rows = await db.select().from(shelterNonprofits);
    expect(rows).toEqual([
      {
        shelterExternalId: "rescuegroups:org:3077",
        everyorgSlug: "border-tails-rescue",
        ein: "85-0940489",
        source: "IRS BMF + every.org, checked by Logan",
        fetchedAt: later,
        everyorgClaim: "claimed",
        claimCheckedAt: later,
      },
    ]);
  });
});
