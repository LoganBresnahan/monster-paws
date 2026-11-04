import { readFile } from "node:fs/promises";
import {
  createR2ObjectStore,
  SHARE_BUCKET,
  deleteShare,
  encodePainting,
  publishShare,
  purgeCloudflare,
  purgeUrls,
} from "@/core/share/publish";
import { isShareToken, sharePagePath } from "@/core/share/source";
import { crewPet } from "@/ui/crew";
import { SITE_ORIGIN } from "@/ui/site";

const USAGE = `npm run share -- publish <crew-slug> <painting1> <painting2> <painting3> <painting4>
npm run share -- takedown <token>

Writes only to ${SHARE_BUCKET}. Needs SHARE_WRITE_ENDPOINT, SHARE_WRITE_ACCESS_KEY_ID and
SHARE_WRITE_SECRET_ACCESS_KEY; takedown also needs SHARE_BASE_URL, CLOUDFLARE_ZONE_ID and
CLOUDFLARE_PURGE_TOKEN (ADR-0036).`;

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

async function publish(slug: string | undefined, paths: string[]): Promise<void> {
  // Crew only, from our own table: never free text, so nothing about a donor can reach a file (ADR-0036).
  const pet = slug ? crewPet(slug) : null;
  if (!pet) throw new Error(`'${slug}' is not one of the crew: share pages are crew only for now (ADR-0036)`);
  const paintings = await Promise.all(paths.map(async (path) => encodePainting(await readFile(path))));
  const { token, files } = await publishShare(store(), { name: pet.name, kind: pet.kind }, paintings);
  for (const file of files) console.log(`${file.key}  ${file.bytes} bytes  sha256 ${file.sha256}  read back`);
  console.log(`\n${SITE_ORIGIN}${sharePagePath(token)}`);
}

async function takedown(token: string | undefined): Promise<void> {
  if (!token || !isShareToken(token)) throw new Error(`not a share token\n\n${USAGE}`);
  // Checked before the delete: without the media hostname, its cached copies would go unpurged (ADR-0036).
  const publicBase = required("SHARE_BASE_URL");
  if (!publicBase.startsWith("https://")) throw new Error(`SHARE_BASE_URL must be the public https hostname, got ${publicBase}`);
  await deleteShare(store(), token);
  console.log("deleted, and every object reads back as absent");
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const purgeToken = process.env.CLOUDFLARE_PURGE_TOKEN;
  if (!zoneId || !purgeToken) {
    // The delete must never wait on the purge's keys, but it isn't finished until the purge runs.
    console.error("NOT PURGED: Cloudflare may still serve these until it is. Set the two keys and run this again.");
    process.exitCode = 2;
    return;
  }
  const urls = purgeUrls(token, SITE_ORIGIN, publicBase);
  await purgeCloudflare({ zoneId, token: purgeToken }, urls);
  console.log(`purged ${urls.length} URLs`);
}

async function main(): Promise<void> {
  const [command, first, ...rest] = process.argv.slice(2);
  if (command === "publish") return publish(first, rest);
  if (command === "takedown") return takedown(first);
  console.error(USAGE);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
