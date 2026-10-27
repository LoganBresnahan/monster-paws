import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isOutreachEventKind, recordOutreachEvent } from "@/core/outreach/events";
import { closeDb, type Db } from "@/db/client";
import { outreachEvents } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateOutreach } from "./support/db";

/**
 * The outreach record's promises, read from the migrated test database so a
 * hand-edited migration cannot pass (ADR-0029 §5): the columns the ADR names,
 * and one send per shelter per wave held by the database itself.
 */

const SHELTER = "rescuegroups:org:3077";
const AT = new Date("2026-11-02T15:00:00Z");

describe.skipIf(SKIP_DB_TESTS)("ADR-0029 outreach_events", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateOutreach(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("holds the shelter key, the wave, the kind, when, the message id and a note — and nothing from RescueGroups' contact fields", async () => {
    const result = await db.execute(
      sql`select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'outreach_events' order by column_name`,
    );
    expect((result.rows as { column_name: string }[]).map((r) => r.column_name)).toEqual([
      "created_at",
      "id",
      "kind",
      "message_id",
      "note",
      "occurred_at",
      "shelter_external_id",
      "wave",
    ]);
  });

  it("refuses a second send to the same shelter in the same wave, and nothing else", async () => {
    await recordOutreachEvent(db, { shelterExternalId: SHELTER, wave: "chicagoland-1", kind: "sent", occurredAt: AT });
    // Drizzle wraps the driver's error; the constraint name rides in `cause`.
    const refusal = await recordOutreachEvent(db, {
      shelterExternalId: SHELTER,
      wave: "chicagoland-1",
      kind: "sent",
      occurredAt: AT,
    }).then(
      () => null,
      (e: Error & { cause?: { constraint?: string } }) => e.cause?.constraint ?? e.message,
    );
    expect(refusal).toBe("outreach_events_one_send_per_wave_uq");

    // The follow-up is a second WAVE; replies and bounces are never limited.
    await recordOutreachEvent(db, { shelterExternalId: SHELTER, wave: "chicagoland-1-followup", kind: "sent", occurredAt: AT });
    await recordOutreachEvent(db, { shelterExternalId: SHELTER, wave: "chicagoland-1", kind: "replied", occurredAt: AT, messageId: "<r1@gmail>" });
    await recordOutreachEvent(db, { shelterExternalId: SHELTER, wave: "chicagoland-1", kind: "replied", occurredAt: AT, messageId: "<r2@gmail>" });
    await recordOutreachEvent(db, { shelterExternalId: "rescuegroups:org:9", wave: "chicagoland-1", kind: "sent", occurredAt: AT });

    const rows = await db.select({ kind: outreachEvents.kind, wave: outreachEvents.wave }).from(outreachEvents).orderBy(outreachEvents.id);
    expect(rows).toEqual([
      { kind: "sent", wave: "chicagoland-1" },
      { kind: "sent", wave: "chicagoland-1-followup" },
      { kind: "replied", wave: "chicagoland-1" },
      { kind: "replied", wave: "chicagoland-1" },
      { kind: "sent", wave: "chicagoland-1" },
    ]);
  });

  it("names the five kinds the ADR names, so the CLI's `record` cannot invent a sixth", () => {
    for (const kind of ["sent", "bounced", "replied", "opted_out", "granted"]) expect(isOutreachEventKind(kind)).toBe(true);
    for (const kind of ["complaint", "Sent", ""]) expect(isOutreachEventKind(kind)).toBe(false);
  });
});
