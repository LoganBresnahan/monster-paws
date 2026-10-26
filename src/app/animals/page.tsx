import type { Metadata } from "next";
import Link from "next/link";
import {
  BROWSE_PAGE_SIZE,
  STATE_CODE,
  loadBrowsePage,
  loadCardDisplay,
  loadFacetGrid,
  loadShelter,
  loadShelterZips,
  parseCursor,
  parseSort,
  type BrowseFilters,
  type BrowsePosition,
  type BrowseScope,
  type FacetCell,
} from "@/core/browse";
import { browseSearch, parseRadius, ZIP_CODE, type BrowseQuery } from "@/core/facets";
import { zipPoint, zipsWithin } from "@/core/geo";
import { getDb } from "@/db/client";
import { AnimalCard, speciesEmoji } from "@/ui/animal";
import { BrowseFilterForm, BrowseResults, BrowseShell } from "@/ui/browse-filters";
import { agoInWords, formatDate } from "@/ui/dates";
import { waitingTeaser } from "@/ui/text";
import { SiteLogo } from "@/ui/site-logo";

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
    "Real animals waiting in real shelters, newest listings first. Every listing links back to the shelter that published it.",
};

/**
 * A filter is taken only when the corpus actually offers it, so a hand-typed
 * or stale URL cannot open a page that is empty for a reason nobody can see.
 * The state check is the same `^[A-Z]{2}$` the options are built from: 27
 * animals still carry a junk `T` state that replay cannot retract.
 */
const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value.length > 0 ? value : null;

function filtersFrom(params: Record<string, string | string[] | undefined>, grid: readonly FacetCell[]): BrowseFilters {
  const has = (key: "species" | "state" | "age" | "sex", value: string | null) =>
    value !== null && grid.some((cell) => cell[key] === value);
  const species = one(params.species);
  const state = one(params.state);
  const age = one(params.age);
  const sex = one(params.sex);
  return {
    species: has("species", species) ? species : null,
    state: state && STATE_CODE.test(state) && has("state", state) ? state : null,
    age: has("age", age) ? age : null,
    sex: has("sex", sex) ? sex : null,
  };
}

/** `after` wins when a hand-edited URL carries both: forward is the common path, and either is a valid page. */
function positionFrom(params: Record<string, string | string[] | undefined>): BrowsePosition {
  const after = parseCursor(typeof params.after === "string" ? params.after : null);
  if (after) return { after };
  const before = parseCursor(typeof params.before === "string" ? params.before : null);
  return before ? { before } : null;
}

function hrefWith(query: BrowseQuery, position?: { after: string } | { before: string }): string {
  const search = browseSearch(query);
  if (position && "after" in position) search.set("after", position.after);
  if (position && "before" in position) search.set("before", position.before);
  const suffix = search.toString();
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

  // The scope first (ADR-0015 as amended 2026-10-26): one shelter, and the
  // shelter zips within a radius of the visitor's. A zip we cannot place is
  // said so on the page and limits nothing, never an empty list with no reason.
  const shelterParam = one(params.shelter);
  const shelter = shelterParam ? await loadShelter(db, shelterParam, asOf) : null;
  const zipParam = one(params.zip);
  const zip = zipParam && ZIP_CODE.test(zipParam) ? zipParam : null;
  const miles = parseRadius(one(params.miles));
  const origin = zip ? zipPoint(zip) : null;
  const zips = origin ? zipsWithin(origin, miles, await loadShelterZips(db, asOf)) : null;
  const scope: BrowseScope = { shelter: shelter?.id ?? null, zips };
  const scoped = scope.shelter !== null || scope.zips !== null;

  const grid = await loadFacetGrid(db, asOf, undefined, scope);
  // A pick is kept when the whole visible set offers it, not only this scope: a
  // dog search that narrows to a zip with no dogs shows "none near you", never
  // silently every animal nearby.
  const filters = filtersFrom(params, scoped ? await loadFacetGrid(db, asOf) : grid);
  const sort = parseSort(typeof params.sort === "string" ? params.sort : null);
  const query: BrowseQuery = { ...filters, zip: origin ? zip : null, miles, shelter: scope.shelter, sort };

  const page = await loadBrowsePage(db, filters, positionFrom(params), asOf, undefined, sort, scope);
  const teaser = waitingTeaser(page.nextNames);
  const display = await loadCardDisplay(
    db,
    page.animals.map((animal) => animal.id),
    asOf,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <h1 className="mt-8 text-3xl font-bold">Animals waiting</h1>
      <p className="mt-2 max-w-2xl text-muted">
        {sort === "longest"
          ? "Longest-waiting first — the ones who have been listed the longest come before everyone else."
          : "Newest listings first — new faces every day."}{" "}
        Every animal here is real, and every listing links back to the shelter that published it.
      </p>

      <BrowseShell>
        <BrowseFilterForm grid={grid} query={query} />

        {shelter && (
          <p className="mt-6 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-leaf/15 px-4 py-1.5 font-semibold text-leaf-deep">
              Animals from {shelter.name ?? "one shelter"}
              <Link
                href={hrefWith({ ...query, shelter: null })}
                aria-label={`Show animals from every shelter, not only ${shelter.name ?? "this one"}`}
                className="rounded-full px-1.5 text-lg leading-none hover:bg-leaf/20"
              >
                ✕
              </Link>
            </span>
          </p>
        )}
        {zip && !origin && (
          <p className="mt-6 text-muted">
            We couldn&apos;t place zip {zip}, so this list isn&apos;t limited by distance.
          </p>
        )}

        <BrowseResults>
          {page.animals.length === 0 ? (
            <p className="mt-12 text-lg text-muted">
              {zips && zips.length === 0
                ? `No shelters we list are within ${miles} miles of ${zip}. A wider radius may reach one.`
                : "No animals match that yet."}{" "}
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

          {(page.prevCursor || page.nextCursor) && (
            <nav aria-label="Pages" className="mt-10 flex flex-wrap items-start justify-between gap-4">
              {page.prevCursor ? (
                <Link
                  href={hrefWith(query, { before: page.prevCursor })}
                  className="inline-block rounded-cuddly border-2 border-paw px-6 py-3 font-bold transition-colors hover:bg-paw/10"
                >
                  ← Previous {BROWSE_PAGE_SIZE}
                </Link>
              ) : (
                <span />
              )}
              {page.nextCursor && (
                <div className="flex flex-col items-end gap-2 text-right">
                  <Link
                    href={hrefWith(query, { after: page.nextCursor })}
                    className="inline-block rounded-cuddly border-2 border-paw px-6 py-3 font-bold transition-colors hover:bg-paw/10"
                  >
                    Next {BROWSE_PAGE_SIZE} animals →
                  </Link>
                  {teaser && <p className="max-w-xs text-sm text-muted">{teaser}</p>}
                </div>
              )}
            </nav>
          )}
        </BrowseResults>
      </BrowseShell>

      <p className="mt-12 text-sm text-muted">
        Listings refresh at most once a day, so ours can be behind a shelter&apos;s — always
        confirm with them before making plans. We show animals their shelter has kept up to date;
        nothing here says &ldquo;available now&rdquo;.
      </p>
    </main>
  );
}
