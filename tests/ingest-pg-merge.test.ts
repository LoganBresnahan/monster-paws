import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import { createPgStages, loadStoredObservations } from "@/core/ingest/pg";
import {
  replay,
  runIngest,
  type AnimalClaims,
  type IngestStages,
  type NormalizedAnimal,
  type Normalizer,
} from "@/core/ingest/pipeline";
import type { Source } from "@/core/sources";
import { closeDb, type Db } from "@/db/client";
import { SKIP_DB_TESTS, testDb, truncateCorpus } from "./support/db";
import { animalIdentities, animals, eventLog } from "@/db/schema";

/**
 * Integration: stages 3–4 against real Postgres (ADR-0013). Skipped without
 * DATABASE_URL — `npm run db:up` first. The rules are the ones
 * `ingest-merge.test.ts` pins on the in-memory writer; this proves the SQL
 * writer agrees, and that `event_log` only ever grows.
 */
// Never DATABASE_URL: these suites truncate, and the dev database is not
// theirs to empty (ADR-0017).

interface Payload {
  id: string;
  name?: string;
  species?: string;
  breed?: string | null;
  status?: string;
}

const T0 = new Date("2026-08-01T12:00:00Z");
const T1 = new Date("2026-08-02T12:00:00Z");
const T2 = new Date("2026-08-03T12:00:00Z");
const AGG: Source = "rescuegroups";
const SHELTER: Source = "shelterluv";
const REX = { id: "rex-1", name: "Rex", species: "dog" };

function obs(source: Source, payload: Payload, at: Date): Observation<Payload> {
  return {
    source,
    externalId: payload.id,
    payload,
    fetchedAt: at,
    contentHash: `${source}:${JSON.stringify(payload)}`,
  };
}

function adapterOf(source: Source, observations: Observation<Payload>[]): SourceAdapter<Payload> {
  return {
    source,
    async *fetch() {
      yield* observations;
    },
  };
}

/** `status: "from-shelter"` stamps the claims as Tier 1 — simulates a second source on one animal. */
function normalizerFor(source: Source): Normalizer<Payload> {
  return {
    source,
    async normalize(o: StoredObservation<Payload>): Promise<NormalizedAnimal> {
      const tier: Source = o.payload.status === "from-shelter" ? SHELTER : o.source;
      const stamp = { source: tier, fetchedAt: o.fetchedAt };
      const claims: AnimalClaims = {};
      if (o.payload.name !== undefined) claims.name = { value: o.payload.name, ...stamp };
      if (o.payload.species !== undefined) claims.species = { value: o.payload.species, ...stamp };
      if (o.payload.breed !== undefined) claims.breed = { value: o.payload.breed, ...stamp };
      return { claims };
    },
  };
}

describe.skipIf(SKIP_DB_TESTS)("ADR-0013 Postgres merge", () => {
  let db: Db;
  let stages: IngestStages;

  beforeAll(() => {
    db = testDb();
    stages = createPgStages(db, [normalizerFor(AGG)]);
  });

  beforeEach(async () => {
    await truncateCorpus(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  const rex = async () => (await db.select().from(animals).where(eq(animals.id, 1)))[0];

  it("creates the row, its identity, and one animal.seen", async () => {
    const report = await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T0)]), stages, { complete: true });

    const row = await rex();
    expect(row.name).toBe("Rex");
    expect(row.breed).toBe("mutt");
    expect(row.provenance).toEqual({
      name: { source: AGG, fetchedAt: T0.toISOString(), rawId: 1 },
      species: { source: AGG, fetchedAt: T0.toISOString(), rawId: 1 },
      breed: { source: AGG, fetchedAt: T0.toISOString(), rawId: 1 },
    });
    expect(await db.select().from(animalIdentities)).toMatchObject([
      { animalId: 1, source: AGG, externalId: "rex-1" },
    ]);
    const events = await db.select().from(eventLog);
    expect(events).toMatchObject([{ kind: "animal.seen", subjectId: "1", source: AGG }]);
    expect(report.events).toHaveLength(1);
  });

  it("resolves a re-poll to the same animal and emits only on change", async () => {
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T0)]), stages, { complete: true });
    const same = await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T1)]), stages, { complete: true });
    const changed = await runIngest(
      adapterOf(AGG, [obs(AGG, { ...REX, breed: "collie" }, T2)]),
      stages,
      { complete: true },
    );

    expect(same.events).toEqual([]);
    expect(changed.events.map((e) => [e.kind, e.data.changed])).toEqual([
      ["animal.updated", ["breed"]],
    ]);
    expect((await rex()).breed).toBe("collie");
    expect(await db.select().from(animals)).toHaveLength(1);
    expect(await db.select().from(eventLog)).toHaveLength(2);
  });

  it("a Tier-1 fact survives a fresher aggregator claim; the conflict is counted, not logged", async () => {
    await runIngest(
      adapterOf(AGG, [obs(AGG, { ...REX, breed: "collie", status: "from-shelter" }, T0)]),
      stages,
      { complete: true },
    );
    const report = await runIngest(
      adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T2)]),
      stages,
      { complete: true },
    );

    const row = await rex();
    expect(row.breed).toBe("collie");
    expect((row.provenance as Record<string, { source: string }>).breed.source).toBe(SHELTER);
    expect(report.conflicted).toBe(1);
    expect(report.events).toEqual([]);
    expect(await db.select().from(eventLog)).toHaveLength(1);
  });

  it("a fresher null never erases a real value", async () => {
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T0)]), stages, { complete: true });
    const report = await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: null }, T1)]), stages, { complete: true });

    expect((await rex()).breed).toBe("mutt");
    expect(report.events).toEqual([]);
    expect(report.conflicted).toBe(0);
  });

  it("replaying the corpus reproduces canonical and appends no events", async () => {
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T0)]), stages, { complete: true });
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "collie" }, T1)]), stages, { complete: true });
    const before = await rex();
    const eventsBefore = (await db.select().from(eventLog)).length;

    const report = await replay(AGG, await loadStoredObservations(db, AGG), stages);

    expect(report.events).toEqual([]);
    expect(report.failures).toEqual([]);
    expect(await rex()).toEqual(before);
    expect(await db.select().from(eventLog)).toHaveLength(eventsBefore);
  });

  it("refuses a first observation that cannot name the animal, as a write failure", async () => {
    const report = await runIngest(adapterOf(AGG, [obs(AGG, { id: "x-1", breed: "mutt" }, T0)]), stages, { complete: true });

    expect(report.failures).toMatchObject([{ externalId: "x-1", stage: "write" }]);
    expect(await db.select().from(animals)).toHaveLength(0);
    expect(await db.select().from(eventLog)).toHaveLength(0);
  });
});
