import { describe, expect, it } from "vitest";
import { INGEST_POLL, INGEST_POLL_CRON, planIngestPoll } from "@/worker/ingest-poll";

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
