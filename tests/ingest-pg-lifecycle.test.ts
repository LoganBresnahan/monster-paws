import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStages, type MemoryCorpus } from "@/core/ingest/memory";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import { createPgStages, loadStoredObservations } from "@/core/ingest/pg";
import {
  replay,
  runIngest,
  type IngestStages,
  type NormalizedAnimal,
  type Normalizer,
} from "@/core/ingest/pipeline";
import { scrapeSource, type Source } from "@/core/sources";
import { closeDb, type Db } from "@/db/client";
import { SKIP_DB_TESTS, testDb, truncateCorpus, truncateDerived } from "./support/db";
import { animalIdentities, eventLog, rawPayloads } from "@/db/schema";

/**
 * Stage 5 against Postgres (ADR-0014), run in lockstep with the in-memory
 * reference: after every run both stores must hold the same identity state
 * and have emitted the same events. Skipped without DATABASE_URL.
 */
// Never DATABASE_URL: these suites truncate, and the dev database is not
// theirs to empty (ADR-0017).

interface Payload {
  id: string;
  name: string;
}

const D1 = new Date("2026-08-01T07:00:00Z");
const D2 = new Date("2026-08-02T07:00:00Z");
const D3 = new Date("2026-08-03T07:00:00Z");
const AGG: Source = "rescuegroups";
const SCRAPE = scrapeSource("happy-tails");

function obs(source: Source, id: string, at: Date): Observation<Payload> {
  return { source, externalId: id, payload: { id, name: id }, fetchedAt: at, contentHash: `${source}:${id}` };
}

function adapterOf(source: Source, observations: Observation<Payload>[]): SourceAdapter<Payload> {
  return {
    source,
    async *fetch() {
      yield* observations;
    },
  };
}

function normalizerFor(source: Source): Normalizer<Payload> {
  return {
    source,
    async normalize(o: StoredObservation<Payload>): Promise<NormalizedAnimal> {
      const stamp = { source: o.source, fetchedAt: o.fetchedAt };
      return {
        claims: { name: { value: o.payload.name, ...stamp }, species: { value: "dog", ...stamp } },
      };
    },
  };
}

type IdentityState = Record<string, { lastSeenAt: string; disappearedAt: string | null }>;
type EventRow = { kind: string; subjectId: string; source: string; externalId: unknown; occurredAt: string };

describe.skipIf(SKIP_DB_TESTS)("ADR-0014 Postgres lifecycle — in lockstep with the reference", () => {
  let db: Db;
  let pg: IngestStages;
  let mem: { stages: IngestStages; corpus: MemoryCorpus };

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    const normalizers = [normalizerFor(AGG), normalizerFor(SCRAPE)];
    pg = createPgStages(db, normalizers);
    mem = createMemoryStages(normalizers);
  });

  afterAll(async () => {
    await closeDb();
  });

  /** Runs are dated by the batch's newest fetchedAt, standing in for the worker's clock. */
  async function both(source: Source, batch: Observation<Payload>[], complete = true) {
    const at = batch.reduce((m, o) => (o.fetchedAt > m ? o.fetchedAt : m), D1);
    const options = { complete, now: () => at };
    const m = await runIngest(adapterOf(source, batch), mem.stages, options);
    const p = await runIngest(adapterOf(source, batch), pg, options);
    expect(p.events.map((e) => [e.kind, e.data.externalId])).toEqual(
      m.events.map((e) => [e.kind, e.data.externalId]),
    );
    expect(p.lifecycleSkipped).toEqual(m.lifecycleSkipped);
    return p;
  }

  async function expectParity() {
    const m: IdentityState = {};
    for (const [k, id] of mem.corpus.identities) {
      m[k] = { lastSeenAt: id.lastSeenAt.toISOString(), disappearedAt: id.disappearedAt?.toISOString() ?? null };
    }
    const p: IdentityState = {};
    for (const row of await db.select().from(animalIdentities)) {
      p[`${row.source}:${row.externalId}`] = {
        lastSeenAt: row.lastSeenAt.toISOString(),
        disappearedAt: row.disappearedAt?.toISOString() ?? null,
      };
    }
    expect(p).toEqual(m);

    const me: EventRow[] = mem.corpus.events.map((e) => ({
      kind: e.kind,
      subjectId: e.subjectId,
      source: e.source,
      externalId: e.data.externalId,
      occurredAt: e.occurredAt.toISOString(),
    }));
    const pe: EventRow[] = (await db.select().from(eventLog).orderBy(eventLog.id)).map((e) => ({
      kind: e.kind,
      subjectId: e.subjectId,
      source: e.source as string,
      externalId: (e.data as { externalId: unknown }).externalId,
      occurredAt: e.occurredAt.toISOString(),
    }));
    expect(pe).toEqual(me);
  }

  it("disappears an absent identity once, then leaves it alone", async () => {
    await both(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]);
    const day2 = await both(AGG, [obs(AGG, "a", D2)]);
    await both(AGG, [obs(AGG, "a", D3)]);

    expect(day2.events.map((e) => e.kind)).toEqual(["animal.disappeared"]);
    expect(day2.events[0].data).toMatchObject({ externalId: "b", lastSeenAt: D1 });
    const [b] = await db.select().from(animalIdentities).where(eq(animalIdentities.externalId, "b"));
    expect(b.disappearedAt).toEqual(D2);
    expect(b.lastSeenAt).toEqual(D1);
    await expectParity();
  });

  it("touches last_seen_at on every complete run, including deduped re-polls", async () => {
    await both(AGG, [obs(AGG, "a", D1)]);
    await both(AGG, [obs(AGG, "a", D2)]);

    const [a] = await db.select().from(animalIdentities);
    expect(a.lastSeenAt).toEqual(D2);
    expect(await db.select().from(rawPayloads)).toHaveLength(1);
    await expectParity();
  });

  it("partial and empty runs change nothing", async () => {
    await both(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]);
    const partial = await both(AGG, [obs(AGG, "a", D2)], false);
    const empty = await both(AGG, []);

    expect(partial.lifecycleSkipped).toMatch(/partial/);
    expect(empty.lifecycleSkipped).toMatch(/nothing/);
    expect(await db.select().from(eventLog)).toHaveLength(2);
    await expectParity();
  });

  it("scopes absence per source and reappears a returning identity", async () => {
    await both(AGG, [obs(AGG, "rex", D1)]);
    await both(SCRAPE, [obs(SCRAPE, "rex", D1)]);
    const gone = await both(AGG, [obs(AGG, "other", D2)]);
    const back = await both(AGG, [obs(AGG, "rex", D3), obs(AGG, "other", D3)]);

    expect(gone.events.map((e) => [e.kind, e.source])).toEqual([
      ["animal.seen", AGG],
      ["animal.disappeared", AGG],
    ]);
    expect(back.events.map((e) => e.kind)).toEqual(["animal.reappeared"]);
    expect(back.events[0].data).toMatchObject({ externalId: "rex", disappearedAt: D2 });
    const scrapeRex = (await db.select().from(animalIdentities)).find((r) => r.source === SCRAPE)!;
    expect(scrapeRex.disappearedAt).toBeNull();
    await expectParity();
  });

  it("an identity born in a partial run carries the sighting's time, not the clock's", async () => {
    await both(AGG, [obs(AGG, "a", D1)]);
    await both(AGG, [obs(AGG, "n", D2)], false);
    const day3 = await both(AGG, [obs(AGG, "a", D3)]);

    expect(day3.events.map((e) => [e.kind, e.data.externalId, e.data.lastSeenAt])).toEqual([
      ["animal.disappeared", "n", D2],
    ]);
    await expectParity();
  });

  it("emits reappearances before disappearances, by externalId, in both stores", async () => {
    await both(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]);
    await both(AGG, [obs(AGG, "a", D2)]);
    const day3 = await both(AGG, [obs(AGG, "b", D3)]);

    expect(day3.events.map((e) => [e.kind, e.data.externalId])).toEqual([
      ["animal.reappeared", "b"],
      ["animal.disappeared", "a"],
    ]);
    await expectParity();
  });

  it("refuses a run older than the source's newest sighting", async () => {
    await both(AGG, [obs(AGG, "a", D3), obs(AGG, "b", D3)]);

    const backwards = { complete: true, now: () => D1 };
    await expect(runIngest(adapterOf(AGG, [obs(AGG, "a", D1)]), pg, backwards)).rejects.toThrow(/predates/);
    await expect(runIngest(adapterOf(AGG, [obs(AGG, "a", D1)]), mem.stages, backwards)).rejects.toThrow(
      /predates/,
    );
    const [b] = await db.select().from(animalIdentities).where(eq(animalIdentities.externalId, "b"));
    expect(b.disappearedAt).toBeNull();
  });

  it("a rebuild keeps true last sightings, and the next run re-establishes disappearance once", async () => {
    await both(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]);
    await both(AGG, [obs(AGG, "a", D2)]);

    // Derived only: the raw rows are what the rebuild replays from.
    await truncateDerived(db);
    await replay(AGG, await loadStoredObservations(db, AGG), pg);
    const rebuilt = await db.select().from(animalIdentities);
    expect(rebuilt.map((r) => [r.externalId, r.lastSeenAt, r.disappearedAt])).toEqual([
      ["a", D2, null],
      ["b", D1, null],
    ]);

    const next = await runIngest(adapterOf(AGG, [obs(AGG, "a", D3)]), pg, { complete: true, now: () => D3 });
    expect(next.events.map((e) => [e.kind, e.data.externalId, e.data.lastSeenAt])).toEqual([
      ["animal.disappeared", "b", D1],
    ]);
  });
});
