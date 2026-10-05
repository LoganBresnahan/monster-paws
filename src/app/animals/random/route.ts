import { pickRandomAnimalId, STATE_CODE } from "@/core/browse";
import { getDb } from "@/db/client";

/**
 * "Surprise me" (ADR-0015 as amended 2026-10-05): a uniformly random visible
 * animal under the browse filters in the query string. Never cache this — a
 * cached roll is the same animal for everyone — and never redirect to an
 * absolute URL built from the request, whose host is the container's own
 * behind Caddy and Cloudflare.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const species = params.get("species") || null;
  const rawState = params.get("state");
  const state = rawState && STATE_CODE.test(rawState) ? rawState : null;

  const id = await pickRandomAnimalId(getDb(), { species, state });
  const query = new URLSearchParams();
  if (species) query.set("species", species);
  if (state) query.set("state", state);
  const back = query.size ? `/animals?${query}` : "/animals";

  return new Response(null, {
    status: 307,
    headers: { Location: id === null ? back : `/animals/${id}`, "Cache-Control": "no-store" },
  });
}
