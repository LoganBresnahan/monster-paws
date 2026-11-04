import * as Sentry from "@sentry/nextjs";
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

/**
 * Acts on two bodies only: RFC 8058's from a mail client, answered blank as it asks, and the page's
 * form, sent on to the page saying it's done.
 */
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!hasTokenShape(token)) return bare(404);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return bare(413);
  const body = (await request.text()).trim();
  const oneClick = body === "List-Unsubscribe=One-Click";
  if (!oneClick && body !== "confirm=yes") return bare(400);

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
  return oneClick ? bare(200) : new Response(null, { status: 303, headers: { Location: `/unsubscribe/${token}/confirm?done=1` } });
}
