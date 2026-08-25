import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStages, type MemoryCorpus } from "@/core/ingest/memory";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import { createPgStages, loadStoredObservations } from "@/core/ingest/pg";
import {
  MERGED_FIELDS,
  replay,
  runIngest,
  type AnimalClaims,
  type IngestEvent,
  type IngestRunReport,
  type IngestStages,
  type Normalizer,
} from "@/core/ingest/pipeline";
import { createRescueGroupsAdapter, rescueGroupsNormalizer } from "@/core/ingest/rescuegroups";
import type { Source } from "@/core/sources";
import type { Claim } from "@/core/trust";
import { closeDb, getDb, type Db } from "@/db/client";
import { animalIdentities, animals, eventLog, rawPayloads } from "@/db/schema";

/**
 * The in-memory writer is the reference and the Postgres writer is
 * production (ADR-0013). Every scenario here runs through BOTH and the
 * resulting canonical state — value, source, fetchedAt and rawId per field —
 * plus every event must be identical. The scenarios are the ones the
 * adversarial pass of 2026-08-21 found the two disagreeing on. Skipped
 * without DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;

interface Payload {
  id: string;
  name?: string;
  species?: string;
  breed?: string | null;
  status?: string;
  tier?: Source;
}

const T0 = new Date("2026-08-01T12:00:00Z");
const T1 = new Date("2026-08-02T12:00:00Z");
const T2 = new Date("2026-08-03T12:00:00Z");
const AGG: Source = "rescuegroups";
const SHELTER: Source = "shelterluv";
const REX = { id: "rex-1", name: "Rex", species: "dog" };

function obs(payload: Payload, at: Date, source: Source = AGG): Observation<Payload> {
  return {
    source,
    externalId: payload.id,
    payload,
    fetchedAt: at,
    contentHash: `${source}:${JSON.stringify(payload)}`,
  };
}

function adapterOf(observations: Observation<Payload>[], source: Source = AGG): SourceAdapter<Payload> {
  return {
    source,
    async *fetch() {
      yield* observations;
    },
  };
}

/** `tier` on the payload stamps the claims as that source — simulates item 10's cross-source merge. */
const normalizer: Normalizer<Payload> = {
  source: AGG,
  async normalize(o: StoredObservation<Payload>): Promise<AnimalClaims> {
    const stamp = { source: o.payload.tier ?? o.source, fetchedAt: o.fetchedAt };
    const claims: AnimalClaims = {};
    if (o.payload.name !== undefined) claims.name = { value: o.payload.name, ...stamp };
    if (o.payload.species !== undefined) claims.species = { value: o.payload.species, ...stamp };
    if (o.payload.breed !== undefined) claims.breed = { value: o.payload.breed, ...stamp };
    if (o.payload.status !== undefined) claims.status = { value: o.payload.status, ...stamp };
    return claims;
  },
};

type Snapshot = {
  animals: Record<string, Record<string, { value: unknown; source: string; fetchedAt: string; rawId?: number }>>;
  events: { kind: string; subjectId: string; changed: unknown; occurredAt: string; source: string }[];
};

function eventsOf(events: IngestEvent[]): Snapshot["events"] {
  return events.map((e) => ({
    kind: e.kind,
    subjectId: e.subjectId,
    changed: e.data.changed,
    occurredAt: e.occurredAt.toISOString(),
    source: e.source,
  }));
}

function memorySnapshot(corpus: MemoryCorpus): Snapshot {
  const out: Snapshot["animals"] = {};
  for (const [id, animal] of corpus.animals) {
    out[id] = {};
    for (const field of MERGED_FIELDS) {
      const c = animal.claims[field] as Claim<unknown> | undefined;
      if (c) out[id][field] = { value: c.value, source: c.source, fetchedAt: c.fetchedAt.toISOString(), rawId: c.rawId };
    }
  }
  return { animals: out, events: eventsOf(corpus.events) };
}

async function pgSnapshot(db: Db): Promise<Snapshot> {
  const out: Snapshot["animals"] = {};
  for (const row of await db.select().from(animals).orderBy(animals.id)) {
    out[row.id] = {};
    const prov = row.provenance as Record<string, { source: string; fetchedAt: string; rawId?: number }>;
    for (const field of MERGED_FIELDS) {
      if (prov[field]) out[row.id][field] = { value: row[field], ...prov[field] };
    }
  }
  const events = (await db.select().from(eventLog).orderBy(eventLog.id)).map((e) => ({
    kind: e.kind,
    subjectId: e.subjectId,
    changed: (e.data as { changed: unknown }).changed,
    occurredAt: e.occurredAt.toISOString(),
    source: e.source as string,
  }));
  return { animals: out, events };
}

describe.skipIf(!DATABASE_URL)("ADR-0013 writer parity — memory is the reference, Postgres must agree", () => {
  let db: Db;
  let pg: IngestStages;
  let mem: { stages: IngestStages; corpus: MemoryCorpus };

  beforeAll(() => {
    db = getDb(DATABASE_URL);
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table ${rawPayloads}, ${animals}, ${animalIdentities}, ${eventLog} restart identity`,
    );
    pg = createPgStages(db, [normalizer]);
    mem = createMemoryStages([normalizer]);
  });

  afterAll(async () => {
    await closeDb();
  });

  /** Run the same adapters through both; return both reports per step. */
  async function both(...steps: SourceAdapter<unknown>[]) {
    const reports: [IngestRunReport, IngestRunReport][] = [];
    for (const step of steps) {
      reports.push([
        await runIngest(step, mem.stages, { complete: true }),
        await runIngest(step, pg, { complete: true }),
      ]);
    }
    return reports;
  }

  async function expectParity() {
    const m = memorySnapshot(mem.corpus);
    const p = await pgSnapshot(db);
    expect(p).toEqual(m);
    return m;
  }

  it("a same-value higher-tier claim takes provenance, so a later lower tier cannot clobber it", async () => {
    const reports = await both(
      adapterOf([obs({ ...REX, breed: "mutt" }, T1)]),
      adapterOf([obs({ ...REX, breed: "mutt", tier: SHELTER }, T0)]),
      adapterOf([obs({ ...REX, breed: "collie" }, T2)]),
    );

    const snap = await expectParity();
    expect(snap.animals["1"].breed).toMatchObject({ value: "mutt", source: SHELTER });
    expect(reports[1].map((r) => r.events)).toEqual([[], []]);
    expect(reports[2].map((r) => [r.events.length, r.conflicted])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it("an exact fetchedAt tie between two raw rows replays to the same state with zero events", async () => {
    await both(adapterOf([obs({ ...REX, breed: "mutt" }, T0), obs({ ...REX, breed: "collie" }, T0)]));
    const before = await expectParity();
    expect(before.animals["1"].breed.value).toBe("collie");

    const m = await replay(AGG, mem.corpus.stored(), mem.stages);
    const p = await replay(AGG, await loadStoredObservations(db, AGG), pg);

    expect([m.events, p.events]).toEqual([[], []]);
    expect(await expectParity()).toEqual(before);
  });

  it("counts a cross-tier disagreement in either order", async () => {
    const [, second] = await both(
      adapterOf([obs({ ...REX, breed: "collie" }, T0)]),
      adapterOf([obs({ ...REX, breed: "mutt", tier: SHELTER }, T1)]),
    );

    expect(second.map((r) => r.conflicted)).toEqual([1, 1]);
    expect(second.map((r) => r.events.map((e) => e.data.changed))).toEqual([[["breed"]], [["breed"]]]);
    await expectParity();
  });

  it("a status nobody asserted is null — never defaulted", async () => {
    await both(adapterOf([obs(REX, T0)]));

    const snap = await expectParity();
    expect(snap.animals["1"].status).toBeUndefined();
    expect((await db.select().from(animals))[0].status).toBeNull();
  });

  it("refuses an all-null first observation in both writers, with no animal and no event", async () => {
    const [reports] = await both(adapterOf([obs({ id: "n-1", breed: null }, T0)]));

    expect(reports.map((r) => r.failures.map((f) => f.stage))).toEqual([["write"], ["write"]]);
    const snap = await expectParity();
    expect(snap).toEqual({ animals: {}, events: [] });
  });

  it("a deduped re-poll keeps provenance on the raw row's fetchedAt, not the poll's", async () => {
    await both(adapterOf([obs({ ...REX, breed: "mutt" }, T0)]), adapterOf([obs({ ...REX, breed: "mutt" }, T1)]));

    const snap = await expectParity();
    expect(snap.animals["1"].breed).toMatchObject({ fetchedAt: T0.toISOString(), rawId: 1 });
    expect(snap.events).toHaveLength(1);
  });

  it("runs the real RescueGroups normalizer identically through both writers", async () => {
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/rescuegroups-available.json", import.meta.url), "utf8"),
    );
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ...fixture, meta: { ...fixture.meta, pages: 1, count: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    pg = createPgStages(db, [rescueGroupsNormalizer]);
    mem = createMemoryStages([rescueGroupsNormalizer]);

    // One fetch, fed to both: the adapter stamps fetchedAt per fetch, and a
    // millisecond's drift between two fetches is not a writer disagreement.
    const fetched: Observation<unknown>[] = [];
    for await (const o of createRescueGroupsAdapter({ apiKey: "k" }, fetchImpl).fetch()) fetched.push(o);
    const [reports] = await both({
      source: AGG,
      async *fetch() {
        yield* fetched;
      },
    });

    expect(reports.map((r) => r.failures)).toEqual([[], []]);
    const snap = await expectParity();
    expect(Object.keys(snap.animals)).toHaveLength(2);
    expect(snap.events.map((e) => e.changed)).toEqual(reports[0].events.map((e) => e.data.changed));
  });
});
