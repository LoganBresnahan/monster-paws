import { and, eq, isNotNull, sql } from "drizzle-orm";
import { visibleAnimals } from "@/core/animals";
import { browseSearch, DEFAULT_RADIUS, DEFAULT_SORT, NO_FILTERS } from "@/core/facets";
import { milesBetween, zipPoint } from "@/core/geo";
import { SHELTER_EXCLUSIONS, type ShelterExclusion } from "@/core/shelters";
import type { Db } from "@/db/client";
import { animals, outreachEvents } from "@/db/schema";

/**
 * Who we write to: the organisations whose animals are visible on the site,
 * described from the same displayed fields their shelter view shows
 * (ADR-0029 §1–2). Reads `animals` only — the table has no email or phone
 * column, and this module must never reach into `raw_payloads`, where
 * RescueGroups' contact fields are: that key's declared use does not cover
 * writing to them.
 */
export interface OutreachShelter {
  /** `animals.shelter_external_id`, e.g. `rescuegroups:org:3077` */
  shelterExternalId: string;
  name: string | null;
  city: string | null;
  state: string | null;
  /** first five digits, or null when no visible animal carries one */
  zip: string | null;
  /** the organisation's own site, as the source published it */
  website: string | null;
  visibleCount: number;
  /** the shelter view on monsterpaws.org — the live page, never a stored copy of a listing */
  shelterViewUrl: string;
}

export const SITE_ORIGIN = "https://monsterpaws.org";

export function shelterViewUrl(shelterExternalId: string, origin = SITE_ORIGIN): string {
  const search = browseSearch({
    ...NO_FILTERS,
    zip: null,
    miles: DEFAULT_RADIUS,
    shelter: shelterExternalId,
    sort: DEFAULT_SORT,
  });
  return `${origin}/animals?${search}`;
}

interface Tally {
  count: number;
  name: Map<string, number>;
  city: Map<string, number>;
  state: Map<string, number>;
  zip: Map<string, number>;
  website: Map<string, number>;
}

function add(tally: Map<string, number>, value: string | null, count: number): void {
  if (value === null || value === "") return;
  tally.set(value, (tally.get(value) ?? 0) + count);
}

/** The value most of the shelter's visible animals carry — how `loadShelter` names a shelter too. */
function mode(tally: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Every shelter with at least one visible animal, as its visible animals
 * describe it. Excluded shelters are gone before this query runs — the
 * exclusion sits inside `visibleAnimals` (ADR-0029 §5) — so an opted-out
 * shelter can never be written to again by this list.
 */
export async function loadOutreachShelters(
  db: Db,
  asOf: Date = new Date(),
  exclusions: readonly ShelterExclusion[] = SHELTER_EXCLUSIONS,
  origin = SITE_ORIGIN,
): Promise<OutreachShelter[]> {
  const zip5 = sql<string | null>`left(${animals.postalCode}, 5)`;
  const rows = await db
    .select({
      id: animals.shelterExternalId,
      name: animals.orgName,
      city: animals.city,
      state: animals.state,
      zip: zip5,
      website: animals.orgUrl,
      count: sql<number>`count(*)::int`,
    })
    .from(animals)
    .where(and(visibleAnimals(asOf, exclusions), isNotNull(animals.shelterExternalId))!)
    .groupBy(animals.shelterExternalId, animals.orgName, animals.city, animals.state, zip5, animals.orgUrl);

  const tallies = new Map<string, Tally>();
  for (const row of rows) {
    const id = row.id!;
    let tally = tallies.get(id);
    if (!tally) {
      tally = { count: 0, name: new Map(), city: new Map(), state: new Map(), zip: new Map(), website: new Map() };
      tallies.set(id, tally);
    }
    tally.count += row.count;
    add(tally.name, row.name, row.count);
    add(tally.city, row.city, row.count);
    add(tally.state, row.state, row.count);
    add(tally.zip, row.zip, row.count);
    add(tally.website, row.website, row.count);
  }

  return [...tallies]
    .map(([shelterExternalId, t]) => ({
      shelterExternalId,
      name: mode(t.name),
      city: mode(t.city),
      state: mode(t.state),
      zip: mode(t.zip),
      website: mode(t.website),
      visibleCount: t.count,
      shelterViewUrl: shelterViewUrl(shelterExternalId, origin),
    }))
    .sort((a, b) => b.visibleCount - a.visibleCount || (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Nothing goes to the whole list at once (ADR-0029 §1). */
export const WAVE_MAX = 200;

/** A wave's name as Logan types it on the command line and as it is stored: lowercase kebab-case. */
export const WAVE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * One wave: a name Logan chose, and a region — shelters within `miles` of a
 * zip, or in the named states. Never both absent: a wave with no region is
 * the whole list.
 */
export interface WaveSpec {
  name: string;
  within?: { zip: string; miles: number };
  states?: readonly string[];
  limit?: number;
}

/** The first wave (ADR-0029 §1): shelter zips within 50 miles of Lincoln Park. */
export const CHICAGOLAND: WaveSpec = { name: "chicagoland-1", within: { zip: "60614", miles: 50 } };

/** Every shelter any wave has already written to — never approached twice with the same ask. */
export async function approachedShelters(db: Db): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ id: outreachEvents.shelterExternalId })
    .from(outreachEvents)
    .where(eq(outreachEvents.kind, "sent"));
  return new Set(rows.map((r) => r.id));
}

/**
 * The shelters a wave writes to, most visible animals first, at most 200. A
 * shelter whose zip the Census cannot place is outside every radius — the
 * same rule as browse's (ADR-0015 as amended 2026-10-26) — and a shelter
 * already written to is left for a follow-up, which is its own wave.
 */
export function selectWave(
  shelters: readonly OutreachShelter[],
  spec: WaveSpec,
  approached: ReadonlySet<string> = new Set(),
): OutreachShelter[] {
  const limit = spec.limit ?? WAVE_MAX;
  if (!(Number.isInteger(limit) && limit > 0 && limit <= WAVE_MAX)) {
    throw new Error(`a wave is at most ${WAVE_MAX} shelters (ADR-0029 §1), not ${spec.limit}`);
  }
  if (!spec.within && !spec.states?.length) {
    throw new Error(`wave '${spec.name}' names no region — a radius or states, never the whole list (ADR-0029 §1)`);
  }
  if (!WAVE_NAME.test(spec.name)) {
    throw new Error(`wave name '${spec.name}' is not lowercase kebab-case`);
  }

  let inside: (shelter: OutreachShelter) => boolean = () => true;
  if (spec.within) {
    const origin = zipPoint(spec.within.zip);
    if (!origin) throw new Error(`wave '${spec.name}': zip ${spec.within.zip} is not a place the Census maps`);
    const miles = spec.within.miles;
    inside = (shelter) => {
      if (!shelter.zip) return false;
      const at = zipPoint(shelter.zip);
      return at !== null && milesBetween(origin, at) <= miles;
    };
  } else if (spec.states) {
    const states = new Set(spec.states.map((s) => s.toUpperCase()));
    inside = (shelter) => shelter.state !== null && states.has(shelter.state.toUpperCase());
  }

  return shelters
    .filter((shelter) => inside(shelter) && !approached.has(shelter.shelterExternalId))
    .sort((a, b) => b.visibleCount - a.visibleCount || (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, limit);
}
