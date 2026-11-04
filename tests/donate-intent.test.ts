import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ABANDONED_AFTER_DAYS,
  correctDonorEmail,
  createIntent,
  eraseAbandonedAddresses,
  intentDonorEmail,
  loadSponsorable,
  parseDonorEmail,
  sponsorNonprofit,
  thankYouIntent,
  type SponsorGate,
} from "@/core/donate/intent";
import type { Grant, ShelterEntry } from "@/core/shelters";
import type { EveryorgClaim } from "@/db/schema";
import { animalIdentities, animals, donationIntents, keepsake, paintingEmailSends, shelterNonprofits } from "@/db/schema";
import { paintingMailState } from "@/core/email/painting-state";
import { closeDb, type Db } from "@/db/client";
import { SKIP_DB_TESTS, testDb, truncateCorpus, truncateDonor } from "./support/db";

/**
 * Who may be given a Sponsor button and what an intent records. Each case is one
 * a page reading only `shelter_nonprofits`, or only the visibility predicate,
 * would get wrong (ADR-0002 as amended 2026-11-02, ADR-0015 as amended 2026-10-01).
 */

const NOW = new Date("2026-03-15T12:00:00Z");
const RECENT = new Date("2026-03-14T12:00:00Z");
const LONG_AGO = new Date("2025-11-01T12:00:00Z");
const SHELTER = "rescuegroups:org:1";

const digify = (over: Partial<Grant> = {}): Grant => ({
  permission: "digify",
  grantedAt: "2026-01-01",
  granter: "A. Director, director",
  basis: "yes, paint them",
  evidence: "doc/consent/happy-tails.md",
  ...over,
});
const entry = (over: Partial<ShelterEntry> = {}): ShelterEntry => ({
  slug: "happy-tails",
  name: "Happy Tails",
  siteUrl: "https://happytails.example",
  listingsUrl: "https://happytails.example/animals",
  tier: "first-party-scrape",
  goldenFixture: null,
  shelterExternalIds: [SHELTER],
  grants: [digify()],
  ...over,
});
/** Production: the case that takes real money. */
const GATE: SponsorGate = { everyorgEnv: "production", asOf: NOW, exclusions: [], registry: [entry()] };

describe.skipIf(SKIP_DB_TESTS)("who can be sponsored (ADR-0027 §3)", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    await truncateDonor(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function seedAnimal(overrides: { shelter?: string | null; status?: string } = {}): Promise<number> {
    const shelter = overrides.shelter === undefined ? SHELTER : overrides.shelter;
    const [row] = await db
      .insert(animals)
      .values({ name: "Rex", species: "dog", status: overrides.status ?? "available", shelterExternalId: shelter, orgName: "Happy Tails" })
      .returning({ id: animals.id });
    await db.insert(animalIdentities).values({
      animalId: row.id,
      source: "rescuegroups",
      externalId: `rg-${row.id}`,
      lastSeenAt: RECENT,
      sourceUpdatedAt: RECENT,
    });
    return row.id;
  }

  async function mapShelter(claim: EveryorgClaim) {
    await db.insert(shelterNonprofits).values({
      shelterExternalId: SHELTER,
      everyorgSlug: "happy-tails",
      ein: "36-4219778",
      source: "test",
      fetchedAt: NOW,
      everyorgClaim: claim,
    });
  }

  it("offers a listed animal whose shelter has claimed its profile", async () => {
    await mapShelter("claimed");
    const id = await seedAnimal();
    expect(await loadSponsorable(db, id, GATE)).toMatchObject({
      animalId: id,
      name: "Rex",
      org: "Happy Tails",
      listed: true,
      source: "rescuegroups",
      externalId: `rg-${id}`,
      nonprofit: { slug: "happy-tails", ein: "36-4219778" },
    });
  });

  it("offers nothing without a confirmed claim", async () => {
    const id = await seedAnimal();
    expect(await loadSponsorable(db, id, GATE), "no mapping").toBeNull();
    for (const claim of ["unclaimed", "unknown"] as const) {
      await db.delete(shelterNonprofits);
      await mapShelter(claim);
      expect(await loadSponsorable(db, id, GATE), claim).toBeNull();
    }
  });

  describe("no permission to paint, no Sponsor button (ADR-0002 as amended 2026-11-02)", () => {
    const refused: [string, ShelterEntry[]][] = [
      ["no registry entry", []],
      ["a grant of something else", [entry({ grants: [{ ...digify(), permission: "display" }] })]],
      ["a revoked grant", [entry({ grants: [digify({ revokedAt: "2026-02-01" })] })]],
      ["a grant from after this moment", [entry({ grants: [digify({ grantedAt: "2026-06-01" })] })]],
      ["a grant from an entry not linked to this listing", [entry({ shelterExternalIds: ["rescuegroups:org:2"] })]],
      ["a grant from an entry linked to nothing", [entry({ shelterExternalIds: undefined })]],
    ];

    it.each(refused)("refuses a claimed shelter with %s", async (_, registry) => {
      await mapShelter("claimed");
      const id = await seedAnimal();
      expect(await sponsorNonprofit(db, SHELTER, { ...GATE, registry })).toBeNull();
      expect(await loadSponsorable(db, id, { ...GATE, registry })).toBeNull();
    });

    it("needs the claim as well as the grant", async () => {
      await mapShelter("unclaimed");
      expect(await sponsorNonprofit(db, SHELTER, GATE)).toBeNull();
    });

    it("skips the grant only on staging, which moves no real money, and never the claim", async () => {
      const staging: SponsorGate = { ...GATE, everyorgEnv: "staging", registry: [] };
      await mapShelter("unknown");
      expect(await sponsorNonprofit(db, SHELTER, staging)).toBeNull();
      await db.delete(shelterNonprofits);
      await mapShelter("claimed");
      expect(await sponsorNonprofit(db, SHELTER, staging)).toMatchObject({ slug: "happy-tails" });
      expect(await sponsorNonprofit(db, SHELTER, { ...staging, everyorgEnv: "production" })).toBeNull();
    });
  });

  it("offers nothing for an animal with no shelter, or no animal", async () => {
    await mapShelter("claimed");
    expect(await loadSponsorable(db, await seedAnimal({ shelter: null }), GATE)).toBeNull();
    expect(await loadSponsorable(db, 999_999, GATE)).toBeNull();
  });

  it("stays sponsorable after leaving the listings, and says so", async () => {
    await mapShelter("claimed");
    const adopted = await seedAnimal({ status: "adopted" });
    expect(await loadSponsorable(db, adopted, GATE)).toMatchObject({ animalId: adopted, listed: false });
  });

  it("closes the donation path when the shelter asked to be taken down (ADR-0029 §5)", async () => {
    await mapShelter("claimed");
    const id = await seedAnimal();
    const exclusions = [{ shelterExternalId: SHELTER }] as unknown as SponsorGate["exclusions"];
    expect(await loadSponsorable(db, id, { ...GATE, exclusions })).toBeNull();
  });

  it("names the animal by a live identity over a gone one, however recently the gone one was seen", async () => {
    await mapShelter("claimed");
    const id = await seedAnimal();
    await db.insert(animalIdentities).values({
      animalId: id,
      source: "shelterluv",
      externalId: "sl-gone",
      lastSeenAt: new Date("2026-03-15T00:00:00Z"),
      disappearedAt: new Date("2026-03-15T01:00:00Z"),
    });
    expect(await loadSponsorable(db, id, GATE)).toMatchObject({ source: "rescuegroups", externalId: `rg-${id}` });
  });

  it("falls back to the most recently seen identity when none is live", async () => {
    await mapShelter("claimed");
    const [row] = await db
      .insert(animals)
      .values({ name: "Rex", species: "dog", status: "available", shelterExternalId: SHELTER })
      .returning({ id: animals.id });
    await db.insert(animalIdentities).values([
      { animalId: row.id, source: "rescuegroups", externalId: "older", lastSeenAt: LONG_AGO, disappearedAt: RECENT },
      { animalId: row.id, source: "shelterluv", externalId: "newer", lastSeenAt: RECENT, disappearedAt: RECENT },
    ]);
    expect(await loadSponsorable(db, row.id, GATE)).toMatchObject({ source: "shelterluv", externalId: "newer", listed: false });
  });

  it("records an open intent with no owner, naming the animal by source identity", async () => {
    await mapShelter("claimed");
    const sponsorable = await loadSponsorable(db, await seedAnimal(), GATE);
    const id = await createIntent(db, sponsorable!, "pat@example.org");
    const [intent] = await db.select().from(donationIntents).where(eq(donationIntents.id, id));
    expect(intent).toMatchObject({
      animalSource: "rescuegroups",
      animalExternalId: sponsorable!.externalId,
      nonprofitSlug: "happy-tails",
      nonprofitEin: "36-4219778",
      donorEmail: "pat@example.org",
      accountId: null,
      closedAt: null,
    });
  });

  describe("the address on an intent (ADR-0027 as amended 2026-11-02)", () => {
    async function intent(over: { createdAt?: Date; closedAt?: Date } = {}): Promise<string> {
      await db.insert(shelterNonprofits).values({ shelterExternalId: SHELTER, everyorgSlug: "happy-tails", ein: "36-4219778", source: "test", fetchedAt: NOW, everyorgClaim: "claimed" }).onConflictDoNothing();
      const sponsorable = await loadSponsorable(db, await seedAnimal(), GATE);
      const id = await createIntent(db, sponsorable!, "pat@example.org");
      if (over.createdAt || over.closedAt) await db.update(donationIntents).set(over).where(eq(donationIntents.id, id));
      return id;
    }
    const daysBefore = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

    it("is erased from a gift nobody finished, only after the days the privacy page promises", async () => {
      const old = await intent({ createdAt: daysBefore(ABANDONED_AFTER_DAYS + 1) });
      const recent = await intent({ createdAt: daysBefore(ABANDONED_AFTER_DAYS - 1) });

      expect(await eraseAbandonedAddresses(db, NOW)).toBe(1);

      expect(await intentDonorEmail(db, old)).toBeNull();
      expect(await intentDonorEmail(db, recent)).toBe("pat@example.org");
      const [row] = await db.select().from(donationIntents).where(eq(donationIntents.id, old));
      expect(row, "the row stays: a late bank webhook still has to find it").toMatchObject({ closedAt: null, nonprofitSlug: "happy-tails" });
    });

    it("is never erased from a finished gift, however old: it waits for the painting", async () => {
      const finished = await intent({ createdAt: daysBefore(400), closedAt: daysBefore(399) });
      expect(await eraseAbandonedAddresses(db, NOW)).toBe(0);
      expect(await intentDonorEmail(db, finished)).toBe("pat@example.org");
    });

    it("can be corrected, but an erased one never comes back", async () => {
      const id = await intent();
      expect(await correctDonorEmail(db, id, "pat.smith@example.org")).toBe("saved");
      expect(await intentDonorEmail(db, id)).toBe("pat.smith@example.org");

      await db.update(donationIntents).set({ donorEmail: null }).where(eq(donationIntents.id, id));
      expect(await correctDonorEmail(db, id, "someone@example.org")).toBe("erased");
      expect(await intentDonorEmail(db, id)).toBeNull();
    });

    describe("once the painting's mail exists (ADR-0027 as amended 2026-11-02, decision 4)", () => {
      async function sendRow(id: string, row: { sentAt?: Date; refusedCode?: string }) {
        const [made] = await db.insert(keepsake).values({ intentId: id, shareToken: `tok-${id}`, snapshottedAt: new Date() }).returning({ id: keepsake.id });
        await db.insert(paintingEmailSends).values({ keepsakeId: made.id, claimedAt: new Date(), providerId: "re_1", ...row });
        return made.id;
      }

      it("refuses a fix once the mail has gone, and keeps the address it went to", async () => {
        const id = await intent();
        await sendRow(id, { sentAt: new Date() });
        expect(await correctDonorEmail(db, id, "new@example.org")).toBe("already-sent");
        expect(await intentDonorEmail(db, id)).toBe("pat@example.org");
        expect(await paintingMailState(db, id)).toBe("sent");
      });

      it("refuses a fix while a send is claimed and its outcome unknown", async () => {
        const id = await intent();
        await sendRow(id, {});
        expect(await correctDonorEmail(db, id, "new@example.org")).toBe("already-sent");
        expect(await paintingMailState(db, id)).toBe("on-its-way");
      });

      it("takes a new address after a bounce, brings it back from erased, and clears the row so it mails again", async () => {
        const id = await intent();
        await sendRow(id, { sentAt: new Date(), refusedCode: "bounced" });
        await db.update(donationIntents).set({ donorEmail: null }).where(eq(donationIntents.id, id));
        expect(await paintingMailState(db, id)).toBe("bounced");
        expect(await correctDonorEmail(db, id, "new@example.org")).toBe("resending");
        expect(await intentDonorEmail(db, id)).toBe("new@example.org");
        expect(await db.select().from(paintingEmailSends)).toHaveLength(0);
        expect(await paintingMailState(db, id)).toBe("not-sent");
      });

      it("never clears a row held for any other refusal", async () => {
        const id = await intent();
        await sendRow(id, { refusedCode: "invalid_idempotent_request" });
        expect(await correctDonorEmail(db, id, "new@example.org")).toBe("already-sent");
        expect(await db.select().from(paintingEmailSends)).toHaveLength(1);
      });
    });

    describe("which gift the thank-you page means", () => {
      const NEWEST_FIRST = (...ids: string[]) => ids;

      it("is the one just started, over an older paid one, so a donor back from Every.org sees it", async () => {
        const paid = await intent({ createdAt: daysBefore(5), closedAt: daysBefore(5) });
        const justStarted = await intent({ createdAt: new Date(NOW.getTime() - 60_000) });
        expect((await thankYouIntent(db, NEWEST_FIRST(justStarted, paid), NOW))?.intentId).toBe(justStarted);
      });

      it("is the paid one, over a newer attempt left unfinished, or its address could never be fixed", async () => {
        const paid = await intent({ createdAt: daysBefore(5), closedAt: daysBefore(5) });
        const abandoned = await intent({ createdAt: daysBefore(2) });
        expect((await thankYouIntent(db, NEWEST_FIRST(abandoned, paid), NOW))?.intentId).toBe(paid);
      });

      it("is the newest paid one when there are several", async () => {
        const older = await intent({ createdAt: daysBefore(5), closedAt: daysBefore(5) });
        const newer = await intent({ createdAt: daysBefore(2), closedAt: daysBefore(2) });
        expect((await thankYouIntent(db, NEWEST_FIRST(newer, older), NOW))?.intentId).toBe(newer);
      });

      it("falls back to the newest that exists, and skips what was deleted", async () => {
        const older = await intent({ createdAt: daysBefore(5) });
        const newer = await intent({ createdAt: daysBefore(2) });
        expect((await thankYouIntent(db, NEWEST_FIRST("gone-gone-gone-gone-gone", newer, older), NOW))?.intentId).toBe(newer);
        expect(await thankYouIntent(db, ["gone-gone-gone-gone-gone"], NOW)).toBeNull();
        expect(await thankYouIntent(db, [], NOW)).toBeNull();
      });
    });
  });
});

describe("the donor's email on the sponsor page (ADR-0027 as amended 2026-11-02)", () => {
  it("takes an address as typed, trimmed, with its case kept", () => {
    expect(parseDonorEmail("pat@example.org")).toBe("pat@example.org");
    expect(parseDonorEmail("  Pat.Smith+dogs@Mail.Example.org\n")).toBe("Pat.Smith+dogs@Mail.Example.org");
  });

  it("refuses what can't be an address, or nothing at all", () => {
    for (const bad of ["", "   ", "pat", "pat@", "@example.org", "pat@example", "pat@@example.org", "pat @example.org", "pat@example..org", null, undefined, 5]) {
      expect(parseDonorEmail(bad), String(bad)).toBeNull();
    }
    expect(parseDonorEmail(`${"a".repeat(250)}@example.org`)).toBeNull();
  });
});
