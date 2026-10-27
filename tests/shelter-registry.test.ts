import { describe, expect, it } from "vitest";
import {
  SHELTERS,
  SHELTER_EXCLUSIONS,
  exclusionProblems,
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

  it("holds no opt-outs yet — outreach is ADR-0029", () => {
    expect(SHELTER_EXCLUSIONS).toHaveLength(0);
    expect(exclusionProblems()).toEqual([]);
  });

  it("flags an opt-out keyed by anything but the shelter's source key, or missing its record (ADR-0029 §5)", () => {
    const optOut = {
      shelterExternalId: "rescuegroups:org:3077",
      name: "Border Tails Rescue",
      askedBy: "Dana Ruiz, shelter director",
      askedAt: "2026-11-02",
      evidence: `<CAF1x2y3@mail.gmail.com> sha256:${"ab".repeat(32)}`,
    };
    expect(exclusionProblems([optOut])).toEqual([]);
    expect(
      exclusionProblems([
        { ...optOut, shelterExternalId: "3077" },
        { ...optOut, askedAt: "11/02/2026", askedBy: " ", evidence: "" },
        optOut,
      ]),
    ).toEqual([
      "exclusion 3077: not a '<source>:org:<id>' shelter key",
      "exclusion rescuegroups:org:3077: askedAt '11/02/2026' is not an ISO date",
      "exclusion rescuegroups:org:3077: has no askedBy",
      "exclusion rescuegroups:org:3077: evidence is not '<Message-ID> sha256:<hex of the .eml in the vault>'",
      "exclusion rescuegroups:org:3077: duplicate",
    ]);
  });

  it("refuses evidence that is a file in the repo, or the email's words, or a hash alone (ADR-0029 as amended 2026-10-27)", () => {
    const optOut = {
      shelterExternalId: "rescuegroups:org:3077",
      name: "Border Tails Rescue",
      askedBy: "Dana Ruiz, shelter director",
      askedAt: "2026-11-02",
      evidence: "",
    };
    for (const evidence of [
      "doc/consent/border-tails-rescue-opt-out-2026-11-02.md",
      "Dana wrote: please remove our listings",
      `sha256:${"ab".repeat(32)}`,
      `<CAF1x2y3@mail.gmail.com> sha256:${"ab".repeat(31)}`,
    ]) {
      expect(exclusionProblems([{ ...optOut, evidence }])).toHaveLength(1);
    }
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
      "happy-tails-rescue/display: grantedAt 'whenever' is not an ISO date",
    ]);
  });
});
