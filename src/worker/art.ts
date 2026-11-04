import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { spokenAnimalName } from "@/core/email/animal-name";
import type { DisplayPhoto } from "@/core/ingest/pipeline";
import { artFilePath, artKey, CREW_BASIS, FACT, type ArtFact, type ArtGenerateJob, type SourcePhotoFact } from "@/core/keepsake";
import { failureCode } from "@/core/observability";
import { keepsakeShare } from "@/core/share/keepsake";
import { createR2ObjectStore, encodePainting, publishShare } from "@/core/share/publish";
import type { Db } from "@/db/client";
import { keepsake, keepsakeFact } from "@/db/schema";

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
  /** the look of the animal's head in run `name`'s fetched photo `file`, read on the CPU (`comfyui/read.py`), or null */
  read(name: string, species: string, file: string): Promise<string | null>;
  /** paints `spec` as run `name` and returns its marked PNGs, one per seed in the spec's order */
  paint(name: string, spec: PaintSpec): Promise<string[]>;
}

/**
 * `live_crops.py` in the explore container on the local detector, set here and never inherited from the worker's
 * `DETECT_PIPELINES`: a listing's photo never leaves the machine (ADR-0004 as amended 2026-08-02; ADR-0028 §1).
 */
export function liveCropsArgs(name: string): string[] {
  return ["compose", "-f", "comfyui/compose.yml", "run", "--rm", "--no-deps", "-e", "DETECT_PIPELINES=owlv2",
    "--entrypoint", "python", "explore", "/home/comfy/harness/live_crops.py", name];
}

/** The photo reader a dog's words get the look of its head from: Logan's blind read of batch 40b (ADR-0004 as amended 2026-11-04). */
export const READER = "qwen3-vl-4b-instruct";

/** Only the species Logan has judged the reader on: a cat keeps the listing's words until a cat batch has been looked at. */
export const READER_SPECIES = ["dog"];

/** `read.py` in the explore container on the CPU, its weights read offline from the models store, never a hosted reader (ADR-0004 as amended 2026-08-02). */
export function readArgs(name: string, species: string, file: string): string[] {
  return ["compose", "-f", "comfyui/compose.yml", "run", "--rm", "--no-deps", "-e", `READER=${READER}`, "-e", "OMP_NUM_THREADS=6",
    "--entrypoint", "python", "explore", "/home/comfy/harness/read.py", `/home/comfy/explore/${name}/read.json`, species, `held:${name}/photos/${file}`];
}

/** A photo `comfyui/live_crops.py` cut: an animal was chosen in it, and maybe its head. */
export interface CutPhoto {
  file: string;
  head: boolean;
}

export type ArtOutcome =
  | { status: "painted"; keys: string[]; published?: boolean; publishError?: string; warning?: string }
  | { status: "has-art" }
  | { status: "skipped"; reason: string };

export function loadCrewTable(path = "comfyui/keepsake-crew.json"): CrewTable {
  return JSON.parse(readFileSync(path, "utf8")) as CrewTable;
}

/** Four seeds, one painting each: a donation gets four (ADR-0004 as amended 2026-11-03, decision 5). */
export function crewSpec(table: CrewTable, slug: string, keepsakeId: number, animal?: string, two?: string[]): PaintSpec {
  // own keys only: "constructor" or "__proto__" in a fact must never reach an object's prototype
  const pet = Object.hasOwn(table.pets, slug) ? table.pets[slug] : undefined;
  if (!pet) throw new Error(`no crew painting row for '${slug}'`);
  if (table.seeds.length !== 4) throw new Error(`the crew table holds ${table.seeds.length} seeds; a donation gets four`);
  return {
    _: `keepsake ${keepsakeId}: ${pet.name}, painted by art.generate from comfyui/keepsake-crew.json`,
    // the crops are read under this name: the pet's for batch 11's, the run's own for a live detection
    animals: { [animal ?? pet.name]: { kind: pet.kind, describe: pet.describe, two: two ?? pet.two } },
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

/**
 * A listing's words from its own fields, "female tuxedo cat": the reviewed words table is not built, and no one reads
 * a shelter's photo to write them. The corpus says "Male" and "Female"; a breed that doesn't name its species gets it,
 * since "tuxedo" or "domestic short hair" alone is not an animal, and one that does never gets it twice, two words
 * ("guinea pig") as well as one (verify, 2026-11-04).
 */
export function listingWords(facts: { field: string; value: unknown }[]): string {
  const sex = text(facts, FACT.sex)?.toLowerCase();
  const species = text(facts, FACT.species)?.toLowerCase();
  const kind = text(facts, FACT.kind)?.toLowerCase();
  const words = [sex === "female" || sex === "male" ? sex : null, kind];
  const spaced = (s: string) => ` ${s.split(/\W+/).filter(Boolean).join(" ")} `;
  if (species && !spaced(kind ?? "").includes(spaced(species))) words.push(species);
  return words.filter(Boolean).join(" ") || "animal";
}

/** Where a listing's photos may come from: RescueGroups' CDN, the only host in the corpus (287,526 of 287,526, verify). */
export function photoHosts(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ART_PHOTO_HOSTS ?? "cdn.rescuegroups.org").split(",").map((h) => h.trim()).filter(Boolean);
}

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** An honest client name and a contact, as Wikimedia asks of every client and the outreach tool already sends (ADR-0029). */
const ART_USER_AGENT = "MonsterPawsArtBot/0.1 (https://monsterpaws.org)";

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

/**
 * A keepsake's run folder: never its id alone, which starts at 1 in every database, so the demo's keepsake 1 and
 * production's would share a folder and a live run would read another animal's paintings (verify, 2026-11-04).
 */
export function runName(keepsakeId: number, shareToken: string): string {
  return `keepsake-${keepsakeId}-${createHash("sha256").update(shareToken).digest("hex").slice(0, 12)}`;
}

const STORE_MARK = ".database";

/**
 * Binds `ART_STORE_DIR` to one database by a marker the first worker writes: `artKey` is the keepsake's id, so two
 * databases sharing a store would overwrite each other's paintings. Refuses a store that names another.
 */
export async function bindArtStore(db: Db, root: string | undefined = process.env.ART_STORE_DIR): Promise<string> {
  if (!root || !isAbsolute(root)) throw new Error("ART_STORE_DIR must be an absolute directory");
  const [{ name }] = (await db.execute(sql`select current_database() as name`)).rows as { name: string }[];
  mkdirSync(root, { recursive: true });
  const mark = join(root, STORE_MARK);
  if (!existsSync(mark)) writeFileSync(mark, `${name}\n`);
  const bound = readFileSync(mark, "utf8").trim();
  if (bound !== name) throw new Error(`ART_STORE_DIR belongs to database ${bound}, not ${name}`);
  return name;
}

/**
 * The read-only check for `npm run share -- publish`: never write the marker here, because a hand run proves
 * nothing about whose paintings a store holds, and `artKey` starts at 1 in every database, so the demo's keepsake 1
 * would go out under production's token (verify, 2026-11-04; ADR-0036).
 */
export async function checkArtStore(db: Db, root: string | undefined = process.env.ART_STORE_DIR): Promise<string> {
  if (!root || !isAbsolute(root)) throw new Error("ART_STORE_DIR must be an absolute directory");
  const [{ name }] = (await db.execute(sql`select current_database() as name`)).rows as { name: string }[];
  const mark = join(root, STORE_MARK);
  if (!existsSync(mark)) throw new Error(`ART_STORE_DIR has no database marker, so nothing says it holds ${name}'s paintings`);
  const bound = readFileSync(mark, "utf8").trim();
  if (bound !== name) throw new Error(`ART_STORE_DIR belongs to database ${bound}, not ${name}`);
  return name;
}

/** The namespace of the per-keepsake lock that serialises writing a set: two handlers once wrote eight art rows (verify). */
const ART_LOCK = 0x41525447;

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
  opts: {
    table?: CrewTable;
    now?: Date;
    nightly?: string | null;
    live?: boolean;
    reader?: boolean;
    publish?: (keepsakeId: number) => Promise<void>;
  } = {},
): Promise<ArtOutcome> {
  const { keepsakeId, photos = [] } = job;
  const [row] = await db.select({ token: keepsake.shareToken }).from(keepsake).where(eq(keepsake.id, keepsakeId)).limit(1);
  if (!row) throw new Error(`keepsake ${keepsakeId} doesn't exist`);
  const facts = await db.select().from(keepsakeFact).where(eq(keepsakeFact.keepsakeId, keepsakeId)).orderBy(asc(keepsakeFact.id));
  if (facts.some((f) => f.field === FACT.art)) return { status: "has-art" };
  // the latest row is the fact: a change is a new row, never an UPDATE (ADR-0022 §3)
  const source = facts.filter((f) => f.field === FACT.sourcePhoto).at(-1);
  const crew = source ? (source.value as SourcePhotoFact) : null;
  if (source && source.basis !== CREW_BASIS) throw new Error(`keepsake ${keepsakeId} names a crew pet on a shelter's basis`);
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
  await bindArtStore(db);

  const table = opts.table ?? loadCrewTable();
  const name = runName(keepsakeId, row.token);
  let pngs: string[];
  let warning: string | undefined;
  if (crew) {
    const pet = table.pets[crew.pet];
    let two: string[] | undefined;
    if (opts.live && pet) {
      const cut = await painter.crops(name, { ...pet.detect, photos: pet.two.map((file) => `crew:${pet.name}/${file}`) });
      // The crew's two are vetted photos of the pet: one the detector can't find is a fault to see, never a set from the other.
      if (pet.two.some((file) => !cut.some((c) => c.file === file))) {
        throw new Error(`keepsake ${keepsakeId}: live detection lost one of ${pet.name}'s photos`);
      }
      const headless = pet.two.filter((file) => !cut.find((c) => c.file === file)?.head);
      if (headless.length > 0) warning = `live detection found no head in ${headless.length} of ${pet.name}'s photos; a close-up's subject stood in`;
      // the head is read from the first photo, so one with its own head leads, as a listing's does
      two = [...pet.two].sort((a, b) => Number(headless.includes(a)) - Number(headless.includes(b)));
    }
    pngs = await painter.paint(name, crewSpec(table, crew.pet, keepsakeId, opts.live ? name : undefined, two));
  } else {
    const species = text(facts, FACT.species);
    if (!species) throw new Error(`keepsake ${keepsakeId} has no ${FACT.species} fact`);
    const words = listingWords(facts);
    try {
      const files = await painter.fetchPhotos(name, photos.slice(0, 2));
      // No colour: `animals` holds none, so the detector's colour vote abstains (ADR-0026).
      const cut = await painter.crops(name, { species, colour: "", subject: `${name}, the ${words}`, photos: files.map((f) => `held:${name}/photos/${f}`) });
      // A photo with no animal chosen is left out; the head is read from the first photo, so one with its own head leads,
      // and a photo whose subject stands in for its head (`live_crops.py`) still paints.
      const usable = [...cut].sort((a, b) => Number(b.head) - Number(a.head));
      if (usable.length === 0) throw new Error(`keepsake ${keepsakeId}: no photo with the animal in it`);
      let look: string | null = null;
      if (opts.reader && READER_SPECIES.includes(species.toLowerCase())) {
        // The photo that leads, whose head the painter reads too; a reader that fails costs its words, never the painting.
        try {
          look = await painter.read(name, species.toLowerCase(), usable[0].file);
          if (!look) warning = "the photo reader gave no words, so the listing's alone";
        } catch (err) {
          warning = `the photo reader failed, so the listing's words alone: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      pngs = await painter.paint(name, listingSpec(table, name, species, look ? `${words} ${look}` : words, usable.map((c) => c.file), keepsakeId));
    } finally {
      // The photos and everything cut from them go when the attempt ends, painted or not: they are fetched again for a retry (ADR-0022 as amended 2026-11-02).
      await painter.forget(name);
    }
  }
  if (pngs.length !== 4) throw new Error(`keepsake ${keepsakeId}: ${pngs.length} paintings, not four`);

  const arts: ArtFact[] = pngs.map((_, i) => ({ key: artKey(keepsakeId, i + 1), candidate: i + 1 }));
  const wrote = await db.transaction(async (tx) => {
    // Under the lock the files and the facts are one write: a second handler waits, then finds the art and writes nothing.
    await tx.execute(sql`select pg_advisory_xact_lock(${ART_LOCK}, ${keepsakeId})`);
    const again = await tx
      .select({ id: keepsakeFact.id })
      .from(keepsakeFact)
      .where(and(eq(keepsakeFact.keepsakeId, keepsakeId), eq(keepsakeFact.field, FACT.art)))
      .limit(1);
    if (again.length > 0) return false;
    for (const [i, png] of pngs.entries()) {
      const path = artFilePath(arts[i].key);
      mkdirSync(dirname(path), { recursive: true });
      // Pixels only, as every image we publish: sharp writes no metadata unless asked (ADR-0030).
      await sharp(png).jpeg({ quality: 92, mozjpeg: true }).toFile(path);
    }
    await tx.insert(keepsakeFact).values(
      arts.map((value) => ({ keepsakeId, field: FACT.art, value, basis: basis!, snapshottedAt: opts.now ?? new Date() })),
    );
    return true;
  });
  if (!wrote) return { status: "has-art" };
  const keys = arts.map((a) => a.key);
  const painted = { status: "painted" as const, keys, ...(warning ? { warning } : {}) };
  if (!opts.publish) return painted;
  try {
    await opts.publish(keepsakeId);
    return { ...painted, published: true };
  } catch (err) {
    // The code alone: a publish error can carry the share token, and a token is the page (ADR-0036).
    return { ...painted, published: false, publishError: failureCode(err) };
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

function run(cmd: string, args: string[], cwd: string, log: string, env?: Record<string, string>): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const out = createWriteStream(log, { flags: "a" });
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: env && { ...process.env, ...env } });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    let failed: Error | undefined;
    out.on("error", (err) => (failed ??= err));
    child.on("error", (err) => (failed ??= err));
    child.on("close", (code, signal) => {
      // Never settle before the log is on disk (and "close" follows a failed spawn too): the caller reads its tail
      // for why the run stopped, and an unflushed tail gives an earlier line (verify, 2026-11-04).
      out.end(() => {
        if (failed) reject(failed);
        else if (code === 0) resolveRun();
        else reject(new Error(`${basename(cmd)} ${args[0]} exited ${code ?? signal}; see ${log}`));
      });
    });
  });
}

function capture(cmd: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], env: env && { ...process.env, ...env } });
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
 * Each seed's painting from a run's `runs.jsonl`, or null: only this spec's runs count, since a folder can hold an
 * earlier prompt's and a seed alone names no animal (verify, 2026-11-04). The latest wins a retried seed.
 */
export function paintedFor(runsJsonl: string, spec: PaintSpec): (string | null)[] {
  const [animal] = Object.keys(spec.animals);
  const runs = runsJsonl.split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { animal: string; prompt: string; describe: string; seed: number; output?: string })
    .filter((r) => r.output && r.animal === animal && r.prompt === spec.prompts[0] && r.describe === spec.describe[0]);
  return spec.seeds.map((seed) => runs.findLast((r) => r.seed === seed)?.output ?? null);
}

/** A progress bar, docker's own chatter or a library's notice: never the reason a run stopped. */
const LOG_NOISE = /it\/s\]|%\||^Container |^Loading weights|^WARN|level=warn|^\[transformers\]/;

/**
 * Why a run stopped, for its error and its alert: the last line of the attempt that isn't noise, whoever wrote it,
 * so a crash after the scripts' own word on a photo is the crash (verify, 2026-11-04); their `<name>: ` goes. At
 * most 200 characters: a detector's error can quote a remote service's reply, and nothing outside the code may
 * rely on what that holds (the sam3 chat, 2026-11-04).
 */
export function lastRunLine(log: string, name: string): string | null {
  const line = log.split("\n").map((l) => l.trim()).filter((l) => l && !LOG_NOISE.test(l)).at(-1);
  if (!line) return null;
  return (line.startsWith(`${name}: `) ? line.slice(name.length + 2) : line).slice(0, 200);
}

/** ComfyUI's data root as `comfyui/compose.yml` resolves it: COMFYUI_DATA, relative to `comfyui/`, or `var/comfyui`. */
export function comfyData(root: string, env: Record<string, string | undefined> = process.env): string {
  const set = env.COMFYUI_DATA;
  return set ? resolve(join(root, "comfyui"), set) : join(root, "var", "comfyui");
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
      // after the cache drop the guard does at every start, so this is the memory a load really has; the drop waits for
      // this floor, never its own lower one, since freed pages reach Windows 20–27 s late (the moderator, 2026-11-04)
      const free = hostFreeGb(await capture(join(root, "comfyui/guard.sh"), ["drop"], { WAIT_GB: String(LOAD_FREE_GB) }));
      if (free !== null && free < LOAD_FREE_GB) return `Windows free ${free} GB, under ${LOAD_FREE_GB} GB before a model load`;
      return null;
    },
    async fetchPhotos(name, photos) {
      const dir = join(explore, name, "photos");
      mkdirSync(dir, { recursive: true });
      const hosts = photoHosts();
      const files: string[] = [];
      // Every message names the photo by its number, never its URL: a URL is the shelter's, and it reaches the log.
      for (const [i, photo] of photos.entries()) {
        let url: URL;
        try {
          url = new URL(photo.url);
        } catch {
          throw new Error(`${name}: photo ${i + 1} has no valid URL`);
        }
        if (url.protocol !== "https:" || !hosts.includes(url.hostname)) throw new Error(`${name}: photo ${i + 1} is not from an allowed host`);
        let res: Response;
        try {
          // No redirect is followed: one could leave the CDN for any address at all (verify, 2026-11-04).
          res = await fetch(url, { redirect: "error", headers: { "User-Agent": ART_USER_AGENT }, signal: AbortSignal.timeout(30_000) });
        } catch {
          throw new Error(`${name}: photo ${i + 1} could not be fetched`);
        }
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/") || !res.body) throw new Error(`${name}: photo ${i + 1} answered ${res.status} ${type}`);
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = res.body.getReader();
        for (;;) {
          let part: ReadableStreamReadResult<Uint8Array>;
          try {
            part = await reader.read();
          } catch {
            // a dropped connection or the timeout mid-body, which undici words as a bare "terminated" (verify, 2026-11-04)
            throw new Error(`${name}: photo ${i + 1} stopped arriving after ${size} bytes`);
          }
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_PHOTO_BYTES) {
            await reader.cancel();
            throw new Error(`${name}: photo ${i + 1} is over ${MAX_PHOTO_BYTES} bytes`);
          }
          chunks.push(part.value);
        }
        const file = `${i + 1}.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`;
        writeFileSync(join(dir, file), Buffer.concat(chunks));
        files.push(file);
      }
      return files;
    },
    async forget(name) {
      // A failure here fails the job on purpose: the photos must go, and a retry fetches and paints again.
      // ComfyUI's output goes too, since each PNG embeds its prompt in its metadata, the reader's words with it.
      for (const dir of [join(explore, name, "photos"), join(explore, name, "detect"), join(comfyData(root), "input", "crew", name), join(comfyData(root), "output", "explore", name)]) {
        rmSync(dir, { recursive: true, force: true });
      }
      // The reader's words and the prompt that carries them are read from a shelter's photo too, so they go with it; the
      // marked paintings stay, carrying no metadata, since the set is written from them after this (ADR-0004 as amended 2026-11-04).
      for (const file of ["read.json", "spec.json", "runs.jsonl", "index.html"]) rmSync(join(explore, name, file), { force: true });
    },
    async crops(name, { photos, ...listing }) {
      const dir = join(explore, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "detect.json"), JSON.stringify({ _: `${name}: one listing for live detection`, listings: { [name]: { ...listing, photos } } }, null, 2) + "\n");
      const log = join(explore, `${name}.log`);
      // The log is appended across attempts, so only this attempt's part may say why it stopped; bytes, since bars are not ASCII.
      const from = existsSync(log) ? statSync(log).size : 0;
      try {
        await run("docker", liveCropsArgs(name), root, log);
      } catch (err) {
        // live_crops says why in its last line (no photo, no animal): carried into the error with the exit, so the alert says both.
        const why = lastRunLine(existsSync(log) ? readFileSync(log).subarray(from).toString("utf8") : "", name);
        const exit = err instanceof Error ? err.message : String(err);
        throw new Error(why ? `${name}: detection stopped: ${why} (${exit})` : exit);
      }
      return JSON.parse(readFileSync(join(dir, "cut.json"), "utf8")) as CutPhoto[];
    },
    async read(name, species, file) {
      await run("docker", readArgs(name, species, file), root, join(explore, `${name}.log`));
      const read = JSON.parse(readFileSync(join(explore, name, "read.json"), "utf8")) as Record<string, { phrase: string | null }>;
      return read[`held:${name}/photos/${file}`]?.phrase ?? null;
    },
    async paint(name, spec) {
      const dir = join(explore, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
      const log = join(explore, `${name}.log`);
      // The reader's weights sit in the VM's cache when a load starts, so the drop waits for the load's own floor (doc/infra.md, Home GPU).
      await run("comfyui/guard.sh", ["batch", name, "4"], root, log, { WAIT_GB: String(LOAD_FREE_GB) });
      const fonts = realpathSync(join(root, "var", "fonts"));
      await run(
        "docker",
        ["compose", "-f", "comfyui/compose.yml", "run", "--rm", "--no-deps", "-v", `${fonts}:/home/comfy/fonts:ro`,
          "--entrypoint", "python", "explore", "/home/comfy/harness/mark.py", name],
        root,
        log,
      );
      return paintedFor(readFileSync(join(dir, "runs.jsonl"), "utf8"), spec).map((output, i) => {
        if (!output) throw new Error(`${name}: seed ${spec.seeds[i]} was not painted; see ${log}`);
        const marked = join(dir, "marked", `${basename(output, extname(output))}.png`);
        if (!existsSync(marked)) throw new Error(`${name}: seed ${spec.seeds[i]} was not marked; see ${log}`);
        return marked;
      });
    },
  };
}
