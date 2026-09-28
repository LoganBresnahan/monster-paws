import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { visibleAnimals } from "@/core/animals";
import { pickLicensedDisplay } from "@/core/display";
import type { Source } from "@/core/sources";
import type { Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals } from "@/db/schema";

/**
 * What the browse page is allowed to read (ADR-0015 as amended). Everything
 * here composes `visibleAnimals` — browse never assembles its own predicate,
 * and every filter, cursor and facet count is applied BESIDE it, never inside
 * it.
 */

/** One screenful. Not a scarcity device: there is no total, no page number and nothing counts down (bright line 3). */
export const BROWSE_PAGE_SIZE = 24;

/**
 * The only state values a filter may offer. Replay cannot retract a claim
 * (ADR-0009 phase-7 rule), so 27 animals still carry a junk state `T` that the
 * normalizer never asserts — and `select distinct state` would put it in the
 * filter as a choice nobody can use.
 */
export const STATE_CODE = /^[A-Z]{2}$/;

/**
 * Listings that are not one adoptable animal, hand-checked 2026-09-04 against
 * the head of the longest-listed sort (the four oldest visible rows, plus two
 * group listings found beside them). The real fix is an LLM verdict as derived
 * data — ADR-0021, roadmap item 7b — and this is the interim it names: a tiny
 * curated list, never a regex over names, which would hide "Sunshine 9.21.09"
 * and "Afraid of Commitment" to catch these.
 *
 * Keyed by (source, external_id) and never by `animals.id`: a canonical rebuild
 * reassigns our ids, and a stale id list would then hide six animals chosen at
 * random. Composed beside `visibleAnimals`, never inside it — a detail page
 * linked from anywhere must still resolve (ADR-0015 decision 2).
 */
export interface BrowseExclusion {
  source: Source;
  externalId: string;
  /** the name as listed, so a reviewer can find the row again */
  name: string;
  /** what the listing actually is, in the shelter's own words where they say it */
  why: string;
}

export const BROWSE_EXCLUSIONS: readonly BrowseExclusion[] = [
  {
    source: "rescuegroups",
    externalId: "44418",
    name: "ADOPTION-Read First",
    why: "RescueCats' adoption-center hours and address, listed as a cat since 2006",
  },
  {
    source: "rescuegroups",
    externalId: "53757",
    name: "Kittens!!!!",
    why: "a standing note that unposted kittens exist during kitten season",
  },
  {
    source: "rescuegroups",
    externalId: "595663",
    name: "OK Fosters Needed",
    why: "a volunteer callout: 'Fosters and transport volunteers needed'",
  },
  {
    source: "rescuegroups",
    externalId: "680671",
    name: "One by One cats",
    why: "a pointer to another shelter's cats, not an animal at this one",
  },
  {
    source: "rescuegroups",
    externalId: "1514909",
    name: "Kittens Available 20+!",
    why: "a group listing whose own description says the pictured kittens are already adopted",
  },
  {
    source: "rescuegroups",
    externalId: "4983805",
    name: "Red Eared Slider Turtles!",
    why: "a group listing: 'many Red Eared Slider Turtles here at PHS'",
  },
];

function notExcluded(exclusions: readonly BrowseExclusion[]): SQL {
  if (exclusions.length === 0) return sql`true`;
  const pairs = sql.join(
    exclusions.map((e) => sql`(${e.source}, ${e.externalId})`),
    sql`, `,
  );
  return sql`not exists (
    select 1 from ${animalIdentities}
    where ${animalIdentities.animalId} = ${animals.id}
      and (${animalIdentities.source}, ${animalIdentities.externalId}) in (${pairs})
  )`;
}

export interface BrowseFilters {
  species: string | null;
  state: string | null;
}

export const NO_FILTERS: BrowseFilters = { species: null, state: null };

/**
 * A cursor names a ROW, not a position: `(listed_at, id)` is the sort key of
 * the last row shown, so the next page cannot skip or repeat an animal when a
 * poll adopts one out from the middle (ADR-0015 as amended). The `id` is the
 * tiebreaker `listed_at` alone does not give — the backfill wrote thousands of
 * rows sharing a timestamp.
 */
export interface BrowseCursor {
  listedAt: Date;
  id: number;
}

export function encodeCursor(cursor: BrowseCursor): string {
  return `${cursor.listedAt.toISOString()},${cursor.id}`;
}

/**
 * Anything unparseable is `null` — page one, never an error: a cursor is a
 * shared URL, and a full canonical rebuild rewrites the sort key and breaks
 * every cursor in the wild. A broken cursor must cost a reader a page of
 * animals, not a 500.
 */
export function parseCursor(raw: string | null | undefined): BrowseCursor | null {
  if (!raw) return null;
  const [when, id] = raw.split(",");
  if (!when || !/^\d+$/.test(id ?? "")) return null;
  const listedAt = new Date(when);
  if (Number.isNaN(listedAt.getTime())) return null;
  return { listedAt, id: Number(id) };
}

/**
 * `asOf` is a parameter for the same reason `visibleAnimals` takes one: a
 * boundary is only testable when the caller owns the clock.
 */
function browseWhere(
  filters: BrowseFilters,
  cursor: BrowseCursor | null,
  asOf: Date,
  exclusions: readonly BrowseExclusion[],
): SQL {
  const parts: SQL[] = [visibleAnimals(asOf), notExcluded(exclusions)];
  if (filters.species) parts.push(eq(animals.species, filters.species));
  if (filters.state) parts.push(eq(animals.state, filters.state));
  // Row comparison, not `listed_at > $1 or (listed_at = $1 and id > $2)`: the
  // two are equivalent only until someone edits one of them, and the row form
  // is what `animals_status_listed_idx` is shaped for.
  if (cursor) {
    parts.push(sql`(${animals.listedAt}, ${animals.id}) > (${cursor.listedAt}, ${cursor.id})`);
  }
  return and(...parts)!;
}

export interface BrowsePage {
  animals: (typeof animals.$inferSelect)[];
  /** null on the last page — there is no `?before=` in v1, so Back is browser history (ADR-0015 as amended) */
  nextCursor: string | null;
}

/**
 * One page of browse, longest-listed first. Measured 2026-09-04 on the live
 * 64k corpus: 0.55 ms unfiltered at page one, 8.8 ms for a deep cursor with
 * species+state — the filters are not in the sort index, so that number grows
 * with depth into the sort and is the one to re-EXPLAIN if browse slows.
 */
export async function loadBrowsePage(
  db: Db,
  filters: BrowseFilters = NO_FILTERS,
  cursor: BrowseCursor | null = null,
  asOf: Date = new Date(),
  exclusions: readonly BrowseExclusion[] = BROWSE_EXCLUSIONS,
): Promise<BrowsePage> {
  const rows = await db
    .select()
    .from(animals)
    .where(browseWhere(filters, cursor, asOf, exclusions))
    // A source that publishes no listing date sorts last and is unreachable by
    // cursor (nulls sort after every value in `asc`). RescueGroups publishes one
    // for every visible animal today; a second source that does not needs its
    // own decision, not a silent tail.
    .orderBy(sql`${animals.listedAt} asc, ${animals.id} asc`)
    // One more than the page, so "is there a next page" costs no second query
    // and no count over the same predicate.
    .limit(BROWSE_PAGE_SIZE + 1);

  const page = rows.slice(0, BROWSE_PAGE_SIZE);
  const last = page[page.length - 1];
  const hasMore = rows.length > BROWSE_PAGE_SIZE;
  return {
    animals: page,
    nextCursor:
      hasMore && last?.listedAt ? encodeCursor({ listedAt: last.listedAt, id: last.id }) : null,
  };
}

export interface FacetCell {
  species: string;
  state: string | null;
  count: number;
}

/**
 * Every (species, state) pair in the VISIBLE set with its count — the whole
 * grid in one query, ~700 cells, measured at 30 ms on the 64k corpus. The two
 * filter menus are derived from it rather than from two queries, so a species
 * count under a chosen state and the state count under a chosen species can
 * never disagree with each other or with the page they open.
 *
 * Never a hardcoded list: the options are what the corpus actually holds today,
 * so a filter can only ever open a page with animals on it.
 */
export async function loadFacetGrid(
  db: Db,
  asOf: Date = new Date(),
  exclusions: readonly BrowseExclusion[] = BROWSE_EXCLUSIONS,
): Promise<FacetCell[]> {
  const rows = await db
    .select({
      species: animals.species,
      state: animals.state,
      count: sql<number>`count(*)::int`,
    })
    .from(animals)
    .where(and(visibleAnimals(asOf), notExcluded(exclusions))!)
    .groupBy(animals.species, animals.state);
  return rows;
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface BrowseFacets {
  species: FacetOption[];
  states: FacetOption[];
}

function tally(cells: readonly FacetCell[], key: (cell: FacetCell) => string | null): FacetOption[] {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const value = key(cell);
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + cell.count);
  }
  return [...counts].map(([value, count]) => ({ value, count }));
}

/**
 * Each menu is counted under the OTHER menu's selection, which is what makes a
 * count a promise: "dog (412)" beside a chosen state means 412 dogs in that
 * state, not 18,000 dogs somewhere.
 */
export function facetOptions(cells: readonly FacetCell[], filters: BrowseFilters): BrowseFacets {
  const forSpecies = cells.filter((c) => !filters.state || c.state === filters.state);
  const forStates = cells.filter((c) => !filters.species || c.species === filters.species);
  return {
    species: tally(forSpecies, (c) => c.species).sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    ),
    states: tally(forStates, (c) => (c.state && STATE_CODE.test(c.state) ? c.state : null)).sort(
      (a, b) => a.value.localeCompare(b.value),
    ),
  };
}

/**
 * The licensed display row per animal for a page of cards — the same
 * `pickLicensedDisplay` the detail page uses, and the only way a card gets a
 * photo. An animal with no licensed row shows its facts and no photo, never a
 * row we merely happen to hold (ADR-0015 decision 3).
 */
export async function loadCardDisplay(
  db: Db,
  animalIds: readonly number[],
  asOf: Date = new Date(),
): Promise<Map<number, typeof animalDisplay.$inferSelect>> {
  const picked = new Map<number, typeof animalDisplay.$inferSelect>();
  if (animalIds.length === 0) return picked;

  const rows = await db
    .select()
    .from(animalDisplay)
    .where(inArray(animalDisplay.animalId, [...animalIds]));

  const byAnimal = new Map<number, (typeof animalDisplay.$inferSelect)[]>();
  for (const row of rows) {
    const list = byAnimal.get(row.animalId) ?? [];
    list.push(row);
    byAnimal.set(row.animalId, list);
  }
  // Grouped first, because `pickLicensedDisplay` throws on rows spanning two
  // animals — that guard is what stops a stranger's photo appearing under this
  // animal's name, and handing it the whole page would trip it every time.
  for (const [animalId, group] of byAnimal) {
    const licensed = pickLicensedDisplay(group, asOf);
    if (licensed) picked.set(animalId, licensed);
  }
  return picked;
}
