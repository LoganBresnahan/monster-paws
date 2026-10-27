import { outreachEvents, type OutreachEventKind } from "@/db/schema";
import { OUTREACH_EVENT_KINDS } from "@/core/outreach/events";
import type { Db } from "@/db/client";

/**
 * The ADR's revisit triggers as numbers per wave (ADR-0029, Revisit
 * triggers): a bounce rate over 5% or any complaint stops the next wave;
 * replies under one in ten after two waves say the message is wrong, not
 * the volume.
 */
export const BOUNCE_STOP = 0.05;
export const REPLY_FLOOR = 0.1;
export const COMPLAINT = /\b(complain\w*|spam|abuse)\b/i;

export interface WaveHealth {
  wave: string;
  /** null for a wave nothing was sent in — a bounce or reply recorded under a name no send carries */
  firstSentAt: Date | null;
  counts: Record<OutreachEventKind, number>;
  /** bounced / sent, or null when nothing was sent: a zero-send wave is neither divided by nor healthy */
  bounceRate: number | null;
  replyRate: number | null;
  /** notes on any of the wave's events that read as a complaint */
  complaints: string[];
}

export function tallyWaves(rows: readonly { wave: string; kind: OutreachEventKind; occurredAt: Date; note: string | null }[]): WaveHealth[] {
  const waves = new Map<string, WaveHealth>();
  for (const row of rows) {
    let health = waves.get(row.wave);
    if (!health) {
      health = {
        wave: row.wave,
        firstSentAt: null,
        counts: Object.fromEntries(OUTREACH_EVENT_KINDS.map((k) => [k, 0])) as Record<OutreachEventKind, number>,
        bounceRate: null,
        replyRate: null,
        complaints: [],
      };
      waves.set(row.wave, health);
    }
    health.counts[row.kind]++;
    if (row.kind === "sent" && (health.firstSentAt === null || row.occurredAt < health.firstSentAt)) health.firstSentAt = row.occurredAt;
    if (row.note && COMPLAINT.test(row.note)) health.complaints.push(row.note);
  }
  for (const health of waves.values()) {
    const sent = health.counts.sent;
    health.bounceRate = sent > 0 ? health.counts.bounced / sent : null;
    health.replyRate = sent > 0 ? health.counts.replied / sent : null;
  }
  // Waves in the order they were sent; the ones nothing was sent in last, by name.
  return [...waves.values()].sort((a, b) => {
    if (a.firstSentAt && b.firstSentAt) return a.firstSentAt.getTime() - b.firstSentAt.getTime() || a.wave.localeCompare(b.wave);
    if (a.firstSentAt) return -1;
    if (b.firstSentAt) return 1;
    return a.wave.localeCompare(b.wave);
  });
}

export async function waveHealth(db: Pick<Db, "select">): Promise<WaveHealth[]> {
  const rows = await db
    .select({ wave: outreachEvents.wave, kind: outreachEvents.kind, occurredAt: outreachEvents.occurredAt, note: outreachEvents.note })
    .from(outreachEvents);
  return tallyWaves(rows);
}

export type LiveGate = { ok: true; warnings: string[] } | { ok: false; reason: string; warnings: string[] };

/**
 * Whether a live wave may start, read from the previous wave — the latest
 * one anything was sent in, other than the wave being sent, which may be
 * resuming. Pure: the CLI loads, this judges.
 */
export function liveSendGate(health: readonly WaveHealth[], wave: string): LiveGate {
  const sentIn = health.filter((h) => h.firstSentAt !== null && h.wave !== wave);
  const previous = sentIn.at(-1);
  const warnings: string[] = [];

  if (sentIn.length >= 2) {
    const lastTwo = sentIn.slice(-2);
    const sent = lastTwo.reduce((n, h) => n + h.counts.sent, 0);
    const replied = lastTwo.reduce((n, h) => n + h.counts.replied, 0);
    if (replied / sent < REPLY_FLOOR) {
      warnings.push(
        `${replied} replies to ${sent} messages across '${lastTwo[0].wave}' and '${lastTwo[1].wave}' — under one in ten: rethink the message, not the volume (ADR-0029, revisit triggers)`,
      );
    }
  }

  if (!previous) return { ok: true, warnings };
  if (previous.complaints.length > 0) {
    return { ok: false, reason: `wave '${previous.wave}' has a complaint on record: "${previous.complaints[0]}" — stop, and fix the list or the message (ADR-0029, revisit triggers)`, warnings };
  }
  if (previous.bounceRate !== null && previous.bounceRate > BOUNCE_STOP) {
    const pct = (previous.bounceRate * 100).toFixed(1);
    return { ok: false, reason: `wave '${previous.wave}' bounced ${previous.counts.bounced} of ${previous.counts.sent} (${pct}%) — over 5%: fix the list before the next wave (ADR-0029, revisit triggers)`, warnings };
  }
  return { ok: true, warnings };
}
