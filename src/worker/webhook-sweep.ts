import type { SweepReport } from "@/core/donate/webhook-replay";

export interface SweepAlert {
  message: string;
  level: "error" | "warning";
  /** true for a condition every sweep would report again until someone fixes it */
  repeats: boolean;
}

const QUIET_OUTCOMES = new Set(["recorded", "replay", "decision_failed"]);

/** Counts and codes only: the route's same words, for a delivery decided here instead (ADR-0010). */
export function webhookSweepAlerts(report: SweepReport): SweepAlert[] {
  const alerts: SweepAlert[] = [];
  if (report.staleFiles > 0) {
    alerts.push({ message: `webhook spool: ${report.staleFiles} delivery files past 10 minutes`, level: "error", repeats: true });
  }
  if (report.failure) {
    alerts.push({ message: `webhook sweep failed: ${report.failure}`, level: "error", repeats: true });
  }
  for (const [outcome, count] of Object.entries(report.decided)) {
    if (!QUIET_OUTCOMES.has(outcome) && count > 0) {
      alerts.push({ message: `everyorg webhook kept, not acted on: ${outcome}`, level: "warning", repeats: false });
    }
  }
  return alerts;
}
