import { describe, expect, it } from "vitest";
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
      { endpoint: "https://account.r2.example/", accessKeyId: "id", secretAccessKey: "secret" },
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
    for (const url of urls) expect(url.startsWith(`https://account.r2.example/monsterpaws-media/share/${TOKEN}/`)).toBe(true);
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
    expect(site).toHaveLength(9);
    expect(site).toContain(`https://monsterpaws.org/share/${TOKEN}/2/painting.jpg`);
    const both = purgeUrls(TOKEN, "https://monsterpaws.org", "https://files.example/");
    expect(both).toHaveLength(14);
    expect(both).toContain(`https://files.example/share/${TOKEN}/manifest.json`);
    expect(both).toContain(`https://files.example/share/${TOKEN}/4.jpg`);
  });

  it("sends Cloudflare the URLs, and fails on a refusal", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const answer = (status: number): typeof fetch => async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response("{}", { status });
    };
    await purgeCloudflare({ zoneId: "zone", token: "t" }, ["https://a/b"], answer(200));
    expect(calls[0].url).toContain("/zones/zone/purge_cache");
    expect(JSON.parse(calls[0].body)).toEqual({ files: ["https://a/b"] });
    await expect(purgeCloudflare({ zoneId: "zone", token: "t" }, ["https://a/b"], answer(403))).rejects.toThrow(/403/);
  });
});

describe("error reports (ADR-0036)", () => {
  it("never carry a share token", () => {
    const event = { request: { url: `https://monsterpaws.org/share/${TOKEN}/2/painting.jpg` }, message: `failed at /share/${TOKEN}` };
    const scrubbed = JSON.stringify(scrubEvent(event));
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).toContain("/share/<secret>/2/painting.jpg");
  });
});
