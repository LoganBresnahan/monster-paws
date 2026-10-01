import { describe, expect, it } from "vitest";
import { createMemoryStages } from "@/core/ingest/memory";
import type { Observation, SourceAdapter, StoredObservation } from "@/core/ingest/observation";
import {
  dailyDisappearanceRate,
  DISAPPEARANCE_GATE_FLOOR,
  judgeDisappearances,
  MAX_DAILY_DISAPPEARANCE_RATE,
  runIngest,
  type DisappearanceTally,
  type NormalizedAnimal,
  type Normalizer,
} from "@/core/ingest/pipeline";
import type { Source } from "@/core/sources";

/**
 * The disappearance-rate gate (ADR-0014 as amended 2026-09-30): a rate per day
 * since the last complete run, never a flat share. The one real wave we have
 * measured — 2026-09-28, the first poll after 24 days away — must pass, and
 * the same share inside one day must not.
 */

const DAY = 86_400_000;
const D0 = new Date("2026-09-04T01:25:00Z");
const WAVE_AT = new Date("2026-09-28T16:15:00Z");
const tally = (present: number, disappearing: number, at: Date, newestSighting: Date | null = null): DisappearanceTally => ({
  present,
  disappearing,
  at,
  newestSighting,
});

describe("ADR-0014 disappearance rate", () => {
  it("measures the 2026-09-28 wave at ~1.2%/day, not the 25% share", () => {
    const days = (WAVE_AT.getTime() - D0.getTime()) / DAY;
    expect(dailyDisappearanceRate(85_204, 21_459, days)).toBeCloseTo(0.0117, 3);
  });

  it("is the share itself over one day, and never less than a day's worth", () => {
    expect(dailyDisappearanceRate(1000, 250, 1)).toBeCloseTo(0.25);
    // Two runs minutes apart: pagination drift must not read as a collapse.
    expect(dailyDisappearanceRate(1000, 5, 0.01)).toBeCloseTo(0.005);
  });

  it("is zero when nothing is present or nothing disappears", () => {
    expect(dailyDisappearanceRate(0, 0, 1)).toBe(0);
    expect(dailyDisappearanceRate(1000, 0, 3)).toBe(0);
  });
});

describe("ADR-0014 disappearance gate — verdicts", () => {
  it("passes the 2026-09-28 wave, measured from the last complete run", () => {
    expect(judgeDisappearances(tally(85_204, 21_459, WAVE_AT), D0, MAX_DAILY_DISAPPEARANCE_RATE).refusal).toBeNull();
  });

  it("refuses the same share inside one day, and says why", () => {
    const oneDayLater = new Date(D0.getTime() + DAY);
    const verdict = judgeDisappearances(tally(85_204, 21_459, oneDayLater), D0, MAX_DAILY_DISAPPEARANCE_RATE);
    expect(verdict.refusal).toMatch(/21459 of 85204 over 1\.0 day\(s\) is 25\.2%\/day, above 5\.0%\/day/);
  });

  // A shelter of twelve adopting three is a good day, not a feed bug.
  it("never refuses below the floor", () => {
    const at = new Date(D0.getTime() + DAY);
    expect(judgeDisappearances(tally(12, 3, at), D0, MAX_DAILY_DISAPPEARANCE_RATE).refusal).toBeNull();
    expect(
      judgeDisappearances(tally(1000, DISAPPEARANCE_GATE_FLOOR, at), D0, MAX_DAILY_DISAPPEARANCE_RATE).refusal,
    ).not.toBeNull();
  });

  it("measures from the last complete run, falling back to the newest sighting, then to one day", () => {
    const at = new Date(D0.getTime() + 10 * DAY);
    const nineDaysAgo = new Date(at.getTime() - 9 * DAY);
    expect(judgeDisappearances(tally(1000, 300, at, nineDaysAgo), D0, 0.05).days).toBeCloseTo(10);
    expect(judgeDisappearances(tally(1000, 300, at, nineDaysAgo), null, 0.05).days).toBeCloseTo(9);
    expect(judgeDisappearances(tally(1000, 300, at, null), null, 0.05).refusal).not.toBeNull();
  });
});

interface Payload {
  id: string;
}

function obs(id: string, at: Date): Observation<Payload> {
  return { source: "rescuegroups", externalId: id, payload: { id }, fetchedAt: at, contentHash: id };
}

function adapterOf(observations: Observation<Payload>[]): SourceAdapter<Payload> {
  return {
    source: "rescuegroups",
    async *fetch() {
      yield* observations;
    },
  };
}

const normalizer: Normalizer<Payload> = {
  source: "rescuegroups" as Source,
  async normalize(o: StoredObservation<Payload>): Promise<NormalizedAnimal> {
    const stamp = { source: o.source, fetchedAt: o.fetchedAt };
    return { claims: { name: { value: o.payload.id, ...stamp }, species: { value: "dog", ...stamp } } };
  },
};

describe("ADR-0014 disappearance gate — in the pipeline", () => {
  const herd = Array.from({ length: 1000 }, (_, i) => `a${i}`);
  const at = (days: number) => new Date(D0.getTime() + days * DAY);

  async function refusedOnce() {
    const { stages, corpus } = createMemoryStages([normalizer]);
    await runIngest(adapterOf(herd.map((id) => obs(id, at(0)))), stages, { complete: true, now: () => at(0) });
    const survivors = herd.slice(0, 700);
    const report = await runIngest(adapterOf(survivors.map((id) => obs(id, at(1)))), stages, {
      complete: true,
      now: () => at(1),
    });
    return { stages, corpus, survivors, report };
  }

  it("a refused run changes no identity, emits nothing, and is recorded incomplete", async () => {
    const { corpus, report } = await refusedOnce();

    expect(report.gateRefused).toBe(true);
    expect(report.disappearanceRatePerDay).toBeCloseTo(0.3);
    expect(report.events.filter((e) => e.kind === "animal.disappeared")).toEqual([]);
    expect([...corpus.identities.values()].every((id) => id.disappearedAt === null)).toBe(true);
    expect(corpus.runs.at(-1)).toMatchObject({ complete: false, lifecycleSkipped: report.lifecycleSkipped });
  });

  // The denominator stays at the last COMPLETE run, so a genuine wave passes
  // once the gap makes it a normal rate — and a bug keeps tripping meanwhile.
  it("lands the same wave on its own once the gap since the last complete run is long enough", async () => {
    const { stages, survivors } = await refusedOnce();
    const later = await runIngest(adapterOf(survivors.map((id) => obs(id, at(8)))), stages, {
      complete: true,
      now: () => at(8),
    });
    expect(later.gateRefused).toBeUndefined();
    expect(later.events.filter((e) => e.kind === "animal.disappeared")).toHaveLength(300);
  });

  it("lands it at once when a person raises the gate for one run", async () => {
    const { stages, survivors } = await refusedOnce();
    const accepted = await runIngest(adapterOf(survivors.map((id) => obs(id, at(1)))), stages, {
      complete: true,
      now: () => at(1),
      maxDailyDisappearanceRate: 0.5,
    });
    expect(accepted.events.filter((e) => e.kind === "animal.disappeared")).toHaveLength(300);
  });
});
