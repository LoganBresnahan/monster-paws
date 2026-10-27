import { createTransport } from "nodemailer";

/** Any bag of strings: the real environment, or a test's. */
type Env = Record<string, string | undefined>;

/** One rendered message, ready to send. The text must read whole on its own (ADR-0029 §3). */
export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** set on a follow-up so a mail client threads it under the first message */
  inReplyTo?: string;
}

export interface SentMail {
  /** the Message-ID the transport assigned, recorded on the `sent` row */
  messageId: string;
}

/**
 * The one door outreach mail leaves through. Mailpit and Gmail are the same
 * SMTP code on another host (ADR-0029 §4); never wire Resend behind this —
 * it is the transactional sender for donors, not the voice of a person.
 */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<SentMail>;
}

export interface SmtpOptions {
  host: string;
  port: number;
  /** TLS from the first byte (465); otherwise STARTTLS is used when the server offers it */
  secure?: boolean;
  auth?: { user: string; pass: string };
}

export function smtpTransport(options: SmtpOptions): MailTransport {
  const transporter = createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure ?? false,
    auth: options.auth,
  });
  return {
    async send(mail) {
      const info = await transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        inReplyTo: mail.inReplyTo,
        references: mail.inReplyTo,
      });
      return { messageId: info.messageId };
    },
  };
}

/** The dev and test transport: whatever docker-compose.dev.yml's Mailpit is listening on. */
export function mailpitTransport(env: Env = process.env): MailTransport {
  return smtpTransport({
    host: env.MAIL_SMTP_HOST ?? "localhost",
    port: Number(env.MAIL_SMTP_PORT ?? 1025),
  });
}

/**
 * Live mail: Gmail's SMTP as Logan, with an app password (ADR-0029 §4). Throws
 * rather than falling back to Mailpit — a "live" run that quietly lands in
 * the local inbox reports a wave as sent that nobody received.
 */
export function gmailTransport(env: Env = process.env): MailTransport {
  const user = env.GMAIL_USER;
  const pass = env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER and GMAIL_APP_PASSWORD are not set — `pass show google/gmail-app-password` (ADR-0029 §4)",
    );
  }
  return smtpTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
}
