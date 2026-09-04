import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createRescueGroupsAdapter,
  rescueGroupsNormalizer,
  trackerUrlOf,
  type RescueGroupsAnimal,
} from "@/core/ingest/rescuegroups";
import { createMemoryStages } from "@/core/ingest/memory";
import { replay, runIngest } from "@/core/ingest/pipeline";
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
    // The fixture's meta is nationwide (count 64653); a test feed of `pages`
    // pages of 2 must promise what it delivers or the adapter (rightly)
    // declares the run truncated (ADR-0014).
    const meta = { ...FIXTURE.meta, pages, count: pages * FIXTURE.data.length };
    return new Response(JSON.stringify({ ...FIXTURE, meta }), {
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

  it("hashes identically when the API shuffles the included array", async () => {
    const shuffled = { ...FIXTURE, included: [...FIXTURE.included].reverse() };
    const shuffledFetch = (async () =>
      new Response(JSON.stringify({ ...shuffled, meta: { pages: 1 } }), {
        status: 200,
      })) as unknown as typeof fetch;

    const ordered = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    const reversed = await collect(createRescueGroupsAdapter({ apiKey: "k" }, shuffledFetch));

    // Their sidecar order is not information — treating it as information
    // appends a duplicate corpus row on ~20% of every real re-poll.
    expect(reversed.map((o) => o.contentHash)).toEqual(ordered.map((o) => o.contentHash));
  });

  it("hashes identically across identical fetches, so a re-poll dedups", async () => {
    const a = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    const b = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    expect(a.map((o) => o.contentHash)).toEqual(b.map((o) => o.contentHash));
  });
});

describe("rescuegroups adapter — completeness is verified, never assumed (ADR-0014)", () => {
  function pagedFetch(bodies: unknown[]): typeof fetch {
    let i = 0;
    return (async () =>
      new Response(JSON.stringify(bodies[i++]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }
  const page = (over: Record<string, unknown>) => ({ ...FIXTURE, ...over });

  it("throws on a 200 without data or meta instead of ending the run quietly", async () => {
    const adapter = createRescueGroupsAdapter(
      { apiKey: "k" },
      pagedFetch([page({ meta: { pages: 3, count: 6 } }), { errors: [{ title: "rate limited" }] }]),
    );

    await expect(collect(adapter)).rejects.toThrow(/malformed/);
  });

  it("takes page count and record count from page 1 — a later page cannot shrink the run", async () => {
    const adapter = createRescueGroupsAdapter(
      { apiKey: "k" },
      pagedFetch([
        page({ meta: { pages: 3, count: 6 } }),
        page({ meta: { pages: 1, count: 2 } }),
        page({ meta: { pages: 1, count: 2 } }),
      ]),
    );

    expect(await collect(adapter)).toHaveLength(6);
  });

  it("throws when the run delivers materially fewer records than page 1 promised", async () => {
    const adapter = createRescueGroupsAdapter(
      { apiKey: "k" },
      pagedFetch([page({ meta: { pages: 2, count: 400 } }), page({ meta: { pages: 2, count: 400 } })]),
    );

    await expect(collect(adapter)).rejects.toThrow(/incomplete/);
  });

  it("tolerates live drift within 1% — an adoption mid-run is not a truncated run", async () => {
    const adapter = createRescueGroupsAdapter(
      { apiKey: "k", pageLimit: 2 },
      pagedFetch([page({ meta: { pages: 100, count: 201 } }), ...Array(99).fill(page({ meta: {} }))]),
    );

    expect(await collect(adapter)).toHaveLength(200);
  });

  it("does not apply the count check to a page-capped run, which is partial by construction", async () => {
    const adapter = createRescueGroupsAdapter(
      { apiKey: "k", maxPages: 1 },
      pagedFetch([page({ meta: { pages: 50, count: 100 } })]),
    );

    expect(await collect(adapter)).toHaveLength(2);
  });
});

describe("rescuegroups normalizer — thin by design (ADR-0006 decision 4)", () => {
  async function observationFor(index: number) {
    const observations = await collect(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
    );
    return { ...observations[index], rawId: index + 1 };
  }

  /** The org resource carries the address the location claims come from. */
  function orgAttributesOf(obs: { payload: { included: { type: string; attributes: Record<string, unknown> }[] } }) {
    return obs.payload.included.find((r) => r.type === "orgs")!.attributes;
  }

  async function normalizeFixture(index: number) {
    return rescueGroupsNormalizer.normalize(await observationFor(index));
  }

  async function claimsFor(index: number) {
    return (await normalizeFixture(index)).claims;
  }

  it("maps the hand-checked fields of animal 10013509 (Stowaway)", async () => {
    const claims = await claimsFor(0);

    expect(claims.name?.value).toBe("Stowaway");
    expect(claims.species?.value).toBe("cat");
    expect(claims.breed?.value).toBe("Domestic Short Hair");
    expect(claims.status?.value).toBe("available");
    expect(claims.shelterExternalId?.value).toBe("rescuegroups:org:3077");
    expect(claims.sex?.value).toBe("Female");
    expect(claims.ageGroup?.value).toBe("Adult");
    expect(claims.birthDate?.value).toEqual(new Date("2010-04-24T00:00:00Z"));
    expect(claims.isBirthDateExact?.value).toBe(false);
  });

  it("namespaces the org so it can never be read as a registry slug", async () => {
    const claims = await claimsFor(1);
    expect(claims.shelterExternalId?.value).toBe("rescuegroups:org:27");
  });

  // Superseded by ADR-0015: the description and photo URLs ARE promoted now
  // (ADR-0006 as amended 2026-08-25), as `display`. What this test still
  // guards is the line that did not move — they are never CLAIMS, so they
  // cannot compete in `resolveClaim` or take provenance as facts.
  it("never asserts prose or photos as claims, however much the payload carries", async () => {
    const claims = await claimsFor(0);

    expect(claims.photoKeys).toBeUndefined();
    expect(Object.keys(claims).sort()).toEqual([
      "ageGroup",
      "birthDate",
      "breed",
      "city",
      "isBirthDateExact",
      "listedAt",
      "name",
      "orgName",
      "postalCode",
      "sex",
      "shelterExternalId",
      "species",
      "state",
      "status",
    ]);
    expect(JSON.stringify(claims)).not.toContain("rescuer could no longer keep her");
    expect(JSON.stringify(claims)).not.toContain("cdn.rescuegroups.org");
  });

  // The two dates the browse sort and the upkeep bound rest on. They are read
  // off the same payload but land in different places on purpose: one is a
  // fact that merges, the other is the source's own housekeeping.
  it("promotes createdDate as the listedAt claim, and updatedDate as upkeep that never merges", async () => {
    const normalized = await normalizeFixture(0);

    expect(normalized.claims.listedAt?.value).toEqual(new Date("2016-05-17T21:17:53Z"));
    expect(normalized.sourceUpdatedAt).toEqual(new Date("2018-04-22T17:49:32Z"));
    // Upkeep is not a fact about the animal: routed through `claims` it would
    // compete in `resolveClaim` and take provenance as if a shelter's edit
    // history were the animal's (ADR-0015 as amended).
    expect(Object.keys(normalized.claims)).not.toContain("sourceUpdatedAt");
  });

  it("asserts neither date when the payload's is unparseable, rather than an Invalid Date", async () => {
    const obs = await observationFor(0);
    obs.payload.animal.attributes.createdDate = "not a date";
    obs.payload.animal.attributes.updatedDate = "";
    const normalized = await rescueGroupsNormalizer.normalize(obs);

    // `new Date("not a date")` is NaN, and every NaN comparison is false — an
    // unparseable stamp stored raw would slip PAST the upkeep window instead of
    // failing it, which is the bug the `isActive` verify pass found.
    expect(normalized.claims.listedAt).toBeUndefined();
    expect(normalized.sourceUpdatedAt).toBeNull();
  });

  // Measured on the 64k corpus 2026-09-04: orgs type their own state, so the
  // raw feed carries TX/Tx/tx as three values and a `state = 'OH'` filter found
  // 1,207 of 1,618 Ohio animals. Browse filters by equality against an index,
  // so this has to be right at promotion, not at query time.
  it("canonicalises the state's case, so one state is one value", async () => {
    for (const [raw, expected] of [
      ["Tx", "TX"],
      ["tx", "TX"],
      [" tx ", "TX"],
      ["TX", "TX"],
    ] as const) {
      const obs = await observationFor(0);
      orgAttributesOf(obs).state = raw;
      const { claims } = await rescueGroupsNormalizer.normalize(obs);
      expect(claims.state?.value, `${JSON.stringify(raw)} should promote as ${expected}`).toBe(
        expected,
      );
    }
  });

  it("asserts no state at all when the value is not a two-letter code", async () => {
    // One org files 27 animals under `T`. A junk state is worse than a missing
    // one: it survives into the filter list as an option nobody can use.
    for (const junk of ["T", "Texas", "", "  ", "T3"]) {
      const obs = await observationFor(0);
      orgAttributesOf(obs).state = junk;
      const { claims } = await rescueGroupsNormalizer.normalize(obs);
      expect(claims.state, `${JSON.stringify(junk)} should assert nothing`).toBeUndefined();
    }
  });

  it("promotes the org address as facts, so browse can filter by state (ADR-0015)", async () => {
    const stowaway = await claimsFor(0);
    expect(stowaway.orgName?.value).toBe("Angel Pets Animal Welfare Society, Inc");
    expect(stowaway.city?.value).toBe("Colonia");
    expect(stowaway.state?.value).toBe("NJ");
    expect(stowaway.postalCode?.value).toBe("07067");

    // Animal 10059734's `locations` resource carries a city too — reading
    // location instead of orgs would disagree with the org on other records
    // and silently split the same shelter across two cities.
    const bettis = await claimsFor(1);
    expect(bettis.orgName?.value).toBe("Olive Branch Animal Rescue & Refuge, Inc.");
    expect(bettis.city?.value).toBe("Sistersville");
    expect(bettis.state?.value).toBe("WV");
    expect(bettis.postalCode?.value).toBe("26175");
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

    const { claims } = await rescueGroupsNormalizer.normalize({ ...obs, rawId: 1 });
    expect(claims.status).toBeUndefined();
    expect(claims.name?.value).toBe("Stowaway");
  });

  it("never asserts birth-date exactness without the date it qualifies", async () => {
    const [obs] = await collect(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
    );
    obs.payload.animal.attributes = {
      ...obs.payload.animal.attributes,
      birthDate: null,
      isBirthDateExact: true,
    };

    const { claims } = await rescueGroupsNormalizer.normalize({ ...obs, rawId: 1 });
    expect(claims.birthDate).toBeUndefined();
    expect(claims.isBirthDateExact).toBeUndefined();
  });

  it("omits ageGroup when the source leaves it blank, rather than inventing one", async () => {
    const observations = await collect(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
    );
    const { claims: bettis } = await rescueGroupsNormalizer.normalize({
      ...observations[1],
      rawId: 2,
    });

    expect(bettis.ageGroup).toBeUndefined();
    expect(bettis.sex?.value).toBe("Male");
    expect(bettis.birthDate?.value).toEqual(new Date("2016-05-09T00:00:00Z"));
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

describe("rescuegroups display promotion (ADR-0015, ADR-0006 as amended 2026-08-25)", () => {
  async function displayFor(index: number) {
    const observations = await collect(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
    );
    return rescueGroupsNormalizer.normalize({ ...observations[index], rawId: index + 1 });
  }

  it("promotes animal 10013509's description verbatim, entities and all", async () => {
    const { display } = await displayFor(0);

    // Hand-read off the fixture: `&nbsp;` is theirs, and the normalizer may
    // drop a description but never edit one — un-escaping here would make the
    // quotation on the page no longer the shelter's words.
    expect(display?.description).toBe(
      "Stowaway is a black female adult cat.&nbsp; Her rescuer could no longer keep her.&nbsp;\n\nRETURNED 2/3/18 - They called her Zoey",
    );
    expect(display?.listingOrg).toBe("Angel Pets Animal Welfare Society, Inc");
    expect(display?.trackerUrl).toBe("https://tracker.rescuegroups.org/pet?10013509");
  });

  it("takes the 500px URLs RescueGroups publishes, in their `order`, never a synthesized one", async () => {
    const { display } = await displayFor(0);

    // Picture ids 35712496/35712498/56438918 carry order 1/2/3; the sidecar is
    // sorted by id for hash stability, so array position is not their order.
    expect(display?.photoUrls).toEqual([
      "https://cdn.rescuegroups.org/3077/pictures/animals/10013/10013509/35712496.jpg?width=500",
      "https://cdn.rescuegroups.org/3077/pictures/animals/10013/10013509/35712498.jpg?width=500",
      "https://cdn.rescuegroups.org/3077/pictures/animals/10013/10013509/56438918.jpg?width=500",
    ]);
  });

  it("orders by `order`, not by the sidecar's id sort", async () => {
    const [obs] = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    const pictures = obs.payload.included.filter((r) => r.type === "pictures");
    // Reverse their order attribute without moving them in the array.
    pictures.forEach((p, i) => (p.attributes.order = pictures.length - i));

    const { display } = await rescueGroupsNormalizer.normalize({ ...obs, rawId: 1 });
    expect(display?.photoUrls.map((u) => u.split("/").pop())).toEqual([
      "56438918.jpg?width=500",
      "35712498.jpg?width=500",
      "35712496.jpg?width=500",
    ]);
  });

  it("falls back to the original URL rather than dropping a photo with no 500px variant", async () => {
    const [obs] = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    const first = obs.payload.included.find((r) => r.type === "pictures")!;
    delete first.attributes.large;

    const { display } = await rescueGroupsNormalizer.normalize({ ...obs, rawId: 1 });
    expect(display?.photoUrls[0]).toBe(
      "https://cdn.rescuegroups.org/3077/pictures/animals/10013/10013509/35712496.jpg",
    );
  });

  it("carries the observation's fetchedAt, so replay rebuilds the same row", async () => {
    const [obs] = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    const { display } = await rescueGroupsNormalizer.normalize({ ...obs, rawId: 1 });

    expect(display?.fetchedAt).toEqual(obs.fetchedAt);
  });

  it("promotes an empty display rather than none, so deleted prose clears the row", async () => {
    const [obs] = await collect(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl));
    obs.payload.animal.attributes = {
      ...obs.payload.animal.attributes,
      descriptionText: null,
      trackerimageUrl: null,
    };
    obs.payload.included = obs.payload.included.filter((r) => r.type !== "pictures");

    const { display } = await rescueGroupsNormalizer.normalize({ ...obs, rawId: 1 });
    // Omitting `display` here would leave yesterday's description standing on
    // the page forever — the upsert can only clear what it is handed.
    expect(display).toEqual({
      description: null,
      photoUrls: [],
      listingOrg: "Angel Pets Animal Welfare Society, Inc",
      trackerUrl: null,
      fetchedAt: obs.fetchedAt,
    });
  });

  it("handles animal 10059734, whose tracker URL the API omits", async () => {
    const { display } = await displayFor(1);

    expect(display?.trackerUrl).toBeNull();
    expect(display?.photoUrls).toEqual([
      "https://cdn.rescuegroups.org/27/pictures/animals/10059/10059734/41339654.jpg?width=500",
      "https://cdn.rescuegroups.org/27/pictures/animals/10059/10059734/41339662.jpg?width=500",
    ]);
  });

  it("never promotes a video or a thumbnail as a listing photo", async () => {
    const { display } = await displayFor(1);

    expect(display?.photoUrls.some((u) => u.includes("width=100"))).toBe(false);
    expect(display?.photoUrls.some((u) => u.includes("videosroot") || u.includes("youtube"))).toBe(false);
  });
});

describe("rescuegroups through the pipeline", () => {
  it("persists, normalizes and emits events with no pipeline changes", async () => {
    const { stages, corpus } = createMemoryStages([rescueGroupsNormalizer]);
    const adapter = createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl);

    const report = await runIngest(adapter, stages, { complete: true });

    expect(report.observed).toBe(2);
    expect(report.persisted).toBe(2);
    expect(report.normalized).toBe(2);
    expect(report.failures).toEqual([]);
    expect(report.events.map((e) => e.kind)).toEqual(["animal.seen", "animal.seen"]);
    expect(corpus.rawRows).toHaveLength(2);
  });

  it("lands one display row per animal, and re-polls and replays leave it untouched", async () => {
    const { stages, corpus } = createMemoryStages([rescueGroupsNormalizer]);
    await runIngest(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl), stages, {
      complete: true,
    });
    const first = structuredClone([...corpus.display.entries()]);

    expect(first.map(([k]) => k)).toEqual(["1:rescuegroups", "2:rescuegroups"]);
    expect(corpus.display.get("1:rescuegroups")?.photoUrls).toHaveLength(3);

    const second = await runIngest(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
      stages,
      { complete: true },
    );
    const replayed = await replay("rescuegroups", corpus.stored(), stages);

    // Neither a re-poll nor a replay may emit: an `animal.updated` per poll is
    // permanent, and display is not a fact that changed (ADR-0003, ADR-0015).
    expect([second.events, replayed.events]).toEqual([[], []]);
    expect([...corpus.display.entries()]).toEqual(first);
  });

  it("dedups on re-poll: a second identical run appends no raw rows", async () => {
    const { stages, corpus } = createMemoryStages([rescueGroupsNormalizer]);

    await runIngest(createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl), stages, { complete: true });
    const second = await runIngest(
      createRescueGroupsAdapter({ apiKey: "k" }, fixtureFetch().fetchImpl),
      stages,
      { complete: true },
    );

    expect(second.deduped).toBe(2);
    expect(second.persisted).toBe(0);
    expect(corpus.rawRows).toHaveLength(2);
  });
});
