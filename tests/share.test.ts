import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/share/[token]/[n]/painting.jpg/route";
import sharp from "sharp";
import {
  createR2ObjectStore,
  deleteShare,
  encodePainting,
  publishShare,
  purgeCloudflare,
  purgeUrls,
  type ObjectStore,
} from "@/core/share/publish";
import {
  createHttpShareSource,
  isShareToken,
  manifestKey,
  paintingKey,
  paintingNumber,
  parseManifest,
  shareSourceFromEnv,
} from "@/core/share/source";
import { scrubEvent } from "@/core/observability";

const TOKEN = "abcdefghij_klmnopq-rst";
const ENDPOINT = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";

function memoryStore(failReadBack = false) {
  const objects = new Map<string, Uint8Array>();
  const log: string[] = [];
  const store: ObjectStore = {
    async put(key, body) {
      log.push(`put ${key}`);
      objects.set(key, body);
    },
    async get(key) {
      const body = objects.get(key) ?? null;
      return failReadBack && body ? new Uint8Array([0]) : body;
    },
    async delete(key) {
      log.push(`delete ${key}`);
      objects.delete(key);
    },
  };
  return { store, objects, log };
}

async function jpeg(width = 1216, height = 832, withMetadata = false): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 160 } } });
  return (withMetadata ? image.withExif({ IFD0: { Copyright: "workflow text" } }) : image).jpeg().toBuffer();
}

describe("share tokens (ADR-0036)", () => {
  it.each(["", "short", `${TOKEN}x`, "../../etc/passwd00000", "abcdefghij klmnopq-rst", "abcdefghij/klmnopq-rst"])(
    "refuses %j",
    (bad) => {
      expect(isShareToken(bad)).toBe(false);
      expect(() => manifestKey(bad)).toThrow(/not a share token/);
      expect(() => paintingKey(bad, 1)).toThrow(/not a share token/);
    },
  );

  it("takes paintings 1 to 4 only", () => {
    expect(paintingNumber("1")).toBe(1);
    expect(paintingNumber("4")).toBe(4);
    for (const bad of ["0", "5", "01", "1.0", "", "x"]) expect(paintingNumber(bad)).toBeNull();
  });
});

describe("the manifest (ADR-0036)", () => {
  it("keeps the name, kind and shelter, and drops whatever else the file holds", () => {
    expect(
      parseManifest({ name: " Beetle ", kind: "Bloodhound", shelter: "A Shelter", email: "a@b.org", amount: 5, intentId: "x", donorName: "y" }),
    ).toEqual({ name: "Beetle", kind: "Bloodhound", shelter: "A Shelter" });
  });

  it("needs only a name: a listing with no breed has no kind, and a crew pet no shelter", () => {
    expect(parseManifest({ name: "Sparrow" })).toEqual({ name: "Sparrow" });
    expect(parseManifest({ name: "Sparrow", kind: "  ", shelter: 7 })).toEqual({ name: "Sparrow" });
    expect(parseManifest({ name: "Sparrow", kind: "K".repeat(121) })).toEqual({ name: "Sparrow" });
  });

  it.each([[null], ["text"], [{ kind: "Dog" }], [{ name: "", kind: "Dog" }], [{ name: 1, kind: "Dog" }], [{ name: "B".repeat(121), kind: "Dog" }]])(
    "refuses %j",
    (raw) => {
      expect(parseManifest(raw)).toBeNull();
    },
  );
});

describe("the base-URL source (ADR-0036)", () => {
  function sourceAnswering(status: number, body: BodyInit | null = null) {
    const urls: string[] = [];
    const source = createHttpShareSource("https://files.example/", async (input) => {
      urls.push(String(input));
      return new Response(body, { status });
    });
    return { source, urls };
  }

  it("reads share/<token>/manifest.json and returns only the name and kind", async () => {
    const { source, urls } = sourceAnswering(200, JSON.stringify({ name: "Beetle", kind: "Bloodhound", email: "a@b.org" }));
    expect(await source.manifest(TOKEN)).toEqual({ name: "Beetle", kind: "Bloodhound" });
    expect(urls).toEqual([`https://files.example/share/${TOKEN}/manifest.json`]);
  });

  it("reads share/<token>/<n>.jpg", async () => {
    const { source, urls } = sourceAnswering(200, "bytes");
    expect(await source.painting(TOKEN, 3)).not.toBeNull();
    expect(urls).toEqual([`https://files.example/share/${TOKEN}/3.jpg`]);
  });

  it("treats a 404 as not published", async () => {
    const { source } = sourceAnswering(404);
    expect(await source.manifest(TOKEN)).toBeNull();
    expect(await source.painting(TOKEN, 1)).toBeNull();
  });

  it("reports any other failure, rather than looking like a takedown", async () => {
    const { source } = sourceAnswering(403);
    await expect(source.manifest(TOKEN)).rejects.toThrow(/403/);
    await expect(source.painting(TOKEN, 1)).rejects.toThrow(/403/);
  });

  it("reports a malformed manifest", async () => {
    const { source } = sourceAnswering(200, JSON.stringify({ kind: "Dog" }));
    await expect(source.manifest(TOKEN)).rejects.toThrow(/malformed/);
  });

  it("never fetches for a malformed token", async () => {
    const { source, urls } = sourceAnswering(200, "{}");
    expect(await source.manifest("../../secrets0000000000")).toBeNull();
    expect(await source.painting("short", 1)).toBeNull();
    expect(urls).toEqual([]);
  });

  it("has no source until SHARE_BASE_URL is set", () => {
    expect(shareSourceFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(shareSourceFromEnv({ SHARE_BASE_URL: "https://files.example" } as unknown as NodeJS.ProcessEnv)).not.toBeNull();
  });
});

describe("publishing (ADR-0036)", () => {
  it("strips metadata from a painting", async () => {
    const out = await encodePainting(await jpeg(1216, 832, true));
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([1216, 832]);
  });

  it("refuses a painting of any other size", async () => {
    await expect(encodePainting(await jpeg(1024, 1024))).rejects.toThrow(/1216×832/);
  });

  it("writes the paintings, then the manifest last, under the keepsake's own token, with only the named fields in it", async () => {
    const { store, objects, log } = memoryStore();
    const paintings = await Promise.all([1, 2, 3, 4].map(() => jpeg()));
    const hostile = { name: "Beetle", kind: "Bloodhound", email: "a@b.org" } as { name: string; kind: string };
    const files = await publishShare(store, hostile, paintings, TOKEN);
    expect(log.at(-1)).toBe(`put ${manifestKey(TOKEN)}`);
    expect(log.slice(0, 4)).toEqual([1, 2, 3, 4].map((n) => `put share/${TOKEN}/${n}.jpg`));
    expect(JSON.parse(Buffer.from(objects.get(manifestKey(TOKEN))!).toString())).toEqual({ name: "Beetle", kind: "Bloodhound" });
    expect(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(files).toHaveLength(5);
  });

  it("fails on a read-back that doesn't match, before the manifest is written", async () => {
    const { store, log } = memoryStore(true);
    const paintings = await Promise.all([1, 2, 3, 4].map(() => jpeg()));
    await expect(publishShare(store, { name: "Beetle", kind: "Bloodhound" }, paintings, TOKEN)).rejects.toThrow(/read-back/);
    expect(log).toEqual([`put share/${TOKEN}/1.jpg`]);
  });

  it("writes nothing for a manifest with no usable name", async () => {
    const { store, log } = memoryStore();
    const paintings = await Promise.all([1, 2, 3, 4].map(() => jpeg()));
    await expect(publishShare(store, { name: "  " }, paintings, TOKEN)).rejects.toThrow(/no usable name/);
    expect(log).toEqual([]);
  });

  it("refuses anything but four paintings", async () => {
    const { store, log } = memoryStore();
    await expect(publishShare(store, { name: "Beetle", kind: "Bloodhound" }, [await jpeg()], TOKEN)).rejects.toThrow(/4 paintings/);
    expect(log).toEqual([]);
  });
});

describe("the write store (ADR-0036)", () => {
  function recording() {
    const urls: string[] = [];
    const store = createR2ObjectStore(
      { endpoint: `${ENDPOINT}/`, accessKeyId: "id", secretAccessKey: "secret" },
      async (input) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return new Response("ok", { status: 200 });
      },
    );
    return { store, urls };
  }

  it("signs every request for monsterpaws-media, the only bucket it can name", async () => {
    const { store, urls } = recording();
    await store.put(paintingKey(TOKEN, 1), new Uint8Array([1]), "image/jpeg");
    await store.get(manifestKey(TOKEN));
    await store.delete(paintingKey(TOKEN, 1));
    expect(urls).toHaveLength(3);
    for (const url of urls) expect(url.startsWith(`${ENDPOINT}/monsterpaws-media/share/${TOKEN}/`)).toBe(true);
  });

  it.each([
    "html/some-shelter/page.html",
    "photos/1.jpg",
    "../monsterpaws-corpus/share/x",
    "share/../../monsterpaws-corpus/html/x.html",
    `share/${TOKEN}/5.jpg`,
    `share/${TOKEN}/other.txt`,
  ])("refuses the key %s", async (key) => {
    const { store, urls } = recording();
    await expect(store.put(key, new Uint8Array([1]), "text/plain")).rejects.toThrow(/not a share key/);
    await expect(store.delete(key)).rejects.toThrow(/not a share key/);
    expect(urls).toEqual([]);
  });
});

describe("the painting's route (ADR-0036)", () => {
  const ctx = { params: Promise.resolve({ token: TOKEN, n: "2" }) };
  const url = `https://monsterpaws.org/share/${TOKEN}/2/painting.jpg`;

  beforeEach(() => {
    vi.stubEnv("SHARE_BASE_URL", "https://files.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bytes", { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("serves the painting at its one URL, cacheable", async () => {
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage");
  });

  it.each(["?x=1", "?dpl=abc"])("serves %s uncached, since a purge can't name that entry", async (query) => {
    const res = await GET(new Request(`${url}${query}`), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the write endpoint (ADR-0036)", () => {
  const config = (endpoint: string) => ({ endpoint, accessKeyId: "id", secretAccessKey: "secret" });

  it.each([
    [`${ENDPOINT}/monsterpaws-corpus`],
    [`${ENDPOINT}/monsterpaws-corpus/`],
    ["https://monsterpaws-corpus.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"],
    ["http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"],
    [`${ENDPOINT}:8443`],
    [`${ENDPOINT}?bucket=monsterpaws-corpus`],
    [`${ENDPOINT}#monsterpaws-corpus`],
    ["https://user:pass@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"],
    ["https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com.evil.example"],
    ["https://files.example"],
    ["not a url"],
    [""],
  ])("refuses %s, before anything is sent", (endpoint) => {
    expect(() => createR2ObjectStore(config(endpoint), () => {
      throw new Error("sent");
    })).toThrow(/SHARE_WRITE_ENDPOINT must be exactly/);
  });

  it("accepts the bare account host, with or without a trailing slash", () => {
    expect(() => createR2ObjectStore(config(ENDPOINT))).not.toThrow();
    expect(() => createR2ObjectStore(config(`${ENDPOINT}/`))).not.toThrow();
  });
});

describe("taking a share down (ADR-0036)", () => {
  it("deletes the manifest first, then every painting", async () => {
    const { store, objects, log } = memoryStore();
    const paintings = await Promise.all([1, 2, 3, 4].map(() => jpeg()));
    await publishShare(store, { name: "Beetle", kind: "Bloodhound" }, paintings, TOKEN);
    log.length = 0;
    await deleteShare(store, TOKEN);
    expect(log[0]).toBe(`delete ${manifestKey(TOKEN)}`);
    expect(log).toHaveLength(5);
    expect(objects.size).toBe(0);
  });

  it("fails if an object survives its delete", async () => {
    const { store, objects } = memoryStore();
    objects.set(paintingKey(TOKEN, 2), new Uint8Array([1]));
    const stubborn: ObjectStore = { ...store, delete: async () => {} };
    await expect(deleteShare(stubborn, TOKEN)).rejects.toThrow(/still there/);
  });

  it("purges the site's pages and images, and the source's own hostname when it has one", () => {
    const site = purgeUrls(TOKEN, "https://monsterpaws.org");
    expect(site).toHaveLength(13);
    expect(site).toContain(`https://monsterpaws.org/share/${TOKEN}/2/painting.jpg?`);
    expect(site).toContain(`https://monsterpaws.org/share/${TOKEN}/2/painting.jpg`);
    const both = purgeUrls(TOKEN, "https://monsterpaws.org", "https://files.example/");
    expect(both).toHaveLength(18);
    expect(both).toContain(`https://files.example/share/${TOKEN}/manifest.json`);
    expect(both).toContain(`https://files.example/share/${TOKEN}/4.jpg`);
  });

  describe("the Cloudflare purge", () => {
    const config = { zoneId: "zone", token: "t" };
    function answering(statuses: Record<"plain" | "bare", number | Error>) {
      const calls: string[][] = [];
      const impl: typeof fetch = async (input, init) => {
        expect(String(input)).toContain("/zones/zone/purge_cache");
        const { files } = JSON.parse(String(init?.body)) as { files: string[] };
        calls.push(files);
        const status = statuses[files[0].endsWith("?") ? "bare" : "plain"];
        if (status instanceof Error) throw status;
        return new Response("{}", { status });
      };
      return { calls, impl };
    }

    it("sends the plain URLs, then the bare `?` forms in a call of their own", async () => {
      const { calls, impl } = answering({ plain: 200, bare: 200 });
      expect(await purgeCloudflare(config, ["https://a/b", "https://a/b?", "https://a/c"], impl)).toEqual({ purged: 3, refused: 0 });
      expect(calls).toEqual([["https://a/b", "https://a/c"], ["https://a/b?"]]);
    });

    it.each([[403], [new Error("network")]])("still purges the plain URLs when the bare form fails: %s", async (failure) => {
      const { calls, impl } = answering({ plain: 200, bare: failure });
      expect(await purgeCloudflare(config, ["https://a/b", "https://a/b?"], impl)).toEqual({ purged: 1, refused: 1 });
      expect(calls[0]).toEqual(["https://a/b"]);
    });

    it("fails if the plain URLs are refused, and never tries the rest", async () => {
      const { calls, impl } = answering({ plain: 403, bare: 200 });
      await expect(purgeCloudflare(config, ["https://a/b", "https://a/b?"], impl)).rejects.toThrow(/403/);
      expect(calls).toHaveLength(1);
    });

    it("makes one call when there are no bare forms", async () => {
      const { calls, impl } = answering({ plain: 200, bare: 200 });
      expect(await purgeCloudflare(config, ["https://a/b"], impl)).toEqual({ purged: 1, refused: 0 });
      expect(calls).toHaveLength(1);
    });
  });
});

describe("error reports (ADR-0036)", () => {
  it("never carry a share token", () => {
    const event = { request: { url: `https://monsterpaws.org/share/${TOKEN}/2/painting.jpg` }, message: `failed at /share/${TOKEN}` };
    const scrubbed = JSON.stringify(scrubEvent(event));
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).toContain("/share/<secret>/2/painting.jpg");
  });

  it("keep a stack frame's file names, since only the token's shape is scrubbed", () => {
    const stack = "at send (/app/src/core/share/publish.ts:44:12)\n at /usr/share/nodejs/x.js:1:1\n at /share/too-short";
    expect(JSON.stringify(scrubEvent({ stack }))).toBe(JSON.stringify({ stack }));
  });

  // The real messages, which name an object key with no leading slash, so a path-only scrub misses them.
  async function messageOf(failing: () => Promise<unknown>): Promise<string> {
    const err = await failing().then(
      () => {
        throw new Error("expected a failure");
      },
      (e: Error) => e,
    );
    return err.message;
  }

  it("never carry a token from the source's or the store's own failures", async () => {
    const refused = createHttpShareSource("https://files.example", async () => new Response(null, { status: 403 }));
    const malformed = createHttpShareSource("https://files.example", async () => new Response("{}", { status: 200 }));
    const store = createR2ObjectStore(
      { endpoint: ENDPOINT, accessKeyId: "id", secretAccessKey: "secret" },
      async () => new Response(null, { status: 500 }),
    );
    const messages = await Promise.all([
      messageOf(() => refused.manifest(TOKEN)),
      messageOf(() => refused.painting(TOKEN, 2)),
      messageOf(() => malformed.manifest(TOKEN)),
      messageOf(() => store.put(paintingKey(TOKEN, 1), new Uint8Array([1]), "image/jpeg")),
      messageOf(() => store.get(manifestKey(TOKEN))),
      messageOf(() => store.delete(paintingKey(TOKEN, 3))),
    ]);
    for (const message of messages) {
      // Guards the test itself: these must be the messages that name the key.
      expect(message).toContain(TOKEN);
      const scrubbed = JSON.stringify(scrubEvent({ message, exception: { values: [{ value: message }] } }));
      expect(scrubbed).not.toContain(TOKEN);
      expect(scrubbed).toContain("share/<secret>");
    }
  });
});
