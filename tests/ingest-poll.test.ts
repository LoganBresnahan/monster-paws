import { describe, expect, it } from "vitest";
import {
  INGEST_POLL,
  INGEST_POLL_CRON,
  planIngestPoll,
  runRawOnlyPoll,
} from "@/worker/ingest-poll";
import { createMemoryStages } from "@/core/ingest/memory";
import type { Observation, SourceAdapter } from "@/core/ingest/observation";

function stubAdapter(observations: Observation<unknown>[]): SourceAdapter<unknown> {
  return {
    source: "rescuegroups",
    async *fetch() {
      yield* observations;
    },
  };
}

const obs = (externalId: string, hash: string): Observation<unknown> => ({
  source: "rescuegroups",
  externalId,
  payload: { id: externalId },
  fetchedAt: new Date("2026-08-19T07:00:00Z"),
  contentHash: hash,
});

describe("ingest.poll registration (ADR-0010: a silent non-poller must not hide)", () => {
  it("registers when the key is present", () => {
    const plan = planIngestPoll({ RESCUEGROUPS_API_KEY: "abc123" });

    expect(plan.register).toBe(true);
    expect(plan.apiKey).toBe("abc123");
    expect(plan.skipReason).toBeUndefined();
  });

  it("skips registration WITH A REASON when the key is missing or blank", () => {
    for (const env of [{}, { RESCUEGROUPS_API_KEY: "" }, { RESCUEGROUPS_API_KEY: "   " }]) {
      const plan = planIngestPoll(env);

      expect(plan.register).toBe(false);
      expect(plan.apiKey).toBeNull();
      expect(plan.skipReason).toContain(INGEST_POLL);
    }
  });

  it("polls at most once a day — RescueGroups sets a weekly minimum (ADR-0006)", () => {
    const [minute, hour, ...rest] = INGEST_POLL_CRON.split(" ");

    // Fixed minute AND hour is what bounds this to one run per day; a `*` or a
    // step (`*/30`) in either field would poll harder than the terms invite.
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect(rest.join(" ")).toBe("* * *");
  });
});

describe("the poll body is stage 1 only (ADR-0009 phases 6–8 pending)", () => {
  it("persists raw and counts dedups", async () => {
    const { stages, corpus } = createMemoryStages([]);
    const batch = [obs("a", "sha256:aaa"), obs("b", "sha256:bbb")];

    const first = await runRawOnlyPoll(stubAdapter(batch), stages.rawStore);
    const second = await runRawOnlyPoll(stubAdapter(batch), stages.rawStore);

    expect(first).toEqual({ observed: 2, persisted: 2, deduped: 0 });
    expect(second).toEqual({ observed: 2, persisted: 0, deduped: 2 });
    expect(corpus.rawRows).toHaveLength(2);
  });

  it("emits no events — nothing may reach the append-only log before the merge exists", async () => {
    const { stages, corpus } = createMemoryStages([]);

    await runRawOnlyPoll(stubAdapter([obs("a", "sha256:aaa")]), stages.rawStore);

    expect(corpus.events).toEqual([]);
    expect(corpus.animals.size).toBe(0);
  });
});
