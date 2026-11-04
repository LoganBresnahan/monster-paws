import { spokenAnimalName } from "@/core/email/animal-name";
import type { OutgoingEmail } from "@/core/email/sender";

type Env = Record<string, string | undefined>;

/**
 * Where the email's links go, kept apart from `SITE_ORIGIN`, which Every.org reads and which must
 * never be localhost (`link.ts`). A local chain's links point at the local server.
 */
export function emailLinkOrigin(env: Env = process.env): string {
  return (env.EMAIL_LINK_ORIGIN || "https://monsterpaws.org").replace(/\/+$/, "");
}

export interface PaintingEmailInput {
  to: string;
  /** unique across databases, because Resend keeps a key per team and a dev run and production share one team */
  sendKey: string;
  animalName: string;
  /** JPEG bytes, in the order they are shown */
  paintings: readonly Buffer[];
  /** null leaves the Share button out, never a dead link */
  shareToken: string | null;
  unsubscribeToken: string;
  origin: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fileStem(animalName: string): string {
  const stem = animalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return stem || "monster-paws";
}

/**
 * Never an amount, and never that money arrived: the intent holds no amount, and a painting can start
 * before the webhook (ADR-0035, decision 10). Never "choose one": all four are the donor's
 * (ADR-0004 as amended 2026-10-14). Nothing here may vary between attempts, or a retry under the same
 * idempotency key is refused as a different body.
 */
export function renderPaintingEmail(input: PaintingEmailInput): OutgoingEmail {
  const { origin } = input;
  const count = input.paintings.length;
  const name = spokenAnimalName(input.animalName);
  const unsubscribeUrl = `${origin}/unsubscribe/${input.unsubscribeToken}`;
  const shareUrl = input.shareToken ? `${origin}/share/${input.shareToken}` : null;

  const ways = count === 4 ? "four ways" : `${count} ways`;
  const subject = name ? `Your paintings of ${name}` : "Your paintings from Monster Paws";
  const title = `Thank you for thinking of ${name ?? "the animal you chose"}.`;
  const lead = `We painted ${name ?? "them"} ${ways}, and they're all yours to keep.`;
  const attached = "They're attached to this email too, so you can save them.";
  const share = name ? `Share ${name}'s painting` : "Share the painting";
  const why = `You're getting this because this address was entered when a gift for ${name ?? "an animal"} was started on Monster Paws.`;
  const stop = "Don't want email from us?";
  const contact = "Questions? Write to hello@monsterpaws.org.";

  const attachments = input.paintings.map((content, index) => ({
    filename: `${fileStem(name ?? "")}-painting-${index + 1}.jpg`,
    contentType: "image/jpeg",
    contentId: `painting-${index + 1}@monsterpaws.org`,
    content,
  }));

  const text = [
    `${title} ${lead}`,
    attached,
    ...(shareUrl ? [`${share}:\n${shareUrl}`] : []),
    why,
    `${stop} Unsubscribe:\n${unsubscribeUrl}`,
    contact,
  ].join("\n\n");

  const safeName = escapeHtml(name ?? "the animal you chose");
  const html = [
    `<!doctype html><html><body style="font-family: Georgia, serif; font-size: 16px; line-height: 1.5; color: #2b2320; max-width: 36em; margin: 0 auto; padding: 1em;">`,
    `<h1 style="font-size: 28px; line-height: 1.25; font-weight: bold; margin: 0 0 8px;">${escapeHtml(title)}</h1>`,
    `<p style="margin-top: 0;">${escapeHtml(lead)}</p>`,
    ...attachments.map(
      (a, index) =>
        `<p><img src="cid:${a.contentId}" alt="Painting ${index + 1} of ${count} of ${safeName}" width="520" style="width: 100%; max-width: 520px; height: auto; border-radius: 8px;"></p>`,
    ),
    `<p>${escapeHtml(attached)}</p>`,
    ...(shareUrl
      ? [
          `<p><a href="${escapeHtml(shareUrl)}" style="display: inline-block; background: #4c8c4a; color: #ffffff; padding: 12px 24px; border-radius: 12px; font-weight: bold; text-decoration: none;">${escapeHtml(share)}</a></p>`,
        ]
      : []),
    `<p style="font-size: 13px; color: #6b5f58;">${escapeHtml(why)}<br>${escapeHtml(stop)} <a href="${escapeHtml(unsubscribeUrl)}" style="color: #6b5f58;">Unsubscribe</a>.<br>${escapeHtml(contact)}</p>`,
    `</body></html>`,
  ].join("\n");

  return {
    to: input.to,
    subject,
    text,
    html,
    // RFC 8058: a mail client's one-click POSTs here; its GET only leads to the page with a button.
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    attachments,
    idempotencyKey: `painting-email-${input.sendKey}`,
  };
}
