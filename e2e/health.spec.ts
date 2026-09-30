import { expect, test } from "./fixtures";

/**
 * `/api/health` against the production build (ADR-0010 as amended 2026-09-28).
 * The seed is a partial run by design, so this is the before-the-first-poll
 * state: the database answers, and the endpoint still refuses to call a
 * poller that has never completed healthy.
 */
test("health reaches the database and fails until a complete poll exists", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(503);
  expect(await res.json()).toMatchObject({
    ok: false,
    db: "up",
    lastCompletePollAt: null,
    pollStale: true,
  });
});
