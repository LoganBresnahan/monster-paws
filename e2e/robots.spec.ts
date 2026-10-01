import { expect, test } from "./fixtures";

/** ADR-0024: search engines in; filtered browse, the API and AI-training crawlers out. */
test("robots.txt fences filtered browse and the API, and opts out of AI training", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/User-Agent: GPTBot\nUser-Agent: ClaudeBot[\s\S]*?Disallow: \/\n/);
  expect(body).toContain("Disallow: /api/");
  expect(body).toContain("Disallow: /animals?*species=");
  expect(body).toContain("Disallow: /animals?*state=");
  // Link previews are how donors arrive; they must never be fenced out.
  expect(body).not.toMatch(/facebookexternalhit|Twitterbot|Slackbot/);
});
