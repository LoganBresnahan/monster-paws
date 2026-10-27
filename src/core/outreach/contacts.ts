import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { AddressCandidate } from "@/core/outreach/addresses";
import type { Db } from "@/db/client";
import { shelterContacts } from "@/db/schema";

/**
 * The candidate addresses and their confirmations (ADR-0029 §2). A row is a
 * fact about where a shelter can be reached, so a second find of the same
 * address keeps the first row and a confirmation UPDATES it — unlike
 * `outreach_events`, which only grows.
 */

export async function recordAddressCandidates(
  db: Db,
  shelterExternalId: string,
  candidates: readonly AddressCandidate[],
  foundAt: Date,
): Promise<number> {
  if (candidates.length === 0) return 0;
  const inserted = await db
    .insert(shelterContacts)
    .values(candidates.map((c) => ({ shelterExternalId, email: c.email.toLowerCase(), sourceUrl: c.sourceUrl, foundAt })))
    .onConflictDoNothing()
    .returning({ email: shelterContacts.email });
  return inserted.length;
}

/** A person's "yes, write there". The address need not have been found first: Logan types one and confirms it in one step. */
export async function confirmAddress(
  db: Db,
  shelterExternalId: string,
  email: string,
  confirmedBy: string,
  at: Date,
): Promise<void> {
  await db
    .insert(shelterContacts)
    .values({
      shelterExternalId,
      email: email.toLowerCase(),
      sourceUrl: `typed by ${confirmedBy}`,
      foundAt: at,
      confirmedAt: at,
      confirmedBy,
    })
    .onConflictDoUpdate({
      target: [shelterContacts.shelterExternalId, shelterContacts.email],
      set: { confirmedAt: sql`excluded.confirmed_at`, confirmedBy: sql`excluded.confirmed_by` },
    });
}

export async function contactsOf(db: Db, shelterExternalId: string): Promise<(typeof shelterContacts.$inferSelect)[]> {
  return db
    .select()
    .from(shelterContacts)
    .where(eq(shelterContacts.shelterExternalId, shelterExternalId))
    // `desc` alone puts the unconfirmed FIRST (Postgres sorts nulls high).
    .orderBy(sql`${shelterContacts.confirmedAt} desc nulls last`, shelterContacts.email);
}

/**
 * The one address a send may use: the most recently confirmed, or null —
 * never a candidate, however good it looks (ADR-0029 §2). The send guard
 * reads this and nothing else.
 */
export async function confirmedAddress(db: Pick<Db, "select">, shelterExternalId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: shelterContacts.email })
    .from(shelterContacts)
    .where(and(eq(shelterContacts.shelterExternalId, shelterExternalId), isNotNull(shelterContacts.confirmedAt)))
    .orderBy(sql`${shelterContacts.confirmedAt} desc nulls last`, shelterContacts.email)
    .limit(1);
  return row?.email ?? null;
}
