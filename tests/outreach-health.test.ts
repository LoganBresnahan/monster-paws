import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmAddress } from "@/core/outreach/contacts";
import { recordOutreachEvent } from "@/core/outreach/events";
import { liveSendGate, tallyWaves, waveHealth, type WaveHealth } from "@/core/outreach/health";
import { sendWave } from "@/core/outreach/send";
import type { MailTransport } from "@/core/outreach/transport";
import { closeDb, type Db } from "@/db/client";
import { outreachEvents, type OutreachEventKind } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateOutreach } from "./support/db";

/**
 * The revisit triggers as a gate on the next live wave (ADR-0029, Revisit
 * triggers): over 5% bounced or a complaint in the previous wave refuses,
 * an override is recorded on every send it allowed, and replies under one in
 * ten after two waves warn.
 */

const T0 = new Date("2026-11-02T15:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * 24 * 3600 * 1000);

function wave(name: string, day: number, sent: number, bounced = 0, replied = 0, notes: string[] = []) {
  const rows: { wave: string; kind: OutreachEventKind; occurredAt: Date; note: string | null }[] = [];
  for (let i = 0; i < sent; i++) rows.push({ wave: name, kind: "sent", occurredAt: new Date(at(day).getTime() + i * 60_000), note: null });
  for (let i = 0; i < bounced; i++) rows.push({ wave: name, kind: "bounced", occurredAt: at(day + 1), note: null });
  for (let i = 0; i < replied; i++) rows.push({ wave: name, kind: "replied", occurredAt: at(day + 2), note: null });
  for (const note of notes) rows.push({ wave: name, kind: "replied", occurredAt: at(day + 2), note });
  return rows;
}

describe("ADR-0029 wave health", () => {
  it("counts each wave by kind, rates against its sends, and orders waves by first send with the sendless last", () => {
    const health = tallyWaves([
      ...wave("chicagoland-2", 10, 40, 1, 5),
      ...wave("chicagoland-1", 0, 40, 3, 2),
      { wave: "stray-note", kind: "replied", occurredAt: at(5), note: "a reply under a wave nothing was sent in" },
    ]);
    expect(health.map((h) => h.wave)).toEqual(["chicagoland-1", "chicagoland-2", "stray-note"]);
    expect(health[0]).toMatchObject({ firstSentAt: at(0), counts: { sent: 40, bounced: 3, replied: 2, opted_out: 0, granted: 0 }, bounceRate: 0.075, replyRate: 0.05, complaints: [] });
    expect(health[1]).toMatchObject({ bounceRate: 0.025, replyRate: 0.125 });
    expect(health[2]).toMatchObject({ firstSentAt: null, bounceRate: null, replyRate: null, counts: { sent: 0, replied: 1 } });
  });

  it("reads a complaint from any event's note", () => {
    const [health] = tallyWaves(wave("chicagoland-1", 0, 40, 0, 1, ["forwarded to us as a spam complaint"]));
    expect(health.complaints).toEqual(["forwarded to us as a spam complaint"]);
    expect(tallyWaves(wave("x-1", 0, 1, 0, 0, ["they said thanks, no complaints at all"]))[0].complaints).toHaveLength(1);
  });
});

describe("ADR-0029 the live-send gate", () => {
  const fine = tallyWaves(wave("chicagoland-1", 0, 40, 2, 6));

  it("opens with no previous wave, and on a previous wave at or under 5% bounced with no complaint", () => {
    expect(liveSendGate([], "chicagoland-1")).toEqual({ ok: true, warnings: [] });
    expect(liveSendGate(fine, "chicagoland-2")).toEqual({ ok: true, warnings: [] });
    expect(liveSendGate(tallyWaves(wave("x-1", 0, 40, 2)), "x-2").ok).toBe(true); // exactly 5%
  });

  it("refuses on a previous wave over 5% bounced, or with a complaint on record, naming the wave and the numbers", () => {
    const bounced = liveSendGate(tallyWaves(wave("chicagoland-1", 0, 40, 3)), "chicagoland-2");
    expect(bounced).toMatchObject({ ok: false, reason: expect.stringContaining("bounced 3 of 40 (7.5%)") });
    const complained = liveSendGate(tallyWaves(wave("chicagoland-1", 0, 40, 0, 1, ["spam complaint via Gmail"])), "chicagoland-2");
    expect(complained).toMatchObject({ ok: false, reason: expect.stringContaining('complaint on record: "spam complaint via Gmail"') });
  });

  it("judges the previous wave, not the one resuming, and ignores a wave nothing was sent in", () => {
    const health: WaveHealth[] = tallyWaves([
      ...wave("chicagoland-1", 0, 40),
      ...wave("chicagoland-2", 10, 20, 5), // 25% bounced, but it is the wave being resumed
      { wave: "notes-only", kind: "replied", occurredAt: at(11), note: "complaint" },
    ]);
    expect(liveSendGate(health, "chicagoland-2").ok).toBe(true);
    expect(liveSendGate(health, "chicagoland-3").ok).toBe(false);
  });

  it("warns, without refusing, when replies across the last two waves are under one in ten", () => {
    const quiet = tallyWaves([...wave("chicagoland-1", 0, 40, 0, 3), ...wave("chicagoland-2", 10, 40, 0, 4)]);
    const gate = liveSendGate(quiet, "chicagoland-3");
    expect(gate.ok).toBe(true);
    expect(gate.warnings).toEqual([expect.stringContaining("7 replies to 80 messages")]);
    expect(liveSendGate(tallyWaves(wave("chicagoland-1", 0, 40, 0, 1)), "chicagoland-2").warnings).toEqual([]);
    expect(liveSendGate(tallyWaves([...wave("a-1", 0, 40, 0, 4), ...wave("a-2", 10, 40, 0, 4)]), "a-3").warnings).toEqual([]);
  });
});

describe.skipIf(SKIP_DB_TESTS)("ADR-0029 wave health from the record", () => {
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

  it("reads the waves from outreach_events, and an override rides on every send it allowed", async () => {
    await recordOutreachEvent(db, { shelterExternalId: "rescuegroups:org:1", wave: "chicagoland-1", kind: "sent", occurredAt: at(-10) });
    await recordOutreachEvent(db, { shelterExternalId: "rescuegroups:org:1", wave: "chicagoland-1", kind: "bounced", occurredAt: at(-9) });
    expect(liveSendGate(await waveHealth(db), "chicagoland-2")).toMatchObject({ ok: false, reason: expect.stringContaining("100.0%") });

    await confirmAddress(db, "rescuegroups:org:2", "two@example.org", "Logan", T0);
    const transport: MailTransport = { send: async () => ({ messageId: "<m1@test>" }) };
    const note = "override of the wave-health stop — one bounce of one — Logan: the address was a typo, reconfirmed";
    const report = await sendWave(db, "chicagoland-2", [{ shelterExternalId: "rescuegroups:org:2", mail: { from: "x", subject: "s", text: "t", html: "h" } }], {
      transport,
      now: () => T0,
      sleep: async () => {},
      note,
    });
    expect(report.sent).toHaveLength(1);
    const rows = await db.select({ wave: outreachEvents.wave, kind: outreachEvents.kind, note: outreachEvents.note }).from(outreachEvents).orderBy(outreachEvents.id);
    expect(rows.at(-1)).toEqual({ wave: "chicagoland-2", kind: "sent", note });
    expect((await waveHealth(db)).map((h) => [h.wave, h.counts.sent])).toEqual([
      ["chicagoland-1", 1],
      ["chicagoland-2", 1],
    ]);
  });
});
