/**
 * The poll's retry policy and the heartbeat ping it implies (ADR-0010 as
 * amended 2026-09-28 and 2026-09-29).
 *
 * The heartbeat's grace is 3 hours; every retry must land inside it, or a poll
 * that recovers on its last attempt still pages someone.
 */
export const INGEST_POLL_RETRY = {
  retryLimit: 2,
  retryDelay: 600,
  retryBackoff: true,
} as const;

export interface Attempt {
  retryCount: number;
  retryLimit: number;
}

/**
 * The URL to ping for this attempt's outcome, or `null` for none. A failure
 * pings `/fail` only on the FINAL attempt: an earlier one is followed by a
 * retry, and opening an incident for a failure the retry fixes is the alert
 * fatigue that gets alerts ignored.
 */
export function heartbeatPing(
  url: string | undefined,
  outcome: "success" | "failure",
  attempt: Attempt,
): string | null {
  if (!url) return null;
  if (outcome === "success") return url;
  return attempt.retryCount >= attempt.retryLimit ? `${url.replace(/\/$/, "")}/fail` : null;
}
