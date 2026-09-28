import { readFileSync } from "node:fs";
import path from "node:path";
import { contentHashOf } from "@/core/ingest/hash";
import type { Observation, SourceAdapter } from "@/core/ingest/observation";
import { createPgStages } from "@/core/ingest/pg";
import { runIngest } from "@/core/ingest/pipeline";
import {
  createRescueGroupsAdapter,
  rescueGroupsNormalizer,
  type RescueGroupsAnimal,
} from "@/core/ingest/rescuegroups";
import type { Db } from "@/db/client";
import { animalIdentities } from "@/db/schema";

/**
 * The e2e corpus (ADR-0017 as amended 2026-09-28): the golden RescueGroups
 * fixture fed through the real adapter, normalizer and pg stages, plus
 * variants cloned from it. The fixture file is never edited — only these
 * seeded copies move.
 */

const DAY = 24 * 60 * 60 * 1000;

/** What a spec may look an animal up by. The ids are resolved after the ingest, never assumed. */
export const SEEDED = {
  stowaway: { externalId: "10013509", name: "Stowaway" },
  bettis: { externalId: "10059734", name: "Bettis" },
  exact: { externalId: "e2e-exact", name: "Pepper" },
  handle: { externalId: "e2e-handle", name: "Juniper" },
  adopted: { externalId: "e2e-adopted", name: "Clementine" },
  stale: { externalId: "e2e-stale", name: "Waffles" },
} as const;

export type SeedKey = keyof typeof SEEDED;
export type SeedManifest = Record<SeedKey, number>;

/** Pepper's birth date, which the page may state exactly because the variant says it is exact. */
export const EXACT_BIRTH_DATE = new Date("2021-03-03T00:00:00Z");

/** Juniper's description: a payment handle and a URL that must render as inert text (ADR-0015 as amended). */
export const HANDLE_DESCRIPTION =
  "Juniper's foster fund takes Venmo @juniper-fund or https://paypal.me/juniperfund — ask us first!";

async function fixtureObservations(): Promise<Observation<RescueGroupsAnimal>[]> {
  const fixture = JSON.parse(
    // `__dirname`, not `import.meta`: Playwright loads TypeScript as CommonJS.
    readFileSync(path.join(__dirname, "../tests/fixtures/rescuegroups-available.json"), "utf8"),
  );
  // One page that promises exactly what it delivers, or the adapter (rightly)
  // calls the run truncated (ADR-0014).
  const meta = { ...fixture.meta, pages: 1, count: fixture.data.length };
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ ...fixture, meta }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const out: Observation<RescueGroupsAnimal>[] = [];
  for await (const obs of createRescueGroupsAdapter({ apiKey: "e2e" }, fetchImpl).fetch()) {
    out.push(obs);
  }
  return out;
}

interface Variant {
  externalId: string;
  name?: string;
  fetchedAt?: Date;
  status?: string;
  isBirthDateExact?: boolean;
  birthDate?: string;
  descriptionText?: string;
}

/**
 * A clone with the dates the visibility predicate reads restamped relative to
 * now. Seeded verbatim, the fixture's 2018 `updatedDate` fails the 24-month
 * upkeep bound and every animal 404s (ADR-0015 as amended 2026-09-03).
 */
function variantOf(
  base: Observation<RescueGroupsAnimal>,
  v: Variant,
  now: Date,
): Observation<RescueGroupsAnimal> {
  const payload: RescueGroupsAnimal = structuredClone(base.payload);
  const attributes = payload.animal.attributes as Record<string, unknown>;
  payload.animal.id = v.externalId;
  attributes.updatedDate = new Date(now.getTime() - 30 * DAY).toISOString();
  if (v.name !== undefined) attributes.name = v.name;
  if (v.isBirthDateExact !== undefined) attributes.isBirthDateExact = v.isBirthDateExact;
  if (v.birthDate !== undefined) attributes.birthDate = v.birthDate;
  if (v.descriptionText !== undefined) attributes.descriptionText = v.descriptionText;
  if (v.status !== undefined) {
    const status = payload.included.find((r) => r.type === "statuses");
    if (!status) throw new Error("seed: fixture animal has no statuses resource to restate");
    (status.attributes as Record<string, unknown>).name = v.status;
  }
  return {
    ...base,
    externalId: v.externalId,
    payload,
    fetchedAt: v.fetchedAt ?? now,
    contentHash: contentHashOf(payload),
  };
}

export async function seedE2eCorpus(db: Db, now: Date = new Date()): Promise<SeedManifest> {
  const [stowaway, bettis] = await fixtureObservations();
  const observations = [
    variantOf(stowaway, { externalId: SEEDED.stowaway.externalId }, now),
    variantOf(bettis, { externalId: SEEDED.bettis.externalId }, now),
    variantOf(
      bettis,
      {
        externalId: SEEDED.exact.externalId,
        name: SEEDED.exact.name,
        isBirthDateExact: true,
        birthDate: EXACT_BIRTH_DATE.toISOString(),
      },
      now,
    ),
    variantOf(
      stowaway,
      { externalId: SEEDED.handle.externalId, name: SEEDED.handle.name, descriptionText: HANDLE_DESCRIPTION },
      now,
    ),
    variantOf(
      stowaway,
      { externalId: SEEDED.adopted.externalId, name: SEEDED.adopted.name, status: "Adopted" },
      now,
    ),
    // Nine days, past the 8-day sighting bound: seen once, then never again.
    variantOf(
      bettis,
      { externalId: SEEDED.stale.externalId, name: SEEDED.stale.name, fetchedAt: new Date(now.getTime() - 9 * DAY) },
      now,
    ),
  ];

  const adapter: SourceAdapter<RescueGroupsAnimal> = {
    source: "rescuegroups",
    async *fetch() {
      yield* observations;
    },
  };
  // Partial by declaration: stage 5 would stamp every identity `now` and
  // erase the stale sighting this seed exists to hold (ADR-0014).
  const report = await runIngest(adapter, createPgStages(db, [rescueGroupsNormalizer]), {
    complete: false,
  });
  if (report.failures.length > 0) {
    throw new Error(`seed: ${report.failures.length} observations failed: ${JSON.stringify(report.failures)}`);
  }

  const identities = await db
    .select({ externalId: animalIdentities.externalId, animalId: animalIdentities.animalId })
    .from(animalIdentities);
  const byExternalId = new Map(identities.map((i) => [i.externalId, i.animalId]));
  const manifest = {} as SeedManifest;
  for (const [key, { externalId }] of Object.entries(SEEDED) as [SeedKey, { externalId: string }][]) {
    const id = byExternalId.get(externalId);
    if (id === undefined) throw new Error(`seed: ${externalId} produced no identity`);
    manifest[key] = id;
  }
  return manifest;
}
