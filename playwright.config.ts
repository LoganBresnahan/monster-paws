import { defineConfig } from "@playwright/test";

/**
 * E2E against the dev server (/shipshape gate). The production-build run
 * (`npm run e2e:prod`) is /deploy's job and reuses these specs against
 * `next start` via PW_BASE_URL.
 */
const baseURL = process.env.PW_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL },
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
