import { describe, expect, it } from "vitest";
import { judgeDisappearances } from "@/core/ingest/pipeline";
import {
  gateAlert,
  INGEST_POLL,
  INGEST_POLL_CRON,
  parsePollArgs,
  planIngestPoll,
} from "@/worker/ingest-poll";

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

describe("ingest poll flags (ADR-0014 as amended 2026-09-30)", () => {
  it("takes no flags as a complete, gated run", () => {
    expect(parsePollArgs([])).toEqual({ maxPages: undefined, maxDailyDisappearanceRate: undefined });
  });

  it("reads both flags in any order", () => {
    expect(parsePollArgs(["--max-daily-disappearance", "0.3", "--max-pages", "2"])).toEqual({
      maxPages: 2,
      maxDailyDisappearanceRate: 0.3,
    });
  });

  // NaN compares false against every rate: passed through, a typo would turn
  // the gate off for the one run a person meant only to loosen it.
  it("refuses a gate override that is not a rate in (0, 1]", () => {
    for (const bad of ["0.3x", "", "0", "-0.2", "1.5", "NaN"]) {
      expect(() => parsePollArgs(["--max-daily-disappearance", bad])).toThrow(/rate in \(0, 1\]/);
    }
    expect(() => parsePollArgs(["--max-daily-disappearance"])).toThrow(/rate in \(0, 1\]/);
    expect(parsePollArgs(["--max-daily-disappearance", "1"]).maxDailyDisappearanceRate).toBe(1);
  });

  it("refuses a page cap that is not a whole number of pages", () => {
    for (const bad of ["two", "0", "-1", "1.5"]) {
      expect(() => parsePollArgs(["--max-pages", bad])).toThrow(/whole number of pages/);
    }
  });
});

describe("disappearance gate alert (ADR-0014 as amended 2026-09-30)", () => {
  it("raises nothing for a run the gate let through, or never saw", () => {
    expect(gateAlert({ lifecycleSkipped: undefined })).toBeNull();
    expect(gateAlert({ lifecycleSkipped: "run declared partial by caller" })).toBeNull();
  });

  it("raises an error carrying the gate's own reason, tagged for the poll", () => {
    const refusal = judgeDisappearances(
      { present: 64_000, disappearing: 32_000, newestSighting: null, at: new Date("2026-10-02T07:00:00Z") },
      new Date("2026-10-01T07:00:00Z"),
      0.05,
    ).refusal!;

    expect(gateAlert({ gateRefused: true, lifecycleSkipped: refusal })).toEqual({
      message: refusal,
      level: "error",
      tags: { job: INGEST_POLL, gate: "disappearance" },
    });
  });
});
