import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { INTENT_ID } from "@/core/donate/intent";
import { failureCode, scrubAddresses } from "@/core/observability";
import type { Db } from "@/db/client";
import { donationIntents, donations, donationStats, everyorgWebhookDecisions, everyorgWebhookPayloads } from "@/db/schema";
import { spoolDelivery, type StoredDelivery } from "./webhook-spool";

/**
 * The Every.org webhook (ADR-0027 §4). It is unsigned, so it is believed no
 * further than the intent it names: stored first, matched on our own id alone,
 * and anything else is kept and logged, never acted on. A row holds no donor: see
 * `storableBody`.
 */

/** About forty times the documented body. Never read past this: the body is held in memory and stored. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Compared as digests so the secret's length doesn't show in timing. An unset
 * secret refuses everything: `""` matching `""` would open the endpoint to anyone.
 */
export function secretMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);

/**
 * What a raw row keeps of the headers (ADR-0027 as amended 2026-10-22). The marker
 * is how we learn whether Every.org sends the auth token; our own secrets never
 * land in a row, whichever header they arrive in.
 */
export function redactHeaders(
  headers: Iterable<[string, string]>,
  secrets: { authToken?: string; pathSecret?: string },
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of headers) {
    if (secrets.authToken && value.includes(secrets.authToken)) kept[name] = "[our auth token]";
    else if (secrets.pathSecret && value.includes(secrets.pathSecret)) kept[name] = "[our path secret]";
    else if (CREDENTIAL_HEADERS.has(name.toLowerCase())) kept[name] = "[redacted]";
    else kept[name] = scrubAddresses(value);
  }
  return kept;
}

function parseBody(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Commas allowed because nothing has shown what a $1,000 gift looks like, and a real one must not fail on it.
const MONEY = /^(\d{1,10}|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/;
const EIN = /^\d{2}-?\d{7}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const plainMoney = (value: string) => value.replaceAll(",", "");

/**
 * Each field's shape, since a named field can still hold a person: a value that doesn't fit
 * is dropped, and named. `donationFields` reads through these too, because `donation_stats`
 * is never deleted, and so a decided row always holds what its decision read.
 */
const KEPT_SHAPES: Record<string, RegExp> = {
  event: /^[a-z_.]{1,64}$/,
  chargeId: /^[\w.:/+=-]{1,128}$/,
  partnerDonationId: INTENT_ID,
  amount: MONEY,
  netAmount: MONEY,
  currency: /^[A-Z]{3}$/,
  frequency: /^[A-Z_]{1,32}$/,
  donationDate: ISO_INSTANT,
  paymentMethod: /^[A-Za-z_-]{1,32}$/,
};
const KEPT_NONPROFIT_SHAPES: Record<string, RegExp> = {
  slug: /^[\w-]{1,128}$/,
  ein: EIN,
  name: /^[^@%<>]{1,200}$/,
};
const KEY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

function keepShaped(from: object, shapes: Record<string, RegExp>, prefix: string, droppedKeys: string[]): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(from)) {
    if (Object.hasOwn(shapes, key) && typeof value === "string" && shapes[key].test(value)) kept[key] = value;
    else droppedKeys.push(KEY_NAME.test(key) ? `${prefix}${key}` : `${prefix}[unnamed]`);
  }
  return kept;
}

/**
 * What a raw row keeps of a body: a list of what to keep, never of what to drop, so a
 * field Every.org adds tomorrow can't put a donor in a row. Never store `raw` itself,
 * which holds a name, an email and a street address (ADR-0027 as amended 2026-11-02,
 * the sanctioned departure from §4's "verbatim"). `droppedKeys` holds names, no values:
 * it is how a new field gets noticed. A body we can't read keeps only its size and a
 * hash keyed by our secret, because a bare hash of a short body can be guessed.
 */
export function storableBody(raw: string, parsed: Record<string, unknown> | null, pathSecret?: string): string {
  if (!parsed) {
    const bytes = Buffer.byteLength(raw);
    return JSON.stringify({
      unreadable: pathSecret ? { hmac: createHmac("sha256", pathSecret).update(raw).digest("hex"), bytes } : { bytes },
    });
  }
  const droppedKeys: string[] = [];
  const { toNonprofit, ...rest } = parsed;
  const kept: Record<string, unknown> = keepShaped(rest, KEPT_SHAPES, "", droppedKeys);
  if (toNonprofit && typeof toNonprofit === "object" && !Array.isArray(toNonprofit)) {
    kept.toNonprofit = keepShaped(toNonprofit, KEPT_NONPROFIT_SHAPES, "toNonprofit.", droppedKeys);
  } else if ("toNonprofit" in parsed) {
    droppedKeys.push("toNonprofit");
  }
  return JSON.stringify({ ...kept, droppedKeys: droppedKeys.sort() });
}

const einDigits = (ein: string) => ein.replace(/\D/g, "");

interface DonationFields {
  chargeId: string;
  amount: string;
  netAmount: string | null;
  currency: string;
  frequency: string;
  donatedAt: Date;
  nonprofit: { slug: string; ein: string; name: string };
}

const COMPLETED = "donation.completed";
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function donationFields(body: Record<string, unknown>): DonationFields | null {
  const { chargeId, amount, netAmount, currency, frequency, donationDate, toNonprofit } = body;
  const nonprofit = (toNonprofit ?? {}) as Record<string, unknown>;
  const fits = (value: unknown, shape: RegExp): value is string => nonEmpty(value) && shape.test(value);
  if (!fits(chargeId, KEPT_SHAPES.chargeId) || !fits(amount, MONEY) || Number(plainMoney(amount)) <= 0) return null;
  if (!fits(currency, KEPT_SHAPES.currency) || !fits(frequency, KEPT_SHAPES.frequency)) return null;
  if (!fits(nonprofit.slug, KEPT_NONPROFIT_SHAPES.slug) || !fits(nonprofit.ein, EIN) || !fits(nonprofit.name, KEPT_NONPROFIT_SHAPES.name)) return null;
  if (!fits(donationDate, ISO_INSTANT)) return null;
  const donatedAt = new Date(donationDate);
  if (Number.isNaN(donatedAt.getTime())) return null;
  return {
    chargeId,
    amount: plainMoney(amount),
    netAmount: fits(netAmount, MONEY) ? plainMoney(netAmount) : null,
    currency,
    frequency,
    donatedAt,
    nonprofit: { slug: nonprofit.slug, ein: nonprofit.ein, name: nonprofit.name },
  };
}

export type WebhookOutcome =
  | "recorded"
  | "replay"
  | "unparsable"
  | "no_partner_id"
  | "other_event"
  | "no_intent"
  | "closed_intent"
  | "charge_on_other_intent"
  | "nonprofit_mismatch"
  | "bad_fields"
  | "decision_failed"
  | "spooled";

export interface WebhookResult {
  /** `null` only on `spooled`: the delivery is a file, and has no row yet */
  payloadId: number | null;
  outcome: WebhookOutcome;
  /** the failed query's code, on `decision_failed` and `spooled` */
  code?: string;
  /** the raw row's id and an outcome, never a name, address or amount: this is what reaches the logs (ADR-0010) */
}

/** Everything a stored delivery keeps, worked out with no database. The raw body goes no further than this. */
export function prepareDelivery(delivery: {
  body: string;
  headers: Iterable<[string, string]>;
  secrets: { authToken?: string; pathSecret?: string };
}): StoredDelivery {
  const parsed = parseBody(delivery.body);
  // A donor can edit this in the link: anything that isn't our id's shape is no id at all.
  const partnerDonationId = nonEmpty(parsed?.partnerDonationId) && INTENT_ID.test(parsed.partnerDonationId) ? parsed.partnerDonationId : null;
  return {
    body: storableBody(delivery.body, parsed, delivery.secrets.pathSecret),
    headers: redactHeaders(delivery.headers, delivery.secrets),
    partnerDonationId,
    receivedAt: new Date(),
  };
}

/** Commits on its own, outside any decision, so a failure deciding never loses a body. */
export async function storeDelivery(db: Db, row: StoredDelivery): Promise<number> {
  const [payload] = await db.insert(everyorgWebhookPayloads).values(row).returning({ id: everyorgWebhookPayloads.id });
  return payload.id;
}

/**
 * Decides from the stored row alone, never the raw body: a replay has only the row, and
 * `donationFields` reads through the same shapes, so both ways reach one answer.
 */
export async function decideStored(
  db: Db,
  row: { id: number; body: string; partnerDonationId: string | null },
): Promise<WebhookResult> {
  const stored = parseBody(row.body);
  try {
    let outcome: WebhookOutcome | null = null;
    let fields: DonationFields | null = null;
    if (!stored || "unreadable" in stored) outcome = "unparsable";
    else if (!row.partnerDonationId) outcome = "no_partner_id";
    // Only a completed gift opens anything. The docs don't list `event`; the real body
    // carries it, and a bank gift that hasn't settled must not count (ADR-0027).
    else if (stored.event !== COMPLETED) outcome = "other_event";
    else if (!(fields = donationFields(stored))) outcome = "bad_fields";

    if (outcome) {
      await db.insert(everyorgWebhookDecisions).values({ payloadId: row.id, outcome }).onConflictDoNothing();
      return { payloadId: row.id, outcome };
    }
    return { payloadId: row.id, outcome: await decide(db, row.id, row.partnerDonationId!, fields!) };
  } catch (err) {
    return { payloadId: row.id, outcome: "decision_failed", code: failureCode(err) };
  }
}

/**
 * How long a delivery waits on the database. `createPool` sets no timeout, so during a failover an
 * insert can hang until Cloudflare gives up at about 100 s, and the sender has a failure by then.
 */
export const STORE_CLOCK_MS = 5_000;

export function withClock<T>(work: Promise<T>, ms: number = STORE_CLOCK_MS): Promise<T> {
  let timer: NodeJS.Timeout;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("database clock expired"), { code: "clock_expired" })), ms);
  });
  return Promise.race([work, clock]).finally(() => clearTimeout(timer));
}

/**
 * Throws only when the delivery could neither be stored nor spooled. A store that runs out its
 * clock may still land: with the replay that makes two raw rows, which decide to one donation
 * (ADR-0027 as amended 2026-11-03).
 */
export async function receiveWebhook(
  db: Db,
  delivery: {
    body: string;
    headers: Iterable<[string, string]>;
    secrets: { authToken?: string; pathSecret?: string };
  },
  options: { spoolDir?: string; clockMs?: number } = {},
): Promise<WebhookResult> {
  const row = prepareDelivery(delivery);
  let id: number;
  try {
    id = await withClock(storeDelivery(db, row), options.clockMs);
  } catch (err) {
    if (!options.spoolDir) throw err;
    await spoolDelivery(options.spoolDir, row);
    return { payloadId: null, outcome: "spooled", code: failureCode(err) };
  }
  try {
    return await withClock(decideStored(db, { ...row, id }), options.clockMs);
  } catch (err) {
    return { payloadId: id, outcome: "decision_failed", code: failureCode(err) };
  }
}

/** One transaction: a donation never lands without its stat, its closed intent and its decision. */
async function decide(db: Db, payloadId: number, partnerDonationId: string, fields: DonationFields): Promise<WebhookOutcome> {
  return db.transaction(async (tx): Promise<WebhookOutcome> => {
    const outcome = await decideLocked(tx, payloadId, partnerDonationId, fields);
    await tx.insert(everyorgWebhookDecisions).values({ payloadId, outcome }).onConflictDoNothing();
    return outcome;
  });
}

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function decideLocked(tx: DbTransaction, payloadId: number, partnerDonationId: string, fields: DonationFields): Promise<WebhookOutcome> {
  const [intent] = await tx
    .select()
    .from(donationIntents)
    .where(eq(donationIntents.id, partnerDonationId))
    .for("update");
  if (!intent) return "no_intent";

  if (intent.nonprofitSlug !== fields.nonprofit.slug || einDigits(intent.nonprofitEin) !== einDigits(fields.nonprofit.ein)) {
    return "nonprofit_mismatch";
  }

  if (intent.closedAt) {
    const [known] = await tx
      .select({ intentId: donations.intentId })
      .from(donations)
      .where(eq(donations.chargeId, fields.chargeId))
      .limit(1);
    return known?.intentId === intent.id ? "replay" : "closed_intent";
  }

  const inserted = await tx
    .insert(donations)
    .values({
      intentId: intent.id,
      webhookPayloadId: payloadId,
      chargeId: fields.chargeId,
      amount: fields.amount,
      netAmount: fields.netAmount,
      currency: fields.currency,
      frequency: fields.frequency,
      nonprofitSlug: fields.nonprofit.slug,
      nonprofitEin: fields.nonprofit.ein,
      nonprofitName: fields.nonprofit.name,
      donatedAt: fields.donatedAt,
    })
    .onConflictDoNothing({ target: donations.chargeId })
    .returning({ id: donations.id });
  // Not a replay: the row lock above sends those to the closed-intent branch, so
  // this charge belongs to another intent. Suspicious, and this intent stays open.
  if (inserted.length === 0) return "charge_on_other_intent";

  // Only when the donation was really inserted, or a replay counts a gift twice.
  // No account, intent, charge, name or email, ever (ADR-0027 §6).
  await tx.insert(donationStats).values({
    animalSource: intent.animalSource,
    animalExternalId: intent.animalExternalId,
    nonprofitSlug: fields.nonprofit.slug,
    amount: fields.amount,
    currency: fields.currency,
    frequency: fields.frequency,
    donatedOn: fields.donatedAt.toISOString().slice(0, 10),
  });
  await tx.update(donationIntents).set({ closedAt: sql`now()` }).where(eq(donationIntents.id, intent.id));
  return "recorded";
}

/** The donations recorded under these intents: what a thank-you page may say arrived. */
export async function donationsForIntents(db: Db, intentIds: readonly string[]) {
  if (intentIds.length === 0) return [];
  return db.select().from(donations).where(inArray(donations.intentId, [...intentIds]));
}
