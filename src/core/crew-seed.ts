import { and, eq } from "drizzle-orm";
import { createIntent, loadSponsorable, parseDonorEmail } from "@/core/donate/intent";
import { receiveWebhook } from "@/core/donate/webhook";
import { crewExternalId } from "@/core/keepsake";
import type { Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals, shelterNonprofits } from "@/db/schema";
import { CREW, crewPet } from "@/ui/crew";

export const DEMO_DATABASE = "monsterpaws_demo";
const CREW_SHELTER = "monster-paws-crew";

export interface DemoNonprofit {
  slug: string;
  ein: string;
  name: string;
}

/** Enough for a rehearsal, where a delivery is posted by hand. Every.org has no such page, so a real staging gift needs Logan's pick. */
export const REHEARSAL_NONPROFIT: DemoNonprofit = { slug: "demo-rehearsal", ein: "00-0000000", name: "A Rehearsal Nonprofit" };

/** Never against another database: the crew beside real listings would let a staging gift reach a RescueGroups photo (ADR-0028 §6). */
export function assertDemoDatabase(connectionString: string | undefined): string {
  const name = connectionString ? new URL(connectionString).pathname.slice(1) : "";
  if (name !== DEMO_DATABASE) throw new Error(`refusing: DATABASE_URL must name ${DEMO_DATABASE}`);
  return connectionString!;
}

/** Writes or refreshes the five pets, so a run also brings a stale crew back into view. */
export async function seedCrew(db: Db, nonprofit: DemoNonprofit, asOf: Date = new Date()): Promise<number> {
  await db
    .insert(shelterNonprofits)
    .values({
      shelterExternalId: CREW_SHELTER,
      everyorgSlug: nonprofit.slug,
      ein: nonprofit.ein,
      source: "the demo's seed, chosen by Logan",
      fetchedAt: asOf,
      everyorgClaim: "claimed",
      claimCheckedAt: asOf,
    })
    .onConflictDoUpdate({
      target: shelterNonprofits.shelterExternalId,
      set: { everyorgSlug: nonprofit.slug, ein: nonprofit.ein, fetchedAt: asOf, claimCheckedAt: asOf },
    });

  for (const pet of CREW) {
    const externalId = crewExternalId(pet.slug);
    const [known] = await db
      .select({ animalId: animalIdentities.animalId })
      .from(animalIdentities)
      .where(and(eq(animalIdentities.source, "manual"), eq(animalIdentities.externalId, externalId)))
      .limit(1);
    const facts = {
      name: pet.name,
      species: pet.species,
      breed: pet.kind,
      status: "available",
      sex: pet.she ? "Female" : "Male",
      shelterExternalId: CREW_SHELTER,
      orgName: nonprofit.name,
      listedAt: asOf,
    };
    let animalId = known?.animalId;
    if (animalId) {
      await db.update(animals).set({ ...facts, updatedAt: asOf }).where(eq(animals.id, animalId));
      await db
        .update(animalIdentities)
        .set({ lastSeenAt: asOf, sourceUpdatedAt: asOf })
        .where(and(eq(animalIdentities.source, "manual"), eq(animalIdentities.externalId, externalId)));
    } else {
      const [row] = await db.insert(animals).values(facts).returning({ id: animals.id });
      animalId = row.id;
      await db.insert(animalIdentities).values({ animalId, source: "manual", externalId, lastSeenAt: asOf, sourceUpdatedAt: asOf });
    }
    const display = {
      description: pet.about,
      photos: [{ url: `/brand/crew/${pet.slug}-photo.jpg`, width: pet.photo[0], height: pet.photo[1] }],
      listingOrg: nonprofit.name,
      fetchedAt: asOf,
    } as Partial<typeof animalDisplay.$inferInsert>;
    await db
      .insert(animalDisplay)
      .values({ animalId, source: "manual", ...display } as typeof animalDisplay.$inferInsert)
      .onConflictDoUpdate({ target: [animalDisplay.animalId, animalDisplay.source], set: display });
  }
  return CREW.length;
}

/**
 * A recorded gift with no Every.org in it, through the real decision, because only Logan can run a
 * staging one. The address gets real mail once the mail runs, so never pass one that isn't ours.
 */
export async function rehearsalGift(db: Db, slug: string, donorEmail: string): Promise<string> {
  const pet = crewPet(slug);
  if (!pet) throw new Error(`no crew pet '${slug}'`);
  const address = parseDonorEmail(donorEmail);
  if (!address) throw new Error("that doesn't look like an email address");
  const [identity] = await db
    .select({ animalId: animalIdentities.animalId })
    .from(animalIdentities)
    .where(and(eq(animalIdentities.source, "manual"), eq(animalIdentities.externalId, crewExternalId(slug))))
    .limit(1);
  if (!identity) throw new Error("the crew isn't seeded");
  const sponsorable = await loadSponsorable(db, identity.animalId, { everyorgEnv: "staging" });
  if (!sponsorable) throw new Error("the crew has no nonprofit");

  const intentId = await createIntent(db, sponsorable, address);
  const [nonprofit] = await db.select().from(shelterNonprofits).where(eq(shelterNonprofits.shelterExternalId, CREW_SHELTER));
  const body = JSON.stringify({
    event: "donation.completed",
    chargeId: `rehearsal-${intentId}`,
    partnerDonationId: intentId,
    toNonprofit: { slug: nonprofit.everyorgSlug, ein: nonprofit.ein.replace(/\D/g, ""), name: sponsorable.org ?? pet.name },
    amount: "5",
    netAmount: "4.50",
    currency: "USD",
    frequency: "ONCE",
    donationDate: new Date().toISOString(),
    paymentMethod: "STRIPE",
  });
  const { outcome } = await receiveWebhook(db, { body, headers: [], secrets: {} });
  if (outcome !== "recorded") throw new Error(`rehearsal delivery came back ${outcome}`);
  return intentId;
}
