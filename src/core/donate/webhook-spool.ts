import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";

/**
 * Deliveries the database couldn't take, one file each, on a volume app and worker share
 * (ADR-0027 as amended 2026-11-03). Memory is no use here: the deploy this protects against wipes it.
 */

/** What a raw row holds, before it is one. A file holds exactly this, so a replayed row equals a direct one. */
export interface StoredDelivery {
  body: string;
  headers: Record<string, string>;
  partnerDonationId: string | null;
  receivedAt: Date;
}

export interface SpoolEntry {
  file: string;
  ageMs: number;
  /** `null` when the file can't be read as a delivery: it stays, and ages into the report. */
  row: StoredDelivery | null;
}

const FILE = ".json";
const UNFINISHED = ".tmp";
const UNFINISHED_KEPT_MS = 60 * 60 * 1000;

/**
 * Renamed only once written and synced, so the replay can never read half a delivery.
 * Takes the stored form only: the raw body holds a donor's name and address (ADR-0027 as amended 2026-11-02).
 */
export async function spoolDelivery(dir: string, row: StoredDelivery): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Never `path.join` a spool path: the build's tracer reads a join onto this unknown directory as files in the project, and in
  // a checkout holding var/ it read gigabytes of it into memory until the build died.
  const name = `${dir}/${row.receivedAt.getTime()}-${randomUUID()}`;
  const handle = await open(`${name}${UNFINISHED}`, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(row));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(`${name}${UNFINISHED}`, `${name}${FILE}`);
  const directory = await open(dir, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function parseEntry(text: string): StoredDelivery | null {
  try {
    const { body, headers, partnerDonationId, receivedAt } = JSON.parse(text) as Record<string, unknown>;
    const at = new Date(typeof receivedAt === "string" ? receivedAt : NaN);
    if (typeof body !== "string" || !headers || typeof headers !== "object" || Array.isArray(headers)) return null;
    if (!Object.values(headers).every((value) => typeof value === "string")) return null;
    if (partnerDonationId !== null && typeof partnerDonationId !== "string") return null;
    if (Number.isNaN(at.getTime())) return null;
    return { body, headers: headers as Record<string, string>, partnerDonationId, receivedAt: at };
  } catch {
    return null;
  }
}

/** Oldest first, and clears what a crash left half written, which never answered 200. */
export async function readSpool(dir: string, asOf: Date = new Date()): Promise<SpoolEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: SpoolEntry[] = [];
  for (const name of names.sort()) {
    // Never `path.join` here either, for the same reason as in `spoolDelivery`.
    const file = `${dir}/${name}`;
    if (name.endsWith(UNFINISHED)) {
      if (asOf.getTime() - (await stat(file)).mtimeMs > UNFINISHED_KEPT_MS) await unlink(file);
    } else if (name.endsWith(FILE)) {
      entries.push({ file, ageMs: asOf.getTime() - (await stat(file)).mtimeMs, row: parseEntry(await readFile(file, "utf8")) });
    }
  }
  return entries;
}
