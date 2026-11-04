import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import sharp from "sharp";
import {
  manifestKey,
  paintingImagePath,
  paintingKey,
  paintingPagePath,
  parseManifest,
  PAINTING_NUMBERS,
  SHARE_PAINTING,
  sharePagePath,
  type PaintingNumber,
  type ShareManifest,
} from "./source";

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * A constant, never config: the pair that publishes can also write the corpus,
 * so this tool must be unable to name any other bucket (ADR-0036).
 */
export const SHARE_BUCKET = "monsterpaws-media";

const ACCOUNT_HOST = /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/;
const SHARE_KEY = /^share\/[A-Za-z0-9_-]{22}\/(manifest\.json|[1-4]\.jpg)$/;

export interface R2StoreConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * The bare account host, https, or nothing: a path or a bucket subdomain here would name another
 * bucket whatever `SHARE_BUCKET` says, and this pair can reach the corpus (ADR-0036).
 */
function accountOrigin(endpoint: string): string {
  const url = URL.canParse(endpoint) ? new URL(endpoint) : null;
  const bare = url && url.protocol === "https:" && ACCOUNT_HOST.test(url.hostname) && !url.port;
  if (!bare || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("SHARE_WRITE_ENDPOINT must be exactly https://<account-id>.r2.cloudflarestorage.com");
  }
  return url.origin;
}

export function createR2ObjectStore(config: R2StoreConfig, fetchImpl: typeof fetch = fetch): ObjectStore {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = `${accountOrigin(config.endpoint)}/${SHARE_BUCKET}`;
  const send = async (key: string, init: RequestInit) => {
    // Exact keys, never a prefix check: `share/../..` would normalize into another bucket (ADR-0036).
    if (!SHARE_KEY.test(key)) throw new Error(`not a share key: ${key}`);
    return fetchImpl(await client.sign(`${base}/${key}`, init));
  };

  return {
    async put(key, body, contentType) {
      const res = await send(key, { method: "PUT", body: Buffer.from(body), headers: { "content-type": contentType } });
      if (!res.ok) throw new Error(`share PUT ${key} failed: ${res.status}`);
    },
    async get(key) {
      const res = await send(key, { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`share GET ${key} failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send(key, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`share DELETE ${key} failed: ${res.status}`);
    },
  };
}

/** Re-encoded from pixels alone: ComfyUI writes its whole workflow into a painting's file (ADR-0036). */
export async function encodePainting(file: string | Buffer): Promise<Buffer> {
  const { data, info } = await sharp(file)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, progressive: true, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  if (info.width !== SHARE_PAINTING[0] || info.height !== SHARE_PAINTING[1]) {
    throw new Error(`a painting must be ${SHARE_PAINTING.join("×")}, got ${info.width}×${info.height}`);
  }
  const meta = await sharp(data).metadata();
  if (meta.exif || meta.icc || meta.xmp || meta.iptc) throw new Error("metadata survived the re-encode");
  return data;
}

export interface PublishedFile {
  key: string;
  bytes: number;
  sha256: string;
}

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

async function putAndReadBack(store: ObjectStore, key: string, body: Uint8Array, contentType: string): Promise<PublishedFile> {
  await store.put(key, body, contentType);
  const stored = await store.get(key);
  const hash = sha256(body);
  if (!stored || sha256(stored) !== hash) throw new Error(`read-back of ${key} did not match what was written`);
  return { key, bytes: body.length, sha256: hash };
}

/**
 * The token is the keepsake's own, never minted here. The manifest goes last and
 * never first: its presence is what makes the page exist, so a failed upload leaves
 * no page with a missing painting (ADR-0036).
 */
export async function publishShare(
  store: ObjectStore,
  manifest: ShareManifest,
  paintings: readonly Buffer[],
  token: string,
): Promise<PublishedFile[]> {
  if (paintings.length !== PAINTING_NUMBERS.length) {
    throw new Error(`a keepsake is ${PAINTING_NUMBERS.length} paintings, got ${paintings.length}`);
  }
  const clean = parseManifest(manifest);
  if (!clean) throw new Error("the manifest has no usable name");
  const files: PublishedFile[] = [];
  for (const n of PAINTING_NUMBERS) {
    files.push(await putAndReadBack(store, paintingKey(token, n), paintings[n - 1], "image/jpeg"));
  }
  files.push(await putAndReadBack(store, manifestKey(token), Buffer.from(JSON.stringify(clean)), "application/json"));
  return files;
}

/** Every URL a takedown must purge; `publicBase` is the source's own hostname when it has one (ADR-0036). */
export function purgeUrls(token: string, siteOrigin: string, publicBase?: string): string[] {
  const site = [
    sharePagePath(token),
    // The bare `?` too: Cloudflare caches it as its own entry, and Next hides it from the image route (ADR-0036).
    ...PAINTING_NUMBERS.flatMap((n: PaintingNumber) => [
      paintingPagePath(token, n),
      paintingImagePath(token, n),
      `${paintingImagePath(token, n)}?`,
    ]),
  ].map((path) => `${siteOrigin}${path}`);
  if (!publicBase) return site;
  const base = publicBase.replace(/\/$/, "");
  return [
    ...site,
    `${base}/${manifestKey(token)}`,
    ...PAINTING_NUMBERS.map((n: PaintingNumber) => `${base}/${paintingKey(token, n)}`),
  ];
}

/**
 * Deletes the manifest first, so the page is gone before anything else is, and
 * returns only once every object reads back as absent (ADR-0036).
 */
export async function deleteShare(store: ObjectStore, token: string): Promise<void> {
  const keys = [manifestKey(token), ...PAINTING_NUMBERS.map((n) => paintingKey(token, n))];
  for (const key of keys) await store.delete(key);
  for (const key of keys) {
    if (await store.get(key)) throw new Error(`${key} is still there after its delete`);
  }
}

export interface PurgeReport {
  purged: number;
  /** bare-`?` URLs Cloudflare refused: those copies age out within a day (ADR-0036) */
  refused: number;
}

/**
 * The bare `?` forms go in their own call and never with the rest: whether Cloudflare's purge takes that
 * form is unmeasured, and a refusal must not leave the plain URLs unpurged (ADR-0036).
 */
export async function purgeCloudflare(
  config: { zoneId: string; token: string },
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<PurgeReport> {
  const send = (files: string[]) =>
    fetchImpl(`https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ files }),
    });
  const bare = urls.filter((url) => url.endsWith("?"));
  const plain = urls.filter((url) => !url.endsWith("?"));

  const res = await send(plain);
  if (!res.ok) throw new Error(`Cloudflare purge failed: ${res.status}`);
  if (bare.length === 0) return { purged: plain.length, refused: 0 };

  const second = await send(bare).catch(() => null);
  return second?.ok ? { purged: urls.length, refused: 0 } : { purged: plain.length, refused: bare.length };
}
