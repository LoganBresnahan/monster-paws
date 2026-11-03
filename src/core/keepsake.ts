import { randomBytes } from "node:crypto";
import { resolve, sep } from "node:path";
import { and, asc, eq, isNotNull, isNull, like, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { donationIntents, keepsake, keepsakeFact } from "@/db/schema";
import { crewPet, type CrewPet } from "@/ui/crew";

export const ART_GENERATE = "art.generate";

export interface ArtGenerateJob {
  keepsakeId: number;
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

/**
 * Writes one keepsake and its facts, or nothing. Never widen past the crew here: the staging gate skips
 * the grant, so a staging gift on a listing would otherwise paint a RescueGroups photo (ADR-0028 §6).
 * Returns the new id, or null when it wrote nothing; the share token is read from the row, because a
 * losing sweep's token is thrown away.
 */
export async function snapshotKeepsake(db: Db, intentId: string, asOf: Date = new Date()): Promise<number | null> {
  const [intent] = await db
    .select({ source: donationIntents.animalSource, externalId: donationIntents.animalExternalId })
    .from(donationIntents)
    .where(eq(donationIntents.id, intentId))
    .limit(1);
  const pet = intent ? crewPetOf(intent.source, intent.externalId) : null;
  if (!pet) return null;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(keepsake)
      .values({ intentId, shareToken: mintShareToken(), snapshottedAt: asOf })
      .onConflictDoNothing({ target: keepsake.intentId })
      .returning({ id: keepsake.id });
    if (!row) return null;
    const photo: SourcePhotoFact = { pet: pet.slug, photo: null };
    const facts: [string, unknown][] = [
      [FACT.name, pet.name],
      [FACT.species, pet.species],
      [FACT.kind, pet.kind],
      [FACT.age, pet.age],
      [FACT.sex, pet.she ? "female" : "male"],
      [FACT.sourcePhoto, photo],
    ];
    await tx.insert(keepsakeFact).values(
      facts.map(([field, value]) => ({ keepsakeId: row.id, field, value, basis: CREW_BASIS, snapshottedAt: asOf })),
    );
    return row.id;
  });
}

const SWEEP_BATCH = 100;

export type SendArtJob = (name: string, data: ArtGenerateJob, options: ReturnType<typeof artJobOptions>) => Promise<string | null>;

/**
 * One tick: a recorded gift to a crew pet gets its keepsake, and every keepsake with no art gets a job.
 * Never queue only on the insert that wrote: a send lost there would lose a paid painting (ADR-0035 decision 6).
 */
export async function sweepKeepsakes(db: Db, send: SendArtJob, asOf: Date = new Date()): Promise<{ written: number; sent: number }> {
  const pending = await db
    .select({ id: donationIntents.id })
    .from(donationIntents)
    .leftJoin(keepsake, eq(keepsake.intentId, donationIntents.id))
    .where(
      and(
        isNotNull(donationIntents.closedAt),
        isNull(keepsake.id),
        eq(donationIntents.animalSource, CREW_SOURCE),
        like(donationIntents.animalExternalId, `${CREW_ID_PREFIX}%`),
      ),
    )
    .orderBy(asc(donationIntents.closedAt))
    .limit(SWEEP_BATCH);

  let written = 0;
  for (const { id } of pending) {
    if ((await snapshotKeepsake(db, id, asOf)) !== null) written += 1;
  }

  const owed = await db
    .select({ id: keepsake.id })
    .from(keepsake)
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
  for (const { id } of owed) {
    if (await send(ART_GENERATE, { keepsakeId: id }, artJobOptions(id))) sent += 1;
  }
  return { written, sent };
}
