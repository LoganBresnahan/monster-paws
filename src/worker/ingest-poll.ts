import type { Observation, SourceAdapter } from "@/core/ingest/observation";
import type { RawStore } from "@/core/ingest/pipeline";

export const INGEST_POLL = "ingest.poll";

/**
 * Daily, and never more often: RescueGroups' terms set a weekly-minimum
 * refresh (ADR-0006) and their listings are discovery data we re-read, not a
 * stream we can miss. Polling harder buys staleness we don't need and
 * goodwill we do.
 */
export const INGEST_POLL_CRON = "0 7 * * *";

export interface IngestPollPlan {
  register: boolean;
  cron: string;
  apiKey: string | null;
  /** why registration was skipped — logged, so a silent non-poller can't hide */
  skipReason?: string;
}

/**
 * Registration is a decision, kept out of the pg-boss wiring so it can be
 * tested. A worker with no key starts healthy and simply never polls, which
 * is the silent-poller failure ADR-0010 exists to make visible — so the
 * reason is returned, never swallowed.
 */
export function planIngestPoll(env: Record<string, string | undefined>): IngestPollPlan {
  const apiKey = env.RESCUEGROUPS_API_KEY?.trim();
  if (!apiKey) {
    return {
      register: false,
      cron: INGEST_POLL_CRON,
      apiKey: null,
      skipReason: `RESCUEGROUPS_API_KEY not set — ${INGEST_POLL} not registered`,
    };
  }
  return { register: true, cron: INGEST_POLL_CRON, apiKey };
}

export interface RawPollReport {
  observed: number;
  persisted: number;
  deduped: number;
}

/**
 * Stage 1 only, deliberately: the Postgres resolver and writer arrive with
 * ADR-0009 phases 6–8. Collecting raw from day one is the point — stages 2–4
 * replay over this corpus later, so nothing is lost by starting here, and
 * emitting events before the merge exists would put phantom rows in an
 * append-only log that no correction can remove.
 */
export async function runRawOnlyPoll(
  adapter: SourceAdapter<unknown>,
  rawStore: RawStore,
): Promise<RawPollReport> {
  const report: RawPollReport = { observed: 0, persisted: 0, deduped: 0 };

  for await (const obs of adapter.fetch()) {
    report.observed += 1;
    const { inserted } = await rawStore.persist(obs as Observation<unknown>);
    if (inserted) report.persisted += 1;
    else report.deduped += 1;
  }

  return report;
}
