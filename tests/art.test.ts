import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mintIntentId } from "@/core/donate/intent";
import { artFilePath, CREW_BASIS, crewExternalId, FACT, mintShareToken, snapshotKeepsake } from "@/core/keepsake";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, keepsake, keepsakeFact } from "@/db/schema";
import { CREW } from "@/ui/crew";
import { crewSpec, generateArt, hostFreeGb, inQuietWindow, LOAD_FREE_GB, loadCrewTable, type CrewTable, type PaintSpec, type Painter } from "@/worker/art";
import { SKIP_DB_TESTS, TEST_DATABASE_URL, testDb, truncateDonor } from "./support/db";

const TABLE: CrewTable = {
  prompt: "storybook_bust",
  seeds: [23, 333, 1111, 3000],
  pets: { plum: { name: "Plum", kind: "dog", describe: "male grey cane corso puppy", two: ["a.jpg", "b.jpg"],
    detect: { species: "dog", colour: "grey", subject: "Plum, the grey cane corso puppy" } } },
};

describe("the crew's painting table (ADR-0004 as amended 2026-11-03)", () => {
  it("paints each pet the way the reviewed batch did, in explore.py's own spec", () => {
    const spec = crewSpec(TABLE, "plum", 7);
    expect(spec.animals).toEqual({ Plum: { kind: "dog", describe: "male grey cane corso puppy", two: ["a.jpg", "b.jpg"] } });
    expect(spec).toMatchObject({ photos: ["two"], crops: ["grownsubject"], aspect: ["landscape"], describe: ["listing"],
      families: ["kleinbfl8"], graphs: ["reference2"], prompts: ["storybook_bust"], seeds: [23, 333, 1111, 3000], heads: ["grownhead"] });
  });

  it("refuses a pet it has no row for, and a set that is not four", () => {
    expect(() => crewSpec(TABLE, "rex", 7)).toThrow("no crew painting row");
    expect(() => crewSpec({ ...TABLE, seeds: [1, 2, 3] }, "plum", 7)).toThrow("four");
  });

  // Fixture provenance: each row's words and photos are copied from the batch spec Logan read (2026-11-03).
  it("holds every crew pet, each with the words of the batch it came from", () => {
    const table = loadCrewTable();
    expect(Object.keys(table.pets).sort()).toEqual(CREW.map((pet) => pet.slug).sort());
    expect(table.seeds).toHaveLength(4);
    const spec = (batch: string) => JSON.parse(readFileSync(`comfyui/explore/${batch}.json`, "utf8")).animals;
    expect(table.pets.plum).toMatchObject({ describe: spec("batch38c").Plum.bare, two: spec("batch38c").Plum.two });
    expect(table.pets.beetle).toMatchObject({ describe: spec("batch35a").Beetle.describe, two: spec("batch35a").Beetle.two });
    expect(table.pets.marty).toMatchObject({ describe: spec("batch37a").Marty.crew, two: spec("batch37a").Marty.two });
  });
});

describe("the nightly poll's quiet window", () => {
  const at = (hhmm: string) => new Date(`2026-11-04T${hhmm}:00Z`);
  it("holds from 06:45 UTC until the night's log says `== exit`", () => {
    expect(inQuietWindow(at("06:44"), null)).toBe(false);
    expect(inQuietWindow(at("06:45"), null)).toBe(true);
    expect(inQuietWindow(at("07:30"), "== start\n")).toBe(true);
    expect(inQuietWindow(at("07:30"), "== start\n== exit 0\n")).toBe(false);
  });
  it("ends at 10:00 UTC, the poll's three-hour limit, even with no log", () => {
    expect(inQuietWindow(at("09:59"), null)).toBe(true);
    expect(inQuietWindow(at("10:00"), null)).toBe(false);
  });
});

describe("the memory a model load needs", () => {
  it("reads the guard's own reading, and wants more than its kill floor plus a load", () => {
    expect(hostFreeGb("guard: dropped 16.0 GB of file cache; Windows free 12 → 20.6 GB\nhost_free=20.6GB shared=1.9GB dedicated=0.6GB fds=-\n")).toBe(20.6);
    expect(hostFreeGb("no reading")).toBeNull();
    // the one kill today began at 20.6 GB after the drop (batch 38f, 2026-11-04 00:20 UTC)
    expect(LOAD_FREE_GB).toBeGreaterThan(20.6);
  });
});

describe("the art-only worker mode", () => {
  it("is never set by the droplet's compose, which has no GPU (ADR-0004 as amended 2026-10-05)", () => {
    expect(readFileSync("docker-compose.prod.yml", "utf8")).not.toContain("WORKER_MODE");
  });
});

describe.skipIf(SKIP_DB_TESTS)("art.generate (doc/plans/demo-chain-contract.md)", () => {
  let db: Db;
  let store: string;
  let pngs: string[];
  const NOON = new Date("2026-11-04T12:00:00Z");

  function painter(paint: string[] = pngs, busy: string | null = null) {
    const p: Painter & { calls: number; detected: unknown[]; specs: PaintSpec[] } = {
      calls: 0,
      detected: [],
      specs: [],
      busy: async () => busy,
      crops: async (name, listing) => {
        p.detected.push({ name, listing });
      },
      paint: async (_name, spec) => {
        p.calls += 1;
        p.specs.push(spec);
        return paint;
      },
    };
    return p;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = testDb();
    store = mkdtempSync(join(tmpdir(), "art-store-"));
    process.env.ART_STORE_DIR = store;
    pngs = await Promise.all(
      [1, 2, 3, 4].map(async (n) => {
        const path = join(store, `painted-${n}.png`);
        await sharp({ create: { width: 1216, height: 832, channels: 3, background: { r: 250, g: 240, b: 230 - n } } }).png().toFile(path);
        return path;
      }),
    );
  });

  beforeEach(async () => {
    await truncateDonor(db);
    // ids restart with the tables, so an earlier test's files would sit under this one's id
    rmSync(join(store, "keepsakes"), { recursive: true, force: true });
  });

  afterAll(async () => {
    rmSync(store, { recursive: true, force: true });
    await closeDb();
  });

  async function crewKeepsake(slug = "plum"): Promise<number> {
    const intentId = mintIntentId();
    await db.insert(donationIntents).values({ id: intentId, animalSource: "manual", animalExternalId: crewExternalId(slug),
      nonprofitSlug: "a-staging-nonprofit", nonprofitEin: "12-3456789", donorEmail: "pat@example.org" });
    const id = await snapshotKeepsake(db, intentId);
    expect(id).not.toBeNull();
    return id!;
  }

  const artOf = (id: number) =>
    db.select().from(keepsakeFact).where(eq(keepsakeFact.keepsakeId, id)).then((rows) => rows.filter((r) => r.field === FACT.art));

  it("writes four art facts on the photo's basis, each a JPEG in the store with no metadata", async () => {
    const id = await crewKeepsake();
    const outcome = await generateArt(db, id, painter(), { table: TABLE, now: NOON, nightly: null });
    expect(outcome).toEqual({ status: "painted", keys: [1, 2, 3, 4].map((n) => `keepsakes/${id}/${n}.jpg`) });
    const art = await artOf(id);
    expect(art.map((r) => r.value)).toEqual([1, 2, 3, 4].map((n) => ({ key: `keepsakes/${id}/${n}.jpg`, candidate: n })));
    expect(new Set(art.map((r) => r.basis))).toEqual(new Set([CREW_BASIS]));
    for (const n of [1, 2, 3, 4]) {
      const meta = await sharp(artFilePath(`keepsakes/${id}/${n}.jpg`)).metadata();
      expect(meta).toMatchObject({ format: "jpeg", width: 1216, height: 832 });
      expect(meta.exif).toBeUndefined();
    }
  });

  it("paints from the batch-11 crops by default, and from its own live detection when asked", async () => {
    const id = await crewKeepsake();
    const table = painter();
    await generateArt(db, id, table, { table: TABLE, now: NOON, nightly: null });
    expect(table.detected).toEqual([]);
    expect(Object.keys(table.specs[0].animals)).toEqual(["Plum"]);

    const other = await crewKeepsake("plum");
    const live = painter();
    await generateArt(db, other, live, { table: TABLE, now: NOON, nightly: null, live: true });
    expect(live.detected).toEqual([{ name: `keepsake-${other}`, listing: { species: "dog", colour: "grey",
      subject: "Plum, the grey cane corso puppy", photos: ["crew:Plum/a.jpg", "crew:Plum/b.jpg"] } }]);
    // read under the run's own name, so batch 11's crops are never what a live run paints from
    expect(Object.keys(live.specs[0].animals)).toEqual([`keepsake-${other}`]);
  });

  it("never paints a keepsake twice", async () => {
    const id = await crewKeepsake();
    await generateArt(db, id, painter(), { table: TABLE, now: NOON, nightly: null });
    const again = painter();
    expect(await generateArt(db, id, again, { table: TABLE, now: NOON, nightly: null })).toEqual({ status: "has-art" });
    expect(again.calls).toBe(0);
    expect(await artOf(id)).toHaveLength(4);
  });

  it("waits out the nightly poll and a card already in use, painting nothing", async () => {
    const id = await crewKeepsake();
    const quiet = painter();
    expect(await generateArt(db, id, quiet, { table: TABLE, now: new Date("2026-11-04T07:00:00Z"), nightly: null }))
      .toEqual({ status: "skipped", reason: "the nightly poll's quiet window" });
    const busy = painter(pngs, "a guard batch is running");
    expect(await generateArt(db, id, busy, { table: TABLE, now: NOON, nightly: null })).toEqual({ status: "skipped", reason: "a guard batch is running" });
    expect(quiet.calls + busy.calls).toBe(0);
    expect(await artOf(id)).toEqual([]);
  });

  it("writes no part set: three paintings leave the keepsake owed", async () => {
    const id = await crewKeepsake();
    await expect(generateArt(db, id, painter(pngs.slice(0, 3)), { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("not four");
    expect(await artOf(id)).toEqual([]);
  });

  it("never paints a held listing photo from the crew's table (ADR-0028 §6)", async () => {
    const intentId = mintIntentId();
    await db.insert(donationIntents).values({ id: intentId, animalSource: "manual", animalExternalId: crewExternalId("plum"),
      nonprofitSlug: "a-staging-nonprofit", nonprofitEin: "12-3456789", donorEmail: "pat@example.org" });
    const [row] = await db.insert(keepsake).values({ intentId, shareToken: mintShareToken(), snapshottedAt: NOON }).returning({ id: keepsake.id });
    const id = row.id;
    // Written as its own fact, never an UPDATE of a crew one: a fact changes by a new row (ADR-0022 §3).
    await db.insert(keepsakeFact).values({ keepsakeId: id, field: FACT.sourcePhoto, value: { pet: "plum", photo: "held/1.jpg" },
      basis: CREW_BASIS, snapshottedAt: NOON });
    const p = painter();
    await expect(generateArt(db, id, p, { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("held photo");
    expect(p.calls).toBe(0);
    expect(existsSync(join(store, "keepsakes", String(id)))).toBe(false);
  });
});
