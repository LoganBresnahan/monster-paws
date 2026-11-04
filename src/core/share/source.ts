/**
 * Where a share page's files come from (ADR-0036): a base URL from config, so
 * the source can move without touching a page.
 */

export const SHARE_PAINTING = [1216, 832] as const;
export const PAINTING_NUMBERS = [1, 2, 3, 4] as const;
export type PaintingNumber = (typeof PAINTING_NUMBERS)[number];

export interface ShareManifest {
  name: string;
  /** a listing's breed field as published; absent when it has none, never guessed */
  kind?: string;
  /** the shelter that gave permission, for the card's credit (ADR-0006 decision 5); a crew pet has none */
  shelter?: string;
}

export interface ShareSource {
  /** null when nothing is published under this token */
  manifest(token: string): Promise<ShareManifest | null>;
  painting(token: string, n: PaintingNumber): Promise<ReadableStream<Uint8Array> | null>;
}

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const FIELD_MAX = 120;
const FETCH_TIMEOUT_MS = 10_000;

export function isShareToken(raw: string): boolean {
  return TOKEN.test(raw);
}

export function paintingNumber(raw: string): PaintingNumber | null {
  return PAINTING_NUMBERS.find((n) => String(n) === raw) ?? null;
}

// Never build a key from an unchecked token: it comes straight from a URL (ADR-0036).
function checked(token: string): string {
  if (!isShareToken(token)) throw new Error("not a share token");
  return token;
}

export function manifestKey(token: string): string {
  return `share/${checked(token)}/manifest.json`;
}

export function paintingKey(token: string, n: PaintingNumber): string {
  return `share/${checked(token)}/${n}.jpg`;
}

export function sharePagePath(token: string): string {
  return `/share/${checked(token)}`;
}

export function paintingPagePath(token: string, n: PaintingNumber): string {
  return `/share/${checked(token)}/${n}`;
}

export function paintingImagePath(token: string, n: PaintingNumber): string {
  return `/share/${checked(token)}/${n}/painting.jpg`;
}

function field(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.trim();
  return clean && clean.length <= FIELD_MAX ? clean : undefined;
}

/** Keeps three named fields only: never let another field of a published file reach a page (ADR-0036). */
export function parseManifest(raw: unknown): ShareManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const fields = raw as Record<string, unknown>;
  const name = field(fields.name);
  if (!name) return null;
  const kind = field(fields.kind);
  const shelter = field(fields.shelter);
  return { name, ...(kind ? { kind } : {}), ...(shelter ? { shelter } : {}) };
}

export function createHttpShareSource(baseUrl: string, fetchImpl: typeof fetch = fetch): ShareSource {
  const base = baseUrl.replace(/\/$/, "");

  // Only a 404 means "not published": a 403 is a broken source, and must report rather than look like a takedown.
  async function get(key: string): Promise<Response | null> {
    const res = await fetchImpl(`${base}/${key}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`share GET ${key} failed: ${res.status}`);
    return res;
  }

  return {
    async manifest(token) {
      if (!isShareToken(token)) return null;
      const res = await get(manifestKey(token));
      if (!res) return null;
      const manifest = parseManifest(await res.json());
      if (!manifest) throw new Error(`share manifest malformed: ${manifestKey(token)}`);
      return manifest;
    },
    async painting(token, n) {
      if (!isShareToken(token)) return null;
      const res = await get(paintingKey(token, n));
      return res?.body ?? null;
    },
  };
}

/** null when no source is configured: every share page is then a 404, as nothing is published. */
export function shareSourceFromEnv(env: NodeJS.ProcessEnv = process.env): ShareSource | null {
  return env.SHARE_BASE_URL ? createHttpShareSource(env.SHARE_BASE_URL) : null;
}
