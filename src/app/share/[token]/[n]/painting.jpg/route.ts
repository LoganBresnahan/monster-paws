import { isShareToken, paintingNumber, shareSourceFromEnv } from "@/core/share/source";

// Cloudflare holds these for a day and a browser for an hour, so a takedown never ends at the delete: it must purge
// them too. A day, never longer: Next hides a bare `?` from this route, and that copy can only age out (ADR-0036).
const CACHE = "public, max-age=3600, s-maxage=86400";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; n: string }> }) {
  const { token, n: raw } = await params;
  const n = paintingNumber(raw);
  const body = n && isShareToken(token) ? await shareSourceFromEnv()?.painting(token, n) : null;
  if (!body) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      // A query is its own entry at Cloudflare, which a takedown's purge can't name. Never 404 it:
      // a platform that adds a query would lose its preview, and `NEXT_DEPLOYMENT_ID` would add one to every image (ADR-0036).
      "Cache-Control": request.url.includes("?") ? "no-store" : CACHE,
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
