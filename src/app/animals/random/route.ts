import { loadShelterZips, pickRandomAnimalId, STATE_CODE, type BrowseScope } from "@/core/browse";
import { sponsorableShelterIds } from "@/core/donate/intent";
import { donateConfigFromEnv } from "@/core/donate/link";
import { browseSearch, DEFAULT_SORT, parseRadius, ZIP_CODE } from "@/core/facets";
import { zipPoint, zipsWithin } from "@/core/geo";
import { getDb } from "@/db/client";

/**
 * "Surprise me" (ADR-0015 as amended 2026-10-05): a uniformly random visible
 * animal under the browse filters and scope in the query string (as amended
 * 2026-10-26: age, sex, a zip radius, one shelter). Never cache this — a cached
 * roll is the same animal for everyone — and never redirect to an absolute URL
 * built from the request, whose host is the container's own behind Caddy and
 * Cloudflare.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const one = (key: string) => params.get(key) || null;
  const rawState = one("state");
  const filters = {
    species: one("species"),
    state: rawState && STATE_CODE.test(rawState) ? rawState : null,
    age: one("age"),
    sex: one("sex"),
  };
  const db = getDb();
  const asOf = new Date();
  const rawZip = one("zip");
  const miles = parseRadius(one("miles"));
  const origin = rawZip && ZIP_CODE.test(rawZip) ? zipPoint(rawZip) : null;
  // Never the visitor's list of shelters, only the Sponsor button's own gate (ADR-0015 as amended 2026-11-04).
  const donateConfig = one("sponsorable") === "1" ? donateConfigFromEnv() : null;
  const sponsorable = donateConfig ? await sponsorableShelterIds(db, { ...donateConfig, asOf }) : [];
  const sponsorableOnly = sponsorable.length > 0;
  const scope: BrowseScope = {
    shelter: one("shelter"),
    zips: origin ? zipsWithin(origin, miles, await loadShelterZips(db, asOf)) : null,
    sponsorable: sponsorableOnly ? sponsorable : null,
  };

  const id = await pickRandomAnimalId(db, filters, asOf, undefined, scope);
  const back = browseSearch({ ...filters, zip: origin ? rawZip : null, miles, shelter: scope.shelter, sort: DEFAULT_SORT, sponsorable: sponsorableOnly });

  return new Response(null, {
    status: 307,
    headers: {
      Location: id === null ? (back.size ? `/animals?${back}` : "/animals") : `/animals/${id}`,
      "Cache-Control": "no-store",
    },
  });
}
