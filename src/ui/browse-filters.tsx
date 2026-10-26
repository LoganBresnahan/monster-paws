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
import {
  BROWSE_SORTS,
  DEFAULT_SORT,
  RADII,
  browseSearch,
  facetOptions,
  type BrowseFilters,
  type BrowseQuery,
  type BrowseSort,
  type FacetCell,
  type FacetOption,
  type Radius,
} from "@/core/facets";

/**
 * The browse filters (ADR-0015 as amended 2026-10-04 and 2026-10-26). Still a
 * plain GET form — with JavaScript off it submits through "Show me" and shares
 * the same URL — but with JavaScript a change applies itself: each menu
 * recounts under the others' picks from the same grid the server counted, and
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

const subscribeNever = () => () => {};

function hrefFor(query: BrowseQuery): string {
  const search = browseSearch(query);
  return search.size ? `/animals?${search}` : "/animals";
}

/** "Surprise me" draws inside every pick and the scope; the sort means nothing to a random draw. */
function randomHref(query: BrowseQuery): string {
  const search = browseSearch({ ...query, sort: DEFAULT_SORT });
  return search.size ? `/animals/random?${search}` : "/animals/random";
}

type Menu = "species" | "state" | "age" | "sex";
const MENU_OPTIONS: Record<Menu, "species" | "states" | "ages" | "sexes"> = {
  species: "species",
  state: "states",
  age: "ages",
  sex: "sexes",
};

/**
 * A pick that leaves another menu's current choice with no animals clears that
 * choice, or the page would open empty. Repeated until nothing changes: one
 * clearing can empty a third menu's choice.
 */
function settle(grid: readonly FacetCell[], picks: BrowseFilters): BrowseFilters {
  let next = picks;
  for (let changed = true; changed; ) {
    changed = false;
    for (const menu of Object.keys(MENU_OPTIONS) as Menu[]) {
      const value = next[menu];
      if (!value) continue;
      const options = facetOptions(grid, { ...next, [menu]: null })[MENU_OPTIONS[menu]];
      if (!options.some((o) => o.value === value)) {
        next = { ...next, [menu]: null };
        changed = true;
      }
    }
  }
  return next;
}

const control = "rounded-cuddly border-2 border-paw/40 bg-card px-3 py-2";

function MenuSelect({
  label,
  name,
  value,
  any,
  options,
  onPick,
}: {
  label: string;
  name: string;
  value: string;
  any: string;
  options: FacetOption[];
  onPick: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <select name={name} value={value} onChange={(e) => onPick(e.target.value)} className={control}>
        <option value="">{any}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({option.count.toLocaleString("en-US")})
          </option>
        ))}
      </select>
    </label>
  );
}

export function BrowseFilterForm({ grid, query: fromUrl }: { grid: readonly FacetCell[]; query: BrowseQuery }) {
  const [query, setQuery] = useState(fromUrl);
  const [zipText, setZipText] = useState(fromUrl.zip ?? "");
  const facets = facetOptions(grid, query);
  const router = useRouter();
  const start = useContext(Pending)?.start;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // true once hydrated: until then "Show me" is the only way to apply a pick
  const live = useSyncExternalStore(subscribeNever, () => true, () => false);

  // Back and Clear change the URL under a mounted form; its picks follow the URL
  // here, during render. Never re-key the form instead: a remount after every
  // change throws keyboard focus off the menu the visitor is using.
  const urlKey = hrefFor(fromUrl);
  const [synced, setSynced] = useState(urlKey);
  if (synced !== urlKey) {
    setSynced(urlKey);
    setQuery(fromUrl);
    setZipText(fromUrl.zip ?? "");
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function apply(next: BrowseQuery) {
    setQuery(next);
    if (!start) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => start(() => router.push(hrefFor(next), { scroll: false })), APPLY_AFTER_MS);
  }

  function pick(menu: Menu, value: string) {
    apply({ ...query, ...settle(grid, { ...query, [menu]: value || null }) });
  }

  // A zip applies once it is whole, or once it is cleared; a partial one waits.
  function typeZip(raw: string) {
    const text = raw.replace(/\D/g, "").slice(0, 5);
    setZipText(text);
    if (text.length === 5 || (text === "" && query.zip)) apply({ ...query, zip: text || null });
  }

  const changed =
    fromUrl.species ||
    fromUrl.state ||
    fromUrl.age ||
    fromUrl.sex ||
    fromUrl.zip ||
    fromUrl.shelter ||
    fromUrl.sort !== DEFAULT_SORT;

  return (
    <form method="get" action="/animals" className="mt-8 flex flex-wrap items-end gap-4">
      <MenuSelect
        label="Kind"
        name="species"
        value={query.species ?? ""}
        any="Any animal"
        options={facets.species}
        onPick={(v) => pick("species", v)}
      />
      <MenuSelect
        label="Age"
        name="age"
        value={query.age ?? ""}
        any="Any age"
        options={facets.ages}
        onPick={(v) => pick("age", v)}
      />
      <MenuSelect
        label="Sex"
        name="sex"
        value={query.sex ?? ""}
        any="Either"
        options={facets.sexes}
        onPick={(v) => pick("sex", v)}
      />
      <MenuSelect
        label="State"
        name="state"
        value={query.state ?? ""}
        any="Anywhere"
        options={facets.states}
        onPick={(v) => pick("state", v)}
      />

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Near zip
          <input
            name="zip"
            value={zipText}
            onChange={(e) => typeZip(e.target.value)}
            inputMode="numeric"
            autoComplete="postal-code"
            pattern="[0-9]{5}"
            placeholder="60614"
            className={`${control} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Within
          <select
            name="miles"
            value={query.miles}
            onChange={(e) => apply({ ...query, miles: Number(e.target.value) as Radius })}
            className={control}
          >
            {RADII.map((miles) => (
              <option key={miles} value={miles}>
                {miles} miles
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Sort
        <select
          name="sort"
          value={query.sort}
          onChange={(e) => apply({ ...query, sort: e.target.value as BrowseSort })}
          className={control}
        >
          {BROWSE_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {/* The shelter view rides along with every change; only its chip's ✕ leaves it. */}
      {query.shelter && <input type="hidden" name="shelter" value={query.shelter} />}

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
        href={randomHref(query)}
        className="rounded-cuddly border-2 border-leaf px-5 py-2 font-bold text-leaf-deep transition-colors hover:bg-leaf hover:text-white"
      >
        Surprise me 🐾
      </a>
      {changed && (
        <Link href="/animals" className="pb-2.5 text-sm font-medium text-muted hover:text-foreground">
          Clear
        </Link>
      )}
    </form>
  );
}
