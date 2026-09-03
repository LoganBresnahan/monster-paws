import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  UPKEEP_WINDOW_MONTHS,
  VISIBILITY_WINDOW_DAYS,
  stalenessCutoff,
  upkeepCutoff,
  visibleAnimalById,
  visibleAnimals,
} from "@/core/animals";
import type { Source } from "@/core/sources";
import { closeDb, getDb, type Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals, eventLog, rawPayloads } from "@/db/schema";

/**
 * The ADR-0015 visibility predicate against real Postgres. What is being
 * pinned is the set of animals a donor can reach: every case here is one a
 * page-local `where status = 'available'` would get wrong. Skipped without
 * DATABASE_URL — `npm run db:up` first.
 */
const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Deliberately far from today: with `NOW` set to the current date, an
 * implementation that used SQL `now()` instead of the injected `asOf` would
 * pass every assertion here and the clock injection would stop being tested.
 */
const NOW = new Date("2026-03-15T12:00:00Z");
const AGG: Source = "rescuegroups";
const SHELTER: Source = "shelterluv";

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe.skipIf(!DATABASE_URL)("ADR-0015 visibility — one predicate, used everywhere", () => {
  let db: Db;

  beforeAll(() => {
    db = getDb(DATABASE_URL);
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table ${rawPayloads}, ${animals}, ${animalIdentities}, ${animalDisplay}, ${eventLog} restart identity`,
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  /**
   * One animal with the identities described; returns its id. `sourceUpdatedAt`
   * defaults to freshly-maintained so that a case about presence or staleness
   * is not silently also a case about upkeep — the upkeep tests pass it.
   */
  async function seed(
    status: string | null,
    identities: {
      source: Source;
      lastSeenAt: Date;
      disappearedAt?: Date;
      sourceUpdatedAt?: Date | null;
    }[],
  ): Promise<number> {
    const [row] = await db
      .insert(animals)
      .values({ name: "Rex", species: "dog", status })
      .returning({ id: animals.id });
    for (const [i, identity] of identities.entries()) {
      await db.insert(animalIdentities).values({
        animalId: row.id,
        source: identity.source,
        externalId: `${row.id}-${i}`,
        lastSeenAt: identity.lastSeenAt,
        disappearedAt: identity.disappearedAt ?? null,
        sourceUpdatedAt:
          identity.sourceUpdatedAt === undefined ? NOW : identity.sourceUpdatedAt,
      });
    }
    return row.id;
  }

  async function visibleIds(): Promise<number[]> {
    const rows = await db.select({ id: animals.id }).from(animals).where(visibleAnimals(NOW));
    return rows.map((r) => r.id);
  }

  it("shows an available animal a live source saw today", async () => {
    const id = await seed("available", [{ source: AGG, lastSeenAt: daysBefore(0) }]);
    expect(await visibleIds()).toEqual([id]);
  });

  it("hides every status but available — including the one nobody asserted", async () => {
    await seed(null, [{ source: AGG, lastSeenAt: NOW }]);
    await seed("adopted", [{ source: AGG, lastSeenAt: NOW }]);
    await seed("pending", [{ source: AGG, lastSeenAt: NOW }]);
    const visible = await seed("available", [{ source: AGG, lastSeenAt: NOW }]);

    expect(await visibleIds()).toEqual([visible]);
  });

  it("hides an animal whose only identity disappeared, however recently it was seen", async () => {
    await seed("available", [
      { source: AGG, lastSeenAt: daysBefore(0), disappearedAt: daysBefore(0) },
    ]);
    expect(await visibleIds()).toEqual([]);
  });

  // Literal days and a literal cutoff, never `VISIBILITY_WINDOW_DAYS ± 1`:
  // fixtures derived from the constant slide with it, so a one-character edit
  // widening the window to 30 days would keep this green. Eight is the number
  // ADR-0015 decided on, and this is the only thing holding it.
  it("hides an animal nothing has confirmed within eight days", async () => {
    const fresh = await seed("available", [{ source: AGG, lastSeenAt: daysBefore(7) }]);
    await seed("available", [{ source: AGG, lastSeenAt: daysBefore(8) }]);
    await seed("available", [{ source: AGG, lastSeenAt: daysBefore(9) }]);

    expect(await visibleIds()).toEqual([fresh]);
    expect(VISIBILITY_WINDOW_DAYS).toBe(8);
    expect(stalenessCutoff(NOW)).toEqual(new Date("2026-03-07T12:00:00Z"));
  });

  it("requires present AND fresh on the SAME identity, never one condition from each", async () => {
    // The split case: the aggregator still lists it but has not been polled in
    // ten days; the shelter API was polled this morning and it was gone. Two
    // separate EXISTS clauses would call this visible.
    await seed("available", [
      { source: AGG, lastSeenAt: daysBefore(10) },
      { source: SHELTER, lastSeenAt: daysBefore(0), disappearedAt: daysBefore(0) },
    ]);

    expect(await visibleIds()).toEqual([]);
  });

  it("shows an animal one live source still confirms, even with another source's identity gone", async () => {
    const id = await seed("available", [
      { source: AGG, lastSeenAt: daysBefore(1) },
      { source: SHELTER, lastSeenAt: daysBefore(30), disappearedAt: daysBefore(20) },
    ]);
    expect(await visibleIds()).toEqual([id]);
  });

  // Literal dates, never `UPKEEP_WINDOW_MONTHS ± 1`: a fixture derived from the
  // constant slides with it, and a one-character edit widening the bound to ten
  // years would keep this green. Twenty-four months is what the measurement
  // bought (ADR-0015 as amended) and this is the only thing holding it.
  it("hides an animal its own source has not touched in twenty-four months", async () => {
    const kept = await seed("available", [
      { source: AGG, lastSeenAt: NOW, sourceUpdatedAt: new Date("2024-03-16T12:00:00Z") },
    ]);
    await seed("available", [
      { source: AGG, lastSeenAt: NOW, sourceUpdatedAt: new Date("2024-03-15T12:00:00Z") },
    ]);
    await seed("available", [
      { source: AGG, lastSeenAt: NOW, sourceUpdatedAt: new Date("2024-03-14T12:00:00Z") },
    ]);

    expect(await visibleIds()).toEqual([kept]);
    expect(UPKEEP_WINDOW_MONTHS).toBe(24);
    expect(upkeepCutoff(NOW)).toEqual(new Date("2024-03-15T12:00:00Z"));
  });

  // The abandoned listing this bound exists for: RescueGroups still serves it,
  // so we still see it daily, but nobody at the org has edited the record in
  // eight years. Fresh by `last_seen_at`, dead by every other measure.
  it("hides a listing we see daily that its shelter abandoned years ago", async () => {
    await seed("available", [
      { source: AGG, lastSeenAt: daysBefore(0), sourceUpdatedAt: new Date("2018-04-22T00:00:00Z") },
    ]);
    expect(await visibleIds()).toEqual([]);
  });

  it("hides an animal whose source publishes no upkeep at all — unknown is not maintained", async () => {
    await seed("available", [{ source: AGG, lastSeenAt: NOW, sourceUpdatedAt: null }]);
    expect(await visibleIds()).toEqual([]);
  });

  it("requires upkeep on the SAME identity as presence and freshness", async () => {
    // The aggregator is live and fresh but its record is abandoned; the shelter
    // API maintains its record but has dropped the animal. Neither identity
    // satisfies all three, and only a per-row EXISTS sees that.
    await seed("available", [
      { source: AGG, lastSeenAt: daysBefore(0), sourceUpdatedAt: new Date("2019-01-01T00:00:00Z") },
      {
        source: SHELTER,
        lastSeenAt: daysBefore(0),
        disappearedAt: daysBefore(0),
        sourceUpdatedAt: NOW,
      },
    ]);

    expect(await visibleIds()).toEqual([]);
  });

  it("gives detail the same answer as browse — a stale id is no row, never a stale card", async () => {
    const stale = await seed("available", [{ source: AGG, lastSeenAt: daysBefore(30) }]);
    const live = await seed("available", [{ source: AGG, lastSeenAt: daysBefore(1) }]);

    const byId = async (id: number) =>
      db.select({ id: animals.id }).from(animals).where(visibleAnimalById(id, NOW));

    expect(await byId(stale)).toEqual([]);
    expect(await byId(live)).toEqual([{ id: live }]);
  });
});
