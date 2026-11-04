import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { visibleAnimalById } from "@/core/animals";
import type { EveryorgEnv } from "@/core/donate/link";
import { paintingMailState } from "@/core/email/painting-state";
import {
  hasGrant,
  SHELTER_EXCLUSIONS,
  shelterByExternalId,
  SHELTERS,
  type ShelterEntry,
  type ShelterExclusion,
} from "@/core/shelters";
import type { Source } from "@/core/sources";
import type { Db } from "@/db/client";
import { animalIdentities, animals, donationIntents, keepsake, paintingEmailSends, shelterNonprofits } from "@/db/schema";

/** 128 CSPRNG bits, never sequential: knowing an id is what lets a forged webhook land (ADR-0027 §4). */
export function mintIntentId(): string {
  return randomBytes(16).toString("base64url");
}

export interface ClaimedNonprofit {
  slug: string;
  ein: string;
}

export interface SponsorGate {
  everyorgEnv: EveryorgEnv;
  asOf?: Date;
  exclusions?: readonly ShelterExclusion[];
  registry?: readonly ShelterEntry[];
}

function mayOffer(shelterExternalId: string, gate: SponsorGate): boolean {
  const granted = hasGrant(shelterByExternalId(shelterExternalId, gate.registry ?? SHELTERS), "digify", gate.asOf ?? new Date());
  return granted || gate.everyorgEnv === "staging";
}

/**
 * The shelter's Every.org profile, only when a gift can be offered at all: no permission
 * to paint, no Sponsor button (ADR-0002 as amended 2026-11-02), and `unknown` or
 * `unclaimed` get none because Every.org takes no card or bank gift for an unclaimed
 * nonprofit (ADR-0002 as amended 2026-10-26). Staging skips the grant only because it
 * moves no real money: never widen this to anything that reaches www.every.org.
 */
export async function sponsorNonprofit(db: Db, shelterExternalId: string, gate: SponsorGate): Promise<ClaimedNonprofit | null> {
  if (!mayOffer(shelterExternalId, gate)) return null;
  const [row] = await db
    .select({ slug: shelterNonprofits.everyorgSlug, ein: shelterNonprofits.ein })
    .from(shelterNonprofits)
    .where(and(eq(shelterNonprofits.shelterExternalId, shelterExternalId), eq(shelterNonprofits.everyorgClaim, "claimed")))
    .limit(1);
  return row ?? null;
}

/**
 * Every shelter `sponsorNonprofit` says yes to, in one query, for the list that leads with them:
 * never a second definition, or an animal could sort first and then show no button (ADR-0015 as amended 2026-11-04).
 */
export async function sponsorableShelterIds(db: Db, gate: SponsorGate): Promise<string[]> {
  const rows = await db
    .select({ id: shelterNonprofits.shelterExternalId })
    .from(shelterNonprofits)
    .where(eq(shelterNonprofits.everyorgClaim, "claimed"));
  return rows.map((row) => row.id).filter((id) => mayOffer(id, gate));
}

export interface Sponsorable {
  animalId: number;
  name: string;
  species: string;
  org: string | null;
  /** read now, never from the page: a tab left open for three days is staler than any cache (ADR-0015 as amended 2026-10-01) */
  listed: boolean;
  source: Source;
  externalId: string;
  nonprofit: ClaimedNonprofit;
}

/**
 * What a donate step may act on, or `null` when this animal can't be sponsored.
 * An animal that left the listings stays sponsorable, since a gift to its shelter
 * is still good, but a shelter that asked to be taken down does not: the opt-out
 * closes the donation path too (ADR-0015 as amended 2026-10-01, ADR-0029 §5).
 */
export async function loadSponsorable(db: Db, animalId: number, gate: SponsorGate): Promise<Sponsorable | null> {
  const asOf = gate.asOf ?? new Date();
  const exclusions = gate.exclusions ?? SHELTER_EXCLUSIONS;
  const [animal] = await db.select().from(animals).where(eq(animals.id, animalId)).limit(1);
  if (!animal?.shelterExternalId) return null;
  if (exclusions.some((e) => e.shelterExternalId === animal.shelterExternalId)) return null;

  const nonprofit = await sponsorNonprofit(db, animal.shelterExternalId, gate);
  if (!nonprofit) return null;

  // A live identity first, then the most recently seen: an intent names the animal
  // by source identity because `animals.id` doesn't survive a replay (ADR-0013).
  const [identity] = await db
    .select({ source: animalIdentities.source, externalId: animalIdentities.externalId })
    .from(animalIdentities)
    .where(eq(animalIdentities.animalId, animal.id))
    .orderBy(sql`${animalIdentities.disappearedAt} is not null`, desc(animalIdentities.lastSeenAt))
    .limit(1);
  if (!identity) return null;

  const [visible] = await db
    .select({ id: animals.id })
    .from(animals)
    .where(visibleAnimalById(animal.id, asOf, exclusions))
    .limit(1);

  return {
    animalId: animal.id,
    name: animal.name,
    species: animal.species,
    org: animal.orgName,
    listed: Boolean(visible),
    source: identity.source,
    externalId: identity.externalId,
    nonprofit,
  };
}

/**
 * Only the shape: whether the address works is what the first email finds out. Never
 * lowercased here, since the part before the @ is the mailbox's own to interpret and
 * only a suppression's HMAC lowercases (ADR-0027 as amended 2026-10-22).
 */
export function parseDonorEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) ? email : null;
}

export async function createIntent(
  db: Db,
  sponsorable: Pick<Sponsorable, "source" | "externalId" | "nonprofit">,
  donorEmail: string,
): Promise<string> {
  const id = mintIntentId();
  await db.insert(donationIntents).values({
    id,
    animalSource: sponsorable.source,
    animalExternalId: sponsorable.externalId,
    nonprofitSlug: sponsorable.nonprofit.slug,
    nonprofitEin: sponsorable.nonprofit.ein,
    donorEmail,
  });
  return id;
}

export interface IntentAnimal {
  intentId: string;
  animalId: number | null;
  name: string | null;
  species: string | null;
  org: string | null;
}

/**
 * The animal an intent names, if our corpus still holds it. Read through the source
 * identity, since a replay may have renumbered `animals` since the click (ADR-0013).
 */
export async function intentAnimal(db: Db, intentId: string): Promise<IntentAnimal | null> {
  // Named columns: this serves a page, and the row also holds the donor's address.
  const [intent] = await db
    .select({ animalSource: donationIntents.animalSource, animalExternalId: donationIntents.animalExternalId })
    .from(donationIntents)
    .where(eq(donationIntents.id, intentId))
    .limit(1);
  if (!intent) return null;
  const [animal] = await db
    .select({ id: animals.id, name: animals.name, species: animals.species, org: animals.orgName })
    .from(animalIdentities)
    .innerJoin(animals, eq(animals.id, animalIdentities.animalId))
    .where(and(eq(animalIdentities.source, intent.animalSource), eq(animalIdentities.externalId, intent.animalExternalId)))
    .limit(1);
  return {
    intentId,
    animalId: animal?.id ?? null,
    name: animal?.name ?? null,
    species: animal?.species ?? null,
    org: animal?.org ?? null,
  };
}

/** Longer than a checkout, so someone just back from Every.org sees this gift, not an older one. */
const JUST_STARTED_MS = 60 * 60 * 1000;

/**
 * The gift the thank-you page means, newest first: a paid one, or one just started. An
 * attempt left unfinished must not hide a paid gift, or its address could never be fixed.
 * Falls back to the newest that still exists: a deleted donor's rows leave ids in the cookie.
 */
export async function thankYouIntent(db: Db, intentIds: readonly string[], asOf: Date = new Date()): Promise<IntentAnimal | null> {
  let newest: string | null = null;
  for (const id of intentIds) {
    const [row] = await db
      .select({ createdAt: donationIntents.createdAt, closedAt: donationIntents.closedAt })
      .from(donationIntents)
      .where(eq(donationIntents.id, id))
      .limit(1);
    if (!row) continue;
    newest ??= id;
    if (row.closedAt || asOf.getTime() - row.createdAt.getTime() < JUST_STARTED_MS) return intentAnimal(db, id);
  }
  return newest ? intentAnimal(db, newest) : null;
}

/**
 * Names a gift in a form without putting its id in the page: the id is the credential, and
 * the cookie is httpOnly to keep it from a script. 128 random bits can't be guessed from this.
 */
export function intentRef(intentId: string): string {
  return createHash("sha256").update(intentId).digest("hex").slice(0, 32);
}

/** Only for the holder of this intent's cookie: this is the one read that shows a page the address. */
export async function intentDonorEmail(db: Db, intentId: string): Promise<string | null> {
  const [row] = await db
    .select({ donorEmail: donationIntents.donorEmail })
    .from(donationIntents)
    .where(eq(donationIntents.id, intentId))
    .limit(1);
  return row?.donorEmail ?? null;
}

export type AddressFix = "saved" | "resending" | "already-sent" | "held" | "erased";

/**
 * A donor fixing a typo, which is how the address gets checked without a second email
 * (ADR-0027 as amended 2026-11-02). Never writes over an erased address, which would bring back a row
 * we told the donor was gone, except after a bounce, when the page asks for a new one and the send row
 * is cleared so it mails again (decision 4). Never changes the address once the mail has left: nothing
 * would go to the new one, and the page would say "Saved." about a painting already gone.
 */
export async function correctDonorEmail(db: Db, intentId: string, donorEmail: string): Promise<AddressFix> {
  return db.transaction(async (tx) => {
    const state = await paintingMailState(tx, intentId);
    if (state === "held") return "held";
    if (state === "on-its-way" || state === "sent") return "already-sent";
    if (state === "bounced") {
      await tx.update(donationIntents).set({ donorEmail }).where(eq(donationIntents.id, intentId));
      await tx
        .delete(paintingEmailSends)
        .where(inArray(paintingEmailSends.keepsakeId, tx.select({ id: keepsake.id }).from(keepsake).where(eq(keepsake.intentId, intentId))));
      return "resending";
    }
    const changed = await tx
      .update(donationIntents)
      .set({ donorEmail })
      .where(and(eq(donationIntents.id, intentId), isNotNull(donationIntents.donorEmail)))
      .returning({ id: donationIntents.id });
    return changed.length > 0 ? "saved" : "erased";
  });
}

export const ABANDONED_AFTER_DAYS = 30;

/**
 * Erases the address of a gift nobody finished, as the privacy page promises. Never
 * touches a closed intent, whose address is held until its painting is delivered
 * (ADR-0027 as amended 2026-11-02). The row stays, since a bank gift's late webhook
 * still has to find it.
 */
export async function eraseAbandonedAddresses(db: Db, asOf: Date = new Date()): Promise<number> {
  const cutoff = new Date(asOf.getTime() - ABANDONED_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const erased = await db
    .update(donationIntents)
    .set({ donorEmail: null })
    .where(and(isNull(donationIntents.closedAt), isNotNull(donationIntents.donorEmail), lt(donationIntents.createdAt, cutoff)))
    .returning({ id: donationIntents.id });
  return erased.length;
}

export const INTENT_COOKIE = "mp_intents";
export const INTENT_ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_COOKIE_INTENTS = 20;

/** Newest first. Values that aren't ids are dropped: the cookie is httpOnly, not tamper-proof. */
export function intentIdsOf(cookie: string | undefined): string[] {
  return (cookie ?? "").split(".").filter((id) => INTENT_ID.test(id));
}

export function withIntent(cookie: string | undefined, id: string): string {
  return [id, ...intentIdsOf(cookie).filter((known) => known !== id)].slice(0, MAX_COOKIE_INTENTS).join(".");
}

export const INTENT_COOKIE_DAYS = 30;

/**
 * Lets the thank-you page name this browser's gift and fix its address, and nothing
 * more: the keepsake goes by email. Never lengthen it lightly: that page shows the
 * address to anyone using this browser (ADR-0027 as amended 2026-11-02). Secure holds
 * on http://localhost too, which browsers treat as a secure context.
 */
export const INTENT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: INTENT_COOKIE_DAYS * 24 * 60 * 60,
} as const;
