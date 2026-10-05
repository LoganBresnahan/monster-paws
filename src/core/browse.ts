import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { visibleAnimals } from "@/core/animals";
import { pickLicensedDisplay } from "@/core/display";
import type { Source } from "@/core/sources";
import type { Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals } from "@/db/schema";
import { DEFAULT_SORT, NO_FILTERS, type BrowseFilters, type BrowseSort, type FacetCell } from "@/core/facets";

export {
  BROWSE_SORTS,
  DEFAULT_SORT,
  parseSort,
  type BrowseSort,
  facetOptions,
  NO_FILTERS,
  STATE_CODE,
  type BrowseFacets,
  type BrowseFilters,
  type FacetCell,
  type FacetOption,
} from "@/core/facets";

/**
 * What the browse page is allowed to read (ADR-0015 as amended). Everything
 * here composes `visibleAnimals` — browse never assembles its own predicate,
 * and every filter, cursor and facet count is applied BESIDE it, never inside
 * it.
 */

/** One screenful. Not a scarcity device: there is no total, no page number and nothing counts down (bright line 3). */
export const BROWSE_PAGE_SIZE = 24;

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
/** Which animals a filtered browse may show — shared by the page and the random pick, so they can never disagree. */
function matchingParts(
  filters: BrowseFilters,
  asOf: Date,
  exclusions: readonly BrowseExclusion[],
): SQL[] {
  const parts: SQL[] = [visibleAnimals(asOf), notExcluded(exclusions)];
  if (filters.species) parts.push(eq(animals.species, filters.species));
  if (filters.state) parts.push(eq(animals.state, filters.state));
  return parts;
}

/**
 * The keyset comparison for one side of a row, in DISPLAY order: "after"
 * means further down the page whichever way the sort runs. Row comparison, not
 * `listed_at > $1 or (listed_at = $1 and id > $2)`: the two are equivalent
 * only until someone edits one of them, and the row form is what
 * `animals_status_listed_idx` is shaped for.
 */
function beyond(sort: BrowseSort, side: "after" | "before", row: BrowseCursor): SQL {
  const descending = sort === "newest";
  const greater = (side === "after") !== descending;
  return greater
    ? sql`(${animals.listedAt}, ${animals.id}) > (${row.listedAt}, ${row.id})`
    : sql`(${animals.listedAt}, ${animals.id}) < (${row.listedAt}, ${row.id})`;
}

function sortWhere(filters: BrowseFilters, asOf: Date, exclusions: readonly BrowseExclusion[], sort: BrowseSort): SQL[] {
  const parts = matchingParts(filters, asOf, exclusions);
  // Newest-first descends, where Postgres puts a null date FIRST: an animal no
  // source dated would lead the page. RescueGroups dates every visible animal
  // today; a source that does not needs its own decision, not the top slot.
  if (sort === "newest") parts.push(isNotNull(animals.listedAt));
  return parts;
}

export interface BrowsePage {
  animals: (typeof animals.$inferSelect)[];
  /** null on the last page */
  nextCursor: string | null;
  /** null on the first page — checked against the rows, never assumed from the URL (ADR-0015 as amended 2026-10-05) */
  prevCursor: string | null;
  /** the first few names on the next page, in order — the "… are waiting" line under Next */
  nextNames: string[];
}

/** How many names of the next page the teaser under Next may show. */
export const NEXT_TEASER_SIZE = 3;

/** Where a page starts: below a row (`after`), above one (`before`), or at the top. */
export type BrowsePosition = { after: BrowseCursor } | { before: BrowseCursor } | null;

/**
 * One page of browse, newest-listed first by default. Measured 2026-09-04 on the live
 * 64k corpus: 0.55 ms unfiltered at page one, 8.8 ms for a deep cursor with
 * species+state — the filters are not in the sort index, so that number grows
 * with depth into the sort and is the one to re-EXPLAIN if browse slows.
 *
 * `position` takes a bare cursor as `after`, which is every caller written
 * before Previous existed.
 */
export async function loadBrowsePage(
  db: Db,
  filters: BrowseFilters = NO_FILTERS,
  position: BrowsePosition | BrowseCursor = null,
  asOf: Date = new Date(),
  exclusions: readonly BrowseExclusion[] = BROWSE_EXCLUSIONS,
  sort: BrowseSort = DEFAULT_SORT,
): Promise<BrowsePage> {
  const at: BrowsePosition =
    position && "listedAt" in position ? { after: position } : (position as BrowsePosition);
  const backward = at !== null && "before" in at;
  const anchor = at === null ? null : "before" in at ? at.before : at.after;

  const parts = sortWhere(filters, asOf, exclusions, sort);
  if (anchor) parts.push(beyond(sort, backward ? "before" : "after", anchor));
  // Walking backward reads the rows just above the anchor nearest-first, so
  // the order flips; the page is flipped back into display order below.
  const ascending = (sort === "longest") !== backward;
  const rows = await db
    .select()
    .from(animals)
    .where(and(...parts)!)
    // A source that publishes no listing date sorts last and is unreachable by
    // cursor (nulls sort after every value in `asc`). RescueGroups publishes one
    // for every visible animal today; a second source that does not needs its
    // own decision, not a silent tail.
    .orderBy(
      ascending
        ? sql`${animals.listedAt} asc, ${animals.id} asc`
        : sql`${animals.listedAt} desc, ${animals.id} desc`,
    )
    // A few more than the page: the first says "there is more this way" with no
    // count over the same predicate, and they name the teaser under Next.
    .limit(BROWSE_PAGE_SIZE + NEXT_TEASER_SIZE);

  const more = rows.length > BROWSE_PAGE_SIZE;
  const page = rows.slice(0, BROWSE_PAGE_SIZE);
  if (backward) page.reverse();
  const first = page[0];
  const last = page[page.length - 1];

  // The side we did not walk is probed, never assumed: rows on it may have
  // been adopted out since the cursor was written.
  const namesBeyond = async (side: "after" | "before", row: typeof first, count: number) => {
    if (!row?.listedAt) return [];
    const nearestFirst = (sort === "longest") === (side === "after");
    const hits = await db
      .select({ name: animals.name })
      .from(animals)
      .where(and(...sortWhere(filters, asOf, exclusions, sort), beyond(sort, side, { listedAt: row.listedAt, id: row.id }))!)
      .orderBy(
        nearestFirst
          ? sql`${animals.listedAt} asc, ${animals.id} asc`
          : sql`${animals.listedAt} desc, ${animals.id} desc`,
      )
      .limit(count);
    return hits.map((h) => h.name);
  };
  const nextNames = backward
    ? await namesBeyond("after", last, NEXT_TEASER_SIZE)
    : rows.slice(BROWSE_PAGE_SIZE).map((r) => r.name);
  const hasNext = nextNames.length > 0;
  const hasPrev = backward ? more : anchor !== null && (await namesBeyond("before", first, 1)).length > 0;

  const cursorOf = (row: typeof first) =>
    row?.listedAt ? encodeCursor({ listedAt: row.listedAt, id: row.id }) : null;
  return {
    animals: page,
    nextCursor: hasNext ? cursorOf(last) : null,
    prevCursor: hasPrev ? cursorOf(first) : null,
    nextNames,
  };
}

/**
 * One animal the filtered browse would show, chosen uniformly at random — the
 * "Surprise me" button (ADR-0015 as amended 2026-10-05). Uniform is the point:
 * every visible animal has the same chance, however long it has been listed,
 * so never weight this toward anything resembling appeal (bright line 1).
 * `null` when nothing matches.
 */
export async function pickRandomAnimalId(
  db: Db,
  filters: BrowseFilters = NO_FILTERS,
  asOf: Date = new Date(),
  exclusions: readonly BrowseExclusion[] = BROWSE_EXCLUSIONS,
): Promise<number | null> {
  const [row] = await db
    .select({ id: animals.id })
    .from(animals)
    .where(and(...matchingParts(filters, asOf, exclusions))!)
    .orderBy(sql`random()`)
    .limit(1);
  return row?.id ?? null;
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
