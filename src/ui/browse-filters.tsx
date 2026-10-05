"use client";

import Link from "next/link";
import { useState } from "react";
import { BROWSE_SORTS, DEFAULT_SORT, facetOptions, type BrowseSort, type FacetCell } from "@/core/facets";

/**
 * The browse filters (ADR-0015 as amended 2026-10-04). Still a plain GET form —
 * it submits and shares the same URL with JavaScript off — but each menu
 * recounts under the other's pick before "Show me", from the same grid the
 * server counted. `after` is deliberately absent: changing a filter starts at
 * the first animal, because a cursor from the old filter names a row the new
 * one may not contain.
 */
export function BrowseFilterForm({
  grid,
  species: initialSpecies,
  state: initialState,
  sort: initialSort,
}: {
  grid: readonly FacetCell[];
  species: string | null;
  state: string | null;
  sort: BrowseSort;
}) {
  const [species, setSpecies] = useState(initialSpecies ?? "");
  const [state, setState] = useState(initialState ?? "");
  const [sort, setSort] = useState<BrowseSort>(initialSort);
  const facets = facetOptions(grid, { species: species || null, state: state || null });

  // A pick that empties the other menu's current choice clears it, or "Show me"
  // would open a page with no animals on it.
  function pickSpecies(next: string) {
    setSpecies(next);
    const states = facetOptions(grid, { species: next || null, state: null }).states;
    if (state && !states.some((o) => o.value === state)) setState("");
  }
  function pickState(next: string) {
    setState(next);
    const kinds = facetOptions(grid, { species: null, state: next || null }).species;
    if (species && !kinds.some((o) => o.value === species)) setSpecies("");
  }

  return (
    <form method="get" action="/animals" className="mt-8 flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Kind
        <select
          name="species"
          value={species}
          onChange={(e) => pickSpecies(e.target.value)}
          className="rounded-cuddly border-2 border-paw/40 bg-card px-3 py-2"
        >
          <option value="">Any animal</option>
          {facets.species.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value} ({option.count.toLocaleString("en-US")})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        State
        <select
          name="state"
          value={state}
          onChange={(e) => pickState(e.target.value)}
          className="rounded-cuddly border-2 border-paw/40 bg-card px-3 py-2"
        >
          <option value="">Anywhere</option>
          {facets.states.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value} ({option.count.toLocaleString("en-US")})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Sort
        <select
          name="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as BrowseSort)}
          className="rounded-cuddly border-2 border-paw/40 bg-card px-3 py-2"
        >
          {BROWSE_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-cuddly bg-leaf px-6 py-2.5 font-bold text-white transition-colors hover:bg-leaf-deep"
      >
        Show me
      </button>
      {(initialSpecies || initialState || initialSort !== DEFAULT_SORT) && (
        <Link href="/animals" className="pb-2.5 text-sm font-medium text-muted hover:text-foreground">
          Clear
        </Link>
      )}
    </form>
  );
}
