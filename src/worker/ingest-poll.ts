import type { IngestRunReport } from "@/core/ingest/pipeline";

export const INGEST_POLL = "ingest.poll";

/**
 * Daily, and never more often: RescueGroups' terms set a weekly-minimum
 * refresh (ADR-0006) and their listings are discovery data we re-read, not a
 * stream we can miss. Polling harder buys staleness we don't need and
 * goodwill we do.
 */
export const INGEST_POLL_CRON = "0 7 * * *";

/** What the cron above means in hours — change them together, or `/api/health` ages the poll against the wrong clock. */
export const INGEST_POLL_INTERVAL_HOURS = 24;

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

export interface PollArgs {
  maxPages?: number;
  maxDailyDisappearanceRate?: number;
}

/**
 * `ingest poll` flags. Throws on a malformed value rather than passing it on:
 * `NaN` compares false against every rate, so a typo in the gate override would
 * switch the gate off instead of raising it (ADR-0014 as amended 2026-09-30).
 */
export function parsePollArgs(args: readonly string[]): PollArgs {
  const value = (name: string): number | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : Number(args[i + 1]);
  };
  const maxPages = value("--max-pages");
  if (maxPages !== undefined && !(Number.isInteger(maxPages) && maxPages > 0)) {
    throw new Error("--max-pages takes a whole number of pages, e.g. 2");
  }
  const maxDailyDisappearanceRate = value("--max-daily-disappearance");
  if (
    maxDailyDisappearanceRate !== undefined &&
    !(maxDailyDisappearanceRate > 0 && maxDailyDisappearanceRate <= 1)
  ) {
    throw new Error("--max-daily-disappearance takes a rate in (0, 1], e.g. 0.3");
  }
  return { maxPages, maxDailyDisappearanceRate };
}

export interface GateAlert {
  message: string;
  level: "error";
  tags: Record<string, string>;
}

/**
 * What the worker reports when stage 5 refused a wave, or null. A refusal is
 * not a failed job — retrying re-fetches the same feed — but it needs a person
 * today, not when `/api/health` goes stale in 27 h (ADR-0014 as amended
 * 2026-09-30).
 */
export function gateAlert(report: Pick<IngestRunReport, "gateRefused" | "lifecycleSkipped">): GateAlert | null {
  if (!report.gateRefused) return null;
  return {
    message: report.lifecycleSkipped ?? "disappearance gate refused the run (ADR-0014)",
    level: "error",
    tags: { job: INGEST_POLL, gate: "disappearance" },
  };
}
