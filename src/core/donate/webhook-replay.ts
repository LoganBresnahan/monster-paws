import { and, asc, isNull, lt, eq } from "drizzle-orm";
import { failureCode } from "@/core/observability";
import type { Db } from "@/db/client";
import { everyorgWebhookDecisions, everyorgWebhookPayloads } from "@/db/schema";
import { unlink } from "node:fs/promises";
import { decideStored, storeDelivery, withClock, type WebhookOutcome } from "./webhook";
import { readSpool } from "./webhook-spool";

/** Past this a file is reported: the sweep failing is otherwise silent (ADR-0027 as amended 2026-11-03). */
export const SPOOL_STALE_MS = 10 * 60 * 1000;
/** A younger undecided row is probably still inside its own request. */
const UNDECIDED_SETTLE_MS = 30 * 1000;
const UNDECIDED_BATCH = 100;

export interface SweepReport {
  replayed: number;
  decided: Partial<Record<WebhookOutcome, number>>;
  /** files still waiting past `SPOOL_STALE_MS`, unreadable ones included */
  staleFiles: number;
  /** the failure code, never its message, which can carry a query's parameters (ADR-0010) */
  failure: string | null;
}

/**
 * Files become rows, then undecided rows get decided, so a replayed delivery and one whose
 * decision failed take one path. Safe to repeat: a second raw row changes nothing, because the row
 * lock, `closed_at` and `donations_charge_uq` hold, and a file is deleted only once its row is stored.
 */
export async function sweepWebhookSpool(db: Db, dir: string, asOf: Date = new Date()): Promise<SweepReport> {
  const report: SweepReport = { replayed: 0, decided: {}, staleFiles: 0, failure: null };
  const entries = await readSpool(dir, asOf);
  let databaseUp = true;
  for (const entry of entries) {
    if (databaseUp && entry.row) {
      try {
        await withClock(storeDelivery(db, entry.row));
        await unlink(entry.file);
        report.replayed += 1;
        continue;
      } catch (err) {
        // One failure is enough to know: every other file would wait out the same clock.
        databaseUp = false;
        report.failure = failureCode(err);
      }
    }
    if (entry.ageMs > SPOOL_STALE_MS) report.staleFiles += 1;
  }
  if (!databaseUp) return report;

  try {
    const undecided = await withClock(
      db
        .select({ id: everyorgWebhookPayloads.id, body: everyorgWebhookPayloads.body, partnerDonationId: everyorgWebhookPayloads.partnerDonationId })
        .from(everyorgWebhookPayloads)
        .leftJoin(everyorgWebhookDecisions, eq(everyorgWebhookDecisions.payloadId, everyorgWebhookPayloads.id))
        .where(and(isNull(everyorgWebhookDecisions.payloadId), lt(everyorgWebhookPayloads.receivedAt, new Date(asOf.getTime() - UNDECIDED_SETTLE_MS))))
        .orderBy(asc(everyorgWebhookPayloads.id))
        .limit(UNDECIDED_BATCH),
    );
    for (const row of undecided) {
      const { outcome, code } = await withClock(decideStored(db, row));
      report.decided[outcome] = (report.decided[outcome] ?? 0) + 1;
      if (code) report.failure = code;
    }
  } catch (err) {
    report.failure = failureCode(err);
  }
  return report;
}
