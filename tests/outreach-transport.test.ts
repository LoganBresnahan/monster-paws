import { describe, expect, it } from "vitest";
import { mailpitMessageBody, mailpitMessages } from "@/core/outreach/mailpit";
import { gmailTransport, mailpitTransport } from "@/core/outreach/transport";
import { SKIP_DB_TESTS } from "./support/db";

/**
 * The transport against the real Mailpit in docker-compose.dev.yml (ADR-0029
 * §4): a message handed to `send` is in the inbox with the Message-ID the
 * transport reported. Fails rather than skips when Mailpit is down, under the
 * same flag as the Postgres suites — `npm run db:up` starts both (ADR-0017).
 */
describe.skipIf(SKIP_DB_TESTS)("ADR-0029 mail transport", () => {
  it("delivers to Mailpit and reports the Message-ID the inbox shows", async () => {
    const stamp = `transport-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sent = await mailpitTransport().send({
      from: "Monster Paws <hello@monsterpaws.org>",
      to: `${stamp}@example.org`,
      subject: `Transport test ${stamp}`,
      text: `plain text body ${stamp}`,
      html: `<p>html body <b>${stamp}</b></p>`,
    });
    expect(sent.messageId).toMatch(/^<.+@.+>$/);

    const inbox = await mailpitMessages();
    const landed = inbox.find((m) => m.Subject === `Transport test ${stamp}`);
    expect(landed, "the message is in Mailpit's inbox").toBeDefined();
    expect(`<${landed!.MessageID}>`).toBe(sent.messageId);
    expect(landed!.To.map((t) => t.Address)).toEqual([`${stamp}@example.org`]);

    const body = await mailpitMessageBody(landed!.ID);
    expect(body.Text).toContain(`plain text body ${stamp}`);
    expect(body.HTML).toContain(`<b>${stamp}</b>`);
  });

  it("refuses a live transport without the Gmail pair, rather than falling back to Mailpit", () => {
    expect(() => gmailTransport({})).toThrow(/GMAIL_USER and GMAIL_APP_PASSWORD/);
    expect(() => gmailTransport({ GMAIL_USER: "logan@example.org" })).toThrow(
      /GMAIL_USER and GMAIL_APP_PASSWORD/,
    );
  });
});
