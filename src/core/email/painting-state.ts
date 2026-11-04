import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { keepsake, paintingEmailSends } from "@/db/schema";

/** `painting_email_sends.refused_code` when the mail bounced for good: the one case a donor's new address clears the row (ADR-0027 as amended 2026-11-02, decision 4). */
export const BOUNCED_CODE = "bounced";

export type PaintingMailState = "not-sent" | "on-its-way" | "sent" | "bounced";

export async function paintingMailState(db: Pick<Db, "select">, intentId: string): Promise<PaintingMailState> {
  const [row] = await db
    .select({ sentAt: paintingEmailSends.sentAt, refusedCode: paintingEmailSends.refusedCode })
    .from(paintingEmailSends)
    .innerJoin(keepsake, eq(keepsake.id, paintingEmailSends.keepsakeId))
    .where(eq(keepsake.intentId, intentId))
    .limit(1);
  if (!row) return "not-sent";
  if (row.refusedCode === BOUNCED_CODE) return "bounced";
  return row.sentAt ? "sent" : "on-its-way";
}
