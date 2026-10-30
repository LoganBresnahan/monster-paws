import { describe, expect, it } from "vitest";
import { evidenceOf } from "@/core/outreach/evidence";
import { CHICAGOLAND } from "@/core/outreach/list";
import { HACKATHON_ENDS, confirmLiveSend, parseOutreachArgs, senderFromEnv, timingFor } from "@/worker/outreach-args";

/**
 * The CLI's refusals, with no database and no network (ADR-0029 §4): a send
 * is a named wave, a live send needs a terminal and the name typed back, a
 * kind is one of the ADR's five, and the hackathon clause has a date.
 */

describe("ADR-0029 parseOutreachArgs", () => {
  it("reads each command's shape", () => {
    expect(parseOutreachArgs(["list"])).toEqual({ command: "list", wave: null });
    expect(parseOutreachArgs(["list", "--wave", "chicagoland-1"])).toEqual({ command: "list", wave: { ...CHICAGOLAND, limit: undefined } });
    expect(parseOutreachArgs(["match", "rescuegroups:org:3077"])).toEqual({ command: "match", shelter: "rescuegroups:org:3077" });
    expect(parseOutreachArgs(["find-emails", "rescuegroups:org:3077"])).toEqual({ command: "find-emails", shelter: "rescuegroups:org:3077" });
    expect(parseOutreachArgs(["preview", "rescuegroups:org:3077"])).toEqual({ command: "preview", shelter: "rescuegroups:org:3077" });
    expect(parseOutreachArgs(["status"])).toEqual({ command: "status" });
    expect(parseOutreachArgs(["prepare", "--wave", "chicagoland-1"])).toEqual({ command: "prepare", wave: { ...CHICAGOLAND, limit: undefined } });
    expect(() => parseOutreachArgs(["prepare"])).toThrow(/--wave <name> is required/);
  });

  it("builds a wave from a radius or states, never both, never none, never more than 200", () => {
    expect(parseOutreachArgs(["send", "--wave", "milwaukee-1", "--zip", "53202", "--miles", "40", "--limit", "50"])).toEqual({
      command: "send",
      wave: { name: "milwaukee-1", within: { zip: "53202", miles: 40 }, limit: 50 },
      live: false,
      override: null,
      skip: [],
    });
    expect(parseOutreachArgs(["send", "--wave", "chicagoland-1", "--skip", "rescuegroups:org:11266, rescuegroups:org:9756"])).toMatchObject({
      skip: ["rescuegroups:org:11266", "rescuegroups:org:9756"],
    });
    expect(() => parseOutreachArgs(["send", "--wave", "chicagoland-1", "--skip", "11266"])).toThrow(/--skip takes shelter keys/);
    expect(parseOutreachArgs(["send", "--wave", "midwest-1", "--states", "il, wi"])).toMatchObject({ wave: { name: "midwest-1", states: ["IL", "WI"] } });
    expect(parseOutreachArgs(["send", "--wave", "chicagoland-1"])).toMatchObject({ wave: CHICAGOLAND });
    expect(() => parseOutreachArgs(["send", "--wave", "elsewhere-1"])).toThrow(/names no region/);
    expect(() => parseOutreachArgs(["send", "--wave", "x-1", "--zip", "60614", "--miles", "50", "--states", "IL"])).toThrow(/not both/);
    expect(() => parseOutreachArgs(["send", "--wave", "x-1", "--zip", "60614"])).toThrow(/go together/);
    expect(() => parseOutreachArgs(["send", "--wave", "x-1", "--states", "Illinois"])).toThrow(/two-letter/);
    expect(() => parseOutreachArgs(["send", "--wave", "x-1", "--states", "IL", "--limit", "201"])).toThrow(/up to 200/);
    expect(() => parseOutreachArgs(["send", "--wave", "Chicagoland 1"])).toThrow(/kebab-case/);
  });

  it("refuses a send with no wave, live or not, and an override without --live", () => {
    expect(() => parseOutreachArgs(["send"])).toThrow(/--wave <name> is required/);
    expect(() => parseOutreachArgs(["send", "--live"])).toThrow(/--wave <name> is required/);
    expect(() => parseOutreachArgs(["send", "--wave", "chicagoland-1", "--override", "list fixed"])).toThrow(/only means something with --live/);
    expect(parseOutreachArgs(["send", "--wave", "chicagoland-1", "--live", "--override", "list fixed"])).toMatchObject({ live: true, override: "list fixed" });
  });

  it("records only the five kinds, under a wave, with an optional time and file", () => {
    expect(parseOutreachArgs(["record", "rescuegroups:org:3077", "--wave", "chicagoland-1", "--kind", "replied", "--message-id", "<r1@x>", "--note", "says yes"])).toEqual({
      command: "record",
      shelter: "rescuegroups:org:3077",
      wave: "chicagoland-1",
      kind: "replied",
      messageId: "<r1@x>",
      note: "says yes",
      at: null,
      eml: null,
    });
    expect(parseOutreachArgs(["record", "rescuegroups:org:3077", "--wave", "chicagoland-1", "--kind", "opted_out", "--eml", "var/x.eml", "--at", "2026-11-03T10:00:00Z"])).toMatchObject({
      kind: "opted_out",
      eml: "var/x.eml",
      at: new Date("2026-11-03T10:00:00Z"),
    });
    expect(() => parseOutreachArgs(["record", "rescuegroups:org:3077", "--wave", "chicagoland-1", "--kind", "complaint"])).toThrow(/sent\|bounced\|replied\|opted_out\|granted/);
    expect(() => parseOutreachArgs(["record", "rescuegroups:org:3077", "--kind", "replied"])).toThrow(/--wave/);
    expect(() => parseOutreachArgs(["record", "3077", "--wave", "chicagoland-1", "--kind", "replied"])).toThrow(/shelter key/);
    expect(() => parseOutreachArgs(["record", "rescuegroups:org:3077", "--wave", "chicagoland-1", "--kind", "replied", "--at", "yesterday"])).toThrow(/not a date/);
  });

  it("refuses a command it does not know, and a shelter key in the wrong shape", () => {
    expect(() => parseOutreachArgs(["blast"])).toThrow(/usage/);
    expect(() => parseOutreachArgs([])).toThrow(/usage/);
    expect(() => parseOutreachArgs(["preview", "Border Tails"])).toThrow(/shelter key/);
  });
});

describe("ADR-0029 confirmLiveSend", () => {
  const plan = { wave: "chicagoland-1", count: 3, from: "Logan <logan@example.org>" };

  it("refuses without a terminal, before asking anything", async () => {
    let asked = 0;
    await expect(
      confirmLiveSend(plan, {
        isTTY: false,
        ask: async () => {
          asked++;
          return "chicagoland-1";
        },
      }),
    ).rejects.toThrow(/not a TTY/);
    expect(asked).toBe(0);
  });

  it("takes the wave's name typed back and nothing else", async () => {
    const io = (answer: string) => ({ isTTY: true, ask: async () => answer });
    await expect(confirmLiveSend(plan, io("chicagoland-1"))).resolves.toBeUndefined();
    await expect(confirmLiveSend(plan, io(" chicagoland-1 "))).resolves.toBeUndefined();
    await expect(confirmLiveSend(plan, io("y"))).rejects.toThrow(/not confirmed/);
    await expect(confirmLiveSend(plan, io("yes"))).rejects.toThrow(/not confirmed/);
    await expect(confirmLiveSend(plan, io(""))).rejects.toThrow(/not confirmed/);
    await expect(confirmLiveSend(plan, io("chicagoland-2"))).rejects.toThrow(/not confirmed/);
  });

  it("names the count and the sender in the question, and refuses an empty wave", async () => {
    let question = "";
    await confirmLiveSend(plan, {
      isTTY: true,
      ask: async (q) => {
        question = q;
        return "chicagoland-1";
      },
    });
    expect(question).toContain("up to 3 real messages");
    expect(question).toContain("Logan <logan@example.org>");
    await expect(confirmLiveSend({ ...plan, count: 0 }, { isTTY: true, ask: async () => "chicagoland-1" })).rejects.toThrow(/no message/);
  });
});

describe("ADR-0028 the hackathon clause has a date", () => {
  it("is on until 21:00 ET on 4 November 2026 and gone after", () => {
    expect(timingFor(new Date("2026-10-27T12:00:00Z"))).toEqual({ event: "the Meta Global AI Developer Hackathon", until: "4 November 2026" });
    expect(timingFor(new Date(HACKATHON_ENDS.getTime() - 1))).not.toBeNull();
    expect(timingFor(HACKATHON_ENDS)).toBeNull();
    expect(timingFor(new Date("2026-11-10T12:00:00Z"))).toBeNull();
  });
});

describe("ADR-0029 the sender", () => {
  it("signs as a person, from the Gmail account when there is one", () => {
    expect(senderFromEnv({})).toEqual({ name: "Logan Bresnahan", role: "founder", email: "logan@monsterpaws.org" });
    expect(senderFromEnv({ GMAIL_USER: "logan.b@gmail.com", OUTREACH_SENDER_ROLE: "co-founder" })).toEqual({ name: "Logan Bresnahan", role: "co-founder", email: "logan.b@gmail.com" });
  });
});

describe("ADR-0029 as amended 2026-10-27: evidence from the raw message", () => {
  const eml = [
    "Delivered-To: logan@example.org",
    "Return-Path: <dana@quiethollow.org>",
    "Message-ID:",
    " <CAF1x2y3@mail.quiethollow.org>",
    "From: Dana Ruiz <dana@quiethollow.org>",
    "Date: Mon, 2 Nov 2026 09:14:00 -0600",
    "Subject: Re: Quiet Hollow Rescue on Monster Paws",
    "",
    "remove",
    "",
  ].join("\r\n");

  it("reads the Message-ID (folded or not), hashes the bytes, and writes the entry's evidence line", () => {
    const evidence = evidenceOf(eml);
    expect(evidence.messageId).toBe("<CAF1x2y3@mail.quiethollow.org>");
    expect(evidence.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.line).toBe(`<CAF1x2y3@mail.quiethollow.org> sha256:${evidence.sha256}`);
    expect(evidence.from).toBe("Dana Ruiz <dana@quiethollow.org>");
    expect(evidence.date).toBe("Mon, 2 Nov 2026 09:14:00 -0600");
    // One byte changed, another hash: the vault copy must match the export exactly.
    expect(evidenceOf(eml.replace("remove", "Remove")).sha256).not.toBe(evidence.sha256);
    expect(evidenceOf(Buffer.from(eml)).sha256).toBe(evidence.sha256);
  });

  it("refuses a copy of the words with no headers", () => {
    expect(() => evidenceOf("Dana wrote:\n\nremove\n")).toThrow(/no Message-ID header/);
  });
});
