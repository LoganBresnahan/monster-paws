import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { contentHashOf } from "@/core/ingest/hash";
import type { Observation } from "@/core/ingest/observation";
import { isValidSlug, shelterSlugOf, type Source } from "@/core/sources";

/**
 * What a scraped page stores on the raw row: the vault key, never the HTML
 * (keys-not-blobs, ADR-0003). The key embeds the page's own hash, so the
 * row's content_hash changes exactly when the page does and dedup keeps
 * working without ever reading R2 (ADR-0011).
 */
export interface ScrapedPage {
  url: string;
  vaultKey: string;
}

export interface HtmlVault {
  /** returns the content-addressed key the HTML now lives at */
  put(slug: string, html: string): Promise<string>;
  get(key: string): Promise<string>;
}

function sha256Hex(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

/**
 * Content-addressed: an unchanged page re-fetched daily produces the same key,
 * so the vault self-dedups and a put is always safe to repeat. Sharded by
 * shelter slug because consent revocation deletes a prefix (ADR-0006 as
 * amended) — never flatten this to one namespace.
 */
export function htmlKey(slug: string, html: string): string {
  if (!isValidSlug(slug)) {
    throw new Error(`invalid shelter slug '${slug}': expected lowercase kebab-case`);
  }
  return `html/${slug}/${sha256Hex(html)}.html`;
}

export interface R2VaultConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** the corpus bucket — never the vault or media bucket (ADR-0011) */
  bucket: string;
  /** override for tests; defaults to the account's S3 endpoint */
  endpoint?: string;
}

export function createR2HtmlVault(
  config: R2VaultConfig,
  fetchImpl: typeof fetch = fetch,
): HtmlVault {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = (
    config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`
  ).replace(/\/$/, "");
  const urlFor = (key: string) => `${base}/${config.bucket}/${key}`;

  // `client.fetch` has no injection seam, so sign and dispatch separately —
  // the vault must be exercisable without a network or real credentials.
  async function send(key: string, init: RequestInit): Promise<Response> {
    return fetchImpl(await client.sign(urlFor(key), init));
  }

  return {
    async put(slug, html) {
      const key = htmlKey(slug, html);

      // HEAD-then-PUT, not blind PUT: the key is the content hash, so a hit
      // means the identical bytes are already there and the write is pure
      // cost — a daily re-poll of a quiet shelter would otherwise rewrite
      // every page every day.
      const head = await send(key, { method: "HEAD" });
      if (head.ok) return key;
      if (head.status !== 404) {
        throw new Error(`vault HEAD ${key} failed: ${head.status} ${head.statusText}`);
      }

      const put = await send(key, {
        method: "PUT",
        body: html,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      if (!put.ok) throw new Error(`vault PUT ${key} failed: ${put.status} ${put.statusText}`);
      return key;
    },

    async get(key) {
      const res = await send(key, { method: "GET" });
      if (!res.ok) throw new Error(`vault GET ${key} failed: ${res.status} ${res.statusText}`);
      return res.text();
    },
  };
}

/** The reference vault for tests — same contract, no network (mirrors `memory.ts`). */
export function createMemoryHtmlVault(store = new Map<string, string>()): HtmlVault & {
  objects: Map<string, string>;
} {
  return {
    objects: store,
    async put(slug, html) {
      const key = htmlKey(slug, html);
      store.set(key, html);
      return key;
    },
    async get(key) {
      const html = store.get(key);
      if (html === undefined) throw new Error(`vault GET ${key} failed: 404 Not Found`);
      return html;
    },
  };
}

export interface ScrapeInput {
  source: Source;
  externalId: string;
  url: string;
  html: string;
  fetchedAt: Date;
}

/**
 * The ordering invariant made unskippable (ADR-0009): fetch → vault → hash →
 * raw row. Never build a scrape observation by hand — HTML that reaches the
 * corpus without reaching R2 first leaves a raw row pointing at a key that
 * was never written, and replay stops being able to repair anything.
 */
export async function vaultThenObserve(
  vault: HtmlVault,
  input: ScrapeInput,
): Promise<Observation<ScrapedPage>> {
  const slug = shelterSlugOf(input.source);
  if (slug === null) {
    throw new Error(`vaultThenObserve requires a scrape source, got '${input.source}'`);
  }

  const payload: ScrapedPage = { url: input.url, vaultKey: await vault.put(slug, input.html) };

  return {
    source: input.source,
    externalId: input.externalId,
    payload,
    fetchedAt: input.fetchedAt,
    contentHash: contentHashOf(payload),
  };
}
