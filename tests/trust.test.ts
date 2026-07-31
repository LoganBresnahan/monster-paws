import { describe, expect, it } from "vitest";
import { resolveClaim, resolveClaims, type Claim } from "@/core/trust";

const claim = (
  value: string,
  source: Claim["source"],
  iso: string,
): Claim<string> => ({ value, source, fetchedAt: new Date(iso) });

describe("trust hierarchy (ADR-0006)", () => {
  it("shelter API beats aggregator regardless of recency", () => {
    const shelter = claim("Biscuit", "shelterluv", "2026-01-01T00:00:00Z");
    const aggregator = claim("Bisquit", "rescuegroups", "2026-07-01T00:00:00Z");
    expect(resolveClaim(shelter, aggregator)).toBe(shelter);
    expect(resolveClaim(aggregator, shelter)).toBe(shelter);
  });

  it("aggregator beats manual entry", () => {
    const agg = claim("terrier mix", "rescuegroups", "2026-01-01T00:00:00Z");
    const manual = claim("terrier", "manual", "2026-07-01T00:00:00Z");
    expect(resolveClaim(agg, manual)).toBe(agg);
  });

  it("recency breaks ties within a tier", () => {
    const older = claim("available", "rescuegroups", "2026-01-01T00:00:00Z");
    const newer = claim("adopted", "rescuegroups", "2026-07-01T00:00:00Z");
    expect(resolveClaim(older, newer)).toBe(newer);
    expect(resolveClaim(newer, older)).toBe(newer);
  });

  it("is deterministic on exact ties (first wins → idempotent normalizer)", () => {
    const a = claim("a", "rescuegroups", "2026-01-01T00:00:00Z");
    const b = claim("b", "rescuegroups", "2026-01-01T00:00:00Z");
    expect(resolveClaim(a, b)).toBe(a);
  });

  it("folds a mixed set to the trusted value", () => {
    const winner = resolveClaims([
      claim("Bisquit", "rescuegroups", "2026-07-01T00:00:00Z"),
      claim("Biscuit", "shelterluv", "2026-02-01T00:00:00Z"),
      claim("Biscuits", "manual", "2026-07-15T00:00:00Z"),
    ]);
    expect(winner?.value).toBe("Biscuit");
    expect(resolveClaims([])).toBeUndefined();
  });
});
