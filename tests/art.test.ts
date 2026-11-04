import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mintIntentId } from "@/core/donate/intent";
import { receiveWebhook } from "@/core/donate/webhook";
import { artFilePath, CREW_BASIS, crewExternalId, FACT, grantBasis, mintShareToken, snapshotKeepsake } from "@/core/keepsake";
import { closeDb, type Db } from "@/db/client";
import { donationIntents, keepsake, keepsakeFact } from "@/db/schema";
import { CREW } from "@/ui/crew";
import { bindArtStore, comfyData, crewSpec, generateArt, guardPainter, hostFreeGb, inQuietWindow, lastRunLine, listingWords, liveCropsArgs, LOAD_FREE_GB, loadCrewTable, paintedFor, photoHosts, runName, type CrewTable, type PaintSpec, type Painter } from "@/worker/art";
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
    // the three-quarter view, the winner of batches 38d–38f (Logan, 2026-11-04: "yes to three quarter"; ADR-0004 as amended 2026-11-03, later)
    expect(table.prompt).toBe("storybook_bust34");
    const spec = (batch: string) => JSON.parse(readFileSync(`comfyui/explore/${batch}.json`, "utf8")).animals;
    // never batch 38c's pair: its second, downloadfile.jpg, is Plum's shelter listing photo (2026-11-04)
    expect(table.pets.plum).toMatchObject({ describe: spec("batch38g").Plum.bare, two: spec("batch38g").Plum.two });
    expect(Object.values(table.pets).flatMap((pet) => pet.two)).not.toContain("downloadfile.jpg");
    expect(table.pets.beetle).toMatchObject({ describe: spec("batch35a").Beetle.describe, two: spec("batch35a").Beetle.two });
    expect(table.pets.marty).toMatchObject({ describe: spec("batch37a").Marty.crew, two: spec("batch37a").Marty.two });
  });
});

describe("a listing's words, from its own fields", () => {
  const f = (pairs: [string, string][]) => pairs.map(([field, value]) => ({ field, value }));
  // Fixture provenance: sex, breed and species as the corpus writes them ("Male" 57,263, "Female" 57,095; species lower case), read 2026-11-04.
  it("are its sex and kind in lower case, with its species when the kind doesn't name it, and no unknown sex", () => {
    expect(listingWords(f([[FACT.sex, "Female"], [FACT.kind, "Pit Bull Terrier Mix"], [FACT.species, "dog"]]))).toBe("female pit bull terrier mix dog");
    expect(listingWords(f([[FACT.sex, "Male"], [FACT.kind, "Domestic Short Hair"], [FACT.species, "cat"]]))).toBe("male domestic short hair cat");
    expect(listingWords(f([[FACT.sex, "Female"], [FACT.kind, "Tuxedo"], [FACT.species, "cat"]]))).toBe("female tuxedo cat");
    expect(listingWords(f([[FACT.sex, "Male"], [FACT.kind, "Siamese Cat"], [FACT.species, "cat"]]))).toBe("male siamese cat");
    expect(listingWords(f([[FACT.sex, "Unknown"], [FACT.species, "cat"]]))).toBe("cat");
  });

  it("never name a two-word species twice", () => {
    expect(listingWords(f([[FACT.sex, "Female"], [FACT.kind, "Guinea Pig"], [FACT.species, "guinea pig"]]))).toBe("female guinea pig");
    expect(listingWords(f([[FACT.sex, "Male"], [FACT.kind, "Sugar Glider"], [FACT.species, "sugar glider"]]))).toBe("male sugar glider");
    expect(listingWords(f([[FACT.sex, "Male"], [FACT.kind, "Lop Eared"], [FACT.species, "rabbit"]]))).toBe("male lop eared rabbit");
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


describe("the detector a run uses (ADR-0028 §6)", () => {
  it("says why a detection stopped, in live_crops' own words for the run", () => {
    const log = "owlv2-raw-v4: 8s\nkeepsake-1-abc: 0 of 1 photos cut\nkeepsake-1-abc: no animal chosen in any photo; nothing to paint from\n";
    expect(lastRunLine(log, "keepsake-1-abc")).toBe("no animal chosen in any photo; nothing to paint from");
    expect(lastRunLine("", "keepsake-2-def")).toBeNull();
  });

  it("takes a crash after the scripts' own word on a photo as the reason, not that word (verify, 2026-11-04)", () => {
    const log = "keepsake-1-abc: no head chosen in held:keepsake-1-abc/photos/1.jpg, a close-up; its subject stands in for the head\n" +
      "Traceback (most recent call last):\nPIL.UnidentifiedImageError: cannot identify image file\n";
    expect(lastRunLine(log, "keepsake-1-abc")).toBe("PIL.UnidentifiedImageError: cannot identify image file");
  });

  it("finds the last line under a progress bar or docker's chatter", () => {
    const noisy = "keepsake-1-abc: 1 of 1 photos cut\nLoading weights: 100%|██████████| 357/357 [00:00<00:00, 1871.42it/s]\n Container comfyui-explore-run-1 Stopping\n";
    expect(lastRunLine(noisy, "keepsake-1-abc")).toBe("1 of 1 photos cut");
    const died = "owlv2-raw-v4: 8s\nTraceback (most recent call last):\n  File \"detect.py\", line 1\nRuntimeError: sam3: MODEL_API_KEY is not set\nLoading weights:  42%|████▏     | 222/529 [00:00<00:00, 2215.91it/s]\n";
    expect(lastRunLine(died, "keepsake-1-abc")).toBe("RuntimeError: sam3: MODEL_API_KEY is not set");
  });

  it("carries 200 characters at most, since a detector's error can quote a remote reply", () => {
    expect(lastRunLine(`keepsake-1-abc: ${"x".repeat(400)}`, "keepsake-1-abc")).toHaveLength(200);
    expect(lastRunLine(`ValueError: ${"y".repeat(400)}`, "keepsake-1-abc")).toHaveLength(200);
  });

  it("passes the run's own detector to the container, and names Meta's key only for sam3, never its value", () => {
    const before = process.env.MODEL_API_KEY;
    process.env.MODEL_API_KEY = "a-key";
    try {
      const local = liveCropsArgs("keepsake-1-abc", "owlv2");
      expect(local).toContain("DETECT_PIPELINES=owlv2");
      expect(local).toContain("MODEL_API_KEY=");
      const meta = liveCropsArgs("keepsake-1-abc", "sam3");
      expect(meta).toContain("DETECT_PIPELINES=sam3");
      expect(meta).toContain("MODEL_API_KEY");
      expect([...local, ...meta].join(" ")).not.toContain("a-key");
    } finally {
      if (before === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = before;
    }
  });
});


describe("a photo with no head chosen (comfyui/live_crops.py)", () => {
  // Fixture provenance: each photo's boxes as detect-lora's grown.json holds them (2026-10-12); the shares are the
  // ones verify counted on 2026-11-04, and Pongpong's chosen subject is the dog's rear half.
  const PHOTOS = {
    pongpong: { detsubject: [0.5014, 0.4726, 0.6984, 0.748], grownsubject: [0.5012, 0.4325, 0.7269, 0.7992], dethead: null, grownhead: null },
    dogFriend: { detsubject: [0.0608, 0.1498, 0.5819, 0.8711], grownsubject: [0.0606, 0.147, 0.5869, 0.8705], dethead: null, grownhead: null },
    viljo19: { detsubject: [0.0022, 0.4397, 0.8902, 0.907], grownsubject: [0.0, 0.3575, 0.8901, 0.9069], dethead: null, grownhead: null },
    dalmatian: { detsubject: [0.065, 0.0798, 0.6334, 0.7818], grownsubject: [0.0013, 0.0778, 0.7056, 0.7816],
      dethead: [0.2372, 0.3731, 0.3148, 0.4514], grownhead: [0.2372, 0.3731, 0.3148, 0.4514] },
  };
  const choose = (found: object) => {
    const r = spawnSync("python3", ["-I", "-c", "import json, sys; sys.path.insert(0, 'comfyui'); import live_crops; " +
      "print(json.dumps(live_crops.choose(json.load(sys.stdin))))"], { input: JSON.stringify(found), encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as [Record<string, number[]> | null, number];
  };

  it("is left out when the animal fills under 40% of the frame, since that subject can be its rear half", () => {
    expect(choose(PHOTOS.pongpong)).toEqual([null, expect.closeTo(0.054, 3)]);
    expect(choose(PHOTOS.dogFriend)).toEqual([null, expect.closeTo(0.376, 3)]);
  });

  it("paints from a close-up, its subject standing in for the head", () => {
    const [boxes, share] = choose(PHOTOS.viljo19);
    expect(share).toBeCloseTo(0.415, 3);
    expect(boxes).toEqual({ ...PHOTOS.viljo19, dethead: PHOTOS.viljo19.detsubject, grownhead: PHOTOS.viljo19.grownsubject });
  });

  it("keeps a photo's own head, however little of the frame the animal fills", () => {
    expect(choose(PHOTOS.dalmatian)[0]).toEqual(PHOTOS.dalmatian);
    const far = { ...PHOTOS.dalmatian, detsubject: [0.5, 0.5, 0.6, 0.6] };
    expect(choose(far)[0]).toEqual(far);
  });
});


describe("a stopped detection, through the real run (verify, 2026-11-04)", () => {
  const root = mkdtempSync(join(tmpdir(), "art-crops-"));
  const explore = join(root, "var", "explore");
  const bin = join(root, "bin");
  mkdirSync(explore, { recursive: true });
  mkdirSync(bin);
  // Stands in for `docker compose run … live_crops.py <name>`; FAKE_MODE says which real outcome it plays.
  writeFileSync(join(bin, "docker"), `#!/bin/sh
for a; do name=$a; done
case "$FAKE_MODE" in
  exit-line) echo "$name: 0 of 1 photos cut into input/crew/$name/, 0 with a head"; echo "$name: no animal chosen in any photo; nothing to paint from" >&2; exit 1;;
  ok)        echo "$name: 1 of 1 photos cut into input/crew/$name/, 1 with a head"; echo '[{"ref":"x","file":"1.jpg","head":true}]' > "${explore}/$name/cut.json"; exit 0;;
  no-output) echo "Cannot connect to the Docker daemon" >&2; exit 125;;
  traceback) echo "$name: no head chosen in held:$name/photos/1.jpg, a close-up; its subject stands in for the head"; echo "Traceback (most recent call last):" >&2; echo "PIL.UnidentifiedImageError: cannot identify image file" >&2; exit 1;;
  oom)       echo "$name: no head chosen in held:$name/photos/1.jpg, a close-up; its subject stands in for the head"; exit 137;;
esac
`);
  chmodSync(join(bin, "docker"), 0o755);
  const listing = { species: "dog", colour: "", subject: "x", photos: ["held:x/photos/1.jpg"] };
  const painter = guardPainter(root);
  const stopped = async (name: string, mode: string) => {
    process.env.FAKE_MODE = mode;
    try {
      return await painter.crops(name, listing);
    } catch (err) {
      return (err as Error).message;
    }
  };
  const PATH = process.env.PATH;
  beforeEach(() => {
    process.env.PATH = `${bin}:${PATH}`;
  });
  afterEach(() => {
    process.env.PATH = PATH;
    delete process.env.FAKE_MODE;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("says the script's last word every time, read only once the log is on disk", async () => {
    const said = new Set<unknown>();
    for (let i = 0; i < 100; i++) {
      const name = `keepsake-${i}-race`;
      said.add(String(await stopped(name, "exit-line")).replaceAll(name, "<run>"));
    }
    expect([...said]).toEqual([`<run>: detection stopped: no animal chosen in any photo; nothing to paint from (docker compose exited 1; see ${explore}/<run>.log)`]);
  });

  it("reads only this attempt's part of the log", async () => {
    expect(await stopped("keepsake-1-stale", "ok")).toEqual([{ ref: "x", file: "1.jpg", head: true }]);
    expect(await stopped("keepsake-1-stale", "no-output")).toMatch(/: detection stopped: Cannot connect to the Docker daemon \(docker compose exited 125;/);
  });

  it("reports a crash after a stand-in line as the crash, and keeps the exit code when the script said nothing more", async () => {
    expect(await stopped("keepsake-2-trace", "traceback")).toMatch(/detection stopped: PIL\.UnidentifiedImageError: cannot identify image file \(docker compose exited 1;/);
    expect(await stopped("keepsake-3-oom", "oom")).toMatch(/\(docker compose exited 137;/);
  });
});


describe("the busy check before a load", () => {
  it("has the guard's drop wait for its own floor, never the guard's lower one", async () => {
    const root = mkdtempSync(join(tmpdir(), "art-busy-"));
    const bin = join(root, "bin");
    mkdirSync(join(root, "comfyui"), { recursive: true });
    mkdirSync(bin);
    // the guard's reading is whatever floor its drop was asked to wait for, so only a passed floor clears the check
    writeFileSync(join(root, "comfyui", "guard.sh"), '#!/bin/sh\necho "host_free=${WAIT_GB:-0}GB shared=1.0GB dedicated=0.0GB fds=-"\n');
    for (const name of ["comfyui/guard.sh", "bin/docker", "bin/pgrep"]) {
      if (name !== "comfyui/guard.sh") writeFileSync(join(root, name), "#!/bin/sh\nexit 0\n");
      chmodSync(join(root, name), 0o755);
    }
    const PATH = process.env.PATH;
    process.env.PATH = `${bin}:${PATH}`;
    try {
      expect(await guardPainter(root).busy()).toBeNull();
    } finally {
      process.env.PATH = PATH;
      rmSync(root, { recursive: true, force: true });
    }
  });
});


describe("a listing's photos, fetched (verify, 2026-11-04)", () => {
  const root = mkdtempSync(join(tmpdir(), "art-fetch-"));
  const fetchPhotos = guardPainter(root).fetchPhotos;
  const photo = (url: string) => ({ url, width: 500, height: 375 });

  it("come only from RescueGroups' CDN unless the worker names another host", () => {
    expect(photoHosts({})).toEqual(["cdn.rescuegroups.org"]);
    expect(photoHosts({ ART_PHOTO_HOSTS: "upload.wikimedia.org, cdn.rescuegroups.org" })).toEqual(["upload.wikimedia.org", "cdn.rescuegroups.org"]);
  });

  it("refuses another host, plain http and a URL that won't parse, naming the photo by number, never by URL", async () => {
    await expect(fetchPhotos("r", [photo("https://evil.example/a.jpg")])).rejects.toThrow("photo 1 is not from an allowed host");
    await expect(fetchPhotos("r", [photo("http://cdn.rescuegroups.org/a.jpg")])).rejects.toThrow("photo 1 is not from an allowed host");
    const bad = fetchPhotos("r", [photo("https://cdn.rescuegroups.org/a.jpg"), photo("not a url at all")]);
    await expect(bad).rejects.not.toThrow("not a url at all");
  });

  it("names the photo a dropped connection cut off, never a bare \"terminated\"", async () => {
    const body = new ReadableStream<Uint8Array>({
      start: (c) => c.enqueue(new Uint8Array(1000)),
      pull: (c) => c.error(new TypeError("terminated")),
    });
    vi.stubGlobal("fetch", async () => new Response(body, { headers: { "content-type": "image/jpeg" } }));
    try {
      await expect(fetchPhotos("keepsake-1-abc", [photo("https://cdn.rescuegroups.org/a.jpg")]))
        .rejects.toThrow("keepsake-1-abc: photo 1 stopped arriving after 1000 bytes");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves ComfyUI's data root as the compose file does", () => {
    expect(comfyData("/repo", {})).toBe("/repo/var/comfyui");
    expect(comfyData("/repo", { COMFYUI_DATA: "../data" })).toBe("/repo/data");
    expect(comfyData("/repo", { COMFYUI_DATA: "/mnt/comfy" })).toBe("/mnt/comfy");
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
    const p: Painter & { calls: number; detected: unknown[]; detectors: string[]; specs: PaintSpec[]; fetched: unknown[]; forgotten: string[] } = {
      calls: 0,
      detected: [],
      detectors: [],
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
      crops: async (name, listing, detector) => {
        p.detected.push({ name, listing });
        p.detectors.push(detector);
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
      ([[FACT.name, "Hopper - (Courtesy Post) - Adopt Me!"], [FACT.species, "dog"], [FACT.kind, "Pit Bull Terrier Mix"], [FACT.sex, "Female"],
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
    expect(p.detected).toEqual([{ name, listing: { species: "dog", colour: "", subject: `${name}, the female pit bull terrier mix dog`,
      photos: [`held:${name}/photos/1.jpg`, `held:${name}/photos/2.jpg`] } }]);
    expect(p.specs[0].animals).toEqual({ [name]: { kind: "dog", describe: "female pit bull terrier mix dog", two: ["1.jpg", "2.jpg"] } });
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

  it("paints a listing from the photos the detector found the animal in, its own head first, and stops with none", async () => {
    const id = await listingKeepsake();
    const one = painter(pngs, null, () => [{ file: "1.jpg", head: false }, { file: "2.jpg", head: true }]);
    await generateArt(db, { keepsakeId: id, photos: PHOTOS }, one, { table: TABLE, now: NOON, nightly: null });
    expect(one.specs[0].animals[await nameOf(id)].two).toEqual(["2.jpg", "1.jpg"]);

    // a close-up's subject stands in for its head (the listing rehearsal's cat, 2026-11-04), so it still paints
    const closeUp = await listingKeepsake();
    const headless = painter(pngs, null, () => [{ file: "1.jpg", head: false }]);
    expect(await generateArt(db, { keepsakeId: closeUp, photos: PHOTOS.slice(0, 1) }, headless, { table: TABLE, now: NOON, nightly: null }))
      .toMatchObject({ status: "painted" });
    expect(headless.specs[0].animals[await nameOf(closeUp)].one).toEqual(["1.jpg"]);

    const other = await listingKeepsake();
    const none = painter(pngs, null, () => []);
    await expect(generateArt(db, { keepsakeId: other, photos: PHOTOS }, none, { table: TABLE, now: NOON, nightly: null })).rejects.toThrow("no photo with the animal");
    expect(none.calls).toBe(0);
    expect(none.forgotten).toEqual([await nameOf(other)]);
  });

  it("warns when a crew pet's live run finds no head in a photo, and leads with the one that has its own", async () => {
    const id = await crewKeepsake();
    const headless = painter(pngs, null, () => [{ file: "a.jpg", head: false }, { file: "b.jpg", head: true }]);
    const outcome = await generateArt(db, { keepsakeId: id }, headless, { table: TABLE, now: NOON, nightly: null, live: true });
    expect(outcome).toMatchObject({ status: "painted", warning: "live detection found no head in 1 of Plum's photos; a close-up's subject stood in" });
    expect(headless.specs[0].animals[await nameOf(id)].two).toEqual(["b.jpg", "a.jpg"]);

    const other = await crewKeepsake();
    const both = painter();
    const fine = await generateArt(db, { keepsakeId: other }, both, { table: TABLE, now: NOON, nightly: null, live: true });
    expect(fine).not.toHaveProperty("warning");
    expect(both.specs[0].animals[await nameOf(other)].two).toEqual(["a.jpg", "b.jpg"]);
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

  it("paints a listing through the local detector even when the worker's environment names sam3", async () => {
    const before = process.env.DETECT_PIPELINES;
    process.env.DETECT_PIPELINES = "sam3";
    try {
      const id = await listingKeepsake();
      const p = painter();
      await generateArt(db, { keepsakeId: id, photos: PHOTOS }, p, { table: TABLE, now: NOON, nightly: null, crewDetector: "sam3" });
      expect(p.detectors).toEqual(["owlv2"]);
    } finally {
      if (before === undefined) delete process.env.DETECT_PIPELINES;
      else process.env.DETECT_PIPELINES = before;
    }
  });

  it("detects a crew pet with sam3 only when the worker says so", async () => {
    const id = await crewKeepsake();
    const unset = painter();
    await generateArt(db, { keepsakeId: id }, unset, { table: TABLE, now: NOON, nightly: null, live: true });
    expect(unset.detectors).toEqual(["owlv2"]);
    const other = await crewKeepsake("plum");
    const meta = painter();
    await generateArt(db, { keepsakeId: other }, meta, { table: TABLE, now: NOON, nightly: null, live: true, crewDetector: "sam3" });
    expect(meta.detectors).toEqual(["sam3"]);
  });
});
