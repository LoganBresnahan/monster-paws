/**
 * Duration copy for the animal pages (ADR-0015 decision 5). `asOf` is a
 * parameter, never `new Date()` inside the comparison, for the same reason
 * `visibleAnimals` takes one: a boundary is only testable when the caller owns
 * the clock.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30.44;
const YEAR_DAYS = 365.25;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * A future timestamp reads as "today", never "in -3 days": a forward wall-clock
 * step writes a `last_seen_at` ahead of real time and no page may present that
 * as a duration (ADR-0014's forward-step carry-in — the ingest path has no
 * reference clock to correct it with).
 */
export function agoInWords(when: Date, asOf: Date = new Date()): string {
  const days = Math.floor((asOf.getTime() - when.getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 45) return `${plural(days, "day")} ago`;
  const months = Math.round(days / MONTH_DAYS);
  if (months < 22) return `${plural(months, "month")} ago`;
  return `${plural(Math.round(days / YEAR_DAYS), "year")} ago`;
}

/**
 * Always UTC: an ISR page is rendered once and served to every timezone, so a
 * server-local date would be wrong for most readers and would change meaning
 * when the droplet moves.
 */
export function formatDate(when: Date): string {
  return when.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
