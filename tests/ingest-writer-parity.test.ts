import { readFileSync } from "node:fs";
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
  type NormalizedAnimal,
  type Normalizer,
} from "@/core/ingest/pipeline";
import { createRescueGroupsAdapter, rescueGroupsNormalizer } from "@/core/ingest/rescuegroups";
import type { Source } from "@/core/sources";
import type { Claim } from "@/core/trust";
import { closeDb, type Db } from "@/db/client";
import { SKIP_DB_TESTS, testDb, truncateCorpus } from "./support/db";
import { animalDisplay, animalIdentities, animals, eventLog } from "@/db/schema";

/**
 * The in-memory writer is the reference and the Postgres writer is
 * production (ADR-0013). Every scenario here runs through BOTH and the
 * resulting canonical state — value, source, fetchedAt and rawId per field —
 * plus every event must be identical. The scenarios are the ones the
 * adversarial pass of 2026-08-21 found the two disagreeing on. Skipped
 * without DATABASE_URL.
 */
// Never DATABASE_URL: these suites truncate, and the dev database is not
// theirs to empty (ADR-0017).

interface Payload {
  id: string;
  name?: string;
  species?: string;
  breed?: string | null;
  status?: string;
  city?: string;
  state?: string;
  orgName?: string;
  postalCode?: string;
  listedAt?: string;
  sourceUpdatedAt?: string | null;
  description?: string;
  photos?: { url: string; width: number; height: number }[];
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
  async normalize(o: StoredObservation<Payload>): Promise<NormalizedAnimal> {
    const stamp = { source: o.payload.tier ?? o.source, fetchedAt: o.fetchedAt };
    const claims: AnimalClaims = {};
    if (o.payload.name !== undefined) claims.name = { value: o.payload.name, ...stamp };
    if (o.payload.species !== undefined) claims.species = { value: o.payload.species, ...stamp };
    if (o.payload.breed !== undefined) claims.breed = { value: o.payload.breed, ...stamp };
    if (o.payload.status !== undefined) claims.status = { value: o.payload.status, ...stamp };
    if (o.payload.city !== undefined) claims.city = { value: o.payload.city, ...stamp };
    if (o.payload.state !== undefined) claims.state = { value: o.payload.state, ...stamp };
    if (o.payload.orgName !== undefined) claims.orgName = { value: o.payload.orgName, ...stamp };
    if (o.payload.postalCode !== undefined) {
      claims.postalCode = { value: o.payload.postalCode, ...stamp };
    }
    if (o.payload.listedAt !== undefined) {
      claims.listedAt = { value: new Date(o.payload.listedAt), ...stamp };
    }
    const sourceUpdatedAt =
      o.payload.sourceUpdatedAt === undefined
        ? undefined
        : o.payload.sourceUpdatedAt === null
          ? null
          : new Date(o.payload.sourceUpdatedAt);
    if (o.payload.description === undefined) return { claims, sourceUpdatedAt };
    return {
      claims,
      sourceUpdatedAt,
      display: {
        description: o.payload.description,
        photos: o.payload.photos ?? [],
        listingOrg: o.payload.orgName ?? null,
        trackerUrl: null,
        fetchedAt: o.fetchedAt,
      },
    };
  },
};

/** The same mapping under a second source, so a per-source write can be caught ignoring the source. */
const shelterNormalizer: Normalizer<Payload> = { ...normalizer, source: SHELTER };

type DisplaySnapshot = Record<
  string,
  { description: string | null; photos: { url: string; width: number; height: number }[]; listingOrg: string | null; trackerUrl: string | null; fetchedAt: string }
>;

type Snapshot = {
  animals: Record<string, Record<string, { value: unknown; source: string; fetchedAt: string; rawId?: number }>>;
  display: DisplaySnapshot;
  /** per-(animal, source) upkeep — in the snapshot because it decides visibility (ADR-0015 as amended) */
  upkeep: Record<string, string | null>;
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
  const shown: DisplaySnapshot = {};
  for (const [k, row] of corpus.display) {
    shown[k] = {
      description: row.description,
      photos: row.photos,
      listingOrg: row.listingOrg,
      trackerUrl: row.trackerUrl,
      fetchedAt: row.fetchedAt.toISOString(),
    };
  }
  const upkeep: Snapshot["upkeep"] = {};
  for (const identity of corpus.identities.values()) {
    upkeep[`${identity.animalId}:${identity.source}`] =
      identity.sourceUpdatedAt?.toISOString() ?? null;
  }
  return { animals: out, display: shown, upkeep, events: eventsOf(corpus.events) };
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
  const shown: DisplaySnapshot = {};
  for (const row of await db.select().from(animalDisplay).orderBy(animalDisplay.id)) {
    shown[`${row.animalId}:${row.source}`] = {
      description: row.description,
      photos: row.photos,
      listingOrg: row.listingOrg,
      trackerUrl: row.trackerUrl,
      fetchedAt: row.fetchedAt.toISOString(),
    };
  }
  const events = (await db.select().from(eventLog).orderBy(eventLog.id)).map((e) => ({
    kind: e.kind,
    subjectId: e.subjectId,
    changed: (e.data as { changed: unknown }).changed,
    occurredAt: e.occurredAt.toISOString(),
    source: e.source as string,
  }));
  const upkeep: Snapshot["upkeep"] = {};
  for (const row of await db.select().from(animalIdentities).orderBy(animalIdentities.id)) {
    upkeep[`${row.animalId}:${row.source}`] = row.sourceUpdatedAt?.toISOString() ?? null;
  }
  return { animals: out, display: shown, upkeep, events };
}

describe.skipIf(SKIP_DB_TESTS)("ADR-0013 writer parity — memory is the reference, Postgres must agree", () => {
  let db: Db;
  let pg: IngestStages;
  let mem: { stages: IngestStages; corpus: MemoryCorpus };

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    pg = createPgStages(db, [normalizer, shelterNormalizer]);
    mem = createMemoryStages([normalizer, shelterNormalizer]);
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

  // All four location fields, not a representative two: `MERGED_FIELDS` is a
  // list, and a field dropped from it is written nowhere, given no provenance
  // and counted in no conflict — silently, since a subset still typechecks
  // against `satisfies`.
  it("merges location facts by tier like any other field (ADR-0015)", async () => {
    const HERE = { city: "Pittsburgh", state: "PA", orgName: "Animal Friends", postalCode: "15238" };
    const reports = await both(
      adapterOf([obs({ ...REX, ...HERE }, T0)]),
      adapterOf([obs({ ...REX, ...HERE, city: "Wilkinsburg", tier: SHELTER }, T1)]),
      adapterOf([obs({ ...REX, ...HERE }, T2)]),
    );

    const snap = await expectParity();
    // The shelter's city holds against a later aggregator poll, and the
    // disagreement is counted rather than logged (ADR-0013).
    expect(snap.animals["1"].city).toMatchObject({ value: "Wilkinsburg", source: SHELTER });
    expect(snap.animals["1"].state).toMatchObject({ value: "PA", source: SHELTER });
    expect(snap.animals["1"].orgName).toMatchObject({ value: "Animal Friends", source: SHELTER });
    expect(snap.animals["1"].postalCode).toMatchObject({ value: "15238", source: SHELTER });
    expect(reports[1].map((r) => r.events.map((e) => e.data.changed))).toEqual([
      [["city"]],
      [["city"]],
    ]);
    expect(reports[2].map((r) => [r.events.length, r.conflicted])).toEqual([
      [0, 1],
      [0, 1],
    ]);

    // Promoting location fires its change ONCE. Re-deriving the same corpus
    // must add nothing: event_log rows are permanent, so a location event per
    // replay is uncorrectable (ADR-0003).
    const m = await replay(AGG, mem.corpus.stored(), mem.stages);
    const p = await replay(AGG, await loadStoredObservations(db, AGG), pg);
    expect([m.events, p.events]).toEqual([[], []]);
    expect(await expectParity()).toEqual(snap);
  });

  it("merges listedAt by tier like any other fact, and fires `changed` once per real change", async () => {
    const reports = await both(
      adapterOf([obs({ ...REX, listedAt: "2019-04-01T00:00:00Z" }, T0)]),
      // Same value, re-polled: the animal is not newly listed every day.
      adapterOf([obs({ ...REX, listedAt: "2019-04-01T00:00:00Z" }, T1)]),
      // The shelter's own record disagrees, and outranks the aggregator.
      adapterOf([obs({ ...REX, listedAt: "2018-11-20T00:00:00Z", tier: SHELTER }, T2)]),
    );

    const snap = await expectParity();
    expect(snap.animals[1].listedAt.value).toEqual(new Date("2018-11-20T00:00:00Z"));
    expect(snap.animals[1].listedAt.source).toBe(SHELTER);
    // Once for the first sighting, once for the tier correction — never for the
    // unchanged re-poll. A `changed` per poll is a permanent event_log row per
    // animal per day, and the corpus has 64k of them (ADR-0003).
    expect(reports.map(([m]) => m.events.length)).toEqual([1, 0, 1]);
    expect(snap.events.filter((e) => e.kind === "animal.updated")).toHaveLength(1);
  });

  it("stores upkeep per source, without an event and without competing as a claim", async () => {
    const reports = await both(
      adapterOf([obs({ ...REX, sourceUpdatedAt: "2026-07-01T00:00:00Z" }, T0)]),
      adapterOf([obs({ ...REX, sourceUpdatedAt: "2026-08-02T00:00:00Z" }, T1)]),
    );

    const snap = await expectParity();
    expect(snap.upkeep["1:rescuegroups"]).toBe("2026-08-02T00:00:00.000Z");
    // Upkeep moving is the source editing its own record, not the animal
    // changing: no `animal.updated`, and nothing in `provenance` (ADR-0015).
    expect(reports[1][0].events).toEqual([]);
    expect(snap.animals[1].sourceUpdatedAt).toBeUndefined();
  });

  it("scopes an upkeep write to its own source, not to every identity sharing an externalId", async () => {
    // Two sources publishing the SAME externalId. Until the cross-source merge
    // (item 10) that is two animals, which is what makes this a live trap: an
    // upkeep write that matched on externalId alone would refresh the
    // aggregator's abandoned record from the shelter's diligent one, and the
    // abandoned listing would stay visible (ADR-0015 as amended).
    await both(
      adapterOf([obs({ ...REX, sourceUpdatedAt: "2019-01-01T00:00:00Z" }, T0)]),
      adapterOf([obs({ ...REX, sourceUpdatedAt: "2020-01-01T00:00:00Z" }, T1, SHELTER)], SHELTER),
      // The shelter's SECOND poll: an existing identity, so this is the update
      // path rather than the insert. Without this step the unscoped write is
      // never reached and the test passes while the trap is wide open.
      adapterOf([obs({ ...REX, sourceUpdatedAt: "2026-08-02T00:00:00Z" }, T2, SHELTER)], SHELTER),
    );

    const snap = await expectParity();
    expect(snap.upkeep["1:rescuegroups"]).toBe("2019-01-01T00:00:00.000Z");
    expect(snap.upkeep["2:shelterluv"]).toBe("2026-08-02T00:00:00.000Z");
  });

  it("upserts one display row per source, and clears what the source stopped saying (ADR-0015)", async () => {
    const SHOWN = {
      description: "Rex loves everyone",
      photos: [{ url: "https://cdn/rex.jpg?width=500", width: 500, height: 400 }],
    };
    const reports = await both(
      adapterOf([obs({ ...REX, orgName: "Animal Friends", ...SHOWN }, T0)]),
      adapterOf([obs({ ...REX, orgName: "Animal Friends", description: "", photos: [] }, T1)]),
    );

    // The second poll changes ONLY display, and must be silent. Without this
    // assertion a writer that emits on "display present and some claim
    // touched" passes every other test here while writing one permanent
    // event_log row per animal per upstream copy edit (ADR-0003).
    expect(reports[1].map((r) => r.events)).toEqual([[], []]);
    const snap = await expectParity();
    expect(snap.display["1:rescuegroups"]).toEqual({
      description: "",
      photos: [],
      listingOrg: "Animal Friends",
      trackerUrl: null,
      fetchedAt: T1.toISOString(),
    });
  });

  it("keeps a second source's display row beside the first instead of merging them", async () => {
    await both(adapterOf([obs({ ...REX, description: "the aggregator's copy" }, T0)]));

    // Applied to the writers directly: v1 entity resolution is per-source, so
    // one animal carrying two sources is item 10's shape, not a poll's.
    const second = {
      source: SHELTER,
      externalId: "rex-1",
      rawId: 1,
      claims: { name: { value: "Rex", source: SHELTER, fetchedAt: T1 } },
      display: {
        description: "the shelter's own words",
        photos: [],
        listingOrg: null,
        trackerUrl: null,
        fetchedAt: T1,
      },
    };
    await mem.stages.writer.apply(second, 1);
    await pg.writer.apply(second, 1);

    const snap = await expectParity();
    // Two rows, not one: which of them a page may render is a LICENSE
    // question (`pickLicensedDisplay`), never a merge (ADR-0015 decision 3).
    expect(Object.keys(snap.display).sort()).toEqual(["1:rescuegroups", "1:shelterluv"]);
    expect(snap.display["1:shelterluv"].description).toBe("the shelter's own words");
  });

  it("writes display without an event, and without touching the animal row", async () => {
    const shown = { ...REX, description: "Rex loves everyone" };
    await both(adapterOf([obs(shown, T0)]));
    const [{ updatedAt }] = await db.select().from(animals);
    const after = await expectParity();

    // A re-poll of an unchanged payload dedups to the same raw row, so the
    // claims are identical and nothing about the animal is written. The
    // display upsert runs anyway — and must stay silent: an `animal.updated`
    // per poll is permanent, and `updated_at` is what a page shows as
    // "last updated" (ADR-0003, ADR-0015).
    const [[mem2, pg2]] = await both(adapterOf([obs(shown, T1)]));
    expect([mem2.events, pg2.events]).toEqual([[], []]);
    expect((await db.select().from(animals))[0].updatedAt).toEqual(updatedAt);
    expect(await expectParity()).toEqual(after);
  });

  it("leaves an existing display row alone when a poll promotes nothing", async () => {
    await both(
      adapterOf([obs({ ...REX, description: "Rex loves everyone" }, T0)]),
      adapterOf([obs({ ...REX, breed: "collie" }, T1)]),
    );

    // Absence of `display` is not a retraction — only the purge path deletes
    // a display row, and only for a whole source (ADR-0006 decision 4).
    const snap = await expectParity();
    expect(snap.display["1:rescuegroups"].description).toBe("Rex loves everyone");
  });

  it("rebuilds an identical display row on replay, from the observation and not the clock", async () => {
    await both(
      adapterOf([obs({ ...REX, description: "Rex loves everyone", photos: [{ url: "https://cdn/a.jpg", width: 4, height: 3 }] }, T0)]),
    );
    const before = await expectParity();

    const m = await replay(AGG, mem.corpus.stored(), mem.stages);
    const p = await replay(AGG, await loadStoredObservations(db, AGG), pg);

    expect([m.events, p.events]).toEqual([[], []]);
    expect(await expectParity()).toEqual(before);
    expect(before.display["1:rescuegroups"].fetchedAt).toBe(T0.toISOString());
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
    expect(snap).toEqual({ animals: {}, display: {}, upkeep: {}, events: [] });
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
