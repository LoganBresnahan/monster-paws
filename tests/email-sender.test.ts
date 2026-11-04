import { createTransport } from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { chooseEmailSender, EmailSendError, type OutgoingEmail, resendSender, smtpEmailSender } from "@/core/email/sender";

const IMAGE = Buffer.from("not really a jpeg");
const email: OutgoingEmail = {
  to: "logan@example.org",
  subject: "Your paintings of Beetle",
  text: "text",
  html: '<img src="cid:painting-1@monsterpaws.org">',
  headers: { "List-Unsubscribe": "<https://monsterpaws.org/unsubscribe/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  attachments: [{ filename: "beetle-painting-1.jpg", contentType: "image/jpeg", contentId: "painting-1@monsterpaws.org", content: IMAGE }],
  idempotencyKey: "painting-email-7",
};

const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("the Resend sender (ADR-0027, docs read 2026-11-03)", () => {
  it("sends from monsterpaws.org with the idempotency key, the headers and an inline attachment", async () => {
    const post = vi.fn(answer(200, { id: "re_1" }));
    const sent = await resendSender({ apiKey: "k", allowedTo: email.to, fetch: post as unknown as typeof fetch }).send(email);
    expect(sent).toEqual({ id: "re_1" });

    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer k", "Idempotency-Key": "painting-email-7" });
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("Monster Paws <hello@monsterpaws.org>");
    expect(body.to).toEqual([email.to]);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.attachments[0]).toEqual({
      filename: "beetle-painting-1.jpg",
      content_type: "image/jpeg",
      content_id: "painting-1@monsterpaws.org",
      content: IMAGE.toString("base64"),
    });
  });

  it("refuses any other address without calling Resend", async () => {
    const post = vi.fn(answer(200, { id: "re_1" }));
    const sender = resendSender({ apiKey: "k", allowedTo: "someone-else@example.org", fetch: post as unknown as typeof fetch });
    await expect(sender.send(email)).rejects.toMatchObject({ code: "recipient_not_allowed", sent: "no", retry: false });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    [429, { name: "rate_limit_exceeded" }, { sent: "no", retry: true }],
    [429, { name: "daily_quota_exceeded" }, { sent: "no", retry: true }],
    [401, { name: "missing_api_key" }, { sent: "no", retry: true }],
    [403, { name: "invalid_api_key" }, { sent: "no", retry: true }],
    [422, { name: "validation_error" }, { sent: "no", retry: false }],
    [409, { name: "concurrent_idempotent_requests" }, { sent: "unknown", retry: true }],
    [409, { name: "invalid_idempotent_request" }, { sent: "unknown", retry: false }],
    [503, {}, { sent: "unknown", retry: true }],
  ])("reads a %i %j", async (status, body, expected) => {
    const sender = resendSender({ apiKey: "k", allowedTo: email.to, fetch: answer(status, body) as unknown as typeof fetch });
    await expect(sender.send(email)).rejects.toMatchObject(expected);
  });

  it("treats a dropped connection as unknown, since Resend may have taken it", async () => {
    const drop = async () => {
      throw new Error("socket hang up");
    };
    const sender = resendSender({ apiKey: "k", allowedTo: email.to, fetch: drop as unknown as typeof fetch });
    await expect(sender.send(email)).rejects.toMatchObject({ code: "network", sent: "unknown", retry: true });
  });

  it("never carries the provider's message into the error, which can quote the address (ADR-0010)", async () => {
    const post = answer(422, { name: "validation_error", message: "bad address logan@example.org" });
    const sender = resendSender({ apiKey: "k", allowedTo: email.to, fetch: post as unknown as typeof fetch });
    const error = await sender.send(email).catch((err: EmailSendError) => err);
    expect(JSON.stringify({ message: (error as EmailSendError).message })).not.toContain("example.org");
  });
});

describe("choosing the sender (ADR-0027)", () => {
  it("is Mailpit unless told otherwise, even with a key in the environment", () => {
    expect(chooseEmailSender({ RESEND_API_KEY: "k", EMAIL_LIVE_ALLOWED_TO: "a@example.org" }).via).toBe("smtp");
    expect(chooseEmailSender({ EMAIL_LIVE: "1", RESEND_API_KEY: "k", EMAIL_LIVE_ALLOWED_TO: "a@example.org" }).via).toBe("resend");
  });

  it("throws when live is asked for without both the key and the one address", () => {
    expect(() => chooseEmailSender({ EMAIL_LIVE: "1" })).toThrow(/RESEND_API_KEY/);
    expect(() => chooseEmailSender({ EMAIL_LIVE: "1", RESEND_API_KEY: "k" })).toThrow(/EMAIL_LIVE_ALLOWED_TO/);
    expect(() => chooseEmailSender({ EMAIL_LIVE: "production" })).toThrow(/RESEND_API_KEY/);
    expect(() => chooseEmailSender({ EMAIL_LIVE: "yes", RESEND_API_KEY: "k" })).toThrow(/1 or production/);
  });

  it("reaches any address only with the droplet's value", async () => {
    expect(chooseEmailSender({ EMAIL_LIVE: "production", RESEND_API_KEY: "k" }).via).toBe("resend");
    const post = vi.fn(answer(200, { id: "re_1" }));
    await resendSender({ apiKey: "k", allowedTo: null, fetch: post as unknown as typeof fetch }).send(email);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("the SMTP sender Mailpit speaks", () => {
  it("writes the unsubscribe headers and an inline image with its content id", async () => {
    const transporter = createTransport({ streamTransport: true, buffer: true });
    const info = vi.spyOn(transporter, "sendMail");
    await smtpEmailSender(transporter).send(email);
    const result = (await info.mock.results[0].value) as { message: Buffer };
    const raw = result.message.toString();
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(raw).toContain("Content-ID: <painting-1@monsterpaws.org>");
    expect(raw).toContain("Monster Paws <hello@monsterpaws.org>");
  });
});
