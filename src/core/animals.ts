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

const DAY_MS = 24 * 60 * 60 * 1000;

export function stalenessCutoff(asOf: Date): Date {
  return new Date(asOf.getTime() - VISIBILITY_WINDOW_DAYS * DAY_MS);
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
  return and(
    eq(animals.status, VISIBLE_STATUS),
    // Both conditions on ONE identity row: an animal present under a
    // disappeared source and stale under a live one is not visible, and
    // splitting these across rows would show it (ADR-0014).
    sql`exists (
      select 1 from ${animalIdentities}
      where ${animalIdentities.animalId} = ${animals.id}
        and ${animalIdentities.disappearedAt} is null
        and ${animalIdentities.lastSeenAt} > ${cutoff}
    )`,
  )!;
}

/** Detail's lookup — never `eq(animals.id, …)` alone, or the predicate is bypassed. */
export function visibleAnimalById(id: number, asOf: Date = new Date()): SQL {
  return and(eq(animals.id, id), visibleAnimals(asOf))!;
}
