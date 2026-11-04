import * as Sentry from "@sentry/nextjs";
import { readBoundedBody } from "@/core/email/bounded-body";
import { hasTokenShape, suppressionKey, unsubscribe } from "@/core/email/suppression";
import { failureCode } from "@/core/observability";
import { getDb } from "@/db/client";

const bare = (status: number) => new Response(null, { status });
const MAX_BODY_BYTES = 1024;

/**
 * Writes nothing, ever: a mail scanner that prefetches this link would otherwise write a permanent
 * suppression and erase every waiting address with no click (ADR-0035, question 6). It only
 * leads to the page with the button.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!hasTokenShape(token)) return bare(404);
  return new Response(null, { status: 303, headers: { Location: `/unsubscribe/${token}/confirm` } });
}

/** RFC 8058 allows multipart or urlencoded, and prefers multipart, so a mail client's stop can come as either. */
async function askedToStop(body: Buffer, contentType: string): Promise<"one-click" | "button" | null> {
  let form: FormData | URLSearchParams;
  try {
    form = contentType.startsWith("multipart/form-data")
      ? await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData()
      : new URLSearchParams(body.toString("utf8").trim());
  } catch {
    return null;
  }
  if (form.get("List-Unsubscribe") === "One-Click") return "one-click";
  return form.get("confirm") === "yes" ? "button" : null;
}

/**
 * Acts on two bodies only: RFC 8058's from a mail client, answered blank as it asks, and the page's
 * form, sent on to the page saying it's done.
 */
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!hasTokenShape(token)) return bare(404);
  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (body === null) return bare(413);
  const asked = await askedToStop(body, request.headers.get("content-type") ?? "");
  if (!asked) return bare(400);

  const key = suppressionKey();
  if (!key) return bare(503);
  try {
    const done = await unsubscribe(getDb(), token, key);
    if (!done) return bare(404);
  } catch (err) {
    // The code alone: a failed query's message can carry its parameters, here an address (ADR-0010).
    const code = failureCode(err);
    console.error(`[unsubscribe] not written: ${code}`);
    Sentry.captureMessage(`unsubscribe not written: ${code}`, { level: "error" });
    return bare(500);
  }
  return asked === "one-click" ? bare(200) : new Response(null, { status: 303, headers: { Location: `/unsubscribe/${token}/confirm?done=1` } });
}
