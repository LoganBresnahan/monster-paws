import { describe, expect, it } from "vitest";
import {
  createMemoryHtmlVault,
  createR2HtmlVault,
  htmlKey,
  vaultThenObserve,
} from "@/core/ingest/vault";
import { createMemoryStages } from "@/core/ingest/memory";
import { scrapeSource } from "@/core/sources";

const SOURCE = scrapeSource("happy-tails-rescue");
const PAGE = "<html><body><h1>Biscuit</h1></body></html>";

describe("html vault keys (ADR-0011)", () => {
  it("is content-addressed, so re-fetching an unchanged page reuses the key", () => {
    expect(htmlKey("happy-tails-rescue", PAGE)).toBe(htmlKey("happy-tails-rescue", PAGE));
    expect(htmlKey("happy-tails-rescue", PAGE)).not.toBe(
      htmlKey("happy-tails-rescue", `${PAGE}<!-- edited -->`),
    );
  });

  it("shards by shelter so revocation can delete one prefix", () => {
    expect(htmlKey("happy-tails-rescue", PAGE)).toMatch(/^html\/happy-tails-rescue\/[0-9a-f]{64}\.html$/);
    expect(htmlKey("second-chance-spca", PAGE)).toMatch(/^html\/second-chance-spca\//);
  });

  it("rejects a slug that would break the prefix", () => {
    expect(() => htmlKey("Happy Tails", PAGE)).toThrow(/kebab-case/);
    expect(() => htmlKey("scrape:happy-tails", PAGE)).toThrow(/kebab-case/);
  });
});

describe("vaultThenObserve (ADR-0009 ordering invariant)", () => {
  it("vaults the HTML before the observation exists", async () => {
    const vault = createMemoryHtmlVault();
    const obs = await vaultThenObserve(vault, {
      source: SOURCE,
      externalId: "biscuit-42",
      url: "https://happytails.example/pets/biscuit-42",
      html: PAGE,
      fetchedAt: new Date("2026-08-17T12:00:00Z"),
    });

    expect(vault.objects.get(obs.payload.vaultKey)).toBe(PAGE);
    expect(obs.payload.vaultKey).toBe(htmlKey("happy-tails-rescue", PAGE));
  });

  it("stores the key, never the HTML", async () => {
    const vault = createMemoryHtmlVault();
    const obs = await vaultThenObserve(vault, {
      source: SOURCE,
      externalId: "biscuit-42",
      url: "https://happytails.example/pets/biscuit-42",
      html: PAGE,
      fetchedAt: new Date("2026-08-17T12:00:00Z"),
    });

    expect(JSON.stringify(obs.payload)).not.toContain("Biscuit");
    expect(Object.keys(obs.payload).sort()).toEqual(["url", "vaultKey"]);
  });

  it("refuses a non-scrape source rather than guessing a prefix", async () => {
    await expect(
      vaultThenObserve(createMemoryHtmlVault(), {
        source: "rescuegroups",
        externalId: "biscuit-42",
        url: "https://example.org/biscuit",
        html: PAGE,
        fetchedAt: new Date("2026-08-17T12:00:00Z"),
      }),
    ).rejects.toThrow(/scrape source/);
  });

  it("dedups against the corpus when the page is unchanged, and appends when it isn't", async () => {
    const vault = createMemoryHtmlVault();
    const store = createMemoryStages([]).stages.rawStore;
    const observe = (html: string, fetchedAt: string) =>
      vaultThenObserve(vault, {
        source: SOURCE,
        externalId: "biscuit-42",
        url: "https://happytails.example/pets/biscuit-42",
        html,
        fetchedAt: new Date(fetchedAt),
      });

    const first = await store.persist(await observe(PAGE, "2026-08-17T12:00:00Z"));
    const second = await store.persist(await observe(PAGE, "2026-08-18T12:00:00Z"));
    const third = await store.persist(await observe(`${PAGE}<p>adopted</p>`, "2026-08-19T12:00:00Z"));

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(third.inserted).toBe(true);
    expect(vault.objects.size).toBe(2);
  });
});

describe("R2 vault", () => {
  function recordingFetch(responses: Record<string, Response>) {
    const calls: { method: string; url: string }[] = [];
    const fetchImpl = (async (input: Request | string, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const method = req.method;
      calls.push({ method, url: req.url });
      const body = method === "PUT" ? await req.text() : null;
      if (body !== null) responses[`BODY ${req.url}`] = new Response(body);
      const canned = responses[`${method} ${req.url}`];
      if (canned) return canned;
      return new Response(null, { status: method === "PUT" ? 200 : 404 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl, responses };
  }

  const config = {
    accountId: "acct",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "monsterpaws-corpus",
    endpoint: "https://r2.test",
  };

  it("puts to the corpus bucket at the content-addressed key", async () => {
    const { calls, fetchImpl, responses } = recordingFetch({});
    const key = await createR2HtmlVault(config, fetchImpl).put("happy-tails-rescue", PAGE);

    expect(key).toBe(htmlKey("happy-tails-rescue", PAGE));
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "PUT"]);
    expect(calls[1].url).toBe(`https://r2.test/monsterpaws-corpus/${key}`);
    expect(await responses[`BODY https://r2.test/monsterpaws-corpus/${key}`].text()).toBe(PAGE);
  });

  it("skips the write when the bytes are already vaulted", async () => {
    const key = htmlKey("happy-tails-rescue", PAGE);
    const { calls, fetchImpl } = recordingFetch({
      [`HEAD https://r2.test/monsterpaws-corpus/${key}`]: new Response(null, { status: 200 }),
    });

    await createR2HtmlVault(config, fetchImpl).put("happy-tails-rescue", PAGE);
    expect(calls.map((c) => c.method)).toEqual(["HEAD"]);
  });

  it("throws on a failed read rather than returning empty HTML", async () => {
    const { fetchImpl } = recordingFetch({});
    await expect(createR2HtmlVault(config, fetchImpl).get("html/x/y.html")).rejects.toThrow(/404/);
  });
});
