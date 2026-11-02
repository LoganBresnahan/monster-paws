import * as Sentry from "@sentry/nextjs";
import { MAX_BODY_BYTES, receiveWebhook, secretMatches } from "@/core/donate/webhook";
import { failureCode } from "@/core/observability";
import { getDb } from "@/db/client";

/** No body, whatever happened: this path is on the public internet, and through the staging tunnel it fronts a dev server. */
const bare = (status: number) => new Response(null, { status });

/** `null` past the limit. A missing or false content-length must not get the whole body into memory. */
async function readBounded(request: Request): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  // TextDecoder, as `request.text()` was: it strips a BOM, which would make a real gift unparsable.
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Every.org's POST (ADR-0027 §4). A stored delivery answers 200 whatever it meant,
 * since anything unmatched is kept and logged, not retried. 500 means it was not stored,
 * or stored and not decided, and the report says which. A wrong secret answers as if
 * nothing lived here, and stores nothing.
 */
export async function POST(request: Request, ctx: { params: Promise<{ secret: string }> }) {
  try {
    const { secret } = await ctx.params;
    const pathSecret = process.env.EVERYORG_WEBHOOK_SECRET;
    if (!secretMatches(secret, pathSecret)) {
      // Never the path itself. The only trace of a webhook configured with a stale
      // secret, or of someone guessing (ADR-0027's revisit trigger on forged calls).
      console.warn("[everyorg-webhook] wrong path secret: nothing stored");
      return bare(404);
    }

    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return bare(413);
    const body = await readBounded(request);
    if (body === null) return bare(413);

    const { payloadId, outcome, code } = await receiveWebhook(getDb(), {
      body,
      headers: request.headers.entries(),
      secrets: { authToken: process.env.EVERYORG_AUTH_TOKEN, pathSecret },
    });
    if (outcome === "decision_failed") {
      // A real gift may be unrecorded and its intent still open: the row is kept, so name it.
      console.error(`[everyorg-webhook] stored, not decided: payload ${payloadId}, ${code}`);
      Sentry.captureMessage(`everyorg webhook stored, not decided: ${code}`, { level: "error", extra: { payloadId } });
      return bare(500);
    }
    if (outcome !== "recorded" && outcome !== "replay") {
      console.warn(`[everyorg-webhook] kept, not acted on: payload ${payloadId}, ${outcome}`);
      Sentry.captureMessage(`everyorg webhook kept, not acted on: ${outcome}`, { level: "warning", extra: { payloadId } });
    }
    return bare(200);
  } catch (err) {
    const code = failureCode(err);
    console.error(`[everyorg-webhook] not stored: ${code}`);
    Sentry.captureMessage(`everyorg webhook not stored: ${code}`, { level: "error" });
    return bare(500);
  }
}
