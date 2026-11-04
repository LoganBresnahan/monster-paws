import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { artFilePath, artKey, FACT, type ArtFact, type SourcePhotoFact } from "@/core/keepsake";
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
  animals: Record<string, { kind: string; describe: string; two: string[] }>;
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
  /** cuts run `name`'s crops by live detection into `input/crew/<name>/` (`comfyui/live_crops.py`) */
  crops(name: string, listing: DetectListing & { photos: string[] }): Promise<void>;
  /** paints `spec` as run `name` and returns its marked PNGs, one per seed in the spec's order */
  paint(name: string, spec: PaintSpec): Promise<string[]>;
}

export type ArtOutcome =
  | { status: "painted"; keys: string[] }
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
  keepsakeId: number,
  painter: Painter,
  opts: { table?: CrewTable; now?: Date; nightly?: string | null; live?: boolean } = {},
): Promise<ArtOutcome> {
  const facts = await db.select().from(keepsakeFact).where(eq(keepsakeFact.keepsakeId, keepsakeId));
  if (facts.some((f) => f.field === FACT.art)) return { status: "has-art" };
  const source = facts.find((f) => f.field === FACT.sourcePhoto);
  if (!source) throw new Error(`keepsake ${keepsakeId} has no ${FACT.sourcePhoto} fact`);
  const photo = source.value as SourcePhotoFact;
  // A named photo is a held listing photo, painted through live detection; never from the crew's table (ADR-0028 §6).
  if (photo.photo !== null) throw new Error(`keepsake ${keepsakeId} names a held photo; only the crew's table paints`);

  const now = opts.now ?? new Date();
  if (inQuietWindow(now, opts.nightly !== undefined ? opts.nightly : nightlyLog(now))) {
    return { status: "skipped", reason: "the nightly poll's quiet window" };
  }
  const busy = await painter.busy();
  if (busy) return { status: "skipped", reason: busy };

  const table = opts.table ?? loadCrewTable();
  const name = `keepsake-${keepsakeId}`;
  const pet = table.pets[photo.pet];
  if (opts.live && pet) {
    await painter.crops(name, { ...pet.detect, photos: pet.two.map((file) => `crew:${pet.name}/${file}`) });
  }
  const spec = crewSpec(table, photo.pet, keepsakeId, opts.live ? name : undefined);
  const pngs = await painter.paint(name, spec);
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
      arts.map((value) => ({ keepsakeId, field: FACT.art, value, basis: source.basis, snapshottedAt: opts.now ?? new Date() })),
    );
    return true;
  });
  return wrote ? { status: "painted", keys: arts.map((a) => a.key) } : { status: "has-art" };
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
    async crops(name, { photos, ...listing }) {
      const dir = join(explore, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "detect.json"), JSON.stringify({ _: `${name}: one listing for live detection`, listings: { [name]: { ...listing, photos } } }, null, 2) + "\n");
      await run("docker", ["compose", "-f", "comfyui/compose.yml", "run", "--rm", "--no-deps", "--entrypoint", "python", "explore",
        "/home/comfy/harness/live_crops.py", name], root, join(explore, `${name}.log`));
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
