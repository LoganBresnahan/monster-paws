import { createHmac, timingSafeEqual } from "node:crypto";
import { inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { donationIntents, emailSuppressions } from "@/db/schema";

type Env = Record<string, string | undefined>;

/** Null means no send at all: a mail we can't check against the list never goes, and never a plain-address fallback (ADR-0027 as amended 2026-10-22, ADR-0035 as amended 2026-11-03). */
export function suppressionKey(env: Env = process.env): string | null {
  return env.EMAIL_SUPPRESSION_KEY || null;
}

/**
 * For comparing inboxes only, never for sending: the part before the @ is the mailbox's own to
 * interpret, so a mail always goes to the address as typed (ADR-0035, decision 8).
 */
export function normaliseInbox(address: string): string {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  const domain = lower.slice(at + 1) === "googlemail.com" ? "gmail.com" : lower.slice(at + 1);
  const local = lower.slice(0, at).split("+")[0];
  return `${domain === "gmail.com" ? local.replaceAll(".", "") : local}@${domain}`;
}

/**
 * The prefix keeps a digest from matching the same address in any other keyed list (ADR-0035, decision 8).
 * Two of them, or a bounce on `a@x` would read as a stop for `a+new@x`, which it says nothing about.
 */
function digest(kind: "exact" | "inbox", value: string, key: string): string {
  return createHmac("sha256", key).update(`suppression-${kind}\0${value}`).digest("hex");
}

/** A bounce is written on this one: a server can treat `+` literally, so it says nothing about the rest of the inbox. */
export function exactDigest(address: string, key: string): string {
  return digest("exact", address.trim().toLowerCase(), key);
}

/** An unsubscribe is written on this one, so it stops every spelling of that inbox. */
export function inboxDigest(address: string, key: string): string {
  return digest("inbox", normaliseInbox(address), key);
}

/** Looks up both digests, so a stop on any spelling and a bounce on this exact one each refuse the mail. */
export async function isSuppressed(db: Db, address: string, key: string): Promise<boolean> {
  const found = await db
    .select({ emailHmac: emailSuppressions.emailHmac })
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.emailHmac, [exactDigest(address, key), inboxDigest(address, key)]))
    .limit(1);
  return found.length > 0;
}

const TOKEN = /^([0-9a-f]{64})-([0-9a-f]{32})$/;

function tokenMac(inbox: string, key: string): string {
  return createHmac("sha256", key).update(`unsubscribe-link\0${inbox}`).digest("hex").slice(0, 32);
}

/**
 * The link carries the digest because the address may be erased by the time it's clicked
 * (ADR-0035, question 6). The mac stops a stranger's POST filling the permanent list with
 * made-up digests.
 */
export function unsubscribeToken(address: string, key: string): string {
  const inbox = inboxDigest(address, key);
  return `${inbox}-${tokenMac(inbox, key)}`;
}

export function hasTokenShape(token: string): boolean {
  return TOKEN.test(token);
}

/** The inbox's digest, or null for a token this key never made. */
export function inboxOfToken(token: string, key: string): string | null {
  const match = TOKEN.exec(token);
  if (!match) return null;
  const expected = Buffer.from(tokenMac(match[1], key));
  const given = Buffer.from(match[2]);
  return timingSafeEqual(expected, given) ? match[1] : null;
}

/**
 * Writes the suppression and erases the address on every gift of that inbox, since several can be
 * waiting (ADR-0035, question 6). Never call this from a GET: a mail scanner that prefetches
 * the link would write a permanent suppression and erase every waiting address with no click.
 */
export async function unsubscribe(db: Db, token: string, key: string): Promise<{ erased: number } | null> {
  const inbox = inboxOfToken(token, key);
  if (!inbox) return null;
  return db.transaction(async (tx) => {
    await tx.insert(emailSuppressions).values({ emailHmac: inbox, reason: "unsubscribe" }).onConflictDoNothing();
    // A scan, because SQL can't compute a keyed digest: only rows still holding an address are read.
    const held = await tx
      .select({ id: donationIntents.id, donorEmail: donationIntents.donorEmail })
      .from(donationIntents)
      .where(isNotNull(donationIntents.donorEmail));
    const ids = held.filter((row) => inboxDigest(row.donorEmail!, key) === inbox).map((row) => row.id);
    if (ids.length > 0) {
      await tx.update(donationIntents).set({ donorEmail: null }).where(inArray(donationIntents.id, ids));
    }
    return { erased: ids.length };
  });
}
