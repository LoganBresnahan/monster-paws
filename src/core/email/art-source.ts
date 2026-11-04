import { readFile } from "node:fs/promises";
import { artFilePath } from "@/core/keepsake";

type Env = Record<string, string | undefined>;

export interface ArtRef {
  shareToken: string | null;
  artKeys: readonly string[];
}

/** One painting's bytes by its place in the keepsake, or a throw, which leaves the painting owed. */
export type ArtReader = (art: ArtRef, index: number) => Promise<Buffer>;

const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const MAX_PAINTING_BYTES = 15 * 1024 * 1024;

/** The dev box: the shared local store, under the art fact's key (doc/plans/demo-chain-contract.md). */
export function storeArtReader(root: string | undefined): ArtReader {
  return (art, index) => readFile(artFilePath(art.artKeys[index], root));
}

/**
 * The droplet: the published copy on the media hostname, by token (ADR-0036 decision 5). Home paints
 * and the droplet mails, so this is how the bytes cross. A taken-down painting reads as absent, so it
 * is never mailed from a stale copy here.
 */
export function mediaArtReader(baseUrl: string, get: typeof fetch = fetch): ArtReader {
  const base = baseUrl.replace(/\/+$/, "");
  return async (art, index) => {
    // Checked before any URL is built, as the share page checks it (ADR-0036 decision 2).
    if (!art.shareToken || !SHARE_TOKEN.test(art.shareToken)) throw new Error("share token has the wrong shape");
    // The manifest goes up last and comes down first (ADR-0036 decisions 10 and 11), so only with it is the
    // mail's "view the paintings" link live: never mail once per set on the images alone.
    if (index === 0) {
      const manifest = await get(`${base}/share/${art.shareToken}/manifest.json`, { signal: AbortSignal.timeout(30_000) });
      // Never left unread: an open body holds its connection until garbage collection, and a stuck set asks every cycle.
      await manifest.body?.cancel();
      if (!manifest.ok) throw new Error(`share page not published: ${manifest.status}`);
    }
    const response = await get(`${base}/share/${art.shareToken}/${index + 1}.jpg`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_PAINTING_BYTES) {
      await response.body?.cancel();
      throw new Error(response.ok ? "painting too large" : `painting not readable: ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PAINTING_BYTES) throw new Error("painting too large");
    return bytes;
  };
}

/** Named by config, never guessed from what happens to be set: a droplet reading a stray store would mail nothing and say little. */
export function artReaderFromEnv(env: Env = process.env): ArtReader {
  if (env.EMAIL_ART_SOURCE === "media") {
    if (!env.SHARE_BASE_URL) throw new Error("EMAIL_ART_SOURCE=media needs SHARE_BASE_URL");
    return mediaArtReader(env.SHARE_BASE_URL);
  }
  if (env.EMAIL_ART_SOURCE === "store") {
    if (!env.ART_STORE_DIR) throw new Error("EMAIL_ART_SOURCE=store needs ART_STORE_DIR");
    return storeArtReader(env.ART_STORE_DIR);
  }
  throw new Error("EMAIL_ART_SOURCE is not set: store or media");
}
