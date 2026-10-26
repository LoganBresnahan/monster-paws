/**
 * The browse filter menus, as pure functions over the facet grid. Kept free of
 * the database so the filter island can recount them in the browser — never
 * import `@/db` or `drizzle-orm` here, or the driver ships to every visitor.
 */

export interface BrowseFilters {
  species: string | null;
  state: string | null;
  age: string | null;
  sex: string | null;
}

export const NO_FILTERS: BrowseFilters = { species: null, state: null, age: null, sex: null };

/**
 * The source's own age groups and sexes, in the order a menu lists them
 * (ADR-0015 as amended 2026-10-26). A filter offers only what the corpus holds
 * under the other picks, so a value missing here never shows; one the corpus
 * gains that is missing here sorts last, never vanishes.
 */
export const AGE_ORDER = ["Baby", "Young", "Adult", "Senior"] as const;
export const SEX_ORDER = ["Female", "Male"] as const;

/**
 * The only state values a filter may offer. Replay cannot retract a claim
 * (ADR-0009 phase-7 rule), so 27 animals still carry a junk state `T` that the
 * normalizer never asserts — and `select distinct state` would put it in the
 * filter as a choice nobody can use.
 */
export const STATE_CODE = /^[A-Z]{2}$/;

export interface FacetCell {
  species: string;
  state: string | null;
  age: string | null;
  sex: string | null;
  count: number;
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface BrowseFacets {
  species: FacetOption[];
  states: FacetOption[];
  ages: FacetOption[];
  sexes: FacetOption[];
}

type Menu = "species" | "state" | "age" | "sex";

function tally(cells: readonly FacetCell[], key: (cell: FacetCell) => string | null): FacetOption[] {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const value = key(cell);
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + cell.count);
  }
  return [...counts].map(([value, count]) => ({ value, count }));
}

function byOrder(order: readonly string[]) {
  const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
  return (a: FacetOption, b: FacetOption) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value);
}

/**
 * Each menu is counted under the OTHER menus' selections, which is what makes
 * a count a promise: "dog (412)" beside a chosen state means 412 dogs in that
 * state, not 18,000 dogs somewhere.
 */
export function facetOptions(cells: readonly FacetCell[], filters: BrowseFilters): BrowseFacets {
  const under = (except: Menu) =>
    cells.filter(
      (c) =>
        (except === "species" || !filters.species || c.species === filters.species) &&
        (except === "state" || !filters.state || c.state === filters.state) &&
        (except === "age" || !filters.age || c.age === filters.age) &&
        (except === "sex" || !filters.sex || c.sex === filters.sex),
    );
  return {
    species: tally(under("species"), (c) => c.species).sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    ),
    states: tally(under("state"), (c) => (c.state && STATE_CODE.test(c.state) ? c.state : null)).sort(
      (a, b) => a.value.localeCompare(b.value),
    ),
    ages: tally(under("age"), (c) => c.age).sort(byOrder(AGE_ORDER)),
    sexes: tally(under("sex"), (c) => c.sex).sort(byOrder(SEX_ORDER)),
  };
}

/**
 * Browse orders (ADR-0015 as amended 2026-10-05). The first is the default and
 * is never written into a URL. Never add an order that ranks animals by
 * appeal: these sort by the source's listing date and nothing else (bright line 1).
 */
export const BROWSE_SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "longest", label: "Longest waiting" },
] as const;

export type BrowseSort = (typeof BROWSE_SORTS)[number]["value"];

export const DEFAULT_SORT: BrowseSort = BROWSE_SORTS[0].value;

/** An unknown value is the default, never an error: a sort is a shared URL. */
export function parseSort(raw: string | null | undefined): BrowseSort {
  const match = BROWSE_SORTS.find((s) => s.value === raw);
  return match ? match.value : DEFAULT_SORT;
}

export const ZIP_CODE = /^\d{5}$/;

/** The radius choices, in miles (ADR-0015 as amended 2026-10-26); the default is never written into a URL. */
export const RADII = [10, 25, 50, 100] as const;
export type Radius = (typeof RADII)[number];
export const DEFAULT_RADIUS: Radius = 25;

export function parseRadius(raw: string | null | undefined): Radius {
  const n = Number(raw);
  return (RADII as readonly number[]).includes(n) ? (n as Radius) : DEFAULT_RADIUS;
}

/** Everything a browse URL can carry besides the cursor. */
export interface BrowseQuery extends BrowseFilters {
  zip: string | null;
  miles: Radius;
  shelter: string | null;
  sort: BrowseSort;
}

/**
 * The one way a browse URL is written — by the page, the filter island and
 * "Surprise me" alike, so a link one of them builds always means the same list
 * to the others. Defaults are left out, and `miles` means nothing without a zip.
 */
export function browseSearch(query: BrowseQuery): URLSearchParams {
  const out = new URLSearchParams();
  if (query.species) out.set("species", query.species);
  if (query.state) out.set("state", query.state);
  if (query.age) out.set("age", query.age);
  if (query.sex) out.set("sex", query.sex);
  if (query.zip) {
    out.set("zip", query.zip);
    if (query.miles !== DEFAULT_RADIUS) out.set("miles", String(query.miles));
  }
  if (query.shelter) out.set("shelter", query.shelter);
  if (query.sort !== DEFAULT_SORT) out.set("sort", query.sort);
  return out;
}
