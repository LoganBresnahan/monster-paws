import { createHash, randomBytes } from "node:crypto";
import { AwsClient } from "aws4fetch";
import sharp from "sharp";
import {
  manifestKey,
  paintingImagePath,
  paintingKey,
  paintingPagePath,
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

const SHARE_KEY = /^share\/[A-Za-z0-9_-]{22}\/(manifest\.json|[1-4]\.jpg)$/;

export interface R2StoreConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createR2ObjectStore(config: R2StoreConfig, fetchImpl: typeof fetch = fetch): ObjectStore {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = `${config.endpoint.replace(/\/$/, "")}/${SHARE_BUCKET}`;
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

/** 128 bits, and never the intent id or the `/thanks` token (ADR-0036). */
export function newShareToken(): string {
  return randomBytes(16).toString("base64url");
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
 * The manifest goes last and never first: its presence is what makes the page
 * exist, so a failed upload leaves no page with a missing painting (ADR-0036).
 */
export async function publishShare(
  store: ObjectStore,
  manifest: ShareManifest,
  paintings: readonly Buffer[],
  token: string = newShareToken(),
): Promise<{ token: string; files: PublishedFile[] }> {
  if (paintings.length !== PAINTING_NUMBERS.length) {
    throw new Error(`a keepsake is ${PAINTING_NUMBERS.length} paintings, got ${paintings.length}`);
  }
  const files: PublishedFile[] = [];
  for (const n of PAINTING_NUMBERS) {
    files.push(await putAndReadBack(store, paintingKey(token, n), paintings[n - 1], "image/jpeg"));
  }
  const body = Buffer.from(JSON.stringify({ name: manifest.name, kind: manifest.kind }));
  files.push(await putAndReadBack(store, manifestKey(token), body, "application/json"));
  return { token, files };
}

/** Every URL a takedown must purge; `publicBase` is the source's own hostname when it has one (ADR-0036). */
export function purgeUrls(token: string, siteOrigin: string, publicBase?: string): string[] {
  const site = [
    sharePagePath(token),
    ...PAINTING_NUMBERS.flatMap((n: PaintingNumber) => [paintingPagePath(token, n), paintingImagePath(token, n)]),
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

export async function purgeCloudflare(
  config: { zoneId: string; token: string },
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify({ files: urls }),
  });
  if (!res.ok) throw new Error(`Cloudflare purge failed: ${res.status}`);
}
