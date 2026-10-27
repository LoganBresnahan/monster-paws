import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordOutreachEvent } from "@/core/outreach/events";
import {
  CHICAGOLAND,
  WAVE_MAX,
  approachedShelters,
  loadOutreachShelters,
  selectWave,
  shelterViewUrl,
  type OutreachShelter,
} from "@/core/outreach/list";
import type { ShelterExclusion } from "@/core/shelters";
import { closeDb, type Db } from "@/db/client";
import { animalIdentities, animals } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateCorpus, truncateOutreach } from "./support/db";

/**
 * The outreach list against real Postgres (ADR-0029 §1–2): who is on it is
 * exactly who has a visible animal, described by what those animals carry,
 * and a wave is a region of it, capped, with the already-approached left out.
 */
const NOW = new Date("2026-03-15T12:00:00Z");

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

const shelter = (over: Partial<OutreachShelter> & Pick<OutreachShelter, "shelterExternalId">): OutreachShelter => ({
  name: null,
  city: null,
  state: "IL",
  zip: "60614",
  website: null,
  visibleCount: 1,
  shelterViewUrl: shelterViewUrl(over.shelterExternalId),
  ...over,
});

describe("ADR-0029 wave selection", () => {
  const lincolnPark = shelter({ shelterExternalId: "rescuegroups:org:1", name: "Lincoln Park", zip: "60614", visibleCount: 5 });
  const evanston = shelter({ shelterExternalId: "rescuegroups:org:2", name: "Evanston", zip: "60201", visibleCount: 9 });
  const rockIsland = shelter({ shelterExternalId: "rescuegroups:org:3", name: "Rock Island", zip: "61201", visibleCount: 40 });
  const noZip = shelter({ shelterExternalId: "rescuegroups:org:4", name: "No zip", zip: null, visibleCount: 50 });
  const milwaukee = shelter({ shelterExternalId: "rescuegroups:org:5", name: "Milwaukee", state: "WI", zip: "53201", visibleCount: 3 });
  const all = [lincolnPark, evanston, rockIsland, noZip, milwaukee];

  it("keeps the shelters inside the radius, most visible animals first, and never one it cannot place", () => {
    expect(selectWave(all, CHICAGOLAND).map((s) => s.name)).toEqual(["Evanston", "Lincoln Park"]);
  });

  it("leaves out a shelter already written to — a follow-up is its own wave", () => {
    expect(selectWave(all, CHICAGOLAND, new Set(["rescuegroups:org:2"])).map((s) => s.name)).toEqual(["Lincoln Park"]);
  });

  it("takes a wave by states too, case aside", () => {
    expect(selectWave(all, { name: "wi-1", states: ["wi"] }).map((s) => s.name)).toEqual(["Milwaukee"]);
  });

  it("caps a wave at 200, and refuses a wave with no region or a name a file could not carry", () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      shelter({ shelterExternalId: `rescuegroups:org:${i}`, name: `S${i}`, visibleCount: 250 - i }),
    );
    expect(selectWave(many, { name: "il-1", states: ["IL"] })).toHaveLength(WAVE_MAX);
    expect(selectWave(many, { name: "il-1", states: ["IL"], limit: 10 })).toHaveLength(10);
    expect(() => selectWave(many, { name: "il-1", states: ["IL"], limit: 201 })).toThrow(/at most 200/);
    expect(() => selectWave(many, { name: "everyone" })).toThrow(/names no region/);
    expect(() => selectWave(many, { name: "Chicago Wave", states: ["IL"] })).toThrow(/kebab-case/);
    expect(() => selectWave(many, { name: "nowhere", within: { zip: "00000", miles: 10 } })).toThrow(/not a place/);
  });

  it("links the shelter view the way browse writes it", () => {
    expect(shelterViewUrl("rescuegroups:org:3077")).toBe("https://monsterpaws.org/animals?shelter=rescuegroups%3Aorg%3A3077");
  });
});

describe.skipIf(SKIP_DB_TESTS)("ADR-0029 outreach list", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
    await truncateOutreach(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  interface Seed {
    name: string;
    shelter: string | null;
    org?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    url?: string | null;
    status?: string;
  }

  async function seed(rows: Seed[]): Promise<void> {
    for (const [i, row] of rows.entries()) {
      const [animal] = await db
        .insert(animals)
        .values({
          name: row.name,
          species: "dog",
          status: row.status ?? "available",
          shelterExternalId: row.shelter,
          orgName: row.org ?? null,
          city: row.city ?? null,
          state: row.state ?? "IL",
          postalCode: row.zip === undefined ? "60614-1234" : row.zip,
          orgUrl: row.url ?? null,
          listedAt: daysBefore(10),
        })
        .returning({ id: animals.id });
      await db.insert(animalIdentities).values({
        animalId: animal.id,
        source: "rescuegroups",
        externalId: `rg-${i}`,
        lastSeenAt: daysBefore(1),
        sourceUpdatedAt: daysBefore(30),
      });
    }
  }

  it("describes each shelter by what most of its visible animals carry, and counts only the visible", async () => {
    await seed([
      { name: "A", shelter: "rescuegroups:org:1", org: "Paws Rescue", city: "Chicago", zip: "60614", url: "https://paws.example" },
      { name: "B", shelter: "rescuegroups:org:1", org: "Paws Rescue", city: "Chicago", zip: "60614-9999", url: "https://paws.example" },
      { name: "C", shelter: "rescuegroups:org:1", org: "PAWS Rescue Inc", city: "Evanston", zip: null, url: null },
      { name: "Gone", shelter: "rescuegroups:org:1", org: "Paws Rescue", status: "adopted" },
      { name: "D", shelter: "rescuegroups:org:2", org: "Other Rescue", city: "Rock Island", zip: "61201" },
      { name: "Orphan", shelter: null, org: "Nobody" },
    ]);
    const list = await loadOutreachShelters(db, NOW);
    expect(list).toEqual([
      {
        shelterExternalId: "rescuegroups:org:1",
        name: "Paws Rescue",
        city: "Chicago",
        state: "IL",
        zip: "60614",
        website: "https://paws.example",
        visibleCount: 3,
        shelterViewUrl: "https://monsterpaws.org/animals?shelter=rescuegroups%3Aorg%3A1",
      },
      {
        shelterExternalId: "rescuegroups:org:2",
        name: "Other Rescue",
        city: "Rock Island",
        state: "IL",
        zip: "61201",
        website: null,
        visibleCount: 1,
        shelterViewUrl: "https://monsterpaws.org/animals?shelter=rescuegroups%3Aorg%3A2",
      },
    ]);
  });

  it("never lists a shelter that opted out, so it can never be written to again (ADR-0029 §5)", async () => {
    const optOut: ShelterExclusion = {
      shelterExternalId: "rescuegroups:org:1",
      name: "Paws Rescue",
      askedBy: "a fixture",
      askedAt: "2026-03-01",
      evidence: "doc/consent/fixture.md",
    };
    await seed([
      { name: "A", shelter: "rescuegroups:org:1", org: "Paws Rescue" },
      { name: "D", shelter: "rescuegroups:org:2", org: "Other Rescue" },
    ]);
    expect((await loadOutreachShelters(db, NOW, [optOut])).map((s) => s.name)).toEqual(["Other Rescue"]);
  });

  it("knows who any wave has already written to", async () => {
    await recordOutreachEvent(db, { shelterExternalId: "rescuegroups:org:1", wave: "chicagoland-1", kind: "sent", occurredAt: NOW });
    await recordOutreachEvent(db, { shelterExternalId: "rescuegroups:org:2", wave: "chicagoland-1", kind: "replied", occurredAt: NOW });
    await recordOutreachEvent(db, { shelterExternalId: "rescuegroups:org:3", wave: "wi-1", kind: "sent", occurredAt: NOW });
    expect([...(await approachedShelters(db))].sort()).toEqual(["rescuegroups:org:1", "rescuegroups:org:3"]);
  });
});
