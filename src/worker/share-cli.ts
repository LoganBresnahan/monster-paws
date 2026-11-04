import { readFile } from "node:fs/promises";
import { spokenAnimalName } from "@/core/email/animal-name";
import { keepsakeShare, shelterShareTokens } from "@/core/share/keepsake";
import {
  createR2ObjectStore,
  deleteShare,
  encodePainting,
  publishShare,
  purgeCloudflare,
  purgeUrls,
  SHARE_BUCKET,
} from "@/core/share/publish";
import { isShareToken, sharePagePath } from "@/core/share/source";
import { isValidSlug } from "@/core/sources";
import { closeDb, getDb } from "@/db/client";
import { SITE_ORIGIN } from "@/ui/site";

const USAGE = `npm run share -- publish <keepsake-id>
npm run share -- takedown <token>
npm run share -- takedown --shelter <slug>

Writes only to ${SHARE_BUCKET}. Needs SHARE_WRITE_ENDPOINT, SHARE_WRITE_ACCESS_KEY_ID and
SHARE_WRITE_SECRET_ACCESS_KEY. publish also reads the database and ART_STORE_DIR; takedown also needs
SHARE_BASE_URL, CLOUDFLARE_ZONE_ID and CLOUDFLARE_PURGE_TOKEN (ADR-0036).`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set\n\n${USAGE}`);
  return value;
}

function store() {
  const asked = process.env.SHARE_WRITE_BUCKET;
  if (asked && asked !== SHARE_BUCKET) throw new Error(`this tool writes only to ${SHARE_BUCKET}, not ${asked} (ADR-0036)`);
  return createR2ObjectStore({
    endpoint: required("SHARE_WRITE_ENDPOINT"),
    accessKeyId: required("SHARE_WRITE_ACCESS_KEY_ID"),
    secretAccessKey: required("SHARE_WRITE_SECRET_ACCESS_KEY"),
  });
}

async function publish(rawId: string | undefined): Promise<void> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`not a keepsake id\n\n${USAGE}`);
  const { token, manifest, files } = await keepsakeShare(getDb(), id, { speak: spokenAnimalName });
  const paintings = await Promise.all(files.map(async (path) => encodePainting(await readFile(path))));
  const published = await publishShare(store(), manifest, paintings, token);
  for (const file of published) console.log(`${file.key}  ${file.bytes} bytes  sha256 ${file.sha256}  read back`);
  console.log(`\n${SITE_ORIGIN}${sharePagePath(token)}`);
}

async function takedown(args: string[]): Promise<void> {
  const shelter = args[0] === "--shelter" ? args[1] : undefined;
  if (args[0] === "--shelter" && (!shelter || !isValidSlug(shelter))) throw new Error(`not a shelter slug\n\n${USAGE}`);
  if (!shelter && (!args[0] || !isShareToken(args[0]))) throw new Error(`not a share token\n\n${USAGE}`);
  // Checked before any delete: without the media hostname, its cached copies would go unpurged (ADR-0036).
  const publicBase = required("SHARE_BASE_URL");
  if (!publicBase.startsWith("https://")) throw new Error(`SHARE_BASE_URL must be the public https hostname, got ${publicBase}`);
  const objects = store();

  const tokens = shelter ? await shelterShareTokens(getDb(), shelter) : [args[0]];
  if (tokens.length === 0) {
    // A typed slug that matches nothing must never read as a finished withdrawal.
    console.error(`no keepsake rests on '${shelter}': nothing was taken down. Check the slug.`);
    process.exitCode = 2;
    return;
  }
  for (const token of tokens) await deleteShare(objects, token);
  console.log(`deleted ${tokens.length} share${tokens.length === 1 ? "" : "s"}, and every object reads back as absent`);

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const purgeToken = process.env.CLOUDFLARE_PURGE_TOKEN;
  if (!zoneId || !purgeToken) {
    // The delete must never wait on the purge's keys, but it isn't finished until the purge runs.
    console.error("NOT PURGED: Cloudflare may still serve these until it is. Set the two keys and run this again.");
    process.exitCode = 2;
    return;
  }
  let urls = 0;
  for (const token of tokens) {
    const list = purgeUrls(token, SITE_ORIGIN, publicBase);
    await purgeCloudflare({ zoneId, token: purgeToken }, list);
    urls += list.length;
  }
  console.log(`purged ${urls} URLs`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "publish") return publish(args[0]);
  if (command === "takedown") return takedown(args);
  console.error(USAGE);
  process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
