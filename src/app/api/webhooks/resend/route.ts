import * as Sentry from "@sentry/nextjs";
import { readBoundedBody } from "@/core/email/bounded-body";
import { receiveResendEvent, verifyResendSignature } from "@/core/email/resend-webhook";
import { suppressionKey } from "@/core/email/suppression";
import { failureCode } from "@/core/observability";
import { getDb } from "@/db/client";

/** No body, whatever happened: this path is on the public internet. */
const bare = (status: number) => new Response(null, { status });
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Resend's signed events (ADR-0027 as amended 2026-11-02, ADR-0035). Answers as if nothing lived here
 * until it is configured, and a 500 asks Resend to retry, which keeps the same `svix-id`. Never logs or
 * reports the body: it holds the recipient's address.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return bare(404);
  const key = suppressionKey();
  if (!key) return bare(503);

  const bytes = await readBoundedBody(request, MAX_BODY_BYTES);
  if (bytes === null) return bare(413);
  const body = bytes.toString("utf8");

  const headers = {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };
  if (!verifyResendSignature(body, headers, secret)) {
    console.warn("[resend-webhook] bad signature: nothing stored");
    return bare(401);
  }

  try {
    const outcome = await receiveResendEvent(getDb(), headers.id!, body, key);
    if (outcome === "unreadable") console.warn("[resend-webhook] signed body did not parse");
    if (outcome === "failed") Sentry.captureMessage("resend reports a painting email failed to send", { level: "error" });
    // A person acts on this: `npm run email -- bounced` names the keepsake, never the address (ADR-0027 as amended 2026-11-02, decision 4).
    if (outcome === "bounced") Sentry.captureMessage("a painting email bounced: the donor must give a new address", { level: "error" });
    return bare(200);
  } catch (err) {
    // The code alone: a failed query's message can carry its parameters, here an address (ADR-0010).
    const code = failureCode(err);
    console.error(`[resend-webhook] not decided: ${code}`);
    Sentry.captureMessage(`resend webhook not decided: ${code}`, { level: "error" });
    return bare(500);
  }
}
