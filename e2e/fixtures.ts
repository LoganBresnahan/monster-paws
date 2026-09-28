import { test as base, type Request } from "@playwright/test";
import type { SeedManifest } from "./seed";

/** A 1×1 transparent GIF — what every off-site image resolves to under test. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * Every spec runs offline from the rest of the internet (ADR-0017 as amended
 * 2026-09-28): the tracker pixel is a real page view on RescueGroups' side and
 * the photo CDN is their bandwidth, so off-site requests are recorded and
 * answered locally, never forwarded.
 */
export const test = base.extend<{ seed: SeedManifest; offsite: Request[] }>({
  seed: async ({}, use) => {
    const raw = process.env.E2E_SEED;
    if (!raw) throw new Error("E2E_SEED is unset — global setup did not run");
    await use(JSON.parse(raw) as SeedManifest);
  },
  offsite: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const seen: Request[] = [];
      await page.route(
        (url) => url.origin !== origin,
        async (route) => {
          seen.push(route.request());
          if (route.request().resourceType() === "image") {
            await route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL });
          } else {
            await route.abort();
          }
        },
      );
      await use(seen);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
