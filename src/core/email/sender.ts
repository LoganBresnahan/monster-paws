import { createTransport, type Transporter } from "nodemailer";

type Env = Record<string, string | undefined>;

/** One sender, fixed to monsterpaws.org (ADR-0027); never the outreach transport, which is Logan's own voice (ADR-0029 §4). */
export const EMAIL_FROM = "Monster Paws <hello@monsterpaws.org>";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  /** referenced from the HTML as `cid:<contentId>`; under Resend's 128 characters */
  contentId: string;
  content: Buffer;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  attachments: EmailAttachment[];
  /** the same key and the same body within 24 hours never mails twice, at Resend (ADR-0035) */
  idempotencyKey: string;
}

export interface SentEmail {
  /** the provider's id for this mail: never an address */
  id: string;
}

export interface EmailSender {
  readonly via: "smtp" | "resend";
  send(email: OutgoingEmail): Promise<SentEmail>;
}

/**
 * The code only: a provider's message can quote the address, and this reaches error reporting
 * (ADR-0010). `sent: false` means no mail left, so the claim can be released; otherwise only the
 * same key may try again.
 */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    readonly sent: "no" | "unknown",
    readonly retry: boolean,
  ) {
    super(`email not sent: ${code}`);
    this.name = "EmailSendError";
  }
}

/** What Mailpit and the tests speak. It can't prove DKIM or Resend's handling of an attachment. */
export function smtpEmailSender(transporter: Pick<Transporter, "sendMail">): EmailSender {
  return {
    via: "smtp",
    async send(email) {
      const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        attachments: email.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          cid: a.contentId,
          content: a.content,
        })),
      });
      return { id: info.messageId };
    },
  };
}

export function mailpitSender(env: Env = process.env): EmailSender {
  return smtpEmailSender(createTransport({ host: env.MAIL_SMTP_HOST ?? "localhost", port: Number(env.MAIL_SMTP_PORT ?? 1025) }));
}

const RESEND_EMAILS = "https://api.resend.com/emails";

/**
 * With `allowedTo`, only that address can receive anything: with a live key, a sweep could otherwise
 * mail any address in a dev database. Null is the droplet's alone (`EMAIL_LIVE=production`), and
 * never widen the check with a pattern.
 */
export function resendSender(options: { apiKey: string; allowedTo: string | null; fetch?: typeof fetch }): EmailSender {
  const post = options.fetch ?? fetch;
  return {
    via: "resend",
    async send(email) {
      if (options.allowedTo !== null && email.to.trim().toLowerCase() !== options.allowedTo.trim().toLowerCase()) {
        throw new EmailSendError("recipient_not_allowed", "no", false);
      }
      let response: Response;
      try {
        response = await post(RESEND_EMAILS, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": email.idempotencyKey,
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [email.to],
            subject: email.subject,
            text: email.text,
            html: email.html,
            headers: email.headers,
            attachments: email.attachments.map((a) => ({
              filename: a.filename,
              content_type: a.contentType,
              content_id: a.contentId,
              content: a.content.toString("base64"),
            })),
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        // A timeout can mean Resend took it, so only the same key may retry.
        throw new EmailSendError("network", "unknown", true);
      }
      const body = (await response.json().catch(() => ({}))) as { id?: unknown; name?: unknown };
      if (response.ok && typeof body.id === "string") return { id: body.id };
      throw classifyRefusal(response.status, typeof body.name === "string" ? body.name : null);
    },
  };
}

function classifyRefusal(status: number, name: string | null): EmailSendError {
  const code = name ?? `http_${status}`;
  // Docs, read 2026-11-03: this key's first request is still running, so "safe to retry later".
  if (name === "concurrent_idempotent_requests") return new EmailSendError(code, "unknown", true);
  // A different body under a used key: the first may have gone, so a person looks, never a new key.
  if (name === "invalid_idempotent_request") return new EmailSendError(code, "unknown", false);
  // A bad key or a spent quota says nothing about this gift, and holding it would need a person per gift.
  if (status === 401 || status === 403 || status === 429) return new EmailSendError(code, "no", true);
  if (status >= 500 || status === 200) return new EmailSendError(code, "unknown", true);
  return new EmailSendError(code, "no", false);
}

/**
 * Mailpit unless `EMAIL_LIVE` says otherwise: `1` for Resend to one allowed address, `production` for
 * the droplet. Throws rather than falling back: a "live" run that quietly lands in the local inbox
 * would record a painting as sent that nobody received.
 */
export function chooseEmailSender(env: Env = process.env): EmailSender {
  if (!env.EMAIL_LIVE) return mailpitSender(env);
  if (env.EMAIL_LIVE === "production") {
    if (!env.RESEND_API_KEY) throw new Error("EMAIL_LIVE=production needs RESEND_API_KEY");
    return resendSender({ apiKey: env.RESEND_API_KEY, allowedTo: null });
  }
  if (env.EMAIL_LIVE !== "1") throw new Error("EMAIL_LIVE is 1 or production");
  if (!env.RESEND_API_KEY || !env.EMAIL_LIVE_ALLOWED_TO) {
    throw new Error("EMAIL_LIVE=1 needs RESEND_API_KEY and EMAIL_LIVE_ALLOWED_TO");
  }
  return resendSender({ apiKey: env.RESEND_API_KEY, allowedTo: env.EMAIL_LIVE_ALLOWED_TO });
}
