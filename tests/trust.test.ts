import { describe, expect, it } from "vitest";
import { resolveFact, resolveFacts, type Fact } from "@/core/trust";

const fact = (
  value: string,
  source: Fact["source"],
  iso: string,
): Fact<string> => ({ value, source, fetchedAt: new Date(iso) });

describe("trust hierarchy (ADR-0006)", () => {
  it("shelter API beats aggregator regardless of recency", () => {
    const shelter = fact("Biscuit", "shelterluv", "2026-01-01T00:00:00Z");
    const aggregator = fact("Bisquit", "rescuegroups", "2026-07-01T00:00:00Z");
    expect(resolveFact(shelter, aggregator)).toBe(shelter);
    expect(resolveFact(aggregator, shelter)).toBe(shelter);
  });

  it("aggregator beats manual entry", () => {
    const agg = fact("terrier mix", "rescuegroups", "2026-01-01T00:00:00Z");
    const manual = fact("terrier", "manual", "2026-07-01T00:00:00Z");
    expect(resolveFact(agg, manual)).toBe(agg);
  });

  it("recency breaks ties within a tier", () => {
    const older = fact("available", "rescuegroups", "2026-01-01T00:00:00Z");
    const newer = fact("adopted", "rescuegroups", "2026-07-01T00:00:00Z");
    expect(resolveFact(older, newer)).toBe(newer);
    expect(resolveFact(newer, older)).toBe(newer);
  });

  it("is deterministic on exact ties (first wins → idempotent normalizer)", () => {
    const a = fact("a", "rescuegroups", "2026-01-01T00:00:00Z");
    const b = fact("b", "rescuegroups", "2026-01-01T00:00:00Z");
    expect(resolveFact(a, b)).toBe(a);
  });

  it("folds a mixed set to the trusted value", () => {
    const winner = resolveFacts([
      fact("Bisquit", "rescuegroups", "2026-07-01T00:00:00Z"),
      fact("Biscuit", "shelterluv", "2026-02-01T00:00:00Z"),
      fact("Biscuits", "manual", "2026-07-15T00:00:00Z"),
    ]);
    expect(winner?.value).toBe("Biscuit");
    expect(resolveFacts([])).toBeUndefined();
  });
});
