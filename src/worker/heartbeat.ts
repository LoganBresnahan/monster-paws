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

/**
 * The art worker's beat. Better Stack's heartbeat has this period and a 10-minute grace, so a dead worker or tunnel
 * alerts within 15 minutes, before a waiting painting's 30 (ADR-0010 as amended 2026-11-11).
 */
export const ART_HEARTBEAT_MS = 5 * 60 * 1000;
export const ART_HEARTBEAT_DB_TIMEOUT_MS = 30_000;

/**
 * Pings only once the database has answered through the tunnel: a live process behind a dead tunnel paints nothing,
 * so it must go as quiet as a dead one (ADR-0010 as amended 2026-11-11).
 */
export async function artHeartbeat(
  url: string | undefined,
  databaseAnswers: () => Promise<unknown>,
  ping: (url: string) => Promise<void>,
  timeoutMs: number = ART_HEARTBEAT_DB_TIMEOUT_MS,
): Promise<boolean> {
  if (!url) return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      databaseAnswers(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("the database did not answer in time")), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
  await ping(url);
  return true;
}
