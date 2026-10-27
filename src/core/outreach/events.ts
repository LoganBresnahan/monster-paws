import { outreachEvents, type OutreachEventKind } from "@/db/schema";
import type { Db } from "@/db/client";

/** One thing that happened between us and a shelter (ADR-0029 §5). */
export interface OutreachEvent {
  /** `animals.shelter_external_id`, e.g. `rescuegroups:org:3077` */
  shelterExternalId: string;
  wave: string;
  kind: OutreachEventKind;
  occurredAt: Date;
  messageId?: string | null;
  note?: string | null;
}

export const OUTREACH_EVENT_KINDS: readonly OutreachEventKind[] = [
  "sent",
  "bounced",
  "replied",
  "opted_out",
  "granted",
];

export function isOutreachEventKind(value: string): value is OutreachEventKind {
  return (OUTREACH_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * The only writer of `outreach_events`, and it only inserts: never UPDATE or
 * DELETE a row — a correction is another row with a note (ADR-0029 §5). A
 * second `sent` for the same shelter and wave is refused by the database.
 */
export async function recordOutreachEvent(db: Pick<Db, "insert">, event: OutreachEvent): Promise<number> {
  const [row] = await db
    .insert(outreachEvents)
    .values({
      shelterExternalId: event.shelterExternalId,
      wave: event.wave,
      kind: event.kind,
      occurredAt: event.occurredAt,
      messageId: event.messageId ?? null,
      note: event.note ?? null,
    })
    .returning({ id: outreachEvents.id });
  return row.id;
}
