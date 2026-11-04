import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mintIntentId } from "@/core/donate/intent";
import { receiveWebhook } from "@/core/donate/webhook";
import { artFilePath, CREW_BASIS, crewExternalId, FACT, grantBasis, mintShareToken, snapshotKeepsake } from "@/core/keepsake";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, keepsake, keepsakeFact } from "@/db/schema";
import { CREW } from "@/ui/crew";
import { bindArtStore, crewSpec, generateArt, hostFreeGb, inQuietWindow, listingWords, LOAD_FREE_GB, loadCrewTable, paintedFor, runName, type CrewTable, type PaintSpec, type Painter } from "@/worker/art";
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

  it("refuses a pet it has no row for, an object's own name among them, and a set that is not four", () => {
    expect(() => crewSpec(TABLE, "rex", 7)).toThrow("no crew painting row");
    for (const slug of ["constructor", "__proto__", "toString"]) expect(() => crewSpec(TABLE, slug, 7)).toThrow("no crew painting row");
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

describe("a listing's words, from its own fields", () => {
  const f = (pairs: [string, string][]) => pairs.map(([field, value]) => ({ field, value }));
  it("are its sex and kind, lower case, the species when it has no kind, and no unknown sex", () => {
    expect(listingWords(f([[FACT.sex, "female"], [FACT.kind, "Pit Bull Terrier Mix"], [FACT.species, "dog"]]))).toBe("female pit bull terrier mix");
    expect(listingWords(f([[FACT.sex, "unknown"], [FACT.species, "cat"]]))).toBe("cat");
  });
});


describe("a run's paintings", () => {
  it("are this spec's runs only, by animal, prompt and words, the latest for a retried seed", () => {
    const spec = crewSpec(TABLE, "plum", 7, "keepsake-7-abc");
    const line = (animal: string, prompt: string, seed: number, output?: string) =>
      JSON.stringify({ animal, prompt, describe: "listing", seed, ...(output ? { output } : {}) });
    const log = [
      line("Beetle", "storybook_bust", 23, "beetle-23.png"),
      line("keepsake-7-abc", "storybook_head", 333, "old-prompt-333.png"),
      line("keepsake-7-abc", "storybook_bust", 23, "first-23.png"),
      line("keepsake-7-abc", "storybook_bust", 23, "retried-23.png"),
      line("keepsake-7-abc", "storybook_bust", 1111),
      line("keepsake-7-abc", "storybook_bust", 3000, "plum-3000.png"),
    ].join("\n");
    expect(paintedFor(log, spec)).toEqual(["retried-23.png", null, null, "plum-3000.png"]);
  });

  it("are named for the keepsake's own token, never its id alone, which every database starts at 1", () => {
    expect(runName(1, "tokenA")).not.toBe(runName(1, "tokenB"));
    expect(runName(1, "tokenA")).toMatch(/^keepsake-1-[0-9a-f]{12}$/);
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

  function painter(paint: string[] | Error = pngs, busy: string | null = null, cut?: (photos: string[]) => { file: string; head: boolean }[]) {
    const p: Painter & { calls: number; detected: unknown[]; specs: PaintSpec[]; fetched: unknown[]; forgotten: string[] } = {
      calls: 0,
      detected: [],
      specs: [],
      fetched: [],
      forgotten: [],
      busy: async () => busy,
      fetchPhotos: async (name, photos) => {
        p.fetched.push({ name, photos });
        return photos.map((_, i) => `${i + 1}.jpg`);
      },
      forget: async (name) => {
        p.forgotten.push(name);
      },
      crops: async (name, listing) => {
        p.detected.push({ name, listing });
        return cut ? cut(listing.photos) : listing.photos.map((ref) => ({ file: ref.split("/").at(-1)!, head: true }));
      },
      paint: async (_name, spec) => {
        p.calls += 1;
        p.specs.push(spec);
        if (paint instanceof Error) throw paint;
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
    // A keepsake is written only for a recorded gift (ADR-0035 as amended 2026-11-04), so this goes through the real decision.
    const delivery = JSON.stringify({
      event: "donation.completed",
      chargeId: `charge-${intentId}`,
      partnerDonationId: intentId,
      toNonprofit: { slug: "a-staging-nonprofit", ein: "123456789", name: "A Staging Nonprofit" },
      amount: "5",
      netAmount: "4.50",
      currency: "USD",
      frequency: "ONCE",
      donationDate: "2026-11-03T12:00:00.000Z",
      paymentMethod: "STRIPE",
    });
    const { outcome } = await receiveWebhook(db, { body: delivery, headers: [], secrets: {} });
    expect(outcome).toBe("recorded");
    const id = await snapshotKeepsake(db, intentId);
    expect(id).not.toBeNull();
    return id!;
  }

  const nameOf = async (id: number) => {
    const [row] = await db.select({ token: keepsake.shareToken }).from(keepsake).where(eq(keepsake.id, id));
    return runName(id, row.token);
  };

  const artOf = (id: number) =>
    db.select().from(keepsakeFact).where(eq(keepsakeFact.keepsakeId, id)).then((rows) => rows.filter((r) => r.field === FACT.art));

  it("writes four art facts on the photo's basis, each a JPEG in the store with no metadata", async () => {
    const id = await crewKeepsake();
    const outcome = await generateArt(db, { keepsakeId: id }, painter(), { table: TABLE, now: NOON, nightly: null });
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
    await generateArt(db, { keepsakeId: id }, table, { table: TABLE, now: NOON, nightly: null });
    expect(table.detected).toEqual([]);
    expect(Object.keys(table.specs[0].animals)).toEqual(["Plum"]);

    const other = await crewKeepsake("plum");
    const live = painter();
    await generateArt(db, { keepsakeId: other }, live, { table: TABLE, now: NOON, nightly: null, live: true });
    expect(live.detected).toEqual([{ name: await nameOf(other), listing: { species: "dog", colour: "grey",
      subject: "Plum, the grey cane corso puppy", photos: ["crew:Plum/a.jpg", "crew:Plum/b.jpg"] } }]);
    // read under the run's own name, so batch 11's crops are never what a live run paints from
    expect(Object.keys(live.specs[0].animals)).toEqual([await nameOf(other)]);
  });

  it("never paints a keepsake twice", async () => {
    const id = await crewKeepsake();
    await generateArt(db, { keepsakeId: id }, painter(), { table: TABLE, now: NOON, nightly: null });
    const again = painter();
    expect(await generateArt(db, { keepsakeId: id }, again, { table: TABLE, now: NOON, nightly: null })).toEqual({ status: "has-art" });
    expect(again.calls).toBe(0);
    expect(await artOf(id)).toHaveLength(4);
  });

  it("waits out the nightly poll and a card already in use, painting nothing", async () => {
    const id = await crewKeepsake();
    const quiet = painter();
    expect(await generateArt(db, { keepsakeId: id }, quiet, { table: TABLE, now: new Date("2026-11-04T07:00:00Z"), nightly: null }))
      .toEqual({ status: "skipped", reason: "the nightly poll's quiet window" });
    const busy = painter(pngs, "a guard batch is running");
    expect(await generateArt(db, { keepsakeId: id }, busy, { table: TABLE, now: NOON, nightly: null })).toEqual({ status: "skipped", reason: "a guard batch is running" });
    expect(quiet.calls + busy.calls).toBe(0);
    expect(await artOf(id)).toEqual([]);
  });

  it("writes no part set: three paintings leave the keepsake owed", async () => {
    const id = await crewKeepsake();
    await expect(generateArt(db, { keepsakeId: id }, painter(pngs.slice(0, 3)), { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("not four");
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
    await expect(generateArt(db, { keepsakeId: id }, p, { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("names a photo");
    expect(p.calls).toBe(0);
    expect(existsSync(join(store, "keepsakes", String(id)))).toBe(false);
  });

  const SPENCER = grantBasis("spencer-pet-rescue");
  const PHOTOS = [
    { url: "https://cdn.rescuegroups.org/1/pictures/animals/1/a.jpg", width: 500, height: 375 },
    { url: "https://cdn.rescuegroups.org/1/pictures/animals/1/b.jpg", width: 375, height: 500 },
    { url: "https://cdn.rescuegroups.org/1/pictures/animals/1/c.jpg", width: 500, height: 500 },
  ];

  // A listing's keepsake as donate's sweep writes it: its own fields, all on its shelter's grant, and no photo fact.
  async function listingKeepsake(): Promise<number> {
    const intentId = mintIntentId();
    await db.insert(donationIntents).values({ id: intentId, animalSource: "rescuegroups", animalExternalId: "12345",
      nonprofitSlug: "a-staging-nonprofit", nonprofitEin: "12-3456789", donorEmail: "pat@example.org" });
    const [row] = await db.insert(keepsake).values({ intentId, shareToken: mintShareToken(), snapshottedAt: NOON }).returning({ id: keepsake.id });
    await db.insert(keepsakeFact).values(
      ([[FACT.name, "Hopper - (Courtesy Post) - Adopt Me!"], [FACT.species, "dog"], [FACT.kind, "Pit Bull Terrier Mix"], [FACT.sex, "female"],
        [FACT.shelter, "Spencer Pet Rescue"]] as const).map(([field, value]) => ({ keepsakeId: row.id, field, value, basis: SPENCER, snapshottedAt: NOON })),
    );
    return row.id;
  }

  it("paints a listing from the photos its job carries, by live detection, and forgets them", async () => {
    const id = await listingKeepsake();
    const p = painter();
    const outcome = await generateArt(db, { keepsakeId: id, photos: PHOTOS }, p, { table: TABLE, now: NOON, nightly: null });
    expect(outcome).toMatchObject({ status: "painted" });
    const name = await nameOf(id);
    // two at most, as klein-v1 reads them
    expect(p.fetched).toEqual([{ name, photos: PHOTOS.slice(0, 2) }]);
    expect(p.detected).toEqual([{ name, listing: { species: "dog", colour: "", subject: `${name}, the female pit bull terrier mix`,
      photos: [`held:${name}/photos/1.jpg`, `held:${name}/photos/2.jpg`] } }]);
    expect(p.specs[0].animals).toEqual({ [name]: { kind: "dog", describe: "female pit bull terrier mix", two: ["1.jpg", "2.jpg"] } });
    expect(p.specs[0].photos).toEqual(["two"]);
    expect(p.forgotten).toEqual([name]);
    expect(new Set((await artOf(id)).map((r) => r.basis))).toEqual(new Set([SPENCER]));
  });

  it("forgets a listing's photos when the painting fails too, and writes nothing", async () => {
    const id = await listingKeepsake();
    const p = painter(new Error("the guard stopped"));
    await expect(generateArt(db, { keepsakeId: id, photos: PHOTOS.slice(0, 1) }, p, { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("the guard stopped");
    expect(p.specs[0].photos).toEqual(["one"]);
    expect(p.forgotten).toEqual([await nameOf(id)]);
    expect(await artOf(id)).toEqual([]);
  });

  it("refuses photos for a crew pet, and a listing with none", async () => {
    const crew = await crewKeepsake();
    await expect(generateArt(db, { keepsakeId: crew, photos: PHOTOS }, painter(), { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("names a photo");
    const listing = await listingKeepsake();
    await expect(generateArt(db, { keepsakeId: listing }, painter(), { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("neither a crew pet nor photos");
  });

  it("publishes after the four facts, and a failed publish leaves the art and says so by its code alone", async () => {
    const id = await crewKeepsake();
    const published: number[] = [];
    expect(await generateArt(db, { keepsakeId: id }, painter(), { table: TABLE, now: NOON, nightly: null, publish: async (k) => { published.push(k); } }))
      .toMatchObject({ status: "painted", published: true });
    expect(published).toEqual([id]);

    const other = await crewKeepsake("plum");
    const failed = await generateArt(db, { keepsakeId: other }, painter(), { table: TABLE, now: NOON, nightly: null,
      publish: async () => { throw new Error("read-back of share/AAAAAAAAAAAAAAAAAAAAAA/1.jpg did not match"); } });
    expect(failed).toMatchObject({ status: "painted", published: false });
    expect(JSON.stringify(failed)).not.toContain("AAAAAAAAAAAAAAAAAAAAAA");
    expect(await artOf(other)).toHaveLength(4);
  });

  it("paints a listing from the photos the detector found the animal in, a head first, and stops with none", async () => {
    const id = await listingKeepsake();
    const one = painter(pngs, null, () => [{ file: "1.jpg", head: false }, { file: "2.jpg", head: true }]);
    await generateArt(db, { keepsakeId: id, photos: PHOTOS }, one, { table: TABLE, now: NOON, nightly: null });
    expect(one.specs[0].animals[await nameOf(id)].two).toEqual(["2.jpg", "1.jpg"]);

    const other = await listingKeepsake();
    const none = painter(pngs, null, () => [{ file: "1.jpg", head: false }]);
    await expect(generateArt(db, { keepsakeId: other, photos: PHOTOS }, none, { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("its head");
    expect(none.calls).toBe(0);
    expect(none.forgotten).toEqual([await nameOf(other)]);
  });

  it("stops a crew pet's live run that loses one of its two photos", async () => {
    const id = await crewKeepsake();
    const lost = painter(pngs, null, () => [{ file: "a.jpg", head: true }]);
    await expect(generateArt(db, { keepsakeId: id }, lost, { table: TABLE, now: NOON, nightly: null, live: true })).rejects.toThrow("lost one");
    expect(lost.calls).toBe(0);
  });

  it("binds the art store to one database, and refuses a store another database marked", async () => {
    expect(await bindArtStore(db)).toMatch(/test/);
    const other = mkdtempSync(join(tmpdir(), "art-store-other-"));
    writeFileSync(join(other, ".database"), "monsterpaws\n");
    await expect(bindArtStore(db, other)).rejects.toThrow("belongs to database monsterpaws");
    await expect(bindArtStore(db, "relative/store")).rejects.toThrow("absolute");
    rmSync(other, { recursive: true, force: true });
  });

  it("paints a crew pet only on the crew's basis, and takes the latest photo fact", async () => {
    const id = await crewKeepsake();
    await db.insert(keepsakeFact).values({ keepsakeId: id, field: FACT.sourcePhoto, value: { pet: "plum", photo: "held/2.jpg" },
      basis: CREW_BASIS, snapshottedAt: NOON });
    await expect(generateArt(db, { keepsakeId: id }, painter(), { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("names a photo");

    const listing = await listingKeepsake();
    await db.insert(keepsakeFact).values({ keepsakeId: listing, field: FACT.sourcePhoto, value: { pet: "plum", photo: null },
      basis: SPENCER, snapshottedAt: NOON });
    await expect(generateArt(db, { keepsakeId: listing }, painter(), { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("shelter's basis");
  });

  it("writes one set when two handlers paint the same keepsake at once", async () => {
    const id = await crewKeepsake();
    const outcomes = await Promise.all([1, 2, 3].map(() => generateArt(db, { keepsakeId: id }, painter(), { table: TABLE, now: NOON, nightly: null })));
    expect(outcomes.filter((o) => o.status === "painted")).toHaveLength(1);
    expect(await artOf(id)).toHaveLength(4);
  });
});
