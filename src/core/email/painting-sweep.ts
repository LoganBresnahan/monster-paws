import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "@/db/client";
import { donationIntents, keepsake, keepsakeFact, paintingEmailSends } from "@/db/schema";
import { type ArtReader, artReaderFromEnv } from "@/core/email/art-source";
import { emailLinkOrigin, renderPaintingEmail } from "@/core/email/painting-email";
import { chooseEmailSender, EmailSendError, type EmailSender } from "@/core/email/sender";
import { isSuppressed, suppressionKey, unsubscribeToken } from "@/core/email/suppression";
import { FACT, type ArtFact } from "@/core/keepsake";

export interface OwedPainting {
  keepsakeId: number;
  /** null once erased: nothing can be sent */
  to: string | null;
  /** null when the keepsake has no name fact: nothing is sent with a blank where the name goes */
  animalName: string | null;
  /** names the published copy on the media hostname, whether or not the mail links to it */
  shareToken: string | null;
  /** null leaves the Share button out; absent means use `shareToken` */
  displayToken?: string | null;
  artKeys: readonly string[];
}

export interface SweepOptions {
  /** the suppression key: no key, no send, for any gift */
  key: string;
  sender: EmailSender;
  origin: string;
  owed: readonly OwedPainting[];
  readArt: ArtReader;
  now?: Date;
}

/** Counts and codes only, never an address (ADR-0010). */
export interface SweepReport {
  sent: number;
  noAddress: number;
  suppressed: number;
  /** claimed, not known to have gone, and past the idempotency window: a person looks */
  stale: number;
  held: number;
  incomplete: number;
  artUnreadable: number;
  failures: Record<string, number>;
}

/**
 * Under Resend's 24 hours (docs, read 2026-11-03). Past it, a re-send under the same key could mail
 * twice, so an unknown outcome stops here and reports, never a new attempt.
 */
export const CLAIM_WINDOW_MS = 23 * 60 * 60 * 1000;

/** A JPEG goes as it is; anything else gets one encoder setting, because a retry's body must be byte-identical or Resend refuses the key. */
export async function paintingJpeg(bytes: Buffer): Promise<Buffer> {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return bytes;
  return sharp(bytes).jpeg({ quality: 90 }).toBuffer();
}

const PAINTINGS_PER_EMAIL = 4;

/**
 * Four `art` candidates and not yet sent or refused, unclaimed first so a stale claim can't hold up a
 * new gift (doc/plans/demo-chain-contract.md). Facts deleted by basis take the keepsake out of this
 * list, so a purged gift is never mailed.
 */
export async function loadOwedPaintings(db: Db, options: { limit?: number; keepsakeId?: number } = {}): Promise<OwedPainting[]> {
  const rows = await db
    .select({ keepsakeId: keepsake.id, shareToken: keepsake.shareToken, to: donationIntents.donorEmail })
    .from(keepsake)
    .innerJoin(donationIntents, eq(donationIntents.id, keepsake.intentId))
    .leftJoin(paintingEmailSends, eq(paintingEmailSends.keepsakeId, keepsake.id))
    .where(
      and(
        options.keepsakeId === undefined ? undefined : eq(keepsake.id, options.keepsakeId),
        or(isNull(paintingEmailSends.keepsakeId), and(isNull(paintingEmailSends.sentAt), isNull(paintingEmailSends.refusedCode))),
        sql`(select count(distinct f.value->>'candidate') from ${keepsakeFact} f where f.keepsake_id = ${keepsake.id} and f.field = ${FACT.art}) >= ${PAINTINGS_PER_EMAIL}`,
      ),
    )
    .orderBy(sql`${paintingEmailSends.keepsakeId} nulls first`, asc(keepsake.id))
    .limit(options.limit ?? 10);
  if (rows.length === 0) return [];

  const facts = await db
    .select({ keepsakeId: keepsakeFact.keepsakeId, field: keepsakeFact.field, value: keepsakeFact.value })
    .from(keepsakeFact)
    .where(and(inArray(keepsakeFact.keepsakeId, rows.map((row) => row.keepsakeId)), inArray(keepsakeFact.field, [FACT.name, FACT.art])))
    .orderBy(asc(keepsakeFact.id));

  return rows.map((row) => {
    const own = facts.filter((fact) => fact.keepsakeId === row.keepsakeId);
    // A later row is the correction: facts are never UPDATEd (ADR-0022 §2–3).
    const art = new Map(own.filter((fact) => fact.field === FACT.art).map((fact) => {
      const value = fact.value as ArtFact;
      return [value.candidate, value.key] as const;
    }));
    const name = own.filter((fact) => fact.field === FACT.name).at(-1)?.value;
    return {
      keepsakeId: row.keepsakeId,
      to: row.to,
      animalName: typeof name === "string" && name ? name : null,
      shareToken: row.shareToken,
      artKeys: [...art].sort(([a], [b]) => a - b).slice(0, PAINTINGS_PER_EMAIL).map(([, key]) => key),
    };
  });
}

type Claim = "go" | "stale" | "held" | "sent";

async function claimSend(db: Db, keepsakeId: number, now: Date): Promise<Claim> {
  const inserted = await db
    .insert(paintingEmailSends)
    .values({ keepsakeId, claimedAt: now })
    .onConflictDoNothing()
    .returning({ keepsakeId: paintingEmailSends.keepsakeId });
  if (inserted.length > 0) return "go";
  const [row] = await db.select().from(paintingEmailSends).where(eq(paintingEmailSends.keepsakeId, keepsakeId));
  if (row.sentAt) return "sent";
  if (row.refusedCode) return "held";
  return now.getTime() - row.claimedAt.getTime() > CLAIM_WINDOW_MS ? "stale" : "go";
}

/**
 * The only way a painting email leaves, so a failed send simply stays owed and the next tick retries
 * it under the same key (ADR-0035). Writes the claim first: a crash can leave a claim with
 * no mail, never a mail with no record.
 */
export async function sendOwedPaintings(db: Db, options: SweepOptions): Promise<SweepReport> {
  const { key, sender, origin, readArt } = options;
  const now = options.now ?? new Date();
  const report: SweepReport = { sent: 0, noAddress: 0, suppressed: 0, stale: 0, held: 0, incomplete: 0, artUnreadable: 0, failures: {} };

  for (const owed of options.owed) {
    if (!owed.to) {
      report.noAddress++;
      continue;
    }
    if (await isSuppressed(db, owed.to, key)) {
      report.suppressed++;
      continue;
    }
    if (!owed.animalName) {
      report.incomplete++;
      continue;
    }

    let paintings: Buffer[];
    try {
      paintings = await Promise.all(owed.artKeys.map(async (_, index) => paintingJpeg(await readArt(owed, index))));
    } catch {
      report.artUnreadable++;
      continue;
    }

    const claim = await claimSend(db, owed.keepsakeId, now);
    if (claim === "stale") report.stale++;
    if (claim === "held") report.held++;
    if (claim !== "go") continue;

    const email = renderPaintingEmail({
      to: owed.to,
      keepsakeId: owed.keepsakeId,
      animalName: owed.animalName,
      paintings,
      shareToken: owed.displayToken === undefined ? owed.shareToken : owed.displayToken,
      unsubscribeToken: unsubscribeToken(owed.to, key),
      origin,
    });

    try {
      const sent = await sender.send(email);
      await db
        .update(paintingEmailSends)
        .set({ sentAt: new Date(), providerId: sent.id })
        .where(eq(paintingEmailSends.keepsakeId, owed.keepsakeId));
      report.sent++;
    } catch (err) {
      const failure = err instanceof EmailSendError ? err : new EmailSendError("unexpected", "unknown", true);
      report.failures[failure.code] = (report.failures[failure.code] ?? 0) + 1;
      if (!failure.retry) {
        await db
          .update(paintingEmailSends)
          .set({ refusedCode: failure.code })
          .where(eq(paintingEmailSends.keepsakeId, owed.keepsakeId));
      } else if (failure.sent === "no") {
        // Nothing left, so the idempotency window starts again with the next attempt.
        await db.delete(paintingEmailSends).where(eq(paintingEmailSends.keepsakeId, owed.keepsakeId));
      }
    }
  }
  return report;
}

/**
 * One tick from the environment. Refuses with no key, for every gift (ADR-0035 as amended 2026-11-03),
 * and never falls back to another sender: `chooseEmailSender` throws on a half-set live run.
 * `EMAIL_SHARE_LINKS=off` leaves the Share button out, for a rehearsal with no published page.
 */
export async function runPaintingEmailTick(
  db: Db,
  env: Record<string, string | undefined> = process.env,
  only: { keepsakeId?: number } = {},
): Promise<SweepReport & { via: EmailSender["via"] }> {
  const key = suppressionKey(env);
  if (!key) throw new Error("EMAIL_SUPPRESSION_KEY is not set: nothing is sent");
  const sender = chooseEmailSender(env);
  const owed = await loadOwedPaintings(db, only);
  const report = await sendOwedPaintings(db, {
    key,
    sender,
    origin: emailLinkOrigin(env),
    owed: env.EMAIL_SHARE_LINKS === "off" ? owed.map((painting) => ({ ...painting, displayToken: null })) : owed,
    readArt: artReaderFromEnv(env),
  });
  return { ...report, via: sender.via };
}
