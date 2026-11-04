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
 * zip, or in the named states — or a list of shelters by name. Never all
 * absent: a wave with none of them is the whole list.
 */
export interface WaveSpec {
  name: string;
  within?: { zip: string; miles: number };
  states?: readonly string[];
  /** with the EIN already found for each, so `prepare` never asks a person to find it again (ADR-0029 as amended 2026-11-04) */
  shelters?: readonly { key: string; ein: string }[];
  /** false leaves the ask's timing paragraph out, whatever the date */
  timing?: false;
  limit?: number;
}

/** The first wave (ADR-0029 §1): shelter zips within 50 miles of Lincoln Park. */
export const CHICAGOLAND: WaveSpec = { name: "chicagoland-1", within: { zip: "60614", miles: 50 } };

/**
 * The rescues on a claimed Every.org profile, from our search of `browse/animals` on 2026-11-02, `hasAdmin`
 * true (ADR-0029 as amended 2026-11-04). Never add Anne Arundel's listing under its Friends-of charity's EIN: that
 * charity can't speak for the shelter. MSPCA is one nonprofit, so it gets one email, under Boston.
 */
export const CLAIMED_1: WaveSpec = {
  name: "claimed-1",
  timing: false,
  shelters: [
    { key: "rescuegroups:org:7832", ein: "742355124" }, // Humane Society of Central Texas
    { key: "rescuegroups:org:4394", ein: "237228287" }, // Helen Woodward Animal Center
    { key: "rescuegroups:org:3112", ein: "596002321" }, // Humane Society of Broward County
    { key: "rescuegroups:org:1792", ein: "352302714" }, // Cat Matchers
    { key: "rescuegroups:org:2836", ein: "042103597" }, // MSPCA-Angell
    { key: "rescuegroups:org:10399", ein: "942692384" }, // The Rabbit Haven
    { key: "rescuegroups:org:1776", ein: "941243665" }, // Peninsula Humane Society & SPCA
    { key: "rescuegroups:org:1915", ein: "430699783" }, // Animal Protective Association of Missouri (APA)
    { key: "rescuegroups:org:4774", ein: "264657471" }, // Doggie Harmony Rescue
    { key: "rescuegroups:org:11696", ein: "990978241" }, // Three Eye Blind Animal Rescue
    { key: "rescuegroups:org:5818", ein: "273838132" }, // Cat Town
    { key: "rescuegroups:org:9691", ein: "854269560" }, // Our Underdog Rescue Squad
    { key: "rescuegroups:org:2158", ein: "650597008" }, // The Cat Network,Inc
    { key: "rescuegroups:org:4716", ein: "274393020" }, // Baja Dog Rescue
    { key: "rescuegroups:org:6420", ein: "431977921" }, // A Forever Home Rescue Foundation
    { key: "rescuegroups:org:5472", ein: "460673295" }, // Only Maine Coons Rescue
    { key: "rescuegroups:org:10968", ein: "233098089" }, // Animal House Project
    { key: "rescuegroups:org:4463", ein: "272775999" }, // Taysia Blue Husky & Malamute Rescue
    { key: "rescuegroups:org:7003", ein: "840405254" }, // Denver Dumb Friends League
    { key: "rescuegroups:org:7852", ein: "475050634" }, // Yorkie Rescue Houston
    { key: "rescuegroups:org:4821", ein: "954347009" }, // C.A.R.E. aka: Cat/Canine Assistance, Referral &
    { key: "rescuegroups:org:9626", ein: "852719806" }, // Peace Love and Poms Rescue
    { key: "rescuegroups:org:11183", ein: "881794651" }, // Rainbow Bridge Hospice Rescue
    { key: "rescuegroups:org:5366", ein: "861080529" }, // Cocker Spaniel Adoption Center
    { key: "rescuegroups:org:5770", ein: "262929324" }, // Black Cat Rescue
    { key: "rescuegroups:org:10262", ein: "951643344" }, // Pasadena Humane
    { key: "rescuegroups:org:9140", ein: "811599145" }, // Ruff Redemption Rescue
  ],
};

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
  if (!spec.within && !spec.states?.length && !spec.shelters?.length) {
    throw new Error(`wave '${spec.name}' names no region — a radius, states or a list of shelters, never the whole list (ADR-0029 §1)`);
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
  } else if (spec.shelters) {
    const named = new Set(spec.shelters.map((s) => s.key));
    inside = (shelter) => named.has(shelter.shelterExternalId);
  }

  return shelters
    .filter((shelter) => inside(shelter) && !approached.has(shelter.shelterExternalId))
    .sort((a, b) => b.visibleCount - a.visibleCount || (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, limit);
}
