import { contentHashOf } from "@/core/ingest/hash";
import type { Observation, SourceAdapter } from "@/core/ingest/observation";
import type { AnimalClaims, DisplayContent, DisplayPhoto, Normalizer } from "@/core/ingest/pipeline";

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
 * Case-canonicalised, because orgs type their own: `TX`, `Tx` and `tx` are one
 * state and three values, and browse filters on equality against an index — a
 * `state = 'OH'` query found 1,207 of 1,618 Ohio animals before this, missing
 * the rest silently (measured on the 64k corpus 2026-09-04). Canonicalising a
 * code's case is not editing the claim, the same way `species.toLowerCase()`
 * above is not.
 *
 * Anything that is not a two-letter code asserts NOTHING rather than a value no
 * filter can use — one org files 27 animals under `T`. The raw row keeps what
 * they said; this layer only decides what we are willing to assert, and a
 * junk state is worse than a missing one because it becomes a filter option.
 */
function stateOr(value: unknown): string | null {
  const text = stringOr(value)?.trim().toUpperCase();
  return text && /^[A-Z]{2}$/.test(text) ? text : null;
}

/**
 * An unparseable date asserts nothing rather than `Invalid Date` — never
 * return the raw `new Date(s)`: every comparison against NaN is false, so a
 * malformed stamp would slip past a window check instead of failing it, which
 * is the bug the `isActive` verify pass found in `shelters.ts`.
 */
function dateOr(value: unknown): Date | null {
  const text = stringOr(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
 * The 500px variant RescueGroups publishes — read, never built. Appending
 * `?width=500` ourselves would make the obligation to hotlink a bounded image
 * depend on our guess about their CDN's query grammar, the same trap
 * `trackerUrlOf` avoids. Falls back to the original variant rather than
 * dropping the photo.
 *
 * URL and dimensions come from ONE variant or neither: `large` and `original`
 * are different pixel sizes of the same picture (500×636 against 700×890 in
 * the payload this was written from), so crossing them would size every frame
 * wrong while looking perfectly plausible.
 */
function pictureOf(attributes: Record<string, unknown>): DisplayPhoto | null {
  for (const name of ["large", "original"]) {
    const variant = attributes[name] as
      | { url?: unknown; resolutionX?: unknown; resolutionY?: unknown }
      | undefined;
    const url = stringOr(variant?.url);
    const width = numberOr(variant?.resolutionX);
    const height = numberOr(variant?.resolutionY);
    if (url && width && height) return { url, width, height };
  }
  return null;
}

/** Positive finite numbers only: a zero dimension divides into an infinite aspect ratio. */
function numberOr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Ordered by each picture's own `order` attribute, not by array position:
 * `sidecarFor` sorts the sidecar by (type, id) for hash stability, so position
 * in `included` is our ordering and carries none of theirs (ADR-0015 decision
 * 4 asks for the order RescueGroups lists them in).
 */
function photosOf(payload: RescueGroupsAnimal): DisplayPhoto[] {
  return payload.included
    .filter((resource) => resource.type === "pictures")
    .map((resource) => ({
      order: typeof resource.attributes.order === "number" ? resource.attributes.order : 0,
      id: resource.id,
      photo: pictureOf(resource.attributes),
    }))
    .filter((p): p is { order: number; id: string; photo: DisplayPhoto } => p.photo !== null)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((p) => p.photo);
}

/**
 * Still bounded by retractability (ADR-0006 decision 4) — every field promoted
 * here purges with the `rescuegroups` set — but no longer identity-only: the
 * ADR-0006 amendment of 2026-08-25 licenses the listing description and photo
 * URLs under `aggregator-display`, and ADR-0015 carries them as `display`,
 * never as claims. The line that has not moved: prose and photos are
 * expression, so they never enter `AnimalClaims` and never reach the art
 * pipeline (decision 5 — no keepsake art from an API photo, ever).
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
    const birthDate = dateOr(attributes.birthDate);
    if (birthDate) {
      claims.birthDate = { value: birthDate, ...stamp };
      claims.isBirthDateExact = { value: attributes.isBirthDateExact === true, ...stamp };
    }

    // The listing's creation in RescueGroups, hand-checked against the live
    // feed 2026-09-03 (600 records over 60 random pages): a real per-animal
    // date, not an onboarding stamp — only one same-timestamp org cluster in
    // the sample was older than two years, the rest being same-day intakes.
    const listedAt = dateOr(attributes.createdDate);
    if (listedAt) claims.listedAt = { value: listedAt, ...stamp };

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

    // The ORG's address, never the `locations` resource: locations is a
    // mailing record that is routinely missing a city, and browse filters on
    // state (ADR-0015 decision 4). Their key is `postalcode`, all lowercase.
    const org = attributesOf(obs.payload, "orgs");
    const orgName = stringOr(org?.name);
    if (orgName) claims.orgName = { value: orgName, ...stamp };
    const orgUrl = orgUrlOf(org);
    if (orgUrl) claims.orgUrl = { value: orgUrl, ...stamp };

    // The listing itself, on the organization's own site — published for 18.6%
    // of the corpus and read, never built: these are per-organization
    // subdomains (`catrangers.rescuegroups.org/animals/detail?AnimalID=…`), so
    // a URL assembled from an id would point at whichever shelter we guessed.
    const listingUrl = httpUrlOr(attributes.url);
    if (listingUrl) claims.listingUrl = { value: listingUrl, ...stamp };
    const city = stringOr(org?.city);
    if (city) claims.city = { value: city, ...stamp };
    const state = stateOr(org?.state);
    if (state) claims.state = { value: state, ...stamp };
    const postalCode = stringOr(org?.postalcode);
    if (postalCode) claims.postalCode = { value: postalCode, ...stamp };

    // Promoted unconditionally, empty fields included: an animal whose
    // description is deleted upstream must clear the display row, and a
    // normalizer that skipped `display` here would leave yesterday's prose
    // standing forever (ADR-0015).
    const display: DisplayContent = {
      description: stringOr(attributes.descriptionText),
      photos: photosOf(obs.payload),
      listingOrg: orgName,
      trackerUrl: trackerUrlOf(obs.payload),
      // The observation's fetch, never `new Date()` — replay must rebuild this
      // row identically or the corpus stops being the repair path (ADR-0009).
      fetchedAt: obs.fetchedAt,
    };

    // Upkeep, deliberately outside `claims` — it says the org still tends this
    // record, which is not a fact about the animal and must never compete in
    // `resolveClaim` (ADR-0015 as amended). `null` when RG omits it, which
    // hides the animal: unknown upkeep is not good upkeep.
    return { claims, display, sourceUpdatedAt: dateOr(attributes.updatedDate) };
  },
};


/**
 * The organization's own site, for the link back that the API terms and
 * ADR-0015 decision 5 both require. Three fields in order of how directly they
 * answer "where does this listing live" — `url`, then the adoption page, then
 * Facebook, which for a lot of small rescues IS the website.
 *
 * Measured on the 2026-09-04 corpus before choosing this shape: 62,658 of
 * 64,133 animals' orgs publish a `url`, 82% of those with an explicit
 * `http://`, 3,349 with no scheme at all, and a few holding something that was
 * never a URL — one is a street address, one is the bare string `http://`.
 * So the field is validated, never trusted.
 *
 * The ONE character we add is a missing scheme, and it is `http://` because
 * that is what this feed's own organizations overwhelmingly publish; an
 * https-capable host redirects, while assuming https breaks every shelter
 * still serving plain http. Nothing else is rewritten — not the host, not the
 * path, not a trailing slash — so what we link is what they published.
 */
export function orgUrlOf(org: Record<string, unknown> | undefined): string | null {
  for (const field of ["url", "adoptionUrl", "facebookUrl"]) {
    const url = httpUrlOr(org?.[field]);
    if (url) return url;
  }
  return null;
}

/**
 * A link we are willing to send a donor to, or null. The ONE character this
 * adds is a missing scheme, and it is `http://` because that is what this
 * feed's own organizations overwhelmingly publish; an https-capable host
 * redirects, while assuming https breaks every shelter still serving plain
 * http. Nothing else is rewritten — not the host, not the path, not a trailing
 * slash — so what we link is what they published.
 */
function httpUrlOr(value: unknown): string | null {
  const raw = stringOr(value)?.trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  // A hostname with a dot and no whitespace — enough to reject `http://` and
  // the street address one org files under `url`, and deliberately not a TLD
  // list we would have to maintain against a source that keeps surprising us.
  return /^[^\s]+\.[^\s.]{2,}$/.test(parsed.hostname) ? candidate : null;
}

/**
 * The per-animal Adoption Tracker URL (ADR-0006 decision 2) — the pixel every
 * pet detail page must load. Read it off the raw payload at render time
 * (roadmap item 3); never synthesize the URL, or the obligation silently
 * depends on our guess about their URL shape.
 */
export function trackerUrlOf(payload: RescueGroupsAnimal): string | null {
  return stringOr(payload.animal.attributes.trackerimageUrl);
}
