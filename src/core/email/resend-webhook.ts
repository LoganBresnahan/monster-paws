import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, inArray, isNotNull, isNull, and } from "drizzle-orm";
import type { Db } from "@/db/client";
import { donationIntents, emailSuppressions, keepsake, paintingEmailSends, resendWebhookEvents } from "@/db/schema";
import { exactDigest, inboxDigest } from "@/core/email/suppression";

/** The docs state no number (read 2026-11-03), so this is ours: long enough for clock drift, short enough to stop a replayed capture. */
const TOLERANCE_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Svix's scheme, by hand so there is no new dependency: an HMAC-SHA256 of `id.timestamp.body` under
 * the base64 part of the secret. Always over the raw body: the signature breaks on any change to it.
 */
export function verifyResendSignature(rawBody: string, headers: SvixHeaders, secret: string, now: number = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > TOLERANCE_MS) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type Outcome = "replay" | "unreadable" | "ignored" | "erased" | "suppressed";

interface ResendEvent {
  type?: unknown;
  data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown } };
}

/** The gift this mail belongs to, through the provider id on its send row: the event never names one, and its `to` is never stored. */
async function intentOfEmail(tx: Pick<Db, "select">, emailId: string): Promise<string | null> {
  const [row] = await tx
    .select({ intentId: keepsake.intentId })
    .from(paintingEmailSends)
    .innerJoin(keepsake, eq(keepsake.id, paintingEmailSends.keepsakeId))
    .where(eq(paintingEmailSends.providerId, emailId))
    .limit(1);
  return row?.intentId ?? null;
}

/**
 * One delivery, once: `svix-id` is the key, because a retry keeps it. The row holds only that id, the
 * event's type and Resend's own mail id, and never the event's `to`, so it can't name a donor
 * (ADR-0027 as amended 2026-11-02). Erases on `email.delivered`, never `email.sent`, which fires before
 * any delivery is tried. A complaint is a person's stop, so like an unsubscribe it covers the inbox;
 * a bounce stays exact, since a server can treat `+` literally (ADR-0035, question 6).
 */
export async function receiveResendEvent(db: Db, svixId: string, rawBody: string, key: string): Promise<Outcome> {
  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return "unreadable";
  }
  const type = typeof event.type === "string" ? event.type : "unknown";
  const emailId = typeof event.data?.email_id === "string" ? event.data.email_id : null;
  const to = Array.isArray(event.data?.to) && typeof event.data.to[0] === "string" ? (event.data.to[0] as string) : null;

  return db.transaction(async (tx) => {
    const fresh = await tx
      .insert(resendWebhookEvents)
      .values({ svixId, eventType: type, emailId })
      .onConflictDoNothing()
      .returning({ svixId: resendWebhookEvents.svixId });
    if (fresh.length === 0) return "replay";

    if (type === "email.delivered") {
      const intentId = emailId ? await intentOfEmail(tx, emailId) : null;
      if (!intentId) return "ignored";
      // Only a donor with no account: an account's address is theirs until they delete it (ADR-0027 as amended 2026-11-02).
      await tx
        .update(donationIntents)
        .set({ donorEmail: null })
        .where(and(eq(donationIntents.id, intentId), isNull(donationIntents.accountId)));
      return "erased";
    }

    if (type === "email.bounced") {
      // Only a permanent one: the docs' `Temporary` type must never write a permanent row.
      if (event.data?.bounce?.type === "Temporary") return "ignored";
      if (to) await tx.insert(emailSuppressions).values({ emailHmac: exactDigest(to, key), reason: "bounce" }).onConflictDoNothing();
      const intentId = emailId ? await intentOfEmail(tx, emailId) : null;
      if (intentId) await tx.update(donationIntents).set({ donorEmail: null }).where(eq(donationIntents.id, intentId));
      return "suppressed";
    }

    if (type === "email.complained") {
      if (!to) return "ignored";
      const inbox = inboxDigest(to, key);
      await tx.insert(emailSuppressions).values({ emailHmac: inbox, reason: "complaint" }).onConflictDoNothing();
      const held = await tx
        .select({ id: donationIntents.id, donorEmail: donationIntents.donorEmail })
        .from(donationIntents)
        .where(isNotNull(donationIntents.donorEmail));
      const ids = held.filter((row) => inboxDigest(row.donorEmail!, key) === inbox).map((row) => row.id);
      if (ids.length > 0) await tx.update(donationIntents).set({ donorEmail: null }).where(inArray(donationIntents.id, ids));
      return "suppressed";
    }

    return "ignored";
  });
}
