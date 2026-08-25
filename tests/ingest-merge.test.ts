import { describe, expect, it } from "vitest";
import { createMemoryStages } from "@/core/ingest/memory";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import {
  replay,
  runIngest,
  type AnimalClaims,
  type NormalizedAnimal,
  type Normalizer,
} from "@/core/ingest/pipeline";
import { scrapeSource, type Source } from "@/core/sources";

/**
 * ADR-0013 merge semantics, driven through the pipeline with two simulated
 * sources. The tier branch has no live cross-source data yet (ADR-0009 phase
 * 7), so every clobber case here is a fixture, and each one is the shape a
 * naive merge ships wrong.
 */

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

const SHELTER: Source = "shelterluv";
const SCRAPE = scrapeSource("happy-tails");
const AGG: Source = "rescuegroups";

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

/** Asserts exactly the keys present on the payload; `breed: null` is asserted as null. */
function normalizerFor(source: Source): Normalizer<Payload> {
  return {
    source,
    async normalize(o: StoredObservation<Payload>): Promise<NormalizedAnimal> {
      const stamp = { source: o.source, fetchedAt: o.fetchedAt };
      const claims: AnimalClaims = {};
      if (o.payload.name !== undefined) claims.name = { value: o.payload.name, ...stamp };
      if (o.payload.species !== undefined) claims.species = { value: o.payload.species, ...stamp };
      if (o.payload.breed !== undefined) claims.breed = { value: o.payload.breed, ...stamp };
      if (o.payload.status !== undefined) claims.status = { value: o.payload.status, ...stamp };
      return { claims };
    },
  };
}

function stagesFor(...sources: Source[]) {
  return createMemoryStages(sources.map(normalizerFor));
}

const REX = { id: "rex-1", name: "Rex", species: "dog" };

describe("ADR-0013 merge — tier beats recency", () => {
  it("a fresher aggregator claim never clobbers a shelter-API fact", async () => {
    const { stages, corpus } = stagesFor(SHELTER, AGG);

    await runIngest(adapterOf(SHELTER, [obs(SHELTER, { ...REX, breed: "collie" }, T0)]), stages, { complete: true });
    const report = await runIngest(
      adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T2)]),
      stages,
      { complete: true },
    );

    // v1 identity is per source, so the aggregator creates its own row; the
    // shelter row must be untouched and the conflict is not visible here.
    expect(corpus.animals.size).toBe(2);
    expect(corpus.animals.get(1)!.claims.breed!.value).toBe("collie");
    expect(report.conflicted).toBe(0);
  });

  it("within one canonical animal, a lower tier loses even when fresher", async () => {
    // Force both sources onto one animal: same source key, but claims stamped
    // as different tiers — the shape item 10's matcher will produce.
    const { stages, corpus } = createMemoryStages([
      {
        source: AGG,
        async normalize(o: StoredObservation<Payload>) {
          const tier: Source = o.payload.status === "from-shelter" ? SHELTER : AGG;
          return {
            claims: {
              name: { value: "Rex", source: tier, fetchedAt: o.fetchedAt },
              species: { value: "dog", source: tier, fetchedAt: o.fetchedAt },
              breed: { value: o.payload.breed ?? null, source: tier, fetchedAt: o.fetchedAt },
            } satisfies AnimalClaims,
          };
        },
      },
    ]);

    await runIngest(
      adapterOf(AGG, [obs(AGG, { id: "rex-1", breed: "collie", status: "from-shelter" }, T0)]),
      stages,
      { complete: true },
    );
    const report = await runIngest(
      adapterOf(AGG, [obs(AGG, { id: "rex-1", breed: "mutt" }, T2)]),
      stages,
      { complete: true },
    );

    const breed = corpus.animals.get(1)!.claims.breed!;
    expect(breed.value).toBe("collie");
    expect(breed.source).toBe(SHELTER);
    expect(report.conflicted).toBe(1);
    expect(report.events).toEqual([]);
  });

  it("within a tier, the most recent fetch wins and emits one update", async () => {
    const { stages, corpus } = stagesFor(AGG);

    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T0)]), stages, { complete: true });
    const report = await runIngest(
      adapterOf(AGG, [obs(AGG, { ...REX, breed: "collie" }, T1)]),
      stages,
      { complete: true },
    );

    expect(corpus.animals.get(1)!.claims.breed!.value).toBe("collie");
    expect(report.events.map((e) => [e.kind, e.data.changed])).toEqual([
      ["animal.updated", ["breed"]],
    ]);
    expect(report.conflicted).toBe(0);
  });
});

describe("ADR-0013 merge — null claims never compete", () => {
  it("a fresher null does not erase a real value, and is not a conflict", async () => {
    const { stages, corpus } = stagesFor(AGG);

    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T0)]), stages, { complete: true });
    const report = await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: null }, T1)]), stages, { complete: true });

    expect(corpus.animals.get(1)!.claims.breed!.value).toBe("mutt");
    expect(report.events).toEqual([]);
    expect(report.conflicted).toBe(0);
  });

  it("a null on a never-asserted field leaves it unset, with no provenance", async () => {
    const { stages, corpus } = stagesFor(AGG);

    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: null }, T0)]), stages, { complete: true });

    expect(corpus.animals.get(1)!.claims.breed).toBeUndefined();
  });

  it("a real value arriving after a null is a plain first assertion", async () => {
    const { stages, corpus } = stagesFor(AGG);

    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: null }, T0)]), stages, { complete: true });
    const report = await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T1)]), stages, { complete: true });

    expect(corpus.animals.get(1)!.claims.breed!.value).toBe("mutt");
    expect(report.events.map((e) => e.data.changed)).toEqual([["breed"]]);
  });
});

describe("ADR-0013 merge — idempotence under replay", () => {
  it("replaying the whole corpus appends zero events and changes nothing", async () => {
    const { stages, corpus } = stagesFor(AGG);
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "mutt" }, T0)]), stages, { complete: true });
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "collie" }, T1)]), stages, { complete: true });
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: null }, T2)]), stages, { complete: true });
    const before = JSON.stringify([...corpus.animals.values()]);
    const eventsBefore = corpus.events.length;

    const report = await replay(AGG, corpus.stored(), stages);

    expect(report.events).toEqual([]);
    expect(report.conflicted).toBe(0);
    expect(corpus.events).toHaveLength(eventsBefore);
    expect(JSON.stringify([...corpus.animals.values()])).toBe(before);
  });

  it("a fixed normalizer repairs canonical on replay — the fresh derivation wins exact ties", async () => {
    const { stages, corpus } = stagesFor(AGG);
    await runIngest(adapterOf(AGG, [obs(AGG, { ...REX, breed: "MUTT" }, T0)]), stages, { complete: true });

    stages.normalizers.set(AGG, {
      source: AGG,
      async normalize(o: StoredObservation<Payload>) {
        const { claims } = await normalizerFor(AGG).normalize(o);
        return {
          claims: { ...claims, breed: { ...claims.breed!, value: (claims.breed!.value as string).toLowerCase() } },
        };
      },
    });
    const report = await replay(AGG, corpus.stored(), stages);

    expect(corpus.animals.get(1)!.claims.breed!.value).toBe("mutt");
    expect(report.events.map((e) => e.data.changed)).toEqual([["breed"]]);
  });
});

describe("ADR-0013 identity — exact (source, externalId) in v1", () => {
  it("the same externalId from two sources is two canonical animals until item 10", async () => {
    const { stages, corpus } = stagesFor(SCRAPE, AGG);

    await runIngest(adapterOf(SCRAPE, [obs(SCRAPE, REX, T0)]), stages, { complete: true });
    await runIngest(adapterOf(AGG, [obs(AGG, REX, T0)]), stages, { complete: true });

    expect(corpus.animals.size).toBe(2);
  });
});
