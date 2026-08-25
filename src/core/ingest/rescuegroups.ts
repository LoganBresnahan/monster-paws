import { contentHashOf } from "@/core/ingest/hash";
import type { Observation, SourceAdapter } from "@/core/ingest/observation";
import type { AnimalClaims, Normalizer } from "@/core/ingest/pipeline";

/**
 * RescueGroups v5 adapter (ADR-0006 decision 2). Tier 2 — discovery, not
 * archive: everything here is set-deletable on ToS termination, which is why
 * the corpus's permanent value must never rest on it (DIRECTION).
 */

const BASE_URL = "https://api.rescuegroups.org/v5";
const SEARCH_PATH = "/public/animals/search/available/";

interface JsonApiRef {
  type: string;
  id: string;
}

interface JsonApiResource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: JsonApiRef | JsonApiRef[] | null }>;
}

/**
 * One animal plus the `included` resources it actually references. JSON:API
 * splits a record across `data` and a shared `included` array, so an
 * observation that kept only the animal would lose species and status and be
 * un-normalizable on replay — the sidecar is carried verbatim, not flattened.
 */
export interface RescueGroupsAnimal {
  animal: JsonApiResource;
  included: JsonApiResource[];
}

interface SearchResponse {
  meta?: { count?: number; pages?: number; pageReturned?: number };
  data?: JsonApiResource[];
  included?: JsonApiResource[];
}

export interface RescueGroupsConfig {
  apiKey: string;
  /** records per request; RescueGroups caps this at 250 */
  pageLimit?: number;
  /** stop after N pages — for smoke runs; omit to sync every available animal */
  maxPages?: number;
  baseUrl?: string;
}

function refsOf(resource: JsonApiResource): JsonApiRef[] {
  const refs: JsonApiRef[] = [];
  for (const rel of Object.values(resource.relationships ?? {})) {
    if (!rel?.data) continue;
    if (Array.isArray(rel.data)) refs.push(...rel.data);
    else refs.push(rel.data);
  }
  return refs;
}

/**
 * Sorted by (type, id), and that sort is load-bearing: JSON:API's `included`
 * is an unordered set, and RescueGroups returns it in a different order run to
 * run. Left as they sent it, ~20% of every re-poll hashes as changed and
 * appends a duplicate corpus row — and phase 8 would emit an `animal.updated`
 * event for each, permanently, into an append-only log (ADR-0009). Ordering
 * within the sidecar is ours to choose; we assemble this array, never them.
 * Measured 2026-08-19: 198 of 202 apparent changes were this and nothing else.
 */
function sidecarFor(animal: JsonApiResource, included: JsonApiResource[]): JsonApiResource[] {
  const wanted = new Set(refsOf(animal).map((ref) => `${ref.type}:${ref.id}`));
  return included
    .filter((resource) => wanted.has(`${resource.type}:${resource.id}`))
    .sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type)));
}

/** Fraction of `meta.count` a complete run may fall short by before it is declared truncated. */
const COUNT_DRIFT_TOLERANCE = 0.01;

export function createRescueGroupsAdapter(
  config: RescueGroupsConfig,
  fetchImpl: typeof fetch = fetch,
): SourceAdapter<RescueGroupsAnimal> {
  const base = (config.baseUrl ?? BASE_URL).replace(/\/$/, "");
  const limit = config.pageLimit ?? 100;

  async function fetchPage(page: number): Promise<SearchResponse> {
    const res = await fetchImpl(`${base}${SEARCH_PATH}?limit=${limit}&page=${page}`, {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/vnd.api+json",
      },
      // An empty body is rejected as malformed JSON; the filterless search is
      // spelled `{"data":{"filters":[]}}`.
      body: JSON.stringify({ data: { filters: [] } }),
    });
    if (!res.ok) {
      throw new Error(`rescuegroups page ${page} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as SearchResponse;
  }

  return {
    source: "rescuegroups",
    async *fetch() {
      let page = 1;
      let pages = 1;
      let expected: number | undefined;
      let total = 0;

      do {
        const body = await fetchPage(page);
        // A 200 without `data`/`meta` is an error envelope, not an empty page:
        // yielding a short batch here would let a "complete" run disappear
        // every animal on the pages it never fetched (ADR-0014).
        if (!Array.isArray(body.data) || (page === 1 && typeof body.meta?.pages !== "number")) {
          throw new Error(`rescuegroups page ${page}: malformed response (no data/meta)`);
        }
        // Page count and record count are read from page 1 only — a later
        // page shrinking them is the same silent truncation.
        if (page === 1) {
          pages = body.meta!.pages!;
          expected = body.meta!.count;
        }
        const included = body.included ?? [];

        for (const animal of body.data) {
          total += 1;
          const payload: RescueGroupsAnimal = {
            animal,
            included: sidecarFor(animal, included),
          };
          // No exclusion list: identical fetches return byte-identical
          // records (verified 2026-08-17), so any hash change is a real
          // change. Add exclusions only against evidence, never pre-emptively.
          yield {
            source: "rescuegroups",
            externalId: animal.id,
            payload,
            fetchedAt: new Date(),
            contentHash: contentHashOf(payload),
          } satisfies Observation<RescueGroupsAnimal>;
        }

        if (config.maxPages !== undefined && page >= config.maxPages) return;
        page += 1;
      } while (page <= pages);

      // Live feeds drift a little between pages (an adoption shifts later
      // records); a shortfall beyond that is a truncated run and must throw
      // rather than reconcile (ADR-0014).
      if (expected !== undefined && total < expected * (1 - COUNT_DRIFT_TOLERANCE)) {
        throw new Error(
          `rescuegroups: fetched ${total} of ${expected} records — run is incomplete`,
        );
      }
    },
  };
}

function attributesOf(
  payload: RescueGroupsAnimal,
  type: string,
): Record<string, unknown> | undefined {
  return payload.included.find((resource) => resource.type === type)?.attributes;
}

function stringOr(value: unknown, fallback: string | null = null): string | null {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Their vocabulary, ours. An unmapped status asserts nothing rather than
 * guessing: the raw row keeps the truth, and a wrong status is worse than a
 * missing one — it decides whether a donor sees an animal at all.
 */
const STATUS_BY_NAME: Record<string, string> = {
  Available: "available",
  Adopted: "adopted",
  "Adoption Pending": "pending",
  Hold: "hold",
};

/**
 * Deliberately thin (ADR-0006 decision 4). Every field promoted here is a
 * field we must be able to retract on ToS termination, so the aggregator
 * asserts identity and nothing else: never the shelter's prose, never photos
 * (which are also gated on the art-rights consent of decision 5). The full
 * payload stays verbatim in the raw row for whatever we're allowed to do with
 * it later.
 */
export const rescueGroupsNormalizer: Normalizer<RescueGroupsAnimal> = {
  source: "rescuegroups",

  async normalize(obs) {
    const { attributes } = obs.payload.animal;
    const claims: AnimalClaims = {};
    const stamp = { source: obs.source, fetchedAt: obs.fetchedAt } as const;

    const name = stringOr(attributes.name);
    if (name) claims.name = { value: name, ...stamp };

    const species = stringOr(attributesOf(obs.payload, "species")?.singular);
    if (species) claims.species = { value: species.toLowerCase(), ...stamp };

    claims.breed = { value: stringOr(attributes.breedPrimary), ...stamp };

    const sex = stringOr(attributes.sex);
    if (sex) claims.sex = { value: sex, ...stamp };

    const ageGroup = stringOr(attributes.ageGroup);
    if (ageGroup) claims.ageGroup = { value: ageGroup, ...stamp };

    // The exactness flag is only meaningful alongside a date — asserted
    // together or not at all, so a later merge can never pair one source's
    // date with another's confidence about it.
    const birthDate = stringOr(attributes.birthDate);
    const parsed = birthDate ? new Date(birthDate) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      claims.birthDate = { value: parsed, ...stamp };
      claims.isBirthDateExact = { value: attributes.isBirthDateExact === true, ...stamp };
    }

    const statusName = stringOr(attributesOf(obs.payload, "statuses")?.name);
    const status = statusName ? STATUS_BY_NAME[statusName] : undefined;
    if (status) claims.status = { value: status, ...stamp };

    // Namespaced, never bare: a bare `27` would be indistinguishable from a
    // shelter-registry slug, and phase 7 is what maps an org onto a registry
    // entry (ADR-0009). Until then this is an aggregator handle, not identity.
    const orgId = refsOf(obs.payload.animal).find((ref) => ref.type === "orgs")?.id;
    if (orgId) {
      claims.shelterExternalId = { value: `rescuegroups:org:${orgId}`, ...stamp };
    }

    return claims;
  },
};

/**
 * The per-animal Adoption Tracker URL (ADR-0006 decision 2) — the pixel every
 * pet detail page must load. Read it off the raw payload at render time
 * (roadmap item 3); never synthesize the URL, or the obligation silently
 * depends on our guess about their URL shape.
 */
export function trackerUrlOf(payload: RescueGroupsAnimal): string | null {
  return stringOr(payload.animal.attributes.trackerimageUrl);
}
