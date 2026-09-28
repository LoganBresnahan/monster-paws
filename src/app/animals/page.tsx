import type { Metadata } from "next";
import Link from "next/link";
import {
  BROWSE_PAGE_SIZE,
  STATE_CODE,
  facetOptions,
  loadBrowsePage,
  loadCardDisplay,
  loadFacetGrid,
  parseCursor,
  type BrowseFilters,
} from "@/core/browse";
import { getDb } from "@/db/client";
import { AnimalCard, speciesEmoji } from "@/ui/animal";
import { agoInWords, formatDate } from "@/ui/dates";

/**
 * The browse page (ADR-0015 decision 5 as amended). Like the detail page it
 * reaches the database only through helpers that compose the ONE visibility
 * predicate — `loadBrowsePage`, `loadFacetGrid`, `loadCardDisplay` — and it
 * renders a photo only through the licensed display row those helpers picked.
 *
 * No Pet Adoption Tracker pixel here: the API terms owe one on every pet DETAIL
 * page (ADR-0006 decision 2), and a pixel fired per card would report 24 views
 * of animals nobody opened.
 */

/**
 * Rendered per request, not ISR: filters and the cursor are search params, so
 * there is no finite set of URLs to revalidate — and dynamic is FRESHER than
 * the hour decision 1 buys the detail page, never staler. Measured on the 64k
 * corpus: 0.55 ms for the page query, 30 ms for the facet grid.
 */
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Animals — Monster Paws",
  description:
    "Real animals waiting in real shelters, longest-waiting first. Every listing links back to the shelter that published it.",
};

/**
 * A filter is taken only when the corpus actually offers it, so a hand-typed
 * or stale URL cannot open a page that is empty for a reason nobody can see.
 * The state check is the same `^[A-Z]{2}$` the options are built from: 27
 * animals still carry a junk `T` state that replay cannot retract.
 */
function filtersFrom(
  params: Record<string, string | string[] | undefined>,
  known: { species: Set<string>; states: Set<string> },
): BrowseFilters {
  const one = (value: string | string[] | undefined) =>
    typeof value === "string" && value.length > 0 ? value : null;
  const species = one(params.species);
  const state = one(params.state);
  return {
    species: species && known.species.has(species) ? species : null,
    state: state && STATE_CODE.test(state) && known.states.has(state) ? state : null,
  };
}

function hrefWith(filters: BrowseFilters, after?: string): string {
  const query = new URLSearchParams();
  if (filters.species) query.set("species", filters.species);
  if (filters.state) query.set("state", filters.state);
  if (after) query.set("after", after);
  const suffix = query.toString();
  return suffix ? `/animals?${suffix}` : "/animals";
}

/** The inversion DIRECTION asks for, said plainly: a long wait is the reason to look, never a discount. */
function waitingLine(listedAt: Date | null, asOf: Date): string | null {
  if (!listedAt) return null;
  const ago = agoInWords(listedAt, asOf);
  const waiting = ago.endsWith(" ago") ? `waiting ${ago.slice(0, -" ago".length)}` : "just listed";
  return `Listed ${formatDate(listedAt)} · ${waiting}`;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const asOf = new Date();
  const params = await searchParams;
  const db = getDb();

  const grid = await loadFacetGrid(db, asOf);
  const known = {
    species: new Set(grid.map((cell) => cell.species)),
    states: new Set(grid.flatMap((cell) => (cell.state ? [cell.state] : []))),
  };
  const filters = filtersFrom(params, known);
  const facets = facetOptions(grid, filters);

  const page = await loadBrowsePage(
    db,
    filters,
    parseCursor(typeof params.after === "string" ? params.after : null),
    asOf,
  );
  const display = await loadCardDisplay(
    db,
    page.animals.map((animal) => animal.id),
    asOf,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12">
      <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
        ← Monster Paws
      </Link>

      <h1 className="mt-8 text-3xl font-bold">Animals waiting</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Longest-waiting first — the ones who have been listed the longest come before everyone
        else. Every animal here is real, and every listing links back to the shelter that
        published it.
      </p>

      {/* A plain GET form: no client island, no JavaScript, and a shareable URL
          for every combination. `after` is deliberately absent — changing a
          filter starts at the first animal, because a cursor from the old
          filter names a row the new one may not contain. */}
      <form method="get" action="/animals" className="mt-8 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Kind
          <select
            name="species"
            defaultValue={filters.species ?? ""}
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
            defaultValue={filters.state ?? ""}
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

        <button
          type="submit"
          className="rounded-cuddly bg-leaf px-6 py-2.5 font-bold text-white transition-colors hover:bg-leaf-deep"
        >
          Show me
        </button>
        {(filters.species || filters.state) && (
          <Link href="/animals" className="pb-2.5 text-sm font-medium text-muted hover:text-foreground">
            Clear
          </Link>
        )}
      </form>

      {page.animals.length === 0 ? (
        <p className="mt-12 text-lg text-muted">
          No animals match that yet.{" "}
          <Link href="/animals" className="font-medium text-foreground underline">
            Show every animal
          </Link>
          .
          {/* If this is empty with no filters at all, the corpus is there but
              `source_updated_at` is null on every identity, which hides every
              animal: run `npm run ingest -- replay rescuegroups` before
              believing it (ADR-0015 as amended). */}
        </p>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {page.animals.map((animal) => {
            const licensed = display.get(animal.id);
            const place = [animal.city, animal.state].filter(Boolean).join(", ");
            return (
              <AnimalCard
                key={animal.id}
                href={`/animals/${animal.id}`}
                name={animal.name}
                facts={[animal.breed ?? animal.species, place].filter(Boolean).join(" · ")}
                photo={licensed?.photos[0]}
                footer={waitingLine(animal.listedAt, asOf) ?? undefined}
                fallbackEmoji={speciesEmoji(animal.species)}
              />
            );
          })}
        </div>
      )}

      {page.nextCursor && (
        <p className="mt-10">
          <Link
            href={hrefWith(filters, page.nextCursor)}
            className="inline-block rounded-cuddly border-2 border-paw px-6 py-3 font-bold transition-colors hover:bg-paw/10"
          >
            Next {BROWSE_PAGE_SIZE} animals →
          </Link>
          {/* Forward only in v1: there is no `?before=`, so Back is the
              browser's own (ADR-0015 as amended). */}
        </p>
      )}

      <p className="mt-12 text-sm text-muted">
        Listings refresh at most once a day, so ours can be behind a shelter&apos;s — always
        confirm with them before making plans. We show animals their shelter has kept up to date;
        nothing here says &ldquo;available now&rdquo;.
      </p>
    </main>
  );
}
