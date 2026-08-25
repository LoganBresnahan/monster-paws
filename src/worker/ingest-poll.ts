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
