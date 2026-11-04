import { randomBytes } from "node:crypto";
import { resolve, sep } from "node:path";
import { and, asc, eq, inArray, isNotNull, isNull, like, notExists, or, sql } from "drizzle-orm";
import { pickLicensedDisplay } from "@/core/display";
import type { DisplayPhoto } from "@/core/ingest/pipeline";
import { hasGrant, SHELTERS, shelterByExternalId, type ShelterEntry } from "@/core/shelters";
import type { Source } from "@/core/sources";
import type { Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals, donationIntents, donations, keepsake, keepsakeFact } from "@/db/schema";
import { crewPet, type CrewPet } from "@/ui/crew";

export const ART_GENERATE = "art.generate";

export interface ArtGenerateJob {
  keepsakeId: number;
  /** a listing's licensed photos, read at each send and never a `keepsake_fact`: under a grant a keepsake holds no photo (ADR-0022 as amended 2026-10-27). A crew pet has none here. */
  photos?: DisplayPhoto[];
}

/** Both sides create the queue with these, because `send` throws on a missing one. An expiry shorter than a cycle would run a second copy beside the first. */
export const ART_QUEUE_OPTIONS = { retryLimit: 1, retryDelay: 60, expireInSeconds: 3600 } as const;

/**
 * Never drop `singletonSeconds`: on a standard queue pg-boss 12.26.3 dedupes only on the slot it
 * sets, so a key alone queues a job every tick, and the hour is what stops a failing job looping the card.
 */
export function artJobOptions(keepsakeId: number): { singletonKey: string; singletonSeconds: number } {
  return { singletonKey: `keepsake:${keepsakeId}`, singletonSeconds: 3600 };
}

/** What the handler may read, and it reads nothing else: never `animals` or `animal_display` (ADR-0022 §1). */
export const FACT = {
  name: "name",
  species: "species",
  kind: "kind",
  age: "age",
  sex: "sex",
  /** a listing's shelter, for the card's credit (ADR-0006 decision 5); never on a crew pet */
  shelter: "shelter",
  sourcePhoto: "source_photo",
  art: "art",
} as const;

/** The founder's own pets, recorded in doc/consent/0001-the-crew.md; there is no shelter behind this basis (ADR-0028 §6). */
export const CREW_BASIS = "grant:monster-paws-crew:digify";

/** Names the photo and never a path: the painter reads its own originals through its crop table, and `photo` null leaves the choice to it. */
export interface SourcePhotoFact {
  pet: string;
  photo: string | null;
}

/** Four rows, written in one transaction: "owed" means no art fact, so a part-written set would never be finished. An art fact holds a key, never the image (ADR-0003). */
export interface ArtFact {
  key: string;
  /** 1 to 4, in generation order: the card's face until the donor picks (ADR-0004 as amended 2026-10-14) */
  candidate: number;
}

export function artKey(keepsakeId: number, candidate: number): string {
  return `keepsakes/${keepsakeId}/${candidate}.jpg`;
}

/** The local store. Worktrees share it only through `ART_STORE_DIR`, so a relative default would hide art from the session that mails it. */
export function artFilePath(key: string, root: string | undefined = process.env.ART_STORE_DIR): string {
  if (!root) throw new Error("ART_STORE_DIR is not set");
  const base = resolve(root);
  const path = resolve(base, key);
  if (!path.startsWith(base + sep)) throw new Error("art key leaves the store");
  return path;
}

export function mintShareToken(): string {
  return randomBytes(16).toString("base64url");
}

const CREW_SOURCE = "manual";
const CREW_ID_PREFIX = "crew:";

export function crewExternalId(slug: string): string {
  return `${CREW_ID_PREFIX}${slug}`;
}

function crewPetOf(source: string, externalId: string): CrewPet | null {
  if (source !== CREW_SOURCE || !externalId.startsWith(CREW_ID_PREFIX)) return null;
  return crewPet(externalId.slice(CREW_ID_PREFIX.length));
}

export function grantBasis(slug: string): string {
  return `grant:${slug}:digify`;
}

interface Snapshot {
  basis: string;
  facts: [string, unknown][];
}

function crewSnapshot(pet: CrewPet): Snapshot {
  const photo: SourcePhotoFact = { pet: pet.slug, photo: null };
  return {
    basis: CREW_BASIS,
    facts: [
      [FACT.name, pet.name],
      [FACT.species, pet.species],
      [FACT.kind, pet.kind],
      [FACT.age, pet.age],
      [FACT.sex, pet.she ? "female" : "male"],
      [FACT.sourcePhoto, photo],
    ],
  };
}

/** The grant as of the gift's date, never today's: a gift made before a withdrawal still gets its painting (ADR-0022 as amended 2026-11-02). */
async function listingSnapshot(
  db: Db,
  gift: { source: Source; externalId: string; donatedAt: Date },
  registry: readonly ShelterEntry[],
): Promise<Snapshot | null> {
  const [animal] = await db
    .select({ name: animals.name, species: animals.species, breed: animals.breed, ageGroup: animals.ageGroup, sex: animals.sex, shelterExternalId: animals.shelterExternalId })
    .from(animalIdentities)
    .innerJoin(animals, eq(animals.id, animalIdentities.animalId))
    .where(and(eq(animalIdentities.source, gift.source), eq(animalIdentities.externalId, gift.externalId)))
    .limit(1);
  if (!animal?.shelterExternalId) return null;
  const shelter = shelterByExternalId(animal.shelterExternalId, registry);
  if (!shelter || !hasGrant(shelter, "digify", gift.donatedAt)) return null;
  const facts: [string, string | null][] = [
    [FACT.name, animal.name],
    [FACT.species, animal.species],
    [FACT.kind, animal.breed],
    [FACT.age, animal.ageGroup],
    [FACT.sex, animal.sex],
    [FACT.shelter, shelter.name],
  ];
  return { basis: grantBasis(shelter.slug), facts: facts.filter(([, value]) => value !== null) };
}

/**
 * Writes one keepsake and its facts, or nothing: only a recorded gift, to a crew pet or an animal whose
 * shelter held a `digify` grant that day. Never widen this: the staging gate skips the grant, so a staging
 * gift on an ungranted listing must still paint nothing (ADR-0006 decision 6). Returns the new id, or null
 * when it wrote nothing; the share token is read from the row, because a losing sweep's token is thrown away.
 */
export async function snapshotKeepsake(
  db: Db,
  intentId: string,
  asOf: Date = new Date(),
  registry: readonly ShelterEntry[] = SHELTERS,
): Promise<number | null> {
  const [gift] = await db
    .select({ source: donationIntents.animalSource, externalId: donationIntents.animalExternalId, donatedAt: donations.donatedAt })
    .from(donationIntents)
    .innerJoin(donations, eq(donations.intentId, donationIntents.id))
    .where(eq(donationIntents.id, intentId))
    .orderBy(asc(donations.donatedAt))
    .limit(1);
  if (!gift) return null;
  const pet = crewPetOf(gift.source, gift.externalId);
  const snapshot = pet ? crewSnapshot(pet) : await listingSnapshot(db, gift, registry);
  if (!snapshot) return null;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(keepsake)
      .values({ intentId, shareToken: mintShareToken(), snapshottedAt: asOf })
      .onConflictDoNothing({ target: keepsake.intentId })
      .returning({ id: keepsake.id });
    if (!row) return null;
    await tx.insert(keepsakeFact).values(
      snapshot.facts.map(([field, value]) => ({ keepsakeId: row.id, field, value, basis: snapshot.basis, snapshottedAt: asOf })),
    );
    return row.id;
  });
}

const SWEEP_BATCH = 100;
const STALLED_MS = 30 * 60 * 1000;

export type SendArtJob = (name: string, data: ArtGenerateJob, options: ReturnType<typeof artJobOptions>) => Promise<string | null>;

export interface KeepsakeSweepReport {
  written: number;
  sent: number;
  /** paid gifts past 30 minutes with no art, whether the box is off, the photo is gone or a job keeps failing: nothing else says so */
  stalled: number;
}

async function listingPhotos(db: Db, source: Source, externalId: string, asOf: Date, registry: readonly ShelterEntry[]): Promise<DisplayPhoto[]> {
  const rows = await db
    .select({ animalId: animalDisplay.animalId, source: animalDisplay.source, photos: animalDisplay.photos })
    .from(animalIdentities)
    .innerJoin(animalDisplay, eq(animalDisplay.animalId, animalIdentities.animalId))
    .where(and(eq(animalIdentities.source, source), eq(animalIdentities.externalId, externalId)));
  return pickLicensedDisplay(rows, asOf, registry)?.photos ?? [];
}

/**
 * One tick: a recorded gift gets its keepsake, and every keepsake with no art gets a job. Never queue only on
 * the insert that wrote: a send lost there would lose a paid painting (ADR-0035 decision 6). Only a recorded gift
 * counts here, so ADR-0035's limits, which count unconfirmed gifts, have nothing to count until slice C.
 */
export async function sweepKeepsakes(
  db: Db,
  send: SendArtJob,
  asOf: Date = new Date(),
  registry: readonly ShelterEntry[] = SHELTERS,
): Promise<KeepsakeSweepReport> {
  const grantedKeys = registry.filter((shelter) => shelter.grants.some((grant) => grant.permission === "digify")).flatMap((shelter) => shelter.shelterExternalIds ?? []);
  const pending = await db
    .select({ id: donationIntents.id, closedAt: donationIntents.closedAt })
    .from(donationIntents)
    .innerJoin(donations, eq(donations.intentId, donationIntents.id))
    .leftJoin(keepsake, eq(keepsake.intentId, donationIntents.id))
    .leftJoin(
      animalIdentities,
      and(eq(animalIdentities.source, donationIntents.animalSource), eq(animalIdentities.externalId, donationIntents.animalExternalId)),
    )
    .leftJoin(animals, eq(animals.id, animalIdentities.animalId))
    .where(
      and(
        isNotNull(donationIntents.closedAt),
        isNull(keepsake.id),
        or(
          and(eq(donationIntents.animalSource, CREW_SOURCE), like(donationIntents.animalExternalId, `${CREW_ID_PREFIX}%`)),
          grantedKeys.length > 0 ? inArray(animals.shelterExternalId, grantedKeys) : undefined,
        ),
      ),
    )
    .orderBy(asc(donationIntents.closedAt))
    .limit(SWEEP_BATCH);

  const cutoff = asOf.getTime() - STALLED_MS;
  let written = 0;
  let stalled = 0;
  for (const { id, closedAt } of pending) {
    if ((await snapshotKeepsake(db, id, asOf, registry)) !== null) written += 1;
    else if (closedAt && closedAt.getTime() < cutoff) stalled += 1;
  }

  const owed = await db
    .select({
      id: keepsake.id,
      snapshottedAt: keepsake.snapshottedAt,
      source: donationIntents.animalSource,
      externalId: donationIntents.animalExternalId,
    })
    .from(keepsake)
    .innerJoin(donationIntents, eq(donationIntents.id, keepsake.intentId))
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(keepsakeFact)
          .where(and(eq(keepsakeFact.keepsakeId, keepsake.id), eq(keepsakeFact.field, FACT.art))),
      ),
    )
    .orderBy(asc(keepsake.id))
    .limit(SWEEP_BATCH);

  let sent = 0;
  for (const { id, snapshottedAt, source, externalId } of owed) {
    if (snapshottedAt.getTime() < cutoff) stalled += 1;
    const data: ArtGenerateJob = { keepsakeId: id };
    if (!crewPetOf(source, externalId)) {
      data.photos = await listingPhotos(db, source, externalId, asOf, registry);
      if (data.photos.length === 0) continue;
    }
    if (await send(ART_GENERATE, data, artJobOptions(id))) sent += 1;
  }
  return { written, sent, stalled };
}
