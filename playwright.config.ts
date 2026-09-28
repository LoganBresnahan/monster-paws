import { defineConfig } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_PORT } from "./e2e/env";

/**
 * E2E against the PRODUCTION build, reading the seeded `monsterpaws_e2e`
 * (ADR-0017 as amended 2026-09-28). `npm run e2e` builds, then this starts
 * the standalone server with the e2e database in its environment. `npm run e2e:prod`
 * sets PW_BASE_URL to reuse /deploy's containers instead — which must be
 * started against the same database; global setup's canary checks.
 */
const external = process.env.PW_BASE_URL;
// 127.0.0.1, not localhost: the server binds IPv4 only, and `localhost` may
// resolve to ::1 first on a CI runner.
const baseURL = external ?? `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  globalSetup: "./e2e/global-setup.ts",
  // One seeded database shared by every spec; specs only read it.
  use: { baseURL },
  webServer: external
    ? undefined
    : {
        // The standalone server the Docker image runs, assembled the way the
        // Dockerfile assembles it — `next start` refuses this build output.
        command:
          "cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && " +
          "node .next/standalone/server.js",
        url: baseURL,
        // Never reuse: a server we did not start reads whatever database it
        // was started with, and the seed would be invisible to it.
        reuseExistingServer: false,
        timeout: 60_000,
        env: { DATABASE_URL: E2E_DATABASE_URL, PORT: String(E2E_PORT), HOSTNAME: "127.0.0.1" },
      },
});
