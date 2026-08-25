import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The Postgres suites share one database and truncate between tests;
    // files must not interleave or one suite's truncate lands mid-test in
    // another. The whole run is ~1s, so serial costs nothing.
    fileParallelism: false,
  },
});
