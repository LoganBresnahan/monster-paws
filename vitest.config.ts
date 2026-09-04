import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Creates and migrates the test database before any file (ADR-0017) —
    // the `db:test:prepare` vitest does not ship.
    globalSetup: ["tests/support/global-setup.ts"],
    // The Postgres suites share one database and truncate between tests;
    // files must not interleave or one suite's truncate lands mid-test in
    // another. The whole run is ~1s, so serial costs nothing.
    fileParallelism: false,
  },
});
