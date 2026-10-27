import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmAddress } from "@/core/outreach/contacts";
import { recordOutreachEvent } from "@/core/outreach/events";
import {
  DAILY_CAP,
  FOLLOW_UP_AFTER_MS,
  MIN_SPACING_MS,
  judgeSend,
  loadSendFacts,
  sendWave,
  type SendFacts,
  type WaveMessage,
} from "@/core/outreach/send";
import type { MailTransport, OutgoingMail } from "@/core/outreach/transport";
import { closeDb, type Db } from "@/db/client";
import { outreachEvents } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateOutreach } from "./support/db";

/**
 * The send guard (ADR-0029 §4–5), each rule at its boundary: the rolling
 * day, the 41st message, the second send in a wave, the follow-up on day six
 * and on day seven, the minute's spacing, the address, the opt-out. Then the
 * loop on the real record with a fake transport and clock: the `sent` row
 * only after the transport answered, never after it threw.
 */

const T0 = new Date("2026-11-02T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const open: SendFacts = {
  shelterExternalId: "rescuegroups:org:77",
  wave: "chicagoland-1",
  sentInLastDay: 0,
  lastSentAt: null,
  sentToShelterAt: [],
  sentInThisWave: false,
  answered: [],
  confirmedTo: "adopt@quiethollow.org",
  excluded: false,
};

describe("ADR-0029 judgeSend", () => {
  it("sends to the confirmed address when nothing stands in the way", () => {
    expect(judgeSend(open, T0)).toEqual({ verdict: "send", to: "adopt@quiethollow.org" });
  });

  it("refuses without a confirmed address, however many candidates were found", () => {
    expect(judgeSend({ ...open, confirmedTo: null }, T0)).toMatchObject({ verdict: "refuse", reason: expect.stringContaining("no confirmed address") });
  });

  it("refuses an excluded shelter and one that opted out in the record, before anything else is weighed", () => {
    expect(judgeSend({ ...open, excluded: true }, T0)).toMatchObject({ verdict: "refuse", reason: expect.stringContaining("SHELTER_EXCLUSIONS") });
    expect(judgeSend({ ...open, answered: ["opted_out"] }, T0)).toMatchObject({ verdict: "refuse", reason: expect.stringContaining("opted out") });
  });

  it("refuses a second send in the same wave", () => {
    expect(judgeSend({ ...open, sentInThisWave: true, sentToShelterAt: [at(-DAY)] }, T0)).toMatchObject({
      verdict: "refuse",
      reason: expect.stringContaining("already sent in wave 'chicagoland-1'"),
    });
  });

  it("allows one follow-up on day seven, not day six, measured from the FIRST send", () => {
    const followUp = { ...open, wave: "chicagoland-1-followup" };
    expect(judgeSend({ ...followUp, sentToShelterAt: [at(-6 * DAY)] }, T0)).toMatchObject({
      verdict: "refuse",
      reason: expect.stringContaining("waits seven days"),
    });
    expect(judgeSend({ ...followUp, sentToShelterAt: [at(-FOLLOW_UP_AFTER_MS + 1)] }, T0).verdict).toBe("refuse");
    expect(judgeSend({ ...followUp, sentToShelterAt: [at(-FOLLOW_UP_AFTER_MS)] }, T0).verdict).toBe("send");
    expect(judgeSend({ ...followUp, sentToShelterAt: [at(-7 * DAY)] }, T0).verdict).toBe("send");
    // Two sends already: a third contact is never a wave, however old the first.
    expect(judgeSend({ ...followUp, wave: "chicagoland-1-again", sentToShelterAt: [at(-30 * DAY), at(-20 * DAY)] }, T0)).toMatchObject({
      verdict: "refuse",
      reason: expect.stringContaining("one message and one follow-up"),
    });
  });

  it("never writes again to a shelter that answered, and never follows up a bounce at the same address", () => {
    const followUp = { ...open, wave: "chicagoland-1-followup", sentToShelterAt: [at(-10 * DAY)] };
    expect(judgeSend({ ...followUp, answered: ["replied"] }, T0)).toMatchObject({ verdict: "refuse", reason: expect.stringContaining("answered (replied)") });
    expect(judgeSend({ ...followUp, answered: ["granted"] }, T0).verdict).toBe("refuse");
    // A yes recorded from a conversation that never went through the CLI still closes the cold ask.
    expect(judgeSend({ ...open, answered: ["granted"] }, T0).verdict).toBe("refuse");
    expect(judgeSend({ ...followUp, answered: ["bounced"] }, T0)).toMatchObject({ verdict: "refuse", reason: expect.stringContaining("bounced") });
  });

  it("refuses, rather than sleeps a year, when the record's last send is ahead of the clock", () => {
    expect(judgeSend({ ...open, sentInLastDay: 1, lastSentAt: at(365 * DAY) }, T0)).toMatchObject({
      verdict: "refuse",
      reason: expect.stringContaining("in the future"),
    });
  });

  it("stops at the 40th in a rolling day — a calendar midnight in any zone does not reset it", () => {
    expect(judgeSend({ ...open, sentInLastDay: DAILY_CAP - 1, lastSentAt: at(-HOUR) }, T0).verdict).toBe("send");
    expect(judgeSend({ ...open, sentInLastDay: DAILY_CAP, lastSentAt: at(-HOUR) }, T0)).toMatchObject({
      verdict: "refuse",
      reason: expect.stringContaining("40 sent in the last 24 hours"),
    });
    expect(judgeSend({ ...open, sentInLastDay: DAILY_CAP + 3, lastSentAt: at(-HOUR) }, T0).verdict).toBe("refuse");
  });

  it("waits out the minute after the last send, to the millisecond, and sends once it has passed", () => {
    expect(judgeSend({ ...open, sentInLastDay: 1, lastSentAt: at(-MIN_SPACING_MS + 1) }, T0)).toEqual({ verdict: "wait", ms: 1 });
    expect(judgeSend({ ...open, sentInLastDay: 1, lastSentAt: at(-MINUTE) }, T0).verdict).toBe("send");
    expect(judgeSend({ ...open, sentInLastDay: 1, lastSentAt: at(-1000) }, T0)).toEqual({ verdict: "wait", ms: MINUTE - 1000 });
  });

  it("checks the cap before the spacing, so a full day refuses rather than waits", () => {
    expect(judgeSend({ ...open, sentInLastDay: DAILY_CAP, lastSentAt: at(-1000) }, T0).verdict).toBe("refuse");
  });

  it("refuses a wave name it could not store as one", () => {
    expect(judgeSend({ ...open, wave: "Chicagoland 1" }, T0).verdict).toBe("refuse");
  });
});

describe.skipIf(SKIP_DB_TESTS)("ADR-0029 sendWave", () => {
  let db: Db;
  const WAVE = "chicagoland-1";
  const shelter = (n: number) => `rescuegroups:org:${n}`;
  const message = (n: number): WaveMessage => ({
    shelterExternalId: shelter(n),
    mail: { from: "Logan <logan@example.org>", subject: `hello ${n}`, text: "text", html: "<p>text</p>" },
  });

  /** A transport that remembers, with a clock that moves a second per send; `failOn` throws for one shelter. */
  function fake(failOn?: string) {
    let clock = T0.getTime();
    const delivered: OutgoingMail[] = [];
    const slept: number[] = [];
    const transport: MailTransport = {
      async send(mail) {
        if (failOn && mail.subject.endsWith(failOn)) throw new Error("535 5.7.8 Username and Password not accepted");
        delivered.push(mail);
        return { messageId: `<m${delivered.length}@test>` };
      },
    };
    return {
      transport,
      delivered,
      slept,
      now: () => new Date(clock),
      sleep: async (ms: number) => {
        slept.push(ms);
        clock += ms;
      },
      tick: (ms: number) => {
        clock += ms;
      },
    };
  }

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateOutreach(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("sends to confirmed addresses only, a minute apart, writing the `sent` row after each transport answer", async () => {
    await confirmAddress(db, shelter(1), "one@a.org", "Logan", T0);
    await confirmAddress(db, shelter(3), "three@c.org", "Logan", T0);
    const f = fake();
    const report = await sendWave(db, WAVE, [message(1), message(2), message(3)], { transport: f.transport, now: f.now, sleep: f.sleep });

    expect(report.sent).toEqual([
      { shelterExternalId: shelter(1), to: "one@a.org", messageId: "<m1@test>" },
      { shelterExternalId: shelter(3), to: "three@c.org", messageId: "<m2@test>" },
    ]);
    expect(report.refused).toEqual([{ shelterExternalId: shelter(2), reason: expect.stringContaining("no confirmed address") }]);
    expect(report.failed).toBeNull();
    expect(report.remaining).toEqual([]);
    expect(f.delivered.map((m) => m.to)).toEqual(["one@a.org", "three@c.org"]);
    expect(f.slept).toEqual([MINUTE]);

    const rows = await db
      .select({ shelter: outreachEvents.shelterExternalId, kind: outreachEvents.kind, messageId: outreachEvents.messageId, at: outreachEvents.occurredAt })
      .from(outreachEvents)
      .orderBy(outreachEvents.id);
    expect(rows).toEqual([
      { shelter: shelter(1), kind: "sent", messageId: "<m1@test>", at: T0 },
      { shelter: shelter(3), kind: "sent", messageId: "<m2@test>", at: at(MINUTE) },
    ]);
  });

  it("writes no `sent` row when the transport throws, and stops the wave there", async () => {
    for (const n of [1, 2, 3]) await confirmAddress(db, shelter(n), `${n}@a.org`, "Logan", T0);
    const f = fake("2");
    const report = await sendWave(db, WAVE, [message(1), message(2), message(3)], { transport: f.transport, now: f.now, sleep: f.sleep });

    expect(report.sent.map((s) => s.shelterExternalId)).toEqual([shelter(1)]);
    expect(report.failed).toEqual({ shelterExternalId: shelter(2), error: "535 5.7.8 Username and Password not accepted" });
    expect(report.remaining).toEqual([shelter(3)]);
    const rows = await db.select({ shelter: outreachEvents.shelterExternalId }).from(outreachEvents);
    expect(rows).toEqual([{ shelter: shelter(1) }]);
  });

  it("refuses a 41st in the rolling day and leaves the rest for tomorrow, whatever the calendar says", async () => {
    // Thirty-nine went out across yesterday evening and this morning UTC; a
    // calendar-day count in Chicago or in UTC would call most of them spent already.
    for (let n = 100; n < 139; n++) {
      await recordOutreachEvent(db, { shelterExternalId: shelter(n), wave: "chicagoland-0", kind: "sent", occurredAt: at(-23 * HOUR + (n - 100) * 10 * MINUTE) });
    }
    for (const n of [1, 2, 3]) await confirmAddress(db, shelter(n), `${n}@a.org`, "Logan", T0);
    const f = fake();
    const report = await sendWave(db, WAVE, [message(1), message(2), message(3)], { transport: f.transport, now: f.now, sleep: f.sleep });

    expect(report.sent.map((s) => s.shelterExternalId)).toEqual([shelter(1)]);
    expect(report.refused).toEqual([{ shelterExternalId: shelter(2), reason: expect.stringContaining("40 sent in the last 24 hours") }]);
    expect(report.remaining).toEqual([shelter(3)]);
    expect(f.delivered).toHaveLength(1);

    // A day on, the oldest have aged out and the wave goes on.
    f.tick(DAY);
    const later = await sendWave(db, WAVE, [message(2), message(3)], { transport: f.transport, now: f.now, sleep: f.sleep });
    expect(later.sent.map((s) => s.shelterExternalId)).toEqual([shelter(2), shelter(3)]);
  });

  it("counts every wave's sends against the day and the minute, and only `sent` rows — a reply just now is not a send", async () => {
    await recordOutreachEvent(db, { shelterExternalId: shelter(9), wave: "elsewhere-1", kind: "sent", occurredAt: at(-30_000) });
    await recordOutreachEvent(db, { shelterExternalId: shelter(8), wave: "elsewhere-1", kind: "replied", occurredAt: at(-1000) });
    await confirmAddress(db, shelter(1), "1@a.org", "Logan", T0);
    const facts = await loadSendFacts(db, shelter(1), WAVE, T0);
    expect(facts).toMatchObject({ sentInLastDay: 1, lastSentAt: at(-30_000), sentToShelterAt: [], answered: [] });
    expect(judgeSend(facts, T0)).toEqual({ verdict: "wait", ms: 30_000 });
  });

  it("holds the one-send-per-wave rule and the follow-up clock from the record itself", async () => {
    await confirmAddress(db, shelter(1), "1@a.org", "Logan", T0);
    await recordOutreachEvent(db, { shelterExternalId: shelter(1), wave: WAVE, kind: "sent", occurredAt: at(-6 * DAY) });
    const f = fake();

    const again = await sendWave(db, WAVE, [message(1)], { transport: f.transport, now: f.now, sleep: f.sleep });
    expect(again.refused[0].reason).toContain("already sent in wave");

    const early = await sendWave(db, "chicagoland-1-followup", [message(1)], { transport: f.transport, now: f.now, sleep: f.sleep });
    expect(early.refused[0].reason).toContain("waits seven days");

    f.tick(DAY);
    const due = await sendWave(db, "chicagoland-1-followup", [message(1)], { transport: f.transport, now: f.now, sleep: f.sleep });
    expect(due.sent).toHaveLength(1);
    expect(f.delivered).toHaveLength(1);

    f.tick(30 * DAY);
    const third = await sendWave(db, "chicagoland-1-third", [message(1)], { transport: f.transport, now: f.now, sleep: f.sleep });
    expect(third.refused[0].reason).toContain("one message and one follow-up");
    expect(f.delivered).toHaveLength(1);
  });

  it("takes turns with a second runner: the 40th goes out once, and the other reads it before judging", async () => {
    // Found by the verify pass (2026-10-27): read-then-send with no lock let two
    // terminals each send the 40th, a second apart or not at all.
    for (let n = 100; n < 139; n++) {
      await recordOutreachEvent(db, { shelterExternalId: shelter(n), wave: "chicagoland-0", kind: "sent", occurredAt: at(-2 * HOUR + (n - 100) * MINUTE) });
    }
    await confirmAddress(db, shelter(1), "1@a.org", "Logan", T0);
    await confirmAddress(db, shelter(2), "2@a.org", "Logan", T0);
    const f = fake();
    const slow: MailTransport = { send: (mail) => new Promise((resolve) => setTimeout(() => resolve(f.transport.send(mail)), 50)) };
    const [a, b] = await Promise.all([
      sendWave(db, WAVE, [message(1)], { transport: slow, now: f.now, sleep: f.sleep }),
      sendWave(db, "elsewhere-1", [message(2)], { transport: slow, now: f.now, sleep: f.sleep }),
    ]);
    expect(a.sent.length + b.sent.length).toBe(1);
    expect(f.delivered).toHaveLength(1);
    expect([...a.refused, ...b.refused].map((r) => r.reason)).toEqual([expect.stringContaining("40 sent in the last 24 hours")]);
  });

  it("takes turns on one shelter in one wave: one mail, one row, both runs report rather than throw", async () => {
    await confirmAddress(db, shelter(1), "1@a.org", "Logan", T0);
    const f = fake();
    const slow: MailTransport = { send: (mail) => new Promise((resolve) => setTimeout(() => resolve(f.transport.send(mail)), 50)) };
    const options = { transport: slow, now: f.now, sleep: f.sleep };
    const [a, b] = await Promise.all([sendWave(db, WAVE, [message(1)], options), sendWave(db, WAVE, [message(1)], options)]);
    expect(f.delivered).toHaveLength(1);
    expect(await db.select({ id: outreachEvents.id }).from(outreachEvents)).toHaveLength(1);
    expect([a.sent.length, b.sent.length].sort()).toEqual([0, 1]);
    expect([...a.refused, ...b.refused].map((r) => r.reason)).toEqual([expect.stringContaining("already sent in wave")]);
  });

  it("reports a delivered mail whose `sent` row could not be written, naming the message id, and stops", async () => {
    await confirmAddress(db, shelter(1), "1@a.org", "Logan", T0);
    await confirmAddress(db, shelter(2), "2@a.org", "Logan", T0);
    const f = fake();
    // The connection drops after SMTP answered: reads work, the one insert does not.
    let failInserts = 1;
    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "transaction") return Reflect.get(target, prop, receiver);
        return (fn: (tx: Db) => Promise<unknown>) =>
          target.transaction((tx) =>
            fn(
              new Proxy(tx as unknown as Db, {
                get(t, p, r) {
                  if (p === "insert" && failInserts > 0) {
                    failInserts--;
                    return () => {
                      throw new Error("connection terminated unexpectedly");
                    };
                  }
                  return Reflect.get(t, p, r);
                },
              }),
            ),
          );
      },
    }) as Db;
    const report = await sendWave(flaky, WAVE, [message(1), message(2)], { transport: f.transport, now: f.now, sleep: f.sleep });
    expect(f.delivered.map((m) => m.to)).toEqual(["1@a.org"]);
    expect(report.sent).toEqual([]);
    expect(report.failed).toEqual({ shelterExternalId: shelter(1), error: expect.stringContaining("DELIVERED to 1@a.org as <m1@test>") });
    expect(report.remaining).toEqual([shelter(2)]);
  });

  it("refuses an excluded shelter from the list the caller passes, and an opt-out in the record", async () => {
    await confirmAddress(db, shelter(1), "1@a.org", "Logan", T0);
    await confirmAddress(db, shelter(2), "2@a.org", "Logan", T0);
    await recordOutreachEvent(db, { shelterExternalId: shelter(2), wave: "chicagoland-0", kind: "opted_out", occurredAt: at(-DAY), note: "reply: remove" });
    const f = fake();
    const report = await sendWave(db, WAVE, [message(1), message(2)], {
      transport: f.transport,
      now: f.now,
      sleep: f.sleep,
      exclusions: [{ shelterExternalId: shelter(1), name: "One", askedBy: "its director", askedAt: "2026-11-01", evidence: "email" }],
    });
    expect(report.sent).toEqual([]);
    expect(report.refused.map((r) => r.reason)).toEqual([expect.stringContaining("SHELTER_EXCLUSIONS"), expect.stringContaining("opted out")]);
    expect(f.delivered).toEqual([]);
  });
});
