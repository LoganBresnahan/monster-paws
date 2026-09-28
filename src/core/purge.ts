import { eq } from "drizzle-orm";
import { isDisplayLicensed, type AggregatorLicense } from "@/core/display";
import type { ShelterEntry } from "@/core/shelters";
import type { Source } from "@/core/sources";
import type { Db } from "@/db/client";
import { animalDisplay } from "@/db/schema";

/**
 * The sanctioned source-scoped DELETE on `animal_display` once a display
 * license has ended, so pages fall back to facts (ADR-0006 decision 4, ADR-0015).
 * Display rows only — never widen this to raw payloads, the vault or facts,
 * which are a separate purge decided per termination (ADR-0006 as amended).
 */
export async function purgeDisplay(
  db: Db,
  source: Source,
  asOf: Date = new Date(),
  registry?: readonly ShelterEntry[],
  licenses?: readonly AggregatorLicense[],
): Promise<number> {
  // The checked-in revocation is the record that rendering stopped being
  // allowed; purging ahead of it deletes rows a page may still show (ADR-0006).
  if (isDisplayLicensed(source, asOf, registry, licenses)) {
    throw new Error(
      `purgeDisplay: '${source}' still holds a display license — record the revocation first (ADR-0006)`,
    );
  }
  const deleted = await db
    .delete(animalDisplay)
    .where(eq(animalDisplay.source, source))
    .returning({ id: animalDisplay.id });
  return deleted.length;
}
