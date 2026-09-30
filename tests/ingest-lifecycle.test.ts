import { describe, expect, it } from "vitest";
import { createMemoryStages } from "@/core/ingest/memory";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import { replay, runIngest, type NormalizedAnimal, type Normalizer } from "@/core/ingest/pipeline";
import { scrapeSource, type Source } from "@/core/sources";

/**
 * ADR-0014: disappearance is inferred from a COMPLETE run's absence, per
 * source, and never from a payload. Each case here is one of the ways a
 * naive set-diff writes a permanent wrong row into event_log.
 */

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
  return {
    source,
    externalId: id,
    payload: { id, name: id },
    fetchedAt: at,
    contentHash: `${source}:${id}`,
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

const kinds = (events: { kind: string; data: Record<string, unknown> }[]) =>
  events.map((e) => [e.kind, e.data.externalId]);

describe("ADR-0014 lifecycle — disappearance from absence", () => {
  it("an animal absent from a complete run disappears once, with its last sighting", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]), stages, { complete: true, now: () => D1 });

    const day2 = await runIngest(adapterOf(AGG, [obs(AGG, "a", D2)]), stages, { complete: true, now: () => D2 });
    const day3 = await runIngest(adapterOf(AGG, [obs(AGG, "a", D3)]), stages, { complete: true, now: () => D3 });

    expect(kinds(day2.events)).toEqual([["animal.disappeared", "b"]]);
    expect(day2.events[0]).toMatchObject({ occurredAt: D2, data: { lastSeenAt: D1 } });
    expect(day3.events).toEqual([]);
    expect(corpus.identities.get("rescuegroups:b")).toMatchObject({ disappearedAt: D2, lastSeenAt: D1 });
    expect(corpus.identities.get("rescuegroups:a")).toMatchObject({ disappearedAt: null, lastSeenAt: D3 });
  });

  it("a partial run never disappears anything, and says why", async () => {
    const { stages } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]), stages, { complete: true, now: () => D1 });

    const report = await runIngest(adapterOf(AGG, [obs(AGG, "a", D2)]), stages, { complete: false, now: () => D2 });

    expect(report.events).toEqual([]);
    expect(report.lifecycleSkipped).toMatch(/partial/);
  });

  it("a run that observed nothing is an outage, not a mass adoption", async () => {
    const { stages } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]), stages, { complete: true, now: () => D1 });

    const report = await runIngest(adapterOf(AGG, []), stages, { complete: true, now: () => D2 });

    expect(report.events).toEqual([]);
    expect(report.lifecycleSkipped).toMatch(/nothing/);
  });

  it("a fetch that throws mid-batch never reaches stage 5, and emits nothing", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]), stages, { complete: true, now: () => D1 });
    const eventsBefore = corpus.events.length;
    const broken: SourceAdapter<Payload> = {
      source: AGG,
      async *fetch() {
        yield obs(AGG, "a", D2);
        throw new Error("page 2 failed: 502");
      },
    };

    await expect(runIngest(broken, stages, { complete: true, now: () => D2 })).rejects.toThrow("502");

    expect(corpus.events).toHaveLength(eventsBefore);
    expect(corpus.identities.get("rescuegroups:b")!.disappearedAt).toBeNull();
  });

  it("scopes absence per source — missing from the aggregator is not missing from the shelter", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor(AGG), normalizerFor(SCRAPE)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "rex", D1)]), stages, { complete: true, now: () => D1 });
    await runIngest(adapterOf(SCRAPE, [obs(SCRAPE, "rex", D1)]), stages, { complete: true, now: () => D1 });

    const report = await runIngest(adapterOf(AGG, [obs(AGG, "other", D2)]), stages, { complete: true, now: () => D2 });

    expect(kinds(report.events)).toEqual([
      ["animal.seen", "other"],
      ["animal.disappeared", "rex"],
    ]);
    expect(report.events[1].source).toBe(AGG);
    expect(corpus.identities.get(`${SCRAPE}:rex`)!.disappearedAt).toBeNull();
  });

  it("a returning animal reappears — never a second first-sight — and can disappear again", async () => {
    const { stages } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1)]), stages, { complete: true, now: () => D1 });
    const gone = await runIngest(adapterOf(AGG, [obs(AGG, "z", D2)]), stages, { complete: true, now: () => D2 });
    const back = await runIngest(adapterOf(AGG, [obs(AGG, "a", D3), obs(AGG, "z", D3)]), stages, { complete: true, now: () => D3 });
    const goneAgain = await runIngest(adapterOf(AGG, [obs(AGG, "z", D3)]), stages, { complete: true, now: () => D3 });

    expect(kinds(gone.events)).toEqual([
      ["animal.seen", "z"],
      ["animal.disappeared", "a"],
    ]);
    expect(kinds(back.events)).toEqual([["animal.reappeared", "a"]]);
    expect(back.events[0].data.disappearedAt).toEqual(D2);
    expect(kinds(goneAgain.events)).toEqual([["animal.disappeared", "a"]]);
  });

  it("replay never reconciles presence", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]), stages, { complete: true, now: () => D1 });
    const eventsBefore = corpus.events.length;

    const report = await replay(AGG, corpus.stored().slice(0, 1), stages);

    expect(report.events).toEqual([]);
    expect(corpus.events).toHaveLength(eventsBefore);
    expect(corpus.identities.get("rescuegroups:b")!.disappearedAt).toBeNull();
  });
});

describe("ADR-0010 run record — what /api/health ages", () => {
  it("records a reconciled run as complete, with its counts and events by kind", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1), obs(AGG, "b", D1)]), stages, { complete: true, now: () => D1 });
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D2)]), stages, { complete: true, now: () => D2 });

    expect(corpus.runs).toHaveLength(2);
    expect(corpus.runs[1]).toMatchObject({
      source: AGG,
      startedAt: D2,
      finishedAt: D2,
      complete: true,
      lifecycleSkipped: null,
      observed: 1,
      failures: 0,
      events: { "animal.disappeared": 1 },
    });
  });

  // A caller's `complete: true` is a claim; only stage 5 running makes it so.
  it("never records a partial or empty run as complete", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor(AGG)]);
    await runIngest(adapterOf(AGG, [obs(AGG, "a", D1)]), stages, { complete: false, now: () => D1 });
    await runIngest(adapterOf(AGG, []), stages, { complete: true, now: () => D2 });

    expect(corpus.runs.map((r) => [r.complete, r.lifecycleSkipped])).toEqual([
      [false, "run declared partial by caller"],
      [false, "run observed nothing"],
    ]);
  });

  it("records nothing for a run that threw, or for replay", async () => {
    const { stages, corpus } = createMemoryStages([normalizerFor(AGG)]);
    const broken: SourceAdapter<Payload> = {
      source: AGG,
      async *fetch() {
        yield obs(AGG, "a", D1);
        throw new Error("page 2 failed: 502");
      },
    };
    await expect(runIngest(broken, stages, { complete: true, now: () => D1 })).rejects.toThrow("502");
    await replay(AGG, corpus.stored(), stages);

    expect(corpus.runs).toEqual([]);
  });
});
