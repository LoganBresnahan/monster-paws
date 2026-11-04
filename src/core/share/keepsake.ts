import { asc, eq } from "drizzle-orm";
import { artFilePath, CREW_BASIS, FACT, grantBasis, type ArtFact } from "@/core/keepsake";
import { hasGrant, SHELTERS, shelterBySlug, type ShelterEntry } from "@/core/shelters";
import type { Db } from "@/db/client";
import { keepsake, keepsakeFact } from "@/db/schema";
import { PAINTING_NUMBERS, type ShareManifest } from "./source";

/** What a page calls an animal whose listing holds no name at all, such as "A310627" (ADR-0036). */
const NO_NAME = "This animal";

export interface KeepsakeShare {
  token: string;
  manifest: ShareManifest;
  /** the four paintings on disk, in candidate order */
  files: string[];
}

export interface KeepsakeShareOptions {
  /** a listing's name is as published and can carry notes; this says what to call the animal */
  speak: (published: string) => string | null;
  registry?: readonly ShelterEntry[];
  asOf?: Date;
  pathOf?: (key: string) => string;
}

function latest(facts: { field: string; value: unknown }[], field: string): string | undefined {
  const value = facts.filter((fact) => fact.field === field).at(-1)?.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * What one keepsake publishes, read from its own rows so the tool can't name the wrong files or
 * mint a token (ADR-0036). Refuses anything but four paintings. Never join `donations` or read
 * `keepsake.intent_id` to check for a gift: this runs as `home_worker`, which is refused both
 * (scripts/home-worker-grants.sql), and `snapshotKeepsake` writes a row for a recorded gift only.
 */
export async function keepsakeShare(db: Db, keepsakeId: number, options: KeepsakeShareOptions): Promise<KeepsakeShare> {
  const { speak, registry = SHELTERS, asOf = new Date(), pathOf = artFilePath } = options;
  const [row] = await db
    .select({ token: keepsake.shareToken })
    .from(keepsake)
    .where(eq(keepsake.id, keepsakeId))
    .limit(1);
  if (!row) throw new Error(`keepsake ${keepsakeId} doesn't exist`);

  const facts = await db
    .select({ field: keepsakeFact.field, value: keepsakeFact.value, basis: keepsakeFact.basis })
    .from(keepsakeFact)
    .where(eq(keepsakeFact.keepsakeId, keepsakeId))
    .orderBy(asc(keepsakeFact.id));

  const art = facts.filter((fact) => fact.field === FACT.art);
  const byCandidate = new Map(art.map((fact) => [(fact.value as ArtFact).candidate, (fact.value as ArtFact).key]));
  const keys = PAINTING_NUMBERS.map((n) => byCandidate.get(n));
  if (art.length !== PAINTING_NUMBERS.length || keys.some((key) => key === undefined)) {
    throw new Error(`keepsake ${keepsakeId} has ${art.length} paintings, and a share needs candidates 1 to 4`);
  }

  // Today's grant, never the gift's: the painting stays the donor's after a withdrawal, but its public page doesn't (ADR-0036).
  const basis = art[0].basis;
  if (basis !== CREW_BASIS) {
    const slug = /^grant:(.+):digify$/.exec(basis)?.[1];
    if (!slug || !hasGrant(shelterBySlug(slug, registry), "digify", asOf)) {
      throw new Error(`keepsake ${keepsakeId}'s shelter holds no digify grant today, so it gets no public page`);
    }
  }

  const name = speak(latest(facts, FACT.name) ?? "") ?? NO_NAME;
  const kind = latest(facts, FACT.kind)?.trim();
  const shelter = latest(facts, FACT.shelter)?.trim();
  return {
    token: row.token,
    manifest: { name, ...(kind ? { kind } : {}), ...(shelter ? { shelter } : {}) },
    files: keys.map((key) => pathOf(key as string)),
  };
}

/** Every share token behind one shelter's grant, for its takedown: the slug is in the facts' basis (ADR-0036). */
export async function shelterShareTokens(db: Db, slug: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ token: keepsake.shareToken })
    .from(keepsake)
    .innerJoin(keepsakeFact, eq(keepsakeFact.keepsakeId, keepsake.id))
    .where(eq(keepsakeFact.basis, grantBasis(slug)));
  return rows.map((row) => row.token);
}
