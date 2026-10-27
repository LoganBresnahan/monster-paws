import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { confirmedAddress } from "@/core/outreach/contacts";
import { recordOutreachEvent } from "@/core/outreach/events";
import { WAVE_NAME } from "@/core/outreach/list";
import type { MailTransport, OutgoingMail } from "@/core/outreach/transport";
import { SHELTER_EXCLUSIONS, type ShelterExclusion } from "@/core/shelters";
import type { Db } from "@/db/client";
import { outreachEvents, type OutreachEventKind } from "@/db/schema";

/**
 * The guard every outreach send passes through (ADR-0029 §4–5). The rules
 * are numbers here, read from the record before EACH message, never counted
 * in memory from the start of a run: a second CLI, a retried run or a wave
 * split across two terminals all share one record.
 */
export const DAILY_CAP = 40;
export const MIN_SPACING_MS = 60_000;
export const FOLLOW_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** the first message and one follow-up — a third contact is a new decision, not a wave (ADR-0029 §5) */
export const MAX_SENDS_PER_SHELTER = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The pool or a transaction on it: the reads and the one write use nothing a transaction lacks. */
export type OutreachDb = Pick<Db, "select" | "insert" | "execute">;

/** What the record says about one shelter at one moment — the guard reads these, never the tables, so each rule is testable with a literal. */
export interface SendFacts {
  shelterExternalId: string;
  wave: string;
  /** `sent` rows, any wave, any shelter, in the last 24 hours */
  sentInLastDay: number;
  /** the latest `sent` row's `occurred_at`, any wave, any shelter */
  lastSentAt: Date | null;
  /** every `sent` to this shelter across waves, oldest first */
  sentToShelterAt: Date[];
  sentInThisWave: boolean;
  /** the kinds this shelter's thread holds besides `sent`: its answers, or a bounce */
  answered: OutreachEventKind[];
  confirmedTo: string | null;
  excluded: boolean;
}

export type SendVerdict =
  | { verdict: "send"; to: string }
  | { verdict: "wait"; ms: number }
  | { verdict: "refuse"; reason: string };

/**
 * The rules, in the order a reader would ask them. Pure: the facts carry the
 * clock, so a test can put the day boundary, the seventh day and the 41st
 * message exactly where it likes.
 */
export function judgeSend(facts: SendFacts, now: Date): SendVerdict {
  const refuse = (reason: string): SendVerdict => ({ verdict: "refuse", reason });

  if (!WAVE_NAME.test(facts.wave)) return refuse(`wave name '${facts.wave}' is not lowercase kebab-case`);
  if (facts.excluded) return refuse("the shelter asked us to stop — it is in SHELTER_EXCLUSIONS (ADR-0029 §5)");
  if (facts.answered.includes("opted_out")) return refuse("the shelter opted out — it is recorded in outreach_events (ADR-0029 §5)");
  if (facts.sentInThisWave) return refuse(`already sent in wave '${facts.wave}' (ADR-0029 §5)`);
  if (!facts.confirmedTo) return refuse("no confirmed address — a candidate is not an address to write to (ADR-0029 §2)");

  const answeredWith = facts.answered.filter((kind) => kind === "replied" || kind === "granted");
  if (answeredWith.length > 0) return refuse(`the shelter answered (${answeredWith.join(", ")}) — nothing more to ask (ADR-0029 §5)`);

  const prior = facts.sentToShelterAt.length;
  if (prior >= MAX_SENDS_PER_SHELTER) {
    return refuse(`already written to ${prior} times — one message and one follow-up is the whole budget (ADR-0029 §5)`);
  }
  if (prior === 1) {
    // A bounced first message reached nobody: a reminder to the same address
    // is a second bounce, and the >5% trigger is the ADR's stop sign.
    if (facts.answered.includes("bounced")) return refuse("the first message bounced — a new address is a new decision, not a follow-up (ADR-0029, revisit triggers)");
    // Measured from the FIRST send, never the latest: a reminder that is
    // itself seven days after a reminder would let a chain grow.
    const first = facts.sentToShelterAt[0];
    const since = now.getTime() - first.getTime();
    if (since < FOLLOW_UP_AFTER_MS) {
      const days = (since / DAY_MS).toFixed(1);
      return refuse(`a follow-up waits seven days from the first message; it has been ${days} (ADR-0029 §5)`);
    }
  }

  // A rolling day, not a calendar one in any zone: forty before midnight and
  // forty after is eighty in Gmail's eyes (ADR-0029 §4).
  if (facts.sentInLastDay >= DAILY_CAP) {
    return refuse(`${facts.sentInLastDay} sent in the last 24 hours — the day's ${DAILY_CAP} are spent (ADR-0029 §4)`);
  }

  if (facts.lastSentAt) {
    const gap = now.getTime() - facts.lastSentAt.getTime();
    // A record ahead of the clock is a skewed clock or a mistyped time, and a
    // wait computed from it is a year's sleep, not a minute's.
    if (gap < 0) return refuse(`the record's last send is ${-gap} ms in the future — the clock or a hand-recorded time is wrong`);
    if (gap < MIN_SPACING_MS) return { verdict: "wait", ms: MIN_SPACING_MS - gap };
  }

  return { verdict: "send", to: facts.confirmedTo };
}

/** Reads the facts the rules need, from `outreach_events` and `shelter_contacts`, at `now`. */
export async function loadSendFacts(
  db: OutreachDb,
  shelterExternalId: string,
  wave: string,
  now: Date,
  exclusions: readonly ShelterExclusion[] = SHELTER_EXCLUSIONS,
): Promise<SendFacts> {
  const sentKind = eq(outreachEvents.kind, "sent");
  // One read after another: inside the send's transaction these share one
  // client, which takes one query at a time.
  const [{ sentInLastDay }] = await db
    .select({ sentInLastDay: count() })
    .from(outreachEvents)
    .where(and(sentKind, gt(outreachEvents.occurredAt, new Date(now.getTime() - DAY_MS))));
  const [latest] = await db
    .select({ at: outreachEvents.occurredAt })
    .from(outreachEvents)
    .where(sentKind)
    .orderBy(desc(outreachEvents.occurredAt))
    .limit(1);
  const history = await db
    .select({ wave: outreachEvents.wave, kind: outreachEvents.kind, at: outreachEvents.occurredAt })
    .from(outreachEvents)
    .where(
      and(
        eq(outreachEvents.shelterExternalId, shelterExternalId),
        inArray(outreachEvents.kind, ["sent", "bounced", "replied", "opted_out", "granted"]),
      ),
    )
    .orderBy(outreachEvents.occurredAt, outreachEvents.id);
  const to = await confirmedAddress(db, shelterExternalId);

  const sent = history.filter((row) => row.kind === "sent");
  return {
    shelterExternalId,
    wave,
    sentInLastDay,
    lastSentAt: latest?.at ?? null,
    sentToShelterAt: sent.map((row) => row.at),
    sentInThisWave: sent.some((row) => row.wave === wave),
    answered: [...new Set(history.filter((row) => row.kind !== "sent").map((row) => row.kind))],
    confirmedTo: to,
    excluded: exclusions.some((e) => e.shelterExternalId === shelterExternalId),
  };
}

/** One shelter's message, rendered; the address is NOT here — the guard reads it from `shelter_contacts` (ADR-0029 §2). */
export interface WaveMessage {
  shelterExternalId: string;
  mail: Omit<OutgoingMail, "to">;
}

export interface WaveSendOptions {
  transport: MailTransport;
  now?: () => Date;
  /** injected so the suite does not sit out a minute between messages */
  sleep?: (ms: number) => Promise<void>;
  exclusions?: readonly ShelterExclusion[];
  /** written on every `sent` row of this run — how an override of the wave-health stop is recorded (ADR-0029, revisit triggers) */
  note?: string;
}

export interface WaveSendReport {
  wave: string;
  sent: { shelterExternalId: string; to: string; messageId: string }[];
  refused: { shelterExternalId: string; reason: string }[];
  /** the transport threw (no `sent` row) or the row could not be written after it answered (the error names the message id); the wave stopped there */
  failed: { shelterExternalId: string; error: string } | null;
  /** shelters not reached because the wave stopped early */
  remaining: string[];
}

type Attempt =
  | { verdict: "sent"; to: string; messageId: string }
  | { verdict: "wait"; ms: number }
  | { verdict: "refuse"; reason: string }
  | { verdict: "failed"; error: string };

/**
 * One message, judged and sent and recorded inside one transaction that
 * holds the outreach lock — two terminals, a retried run and a wave split in
 * two then take turns, and each reads the other's `sent` row before it
 * judges. The lock is held across the SMTP round trip on purpose: that is
 * the window the rules are about.
 */
/** The pool, or a transaction on it — a rehearsal runs the loop inside one it rolls back. */
export type SendDb = Pick<Db, "transaction">;

async function attempt(db: SendDb, wave: string, message: WaveMessage, options: WaveSendOptions, now: () => Date): Promise<Attempt> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('outreach-send'))`);
    const verdict = judgeSend(await loadSendFacts(tx, message.shelterExternalId, wave, now(), options.exclusions), now());
    if (verdict.verdict !== "send") return verdict;

    let messageId: string;
    try {
      ({ messageId } = await options.transport.send({ ...message.mail, to: verdict.to }));
    } catch (error) {
      return { verdict: "failed", error: (error as Error).message };
    }
    // Only now: a row before the transport answers claims a send that may not
    // have happened. And if the row cannot be written, the mail is still gone:
    // the report must carry the message id so a person can record it by hand.
    try {
      await recordOutreachEvent(tx, { shelterExternalId: message.shelterExternalId, wave, kind: "sent", occurredAt: now(), messageId, note: options.note ?? null });
    } catch (error) {
      return {
        verdict: "failed",
        error: `DELIVERED to ${verdict.to} as ${messageId} but the sent row was refused (${(error as Error).message}) — record it by hand before the next run, or this shelter is written to twice`,
      };
    }
    return { verdict: "sent", to: verdict.to, messageId };
  });
}

/**
 * Sends a wave one message at a time, the guard consulted before each. A
 * transport throw stops the wave, because the next send would hit the same
 * account; so does a `sent` row that could not be written. The cap stops it
 * too — the rest of the list is tomorrow's, not forty refusals.
 */
export async function sendWave(db: SendDb, wave: string, messages: readonly WaveMessage[], options: WaveSendOptions): Promise<WaveSendReport> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const report: WaveSendReport = { wave, sent: [], refused: [], failed: null, remaining: [] };

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    let outcome = await attempt(db, wave, message, options, now);
    if (outcome.verdict === "wait") {
      // Sleep outside the lock, then judge again from the record: another
      // runner may have sent meanwhile.
      await sleep(outcome.ms);
      outcome = await attempt(db, wave, message, options, now);
      // A clock that did not move is not a clock to send on.
      if (outcome.verdict === "wait") outcome = { verdict: "refuse", reason: `still ${outcome.ms} ms inside the minute after the last send` };
    }
    if (outcome.verdict === "refuse") {
      report.refused.push({ shelterExternalId: message.shelterExternalId, reason: outcome.reason });
      if (outcome.reason.includes("are spent")) {
        report.remaining = messages.slice(i + 1).map((m) => m.shelterExternalId);
        break;
      }
      continue;
    }
    if (outcome.verdict === "failed") {
      report.failed = { shelterExternalId: message.shelterExternalId, error: outcome.error };
      report.remaining = messages.slice(i + 1).map((m) => m.shelterExternalId);
      break;
    }
    report.sent.push({ shelterExternalId: message.shelterExternalId, to: outcome.to, messageId: outcome.messageId });
  }
  return report;
}
