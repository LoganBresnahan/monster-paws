/**
 * The browse filter menus, as pure functions over the facet grid. Kept free of
 * the database so the filter island can recount them in the browser — never
 * import `@/db` or `drizzle-orm` here, or the driver ships to every visitor.
 */

export interface BrowseFilters {
  species: string | null;
  state: string | null;
}

export const NO_FILTERS: BrowseFilters = { species: null, state: null };

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
  count: number;
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
