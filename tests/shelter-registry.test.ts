import { describe, expect, it } from "vitest";
import {
  SHELTERS,
  hasGrant,
  registryProblems,
  shelterBySlug,
  sheltersWithGrant,
  sourceOf,
  type Grant,
  type ShelterEntry,
} from "@/core/shelters";

const grant = (over: Partial<Grant> & Pick<Grant, "permission">): Grant => ({
  granter: "Dana Ruiz, shelter director",
  grantedAt: "2026-03-01",
  basis: "yes, you're welcome to pull our adoptable pets page",
  evidence: "doc/consent/happy-tails-rescue-2026-03-01.md",
  ...over,
});

const shelter = (over: Partial<ShelterEntry> = {}): ShelterEntry => ({
  slug: "happy-tails-rescue",
  name: "Happy Tails Rescue",
  siteUrl: "https://happytailsrescue.example",
  listingsUrl: "https://happytailsrescue.example/adopt",
  tier: "first-party-scrape",
  goldenFixture: null,
  grants: [],
  ...over,
});

const asOf = (iso: string) => new Date(iso);

describe("shelter registry (ADR-0006 as amended)", () => {
  it("holds no grants yet — outreach is roadmap item 5", () => {
    expect(SHELTERS).toHaveLength(0);
    expect(registryProblems()).toEqual([]);
  });

  it("derives the scrape source identity from the slug", () => {
    expect(sourceOf(shelter())).toBe("scrape:happy-tails-rescue");
  });

  it("gates each permission separately", () => {
    const s = shelter({ grants: [grant({ permission: "scrape" })] });
    expect(hasGrant(s, "scrape", asOf("2026-06-01"))).toBe(true);
    expect(hasGrant(s, "display", asOf("2026-06-01"))).toBe(false);
    expect(hasGrant(s, "digify", asOf("2026-06-01"))).toBe(false);
  });

  it("default-denies an unknown shelter", () => {
    expect(hasGrant(shelterBySlug("nobody"), "scrape")).toBe(false);
  });

  it("treats a grant as inactive before it was given and after it was revoked", () => {
    const s = shelter({
      grants: [grant({ permission: "display", revokedAt: "2026-07-01" })],
    });
    expect(hasGrant(s, "display", asOf("2026-02-01"))).toBe(false);
    expect(hasGrant(s, "display", asOf("2026-06-01"))).toBe(true);
    expect(hasGrant(s, "display", asOf("2026-08-01"))).toBe(false);
  });

  it("re-granting after a revocation is an append, and the later grant governs", () => {
    const s = shelter({
      grants: [
        grant({ permission: "scrape", revokedAt: "2026-07-01" }),
        grant({
          permission: "scrape",
          grantedAt: "2026-07-20",
          evidence: "doc/consent/happy-tails-rescue-2026-07-20.md",
        }),
      ],
    });
    expect(s.grants).toHaveLength(2); // the revoked grant is never removed
    expect(hasGrant(s, "scrape", asOf("2026-07-10"))).toBe(false);
    expect(hasGrant(s, "scrape", asOf("2026-08-01"))).toBe(true);
  });

  it("lists only shelters holding the permission at that moment", () => {
    const registry = [
      shelter({ grants: [grant({ permission: "scrape" })] }),
      shelter({ slug: "second-chance-shelter", grants: [] }),
      shelter({
        slug: "paws-and-claws",
        grants: [grant({ permission: "scrape", revokedAt: "2026-05-01" })],
      }),
    ];
    expect(sheltersWithGrant("scrape", asOf("2026-06-01"), registry).map((s) => s.slug)).toEqual([
      "happy-tails-rescue",
    ]);
  });

  it("flags malformed entries and evidence-free grants", () => {
    const problems = registryProblems([
      shelter({ slug: "Happy Tails" }),
      shelter({ grants: [grant({ permission: "digify", evidence: "  " })] }),
      shelter({ grants: [grant({ permission: "display", grantedAt: "whenever" })] }),
    ]);
    expect(problems).toEqual([
      "slug 'Happy Tails' is not lowercase kebab-case",
      "happy-tails-rescue/digify: grant has no evidence pointer",
      "duplicate slug 'happy-tails-rescue'",
      "happy-tails-rescue/display: unparseable grantedAt 'whenever'",
    ]);
  });
});
