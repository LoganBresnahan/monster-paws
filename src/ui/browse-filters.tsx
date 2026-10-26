"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from "react";
import { BROWSE_SORTS, DEFAULT_SORT, facetOptions, type BrowseSort, type FacetCell } from "@/core/facets";

/**
 * The browse filters (ADR-0015 as amended 2026-10-04 and 2026-10-26). Still a
 * plain GET form — with JavaScript off it submits through "Show me" and shares
 * the same URL — but with JavaScript a change applies itself: each menu
 * recounts under the other's pick from the same grid the server counted, and
 * the list follows the URL, one history entry per change so Back undoes the
 * last one. `after` is deliberately absent: changing a filter starts at the
 * first animal, because a cursor from the old filter names a row the new one
 * may not contain.
 */

/** Long enough that arrowing through a closed menu (Windows fires a change per key) is one navigation. */
const APPLY_AFTER_MS = 400;

const Pending = createContext<{ pending: boolean; start: TransitionStartFunction } | null>(null);

/** Holds the navigation a filter change starts, so the results can show it is under way. */
export function BrowseShell({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition();
  return <Pending.Provider value={{ pending, start }}>{children}</Pending.Provider>;
}

/** The list under the filters, dimmed while a change loads — the old animals never pass for the new filter's. */
export function BrowseResults({ children }: { children: ReactNode }) {
  const pending = useContext(Pending)?.pending ?? false;
  return (
    <div aria-busy={pending} className={`transition-opacity ${pending ? "opacity-40" : ""}`}>
      {children}
    </div>
  );
}

function hrefFor(species: string, state: string, sort: BrowseSort): string {
  const query = new URLSearchParams();
  if (species) query.set("species", species);
  if (state) query.set("state", state);
  if (sort !== DEFAULT_SORT) query.set("sort", sort);
  return query.size ? `/animals?${query}` : "/animals";
}

const subscribeNever = () => () => {};
function randomHref(species: string, state: string): string {
  const query = new URLSearchParams();
  if (species) query.set("species", species);
  if (state) query.set("state", state);
  return query.size ? `/animals/random?${query}` : "/animals/random";
}

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
  const router = useRouter();
  const start = useContext(Pending)?.start;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // true once hydrated: until then "Show me" is the only way to apply a pick
  const live = useSyncExternalStore(subscribeNever, () => true, () => false);

  // Back and Clear change the URL under a mounted form; its picks follow the URL
  // here, during render. Never re-key the form instead: a remount after every
  // change throws keyboard focus off the menu the visitor is using.
  const fromUrl = `${initialSpecies ?? ""}|${initialState ?? ""}|${initialSort}`;
  const [synced, setSynced] = useState(fromUrl);
  if (synced !== fromUrl) {
    setSynced(fromUrl);
    setSpecies(initialSpecies ?? "");
    setState(initialState ?? "");
    setSort(initialSort);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function apply(nextSpecies: string, nextState: string, nextSort: BrowseSort) {
    if (!start) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => start(() => router.push(hrefFor(nextSpecies, nextState, nextSort), { scroll: false })),
      APPLY_AFTER_MS,
    );
  }

  // A pick that empties the other menu's current choice clears it, or the page
  // would open with no animals on it.
  function pickSpecies(next: string) {
    const states = facetOptions(grid, { species: next || null, state: null }).states;
    const nextState = state && !states.some((o) => o.value === state) ? "" : state;
    setSpecies(next);
    setState(nextState);
    apply(next, nextState, sort);
  }
  function pickState(next: string) {
    const kinds = facetOptions(grid, { species: null, state: next || null }).species;
    const nextSpecies = species && !kinds.some((o) => o.value === species) ? "" : species;
    setState(next);
    setSpecies(nextSpecies);
    apply(nextSpecies, next, sort);
  }
  function pickSort(next: BrowseSort) {
    setSort(next);
    apply(species, state, next);
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
          onChange={(e) => pickSort(e.target.value as BrowseSort)}
          className="rounded-cuddly border-2 border-paw/40 bg-card px-3 py-2"
        >
          {BROWSE_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {/* Only without JavaScript: with it a change applies itself, and a button
          that does nothing new reads as a step the visitor has missed. */}
      <button
        type="submit"
        hidden={live}
        className="rounded-cuddly bg-leaf px-6 py-2.5 font-bold text-white transition-colors hover:bg-leaf-deep"
      >
        Show me
      </button>
      {/* A plain <a>, never <Link>: prefetching would roll the dice for pages nobody opens. */}
      <a
        href={randomHref(species, state)}
        className="rounded-cuddly border-2 border-leaf px-5 py-2 font-bold text-leaf-deep transition-colors hover:bg-leaf hover:text-white"
      >
        Surprise me 🐾
      </a>
      {(initialSpecies || initialState || initialSort !== DEFAULT_SORT) && (
        <Link href="/animals" className="pb-2.5 text-sm font-medium text-muted hover:text-foreground">
          Clear
        </Link>
      )}
    </form>
  );
}
