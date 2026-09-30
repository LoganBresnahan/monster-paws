import { describe, expect, it } from "vitest";
import { reportingOptions } from "@/core/observability";

/**
 * The settings ADR-0010 fixes for every runtime (as amended 2026-09-29). A
 * wizard, an SDK upgrade or a copy-paste from docs is how these drift, and
 * none of them would announce it.
 */
describe("ADR-0010 reporting options", () => {
  const dsn = "https://key@ingest.example.org/1";

  it("is disabled without a DSN, so dev and CI's e2e never report", () => {
    const opts = reportingOptions("app", { dsn: undefined, environment: undefined, release: undefined });
    expect(opts.enabled).toBe(false);
  });

  it("never traces, never sends PII, and tags the component", () => {
    const opts = reportingOptions("worker", { dsn, environment: undefined, release: "abc123" });
    expect(opts).toMatchObject({
      enabled: true,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      release: "abc123",
      initialScope: { tags: { component: "worker" } },
    });
  });

  it("defaults the environment to production, and passes any other through", () => {
    expect(reportingOptions("app", { dsn, environment: undefined, release: undefined }).environment).toBe(
      "production",
    );
    expect(reportingOptions("app", { dsn, environment: "spike", release: undefined }).environment).toBe("spike");
  });

  it("configures no session replay", () => {
    const opts = reportingOptions("app", { dsn, environment: undefined, release: undefined });
    expect(opts).not.toHaveProperty("replaysSessionSampleRate");
    expect(opts).not.toHaveProperty("replaysOnErrorSampleRate");
  });
});
