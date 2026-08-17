import { describe, expect, it } from "vitest";
import { createMemoryStages } from "@/core/ingest/memory";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import { replay, runIngest, type AnimalClaims, type Normalizer } from "@/core/ingest/pipeline";
import type { Source } from "@/core/sources";

interface RgPayload {
  id: string;
  name: string;
  species: string;
  breed?: string;
}

const FETCHED = new Date("2026-07-30T12:00:00Z");
const LATER = new Date("2026-07-31T12:00:00Z");

function obs(payload: RgPayload, source: Source = "rescuegroups", at = FETCHED): Observation<RgPayload> {
  return {
    source,
    externalId: payload.id,
    payload,
    fetchedAt: at,
    contentHash: JSON.stringify(payload),
  };
}

function adapterOf(observations: Observation<RgPayload>[], source: Source = "rescuegroups") {
  return {
    source,
    async *fetch() {
      yield* observations;
    },
  } satisfies SourceAdapter<RgPayload>;
}

function normalizerFor(source: Source): Normalizer<RgPayload> {
  const normalizer: Normalizer<RgPayload> = {
    source,
    async normalize(o: StoredObservation<RgPayload>): Promise<AnimalClaims> {
      const stamp = { source: o.source, fetchedAt: o.fetchedAt };
      return {
        name: { value: o.payload.name, ...stamp },
        species: { value: o.payload.species, ...stamp },
        breed: { value: o.payload.breed ?? null, ...stamp },
      };
    },
  };
  return normalizer;
}

const REX = { id: "rg-1", name: "Rex", species: "dog", breed: "mutt" };
const LUNA = { id: "rg-2", name: "Luna", species: "dog" };

describe("ADR-0009 ingest pipeline", () => {
  it("persists raw, normalizes, and emits animal.seen per new animal", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor("rescuegroups")]);

    const report = await runIngest(adapterOf([obs(REX), obs(LUNA)]), stages);

    expect(report).toMatchObject({ observed: 2, persisted: 2, deduped: 0, normalized: 2 });
    expect(report.failures).toEqual([]);
    expect(report.events.map((e) => e.kind)).toEqual(["animal.seen", "animal.seen"]);
    expect(corpus.rawRows).toHaveLength(2);
    expect(corpus.animals.size).toBe(2);
  });

  it("dedups an unchanged payload and emits nothing on the second run", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor("rescuegroups")]);

    await runIngest(adapterOf([obs(REX)]), stages);
    const second = await runIngest(adapterOf([obs(REX, "rescuegroups", LATER)]), stages);

    expect(second).toMatchObject({ observed: 1, persisted: 0, deduped: 1 });
    expect(second.events).toEqual([]);
    expect(corpus.rawRows).toHaveLength(1);
    expect(corpus.animals.size).toBe(1);
  });

  it("writes a new raw row and one animal.updated when the payload changes", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor("rescuegroups")]);

    await runIngest(adapterOf([obs(REX)]), stages);
    const second = await runIngest(
      adapterOf([obs({ ...REX, name: "Rexington" }, "rescuegroups", LATER)]),
      stages,
    );

    expect(second.persisted).toBe(1);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({ kind: "animal.updated", data: { changed: ["name"] } });
    expect(corpus.rawRows).toHaveLength(2);
    expect(corpus.animals.size).toBe(1);
  });

  it("replays stages 2-4 off the corpus with no source contact, idempotently", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor("rescuegroups")]);
    await runIngest(adapterOf([obs(REX), obs(LUNA)]), stages);
    const eventsAfterIngest = corpus.events.length;

    const report = await replay("rescuegroups", corpus.stored(), stages);

    expect(report).toMatchObject({ observed: 2, persisted: 0, normalized: 2 });
    expect(report.failures).toEqual([]);
    // Replay must add no events: event_log rows are permanent (ADR-0003).
    expect(report.events).toEqual([]);
    expect(corpus.events).toHaveLength(eventsAfterIngest);
  });

  it("replay picks up a fixed normalizer without re-fetching", async () => {
    const broken: Normalizer<RgPayload> = {
      source: "rescuegroups",
      async normalize(o) {
        return { name: { value: "???", source: o.source, fetchedAt: o.fetchedAt } };
      },
    };
    const { stages, corpus } = createMemoryStages([broken]);
    await runIngest(adapterOf([obs(REX)]), stages);

    stages.normalizers.set("rescuegroups", normalizerFor("rescuegroups"));
    const report = await replay("rescuegroups", corpus.stored(), stages);

    expect(report.events[0]).toMatchObject({ kind: "animal.updated" });
    expect(corpus.animals.get(1)?.claims.name?.value).toBe("Rex");
    expect(corpus.rawRows).toHaveLength(1);
  });

  it("takes a second source through the same pipeline, unmodified", async () => {
    const { stages, corpus } = createMemoryStages([
      normalizerFor("rescuegroups"),
      normalizerFor("shelterluv"),
    ]);

    await runIngest(adapterOf([obs(REX)]), stages);
    const report = await runIngest(
      adapterOf([obs({ ...REX, id: "sl-1" }, "shelterluv")], "shelterluv"),
      stages,
    );

    expect(report.failures).toEqual([]);
    expect(report.source).toBe("shelterluv");
    expect(corpus.rawRows.map((r) => r.source)).toEqual(["rescuegroups", "shelterluv"]);
  });

  it("records a per-observation failure and keeps processing the batch", async () => {
    const flaky: Normalizer<RgPayload> = {
      source: "rescuegroups",
      async normalize(o) {
        if (o.externalId === "rg-1") throw new Error("unparseable payload");
        return { name: { value: o.payload.name, source: o.source, fetchedAt: o.fetchedAt } };
      },
    };
    const { stages } = createMemoryStages([flaky]);

    const report = await runIngest(adapterOf([obs(REX), obs(LUNA)]), stages);

    expect(report).toMatchObject({ observed: 2, persisted: 2, normalized: 1 });
    expect(report.failures).toEqual([
      { externalId: "rg-1", stage: "normalize", error: "unparseable payload" },
    ]);
    expect(report.events).toHaveLength(1);
  });

  it("fails an unregistered source loudly instead of dropping it silently", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor("rescuegroups")]);

    const report = await runIngest(adapterOf([obs(REX, "manual")], "manual"), stages);

    expect(report.persisted).toBe(1);
    expect(report.normalized).toBe(0);
    expect(report.failures[0]).toMatchObject({ stage: "normalize" });
    expect(corpus.animals.size).toBe(0);
  });
});
