import { and, eq, sql, type SQL } from "drizzle-orm";
import { animalIdentities, animals } from "@/db/schema";

/**
 * The one visibility predicate (ADR-0015). Browse, detail, the sitemap and any
 * future feed compose THIS — a page that assembles its own is how a
 * just-adopted dog reaches a donor, and a detail page for an animal we can no
 * longer vouch for is the stale-data risk itself.
 */

/** A status nobody asserted is null, and null is "don't show" (ADR-0013). */
export const VISIBLE_STATUS = "available";

/**
 * The weekly refresh minimum (ADR-0006) plus one day of slack. Widening this
 * means showing animals no source has confirmed within its own refresh cycle.
 */
export const VISIBILITY_WINDOW_DAYS = 8;

/**
 * How long a source may leave its own record untouched before we stop
 * rendering it (ADR-0015 as amended). Measured, not chosen: ~10% of the
 * RescueGroups feed was listed 2+ years ago and 82% of that tail had not been
 * updated in twelve months, so the longest-listed sort points straight at
 * abandoned listings. Widening this puts them back at the top of browse.
 */
export const UPKEEP_WINDOW_MONTHS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

export function stalenessCutoff(asOf: Date): Date {
  return new Date(asOf.getTime() - VISIBILITY_WINDOW_DAYS * DAY_MS);
}

export function upkeepCutoff(asOf: Date): Date {
  const cutoff = new Date(asOf);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - UPKEEP_WINDOW_MONTHS);
  return cutoff;
}

/**
 * `asOf` is a parameter, not `now()` in SQL: the boundary is only testable
 * when the caller owns the clock.
 *
 * Only for `db.select().from(animals)` with `animals` unaliased — the
 * correlated subquery names the table outright, so `db.query.animals.*` and
 * `alias(animals, …)` rewrite it into a query that throws.
 */
export function visibleAnimals(asOf: Date = new Date()): SQL {
  const cutoff = stalenessCutoff(asOf);
  const upkeep = upkeepCutoff(asOf);
  return and(
    eq(animals.status, VISIBLE_STATUS),
    // All THREE conditions on ONE identity row: an animal present under a
    // disappeared source, stale under a live one, and maintained under a third
    // is not visible, and splitting these across rows would show it (ADR-0014,
    // ADR-0015 as amended).
    //
    // A null `source_updated_at` fails the comparison and hides the animal.
    // That is the intended default-deny: a source that does not tell us
    // whether anyone still maintains a record has not earned a rendered page,
    // and a source that publishes upkeep must be mapped in its normalizer
    // before its animals can appear.
    sql`exists (
      select 1 from ${animalIdentities}
      where ${animalIdentities.animalId} = ${animals.id}
        and ${animalIdentities.disappearedAt} is null
        and ${animalIdentities.lastSeenAt} > ${cutoff}
        and ${animalIdentities.sourceUpdatedAt} > ${upkeep}
    )`,
  )!;
}

/** Detail's lookup — never `eq(animals.id, …)` alone, or the predicate is bypassed. */
export function visibleAnimalById(id: number, asOf: Date = new Date()): SQL {
  return and(eq(animals.id, id), visibleAnimals(asOf))!;
}
