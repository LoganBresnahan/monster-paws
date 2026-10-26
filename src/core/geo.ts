import { ZIP_CENTROIDS } from "@/core/zip-centroids";
import { ZIP_CODE } from "@/core/facets";

/**
 * Where a US zip is, for the browse radius filter (ADR-0015 as amended
 * 2026-10-26). Server only: the table is ~780 KB, so never import this from
 * `@/core/facets` or anything the filter island ships.
 */

export interface Point {
  lat: number;
  lon: number;
}

let table: Map<string, Point> | null = null;
let sorted: string[] = [];
const fallback = new Map<string, Point | null>();

function zips(): Map<string, Point> {
  if (!table) {
    table = new Map();
    for (const line of ZIP_CENTROIDS.split("\n")) {
      const [zip, lat, lon] = line.split(" ");
      table.set(zip, { lat: Number(lat), lon: Number(lon) });
    }
    sorted = [...table.keys()];
  }
  return table;
}

/**
 * The zip's centre, or for a zip the Census does not map — a PO Box, which is
 * where many small rescues receive mail (9.2% of visible animals, 2026-10-26) —
 * the numerically nearest mapped zip sharing its first three digits: the same
 * sectional center, so within a few miles. Never a guess outside those three
 * digits: a rescue placed in the wrong city is worse than one not placed.
 */
export function zipPoint(zip: string): Point | null {
  const known = zips();
  const five = zip.slice(0, 5);
  if (!ZIP_CODE.test(five)) return null;
  const exact = known.get(five);
  if (exact) return exact;
  if (fallback.has(five)) return fallback.get(five)!;
  const prefix = five.slice(0, 3);
  const target = Number(five);
  let best: string | null = null;
  for (const candidate of sorted) {
    if (!candidate.startsWith(prefix)) continue;
    if (best === null || Math.abs(Number(candidate) - target) < Math.abs(Number(best) - target)) best = candidate;
  }
  const point = best ? known.get(best)! : null;
  fallback.set(five, point);
  return point;
}

/** Great-circle distance in miles. */
export function milesBetween(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/** The candidate zips within `miles` of `origin`; a candidate with no known place is never inside. */
export function zipsWithin(origin: Point, miles: number, candidates: Iterable<string>): string[] {
  const inside: string[] = [];
  for (const zip of candidates) {
    const at = zipPoint(zip);
    if (at && milesBetween(origin, at) <= miles) inside.push(zip);
  }
  return inside;
}
