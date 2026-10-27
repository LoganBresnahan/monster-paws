import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmAddress } from "@/core/outreach/contacts";
import { recordOutreachEvent } from "@/core/outreach/events";
import { recordShelterNonprofit } from "@/core/outreach/everyorg";
import { shelterViewUrl, type OutreachShelter } from "@/core/outreach/list";
import { mailpitMessages } from "@/core/outreach/mailpit";
import { mailpitTransport, type MailTransport, type OutgoingMail } from "@/core/outreach/transport";
import { assembleWave, rehearseWave, shelterStatuses } from "@/core/outreach/wave";
import { closeDb, type Db } from "@/db/client";
import { outreachEvents } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateDonor, truncateOutreach } from "./support/db";

/**
 * A wave assembled from the record and rehearsed through the real guard into
 * Mailpit, the record untouched afterwards (ADR-0029 §3–4).
 */

const T0 = new Date("2026-11-02T15:00:00Z");
const shelter = (n: number, name: string): OutreachShelter => ({
  shelterExternalId: `rescuegroups:org:${n}`,
  name,
  city: "Northbrook",
  state: "IL",
  zip: "60062",
  website: `https://${name.toLowerCase().replace(/\s+/g, "")}.org`,
  visibleCount: n,
  shelterViewUrl: shelterViewUrl(`rescuegroups:org:${n}`),
});
const sender = { name: "Logan Bresnahan", role: "founder", email: "logan@example.org" };

describe.skipIf(SKIP_DB_TESTS)("ADR-0029 assembling a wave", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateOutreach(db);
    await truncateDonor(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("renders each shelter with its claim from shelter_nonprofits, unknown when unmatched, and shows the confirmed address beside it", async () => {
    const quiet = shelter(12, "Quiet Hollow Rescue");
    const paws = shelter(7, "Paws Chicago");
    await recordShelterNonprofit(db, {
      shelterExternalId: paws.shelterExternalId,
      nonprofit: { slug: "paws-chicago", ein: "36-4219778", name: "PAWS Chicago", claim: "claimed", profileUrl: "https://www.every.org/paws-chicago", websiteUrl: null, locationAddress: null },
      checkedBy: "Logan",
      fetchedAt: T0,
    });
    await confirmAddress(db, quiet.shelterExternalId, "adopt@quiethollow.org", "Logan", T0);

    const statuses = await shelterStatuses(db, [quiet, paws]);
    expect(statuses.get(quiet.shelterExternalId)).toEqual({ claim: "unknown", everyorgProfileUrl: null, confirmedAddress: "adopt@quiethollow.org" });
    expect(statuses.get(paws.shelterExternalId)).toEqual({ claim: "claimed", everyorgProfileUrl: "https://www.every.org/paws-chicago", confirmedAddress: null });

    const messages = await assembleWave(db, [quiet, paws], { sender, from: "Logan Bresnahan <logan@example.org>", timing: null });
    expect(messages.map((m) => m.shelterExternalId)).toEqual([quiet.shelterExternalId, paws.shelterExternalId]);
    expect(messages[0].mail.text).toContain("Could you claim your free Every.org profile?");
    expect(messages[0].mail.text).toContain("https://www.every.org/nonprofits");
    expect(messages[1].mail.text).toContain("your Every.org profile is already claimed");
    expect(messages[1].mail.text).not.toMatch(/hackathon/i);
    expect(messages[0].mail.from).toBe("Logan Bresnahan <logan@example.org>");
    // No address rides on a message: the guard reads it (ADR-0029 §2).
    expect("to" in messages[0].mail).toBe(false);
  });

  it("rehearses the wave through the guard into Mailpit and leaves the record exactly as it was", async () => {
    const a = shelter(1, "Rehearsal Alpha");
    const b = shelter(2, "Rehearsal Beta");
    const c = shelter(3, "Rehearsal Gamma");
    const stamp = `rehearsal-${Date.now()}`;
    await confirmAddress(db, a.shelterExternalId, `${stamp}-a@example.org`, "Logan", T0);
    await confirmAddress(db, c.shelterExternalId, `${stamp}-c@example.org`, "Logan", T0);
    await recordOutreachEvent(db, { shelterExternalId: "rescuegroups:org:9", wave: "earlier-1", kind: "sent", occurredAt: new Date(T0.getTime() - 30_000) });

    const messages = await assembleWave(db, [a, b, c], { sender, from: "Logan Bresnahan <logan@example.org>", timing: null });
    const report = await rehearseWave(db, "chicagoland-1", messages, { transport: mailpitTransport(), now: () => T0 });

    expect(report.sent.map((s) => s.to)).toEqual([`${stamp}-a@example.org`, `${stamp}-c@example.org`]);
    expect(report.refused).toEqual([{ shelterExternalId: b.shelterExternalId, reason: expect.stringContaining("no confirmed address") }]);
    expect(report.failed).toBeNull();
    // Nothing kept: the sends it judged and wrote were rolled back with the transaction.
    expect(await db.select({ wave: outreachEvents.wave }).from(outreachEvents)).toEqual([{ wave: "earlier-1" }]);
    // Everything delivered: the messages are in the local inbox to be read.
    const inbox = await mailpitMessages();
    for (const s of report.sent) expect(inbox.some((m) => `<${m.MessageID}>` === s.messageId && m.To[0].Address === s.to)).toBe(true);
  });

  it("rehearses with a clock that advances by the minute it would have waited, so the spacing shows and takes no time", async () => {
    const a = shelter(1, "Clock Alpha");
    const b = shelter(2, "Clock Beta");
    await confirmAddress(db, a.shelterExternalId, "a@example.org", "Logan", T0);
    await confirmAddress(db, b.shelterExternalId, "b@example.org", "Logan", T0);
    const delivered: OutgoingMail[] = [];
    const transport: MailTransport = {
      async send(mail) {
        delivered.push(mail);
        return { messageId: `<m${delivered.length}@test>` };
      },
    };
    const started = Date.now();
    const report = await rehearseWave(db, "chicagoland-1", await assembleWave(db, [a, b], { sender, from: "x <x@example.org>", timing: null }), { transport, now: () => T0 });
    expect(report.sent).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await db.select({ id: outreachEvents.id }).from(outreachEvents)).toEqual([]);
  });
});
