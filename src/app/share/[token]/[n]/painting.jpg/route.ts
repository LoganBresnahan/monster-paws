import { isShareToken, paintingNumber, shareSourceFromEnv } from "@/core/share/source";

// Cloudflare holds these for a month and a browser for an hour, so a takedown
// never ends at the delete: it must purge them too (ADR-0036).
const CACHE = "public, max-age=3600, s-maxage=2592000";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; n: string }> }) {
  const { token, n: raw } = await params;
  const n = paintingNumber(raw);
  // Never answer a query string: each is its own month-long entry at Cloudflare, which a takedown's purge can't name (ADR-0036).
  const plain = !new URL(request.url).search;
  const body = plain && n && isShareToken(token) ? await shareSourceFromEnv()?.painting(token, n) : null;
  if (!body) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": CACHE,
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
