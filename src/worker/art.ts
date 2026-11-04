import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { spokenAnimalName } from "@/core/email/animal-name";
import type { DisplayPhoto } from "@/core/ingest/pipeline";
import { artFilePath, artKey, CREW_BASIS, FACT, type ArtFact, type ArtGenerateJob, type SourcePhotoFact } from "@/core/keepsake";
import { failureCode } from "@/core/observability";
import { keepsakeShare } from "@/core/share/keepsake";
import { createR2ObjectStore, encodePainting, publishShare } from "@/core/share/publish";
import type { Db } from "@/db/client";
import { keepsakeFact } from "@/db/schema";

/** A listing as `comfyui/detect.py` reads it: the words its votes need and the photos it chooses in. */
export interface DetectListing {
  species: string;
  colour: string;
  subject: string;
}

/** One pet's row in `comfyui/keepsake-crew.json`: its two originals in `var/crew/<name>/` and the words the reviewed batches painted it with. */
export interface CrewPetPainting {
  name: string;
  kind: string;
  describe: string;
  two: string[];
  detect: DetectListing;
}

export interface CrewTable {
  prompt: string;
  seeds: number[];
  pets: Record<string, CrewPetPainting>;
}

/** A spec in `comfyui/explore.py`'s own shape, so a keepsake is painted exactly as the batches Logan read were. */
export interface PaintSpec {
  _: string;
  animals: Record<string, { kind: string; describe: string; one?: string[]; two?: string[] }>;
  photos: string[];
  crops: string[];
  aspect: string[];
  describe: string[];
  families: string[];
  graphs: string[];
  prompts: string[];
  denoise: never[];
  weights: never[];
  weight_types: never[];
  end_at: never[];
  seeds: number[];
  heads: string[];
}

export interface Painter {
  /** a reason the card is not free, or null: one driver at a time (doc/infra.md, Home GPU) */
  busy(): Promise<string | null>;
  /** fetches a listing's photos beside run `name` (`var/explore/<name>/photos/`) and returns their file names */
  fetchPhotos(name: string, photos: DisplayPhoto[]): Promise<string[]>;
  /** deletes run `name`'s fetched photos and everything cut from them */
  forget(name: string): Promise<void>;
  /** cuts run `name`'s crops by live detection into `input/crew/<name>/` (`comfyui/live_crops.py`), and returns the photos cut */
  crops(name: string, listing: DetectListing & { photos: string[] }): Promise<CutPhoto[]>;
  /** paints `spec` as run `name` and returns its marked PNGs, one per seed in the spec's order */
  paint(name: string, spec: PaintSpec): Promise<string[]>;
}

/** A photo `comfyui/live_crops.py` cut: an animal was chosen in it, and maybe its head. */
export interface CutPhoto {
  file: string;
  head: boolean;
}

export type ArtOutcome =
  | { status: "painted"; keys: string[]; published?: boolean; publishError?: string }
  | { status: "has-art" }
  | { status: "skipped"; reason: string };

export function loadCrewTable(path = "comfyui/keepsake-crew.json"): CrewTable {
  return JSON.parse(readFileSync(path, "utf8")) as CrewTable;
}

/** Four seeds, one painting each: a donation gets four (ADR-0004 as amended 2026-11-03, decision 5). */
export function crewSpec(table: CrewTable, slug: string, keepsakeId: number, animal?: string): PaintSpec {
  const pet = table.pets[slug];
  if (!pet) throw new Error(`no crew painting row for '${slug}'`);
  if (table.seeds.length !== 4) throw new Error(`the crew table holds ${table.seeds.length} seeds; a donation gets four`);
  return {
    _: `keepsake ${keepsakeId}: ${pet.name}, painted by art.generate from comfyui/keepsake-crew.json`,
    // the crops are read under this name: the pet's for batch 11's, the run's own for a live detection
    animals: { [animal ?? pet.name]: { kind: pet.kind, describe: pet.describe, two: pet.two } },
    photos: ["two"],
    crops: ["grownsubject"],
    aspect: ["landscape"],
    describe: ["listing"],
    families: ["kleinbfl8"],
    graphs: ["reference2"],
    prompts: [table.prompt],
    denoise: [],
    weights: [],
    weight_types: [],
    end_at: [],
    seeds: table.seeds,
    heads: ["grownhead"],
  };
}

function text(facts: { field: string; value: unknown }[], field: string): string | undefined {
  const value = facts.filter((f) => f.field === field).at(-1)?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A listing's words from its own fields, "female pit bull terrier mix": the reviewed words table is not built, and no one reads a shelter's photo to write them. */
export function listingWords(facts: { field: string; value: unknown }[]): string {
  const sex = text(facts, FACT.sex);
  const kind = text(facts, FACT.kind) ?? text(facts, FACT.species) ?? "animal";
  return [sex === "female" || sex === "male" ? sex : null, kind].filter(Boolean).join(" ").toLowerCase();
}

/** A listing painted from its own photos, one or two, by the crew table's prompt and four seeds. */
export function listingSpec(table: CrewTable, name: string, species: string, words: string, files: string[], keepsakeId: number): PaintSpec {
  if (files.length < 1 || files.length > 2) throw new Error(`${name}: ${files.length} photos; a listing paints from one or two`);
  if (table.seeds.length !== 4) throw new Error(`the crew table holds ${table.seeds.length} seeds; a donation gets four`);
  const key = files.length === 2 ? "two" : "one";
  return {
    _: `keepsake ${keepsakeId}: a listing, painted by art.generate from its own photos and fields`,
    animals: { [name]: { kind: species, describe: words, [key]: files } },
    photos: [key],
    crops: ["grownsubject"],
    aspect: ["landscape"],
    describe: ["listing"],
    families: ["kleinbfl8"],
    graphs: ["reference2"],
    prompts: [table.prompt],
    denoise: [],
    weights: [],
    weight_types: [],
    end_at: [],
    seeds: table.seeds,
    heads: ["grownhead"],
  };
}

const QUIET_START_MIN = 6 * 60 + 45;
const QUIET_CAP_MIN = 10 * 60;

/**
 * No painting from 06:45 UTC until the main checkout's nightly poll log says `== exit`, capped at
 * 10:00, its three-hour limit: the poll and a guard batch must never share the box (doc/infra.md).
 */
export function inQuietWindow(now: Date, todaysNightlyLog: string | null): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minutes < QUIET_START_MIN || minutes >= QUIET_CAP_MIN) return false;
  return !(todaysNightlyLog ?? "").includes("== exit");
}

function nightlyLog(now: Date, dir = "var/nightly"): string | null {
  const path = join(dir, `${now.toISOString().slice(0, 10)}.log`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * One keepsake's four portraits. Never writes a part set: "owed" is no art fact at all, so the four
 * rows go in one transaction or none do (doc/plans/demo-chain-contract.md).
 */
export async function generateArt(
  db: Db,
  job: ArtGenerateJob,
  painter: Painter,
  opts: { table?: CrewTable; now?: Date; nightly?: string | null; live?: boolean; publish?: (keepsakeId: number) => Promise<void> } = {},
): Promise<ArtOutcome> {
  const { keepsakeId, photos = [] } = job;
  const facts = await db.select().from(keepsakeFact).where(eq(keepsakeFact.keepsakeId, keepsakeId));
  if (facts.some((f) => f.field === FACT.art)) return { status: "has-art" };
  const source = facts.find((f) => f.field === FACT.sourcePhoto);
  const crew = source ? (source.value as SourcePhotoFact) : null;
  // A crew pet paints from its own originals and a listing only from the photos its job carries (ADR-0028 §6, ADR-0022 as amended 2026-10-27).
  if (crew && (crew.photo !== null || photos.length > 0)) throw new Error(`keepsake ${keepsakeId} is a crew pet's and names a photo`);
  if (!crew && photos.length === 0) throw new Error(`keepsake ${keepsakeId} has neither a crew pet nor photos in its job`);
  const basis = source?.basis ?? facts[0]?.basis;
  if (!crew && (!basis || basis === CREW_BASIS)) throw new Error(`keepsake ${keepsakeId}'s photos come with no listing's basis`);

  const now = opts.now ?? new Date();
  if (inQuietWindow(now, opts.nightly !== undefined ? opts.nightly : nightlyLog(now))) {
    return { status: "skipped", reason: "the nightly poll's quiet window" };
  }
  const busy = await painter.busy();
  if (busy) return { status: "skipped", reason: busy };

  const table = opts.table ?? loadCrewTable();
  const name = `keepsake-${keepsakeId}`;
  let pngs: string[];
  if (crew) {
    const pet = table.pets[crew.pet];
    if (opts.live && pet) {
      const cut = await painter.crops(name, { ...pet.detect, photos: pet.two.map((file) => `crew:${pet.name}/${file}`) });
      // The crew's two are vetted photos of the pet: one the detector can't find is a fault to see, never a set from the other.
      if (pet.two.some((file) => !cut.some((c) => c.file === file)) || !cut.find((c) => c.file === pet.two[0])?.head) {
        throw new Error(`keepsake ${keepsakeId}: live detection lost one of ${pet.name}'s photos or its first's head`);
      }
    }
    pngs = await painter.paint(name, crewSpec(table, crew.pet, keepsakeId, opts.live ? name : undefined));
  } else {
    const species = text(facts, FACT.species);
    if (!species) throw new Error(`keepsake ${keepsakeId} has no ${FACT.species} fact`);
    const words = listingWords(facts);
    try {
      const files = await painter.fetchPhotos(name, photos.slice(0, 2));
      // No colour: `animals` holds none, so the detector's colour vote abstains (ADR-0026).
      const cut = await painter.crops(name, { species, colour: "", subject: `${name}, the ${words}`, photos: files.map((f) => `held:${name}/photos/${f}`) });
      // A photo with no animal chosen is left out; the head is read from the first photo, so one with a head leads.
      const usable = [...cut].sort((a, b) => Number(b.head) - Number(a.head));
      if (!usable[0]?.head) throw new Error(`keepsake ${keepsakeId}: no photo with the animal and its head`);
      pngs = await painter.paint(name, listingSpec(table, name, species, words, usable.map((c) => c.file), keepsakeId));
    } finally {
      // The photos and everything cut from them go when the attempt ends, painted or not: they are fetched again for a retry (ADR-0022 as amended 2026-11-02).
      await painter.forget(name);
    }
  }
  if (pngs.length !== 4) throw new Error(`keepsake ${keepsakeId}: ${pngs.length} paintings, not four`);

  const arts: ArtFact[] = pngs.map((_, i) => ({ key: artKey(keepsakeId, i + 1), candidate: i + 1 }));
  for (const [i, png] of pngs.entries()) {
    const path = artFilePath(arts[i].key);
    mkdirSync(dirname(path), { recursive: true });
    // Pixels only, as every image we publish: sharp writes no metadata unless asked (ADR-0030).
    await sharp(png).jpeg({ quality: 92, mozjpeg: true }).toFile(path);
  }

  const wrote = await db.transaction(async (tx) => {
    const again = await tx
      .select({ id: keepsakeFact.id })
      .from(keepsakeFact)
      .where(and(eq(keepsakeFact.keepsakeId, keepsakeId), eq(keepsakeFact.field, FACT.art)))
      .limit(1);
    if (again.length > 0) return false;
    await tx.insert(keepsakeFact).values(
      arts.map((value) => ({ keepsakeId, field: FACT.art, value, basis: basis!, snapshottedAt: opts.now ?? new Date() })),
    );
    return true;
  });
  if (!wrote) return { status: "has-art" };
  const keys = arts.map((a) => a.key);
  if (!opts.publish) return { status: "painted", keys };
  try {
    await opts.publish(keepsakeId);
    return { status: "painted", keys, published: true };
  } catch (err) {
    // The code alone: a publish error can carry the share token, and a token is the page (ADR-0036).
    return { status: "painted", keys, published: false, publishError: failureCode(err) };
  }
}

/**
 * The share tool's own publish (`npm run share -- publish`), after the four art facts; only with
 * `SHARE_PUBLISH=on` and the write pair in the environment from `pass`, never a file (oplog 0026, ADR-0036).
 */
export function sharePublisher(db: () => Db, env = process.env): ((keepsakeId: number) => Promise<void>) | undefined {
  if (env.SHARE_PUBLISH !== "on") return undefined;
  const need = (key: string) => {
    const value = env[key];
    if (!value) throw new Error(`SHARE_PUBLISH=on needs ${key}`);
    return value;
  };
  const store = createR2ObjectStore({
    endpoint: need("SHARE_WRITE_ENDPOINT"),
    accessKeyId: need("SHARE_WRITE_ACCESS_KEY_ID"),
    secretAccessKey: need("SHARE_WRITE_SECRET_ACCESS_KEY"),
  });
  return async (keepsakeId) => {
    const share = await keepsakeShare(db(), keepsakeId, { speak: spokenAnimalName });
    const paintings = await Promise.all(share.files.map((path) => encodePainting(path)));
    await publishShare(store, share.manifest, paintings, share.token);
  };
}

function run(cmd: string, args: string[], cwd: string, log: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const out = createWriteStream(log, { flags: "a" });
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on("error", reject);
    child.on("close", (code) => {
      out.end();
      if (code === 0) resolveRun();
      else reject(new Error(`${basename(cmd)} ${args[0]} exited ${code}; see ${log}`));
    });
  });
}

function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.on("error", () => resolveRun(""));
    child.on("close", () => resolveRun(text));
  });
}

/**
 * A klein load takes 6–11 GB of Windows free memory, and the guard kills ComfyUI under 10 GB (FLOOR_GB), so a
 * start under this leaves a half-painted set; measured on batches 35a–38f, whose one kill started at 20.6 GB.
 */
export const LOAD_FREE_GB = 22;

/** The `host_free=` reading in `comfyui/guard.sh`'s output, or null when it printed none. */
export function hostFreeGb(guardOutput: string): number | null {
  const m = guardOutput.match(/host_free=([0-9.]+)GB/);
  return m ? Number(m[1]) : null;
}

/**
 * Paints through `comfyui/guard.sh batch`, never a ComfyUI of its own: the guard restarts ComfyUI and
 * kills it when the driver's pool leaks, and nothing drives the Arc except through it (doc/infra.md, Home GPU).
 */
export function guardPainter(root: string): Painter {
  const explore = join(root, "var", "explore");
  return {
    async busy() {
      const names = await capture("docker", ["ps", "--format", "{{.Names}}"]);
      if (/comfyui-comfyui|comfyui-explore-run/.test(names)) return "a ComfyUI container is up";
      if ((await capture("pgrep", ["-f", "guard[.]sh batch"])).trim()) return "a guard batch is running";
      // after the cache drop the guard does at every start, so this is the memory a load really has
      const free = hostFreeGb(await capture(join(root, "comfyui/guard.sh"), ["drop"]));
      if (free !== null && free < LOAD_FREE_GB) return `Windows free ${free} GB, under ${LOAD_FREE_GB} GB before a model load`;
      return null;
    },
    async fetchPhotos(name, photos) {
      const dir = join(explore, name, "photos");
      mkdirSync(dir, { recursive: true });
      const files: string[] = [];
      for (const [i, photo] of photos.entries()) {
        if (!photo.url.startsWith("https://")) throw new Error(`${name}: photo ${i + 1} is not an https URL`);
        const res = await fetch(photo.url, { signal: AbortSignal.timeout(30_000) });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/")) throw new Error(`${name}: photo ${i + 1} answered ${res.status} ${type}`);
        const file = `${i + 1}.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`;
        writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()));
        files.push(file);
      }
      return files;
    },
    async forget(name) {
      for (const dir of [join(explore, name, "photos"), join(explore, name, "detect"), join(root, "var", "comfyui", "input", "crew", name)]) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    async crops(name, { photos, ...listing }) {
      const dir = join(explore, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "detect.json"), JSON.stringify({ _: `${name}: one listing for live detection`, listings: { [name]: { ...listing, photos } } }, null, 2) + "\n");
      await run("docker", ["compose", "-f", "comfyui/compose.yml", "run", "--rm", "--no-deps", "--entrypoint", "python", "explore",
        "/home/comfy/harness/live_crops.py", name], root, join(explore, `${name}.log`));
      return JSON.parse(readFileSync(join(dir, "cut.json"), "utf8")) as CutPhoto[];
    },
    async paint(name, spec) {
      const dir = join(explore, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
      const log = join(explore, `${name}.log`);
      await run("comfyui/guard.sh", ["batch", name, "4"], root, log);
      const fonts = realpathSync(join(root, "var", "fonts"));
      await run(
        "docker",
        ["compose", "-f", "comfyui/compose.yml", "run", "--rm", "--no-deps", "-v", `${fonts}:/home/comfy/fonts:ro`,
          "--entrypoint", "python", "explore", "/home/comfy/harness/mark.py", name],
        root,
        log,
      );
      const runs = readFileSync(join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean)
        .map((line) => JSON.parse(line) as { seed: number; output?: string })
        .filter((r) => r.output);
      return spec.seeds.map((seed) => {
        const r = runs.findLast((x) => x.seed === seed);
        if (!r?.output) throw new Error(`${name}: seed ${seed} was not painted; see ${log}`);
        const marked = join(dir, "marked", `${basename(r.output, extname(r.output))}.png`);
        if (!existsSync(marked)) throw new Error(`${name}: seed ${seed} was not marked; see ${log}`);
        return marked;
      });
    },
  };
}
