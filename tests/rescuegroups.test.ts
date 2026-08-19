import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createRescueGroupsAdapter,
  rescueGroupsNormalizer,
  trackerUrlOf,
  type RescueGroupsAnimal,
} from "@/core/ingest/rescuegroups";
import { createMemoryStages } from "@/core/ingest/memory";
import { runIngest } from "@/core/ingest/pipeline";
import type { Observation } from "@/core/ingest/observation";

/**
 * Golden fixture provenance: a real `POST /v5/public/animals/search/available/`
 * response (limit=2, page=1), recorded 2026-08-17 by Claude and hand-checked
 * against the live API by Logan + Claude in the same session. The per-request
 * `meta.transactionId` was dropped; every record is otherwise verbatim.
 * Expected outputs below were read off this snapshot by hand, not generated
 * from the normalizer — regenerating them from code would make this
 * unfalsifiable.
 */
const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/rescuegroups-available.json", import.meta.url), "utf8"),
);

function fixtureFetch(pages = 1): { calls: string[]; fetchImpl: typeof fetch } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (init?.method !== "POST") throw new Error(`expected POST, got ${init?.method}`);
    return new Response(JSON.stringify({ ...FIXTURE, meta: { ...FIXTURE.meta, pages } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

async function collect(adapter: ReturnType<typeof createRescueGroupsAdapter>) {
  const out: Observation<RescueGroupsAnimal>[] = [];
  for await (const obs of adapter.fetch()) out.push(obs);
  return out;
}

describe("rescuegroups adapter (ADR-0006 decision 2)", () => {
  it("emits one observation per animal, tagged with the aggregator source", async () => {
    const { fetchImpl } = fixtureFetch();
    const observations = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fetchImpl));

    expect(observations).toHaveLength(2);
    expect(observations.map((o) => o.externalId)).toEqual(["10013509", "10059734"]);
    expect(observations.every((o) => o.source === "rescuegroups")).toBe(true);
  });

  it("carries each animal's own included resources, not the shared array", async () => {
    const { fetchImpl } = fixtureFetch();
    const [stowaway] = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fetchImpl));

    const orgs = stowaway.payload.included.filter((r) => r.type === "orgs");
    expect(orgs.map((o) => o.id)).toEqual(["3077"]);
    expect(stowaway.payload.included.some((r) => r.type === "species" && r.id === "3")).toBe(true);
  });

  it("sends the filterless search body the API demands", async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ ...FIXTURE, meta: { pages: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;

    await collect(createRescueGroupsAdapter({ apiKey: "k" }, fetchImpl));
    expect(JSON.parse(bodies[0])).toEqual({ data: { filters: [] } });
  });

  it("pages to the end, and stops early at maxPages", async () => {
    const all = fixtureFetch(3);
    await collect(createRescueGroupsAdapter({ apiKey: "k" }, all.fetchImpl));
    expect(all.calls.map((u) => new URL(u).searchParams.get("page"))).toEqual(["1", "2", "3"]);

    const capped = fixtureFetch(3);
    await collect(createRescueGroupsAdapter({ apiKey: "k", maxPages: 2 }, capped.fetchImpl));
    expect(capped.calls).toHaveLength(2);
  });

  it("throws loudly on an API error rather than yielding a short batch", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;

    await expect(collect(createRescueGroupsAdapter({ apiKey: "k" }, fetchImpl))).rejects.toThrow(
      /503/,
    );
  });

  it("hashes identically across identical fetches, so a re-poll dedups", async () => {
    const a = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    const b = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    expect(a.map((o) => o.contentHash)).toEqual(b.map((o) => o.contentHash));
  });
});

describe("rescuegroups normalizer — thin by design (ADR-0006 decision 4)", () => {
  async function claimsFor(index: number) {
    const observations = await collect(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
    );
    return rescueGroupsNormalizer.normalize({ ...observations[index], rawId: index + 1 });
  }

  it("maps the hand-checked fields of animal 10013509 (Stowaway)", async () => {
    const claims = await claimsFor(0);

    expect(claims.name?.value).toBe("Stowaway");
    expect(claims.species?.value).toBe("cat");
    expect(claims.breed?.value).toBe("Domestic Short Hair");
    expect(claims.status?.value).toBe("available");
    expect(claims.shelterExternalId?.value).toBe("rescuegroups:org:3077");
  });

  it("namespaces the org so it can never be read as a registry slug", async () => {
    const claims = await claimsFor(1);
    expect(claims.shelterExternalId?.value).toBe("rescuegroups:org:27");
  });

  it("never asserts prose or photos, however much the payload carries", async () => {
    const claims = await claimsFor(0);

    expect(claims.photoKeys).toBeUndefined();
    expect(Object.keys(claims).sort()).toEqual([
      "breed",
      "name",
      "shelterExternalId",
      "species",
      "status",
    ]);
    expect(JSON.stringify(claims)).not.toContain("rescuer could no longer keep her");
  });

  it("stamps every claim with the aggregator source, for tiering and for purge", async () => {
    const claims = await claimsFor(0);
    for (const claim of Object.values(claims)) {
      expect(claim?.source).toBe("rescuegroups");
    }
  });

  it("asserts nothing rather than guessing when the status is unmapped", async () => {
    const [obs] = await collect(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
    );
    const statuses = obs.payload.included.find((r) => r.type === "statuses")!;
    statuses.attributes = { name: "Some Status We Have Never Seen" };

    const claims = await rescueGroupsNormalizer.normalize({ ...obs, rawId: 1 });
    expect(claims.status).toBeUndefined();
    expect(claims.name?.value).toBe("Stowaway");
  });

  it("reads the tracker pixel off the payload instead of synthesizing it", async () => {
    const observations = await collect(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
    );

    expect(trackerUrlOf(observations[0].payload)).toBe("https://tracker.rescuegroups.org/pet?10013509");
    // Absent on some records — item 3 must handle null, not assume a URL.
    expect(trackerUrlOf(observations[1].payload)).toBeNull();
  });
});

describe("rescuegroups through the pipeline", () => {
  it("persists, normalizes and emits events with no pipeline changes", async () => {
    const { stages, corpus } = createMemoryStages([rescueGroupsNormalizer]);
    const adapter = createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl);

    const report = await runIngest(adapter, stages);

    expect(report.observed).toBe(2);
    expect(report.persisted).toBe(2);
    expect(report.normalized).toBe(2);
    expect(report.failures).toEqual([]);
    expect(report.events.map((e) => e.kind)).toEqual(["animal.seen", "animal.seen"]);
    expect(corpus.rawRows).toHaveLength(2);
  });

  it("dedups on re-poll: a second identical run appends no raw rows", async () => {
    const { stages, corpus } = createMemoryStages([rescueGroupsNormalizer]);

    await runIngest(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl), stages);
    const second = await runIngest(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
      stages,
    );

    expect(second.deduped).toBe(2);
    expect(second.persisted).toBe(0);
    expect(corpus.rawRows).toHaveLength(2);
  });
});
