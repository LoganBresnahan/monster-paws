import { eq, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ingestRuns } from "@/db/schema";
import { INGEST_POLL_INTERVAL_HOURS } from "@/worker/ingest-poll";

/**
 * One poll interval plus the heartbeat's 3-hour grace (ADR-0010 as amended
 * 2026-09-28): the uptime check and the heartbeat alert on the same missed
 * poll, and neither alerts on a poll its retries are still inside.
 */
export const POLL_STALE_AFTER_HOURS = INGEST_POLL_INTERVAL_HOURS + 3;

export type DbState = "up" | "down" | "unconfigured";

export interface Health {
  ok: boolean;
  db: DbState;
  /** the OLDEST source's newest complete run — one stale source is a stale poller */
  lastCompletePollAt: string | null;
  pollStale: boolean;
}

/**
 * Never ok without a database: the pre-database landing page was the only
 * build that could run without one, and a missing `DATABASE_URL` now is a
 * broken deploy the uptime check must see (ADR-0010).
 */
export function assessHealth(
  db: DbState,
  newestCompleteBySource: readonly Date[],
  now: Date,
): Health {
  const oldest = newestCompleteBySource.reduce<Date | null>(
    (m, d) => (!m || d < m ? d : m),
    null,
  );
  const pollStale =
    !oldest || now.getTime() - oldest.getTime() > POLL_STALE_AFTER_HOURS * 3_600_000;
  return {
    ok: db === "up" && !pollStale,
    db,
    lastCompletePollAt: oldest?.toISOString() ?? null,
    pollStale,
  };
}

/** Only runs where stage 5 reconciled count: a partial or empty run proves nothing about the feed (ADR-0014). */
export async function newestCompleteRuns(db: Db): Promise<Date[]> {
  const rows = await db
    .select({ source: ingestRuns.source, at: max(ingestRuns.finishedAt) })
    .from(ingestRuns)
    .where(eq(ingestRuns.complete, true))
    .groupBy(ingestRuns.source);
  return rows.flatMap((r) => (r.at ? [r.at] : []));
}
