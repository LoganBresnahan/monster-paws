import { describe, expect, it } from "vitest";
import { failureCode, reportingOptions, scrubEvent } from "@/core/observability";

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

  it("never traces, and tags the component", () => {
    const opts = reportingOptions("worker", { dsn, environment: undefined, release: "abc123" });
    expect(opts).toMatchObject({
      enabled: true,
      tracesSampleRate: 0,
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

describe("error reports never carry the webhook's path secret or an address (ADR-0027 §4, ADR-0010)", () => {
  const event = {
    transaction: "POST /api/webhooks/everyorg/[secret]",
    request: { url: "https://monsterpaws.org/api/webhooks/everyorg/abc123?x=1", headers: { referer: "/api/webhooks/everyorg/abc123" } },
    breadcrumbs: [{ data: { url: "http://127.0.0.1:3027/api/webhooks/everyorg/abc123" } }],
    message: "failed at /api/webhooks/everyorg/abc123",
  };

  it("removes it from everywhere the SDK copies the URL", () => {
    const scrubbed = JSON.stringify(scrubEvent(event));
    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).toContain("/api/webhooks/everyorg/<secret>?x=1");
  });

  it("removes the hidden test page's secret too", () => {
    const scrubbed = JSON.stringify(scrubEvent({ request: { url: "https://monsterpaws.org/test-gift/abc123?problem=form" } }));
    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).toContain("/test-gift/<secret>?problem=form");
    expect(JSON.stringify(scrubEvent({ request: { url: "https://monsterpaws.org/unsubscribe/abc-def/confirm" } }))).toContain("/unsubscribe/<secret>/confirm");
  });

  it("survives an address right after an escaped newline, which a multipart body always has", () => {
    // Scrubbing the JSON text ate the `n` of `\\n`, the parse threw, and the SDK dropped the report.
    const scrubbed = scrubEvent({ message: "a\npat@example.org", data: 'name="email"\r\n\r\npat@example.org\r\n' });
    expect(JSON.stringify(scrubbed)).not.toContain("pat@example.org");
    expect(scrubbed.message).toBe("a\n<email>");
  });

  it("leaves a third-party frame's path alone: an @scope isn't an address", () => {
    const frame = { filename: "/app/node_modules/@sentry/core/build/cjs/x.js" };
    expect(scrubEvent(frame)).toEqual(frame);
  });

  it("removes an address in a URL, and one with an apostrophe", () => {
    expect(JSON.stringify(scrubEvent({ url: "https://www.every.org/x?email=pat%40example.org&amount=5" }))).not.toContain("example.org");
    expect(JSON.stringify(scrubEvent({ message: "o'brien@example.org" }))).toBe('{"message":"<email>"}');
  });

  it("removes a failed query's parameters, which hold an intent id or an address", () => {
    const scrubbed = scrubEvent({ exception: { values: [{ value: 'Failed query: select "id" from "donation_intents"\nparams: abcDEF123_-abcDEF123_-' }] } });
    expect(JSON.stringify(scrubbed)).not.toContain("abcDEF123");
    expect(JSON.stringify(scrubbed)).toContain("Failed query");
  });

  it("drops the user, the cookies, the body and the query string outright", () => {
    const scrubbed = scrubEvent({ user: { ip_address: "203.0.113.9" }, request: { url: "/thanks", cookies: { mp_intents: "abc" }, data: "x", query_string: "y" } });
    expect(scrubbed).toEqual({ request: { url: "/thanks" } });
  });

  it("leaves every other path alone", () => {
    const other = { request: { url: "https://monsterpaws.org/animals/7" } };
    expect(scrubEvent(other)).toEqual(other);
  });

  it("removes an email address wherever it landed", () => {
    const leaked = { message: 'Failed query: insert ... params: abc,Pat.Smith+dogs@Mail.Example.org', extra: { to: "pat@example.org" } };
    const scrubbed = JSON.stringify(scrubEvent(leaked));
    expect(scrubbed).not.toMatch(/example\.org/i);
    expect(scrubbed).toContain("<email>");
  });

  it("reports a failed query by its code alone", () => {
    expect(failureCode(Object.assign(new Error("Failed query: params: pat@example.org"), { cause: { code: "23505" } }))).toBe("23505");
    expect(failureCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("ECONNREFUSED");
    expect(failureCode(new Error("params: pat@example.org"))).toBe("unknown");
  });

  it("is wired into every runtime's options", () => {
    const opts = reportingOptions("app", { dsn: "https://k@i.example/1", environment: undefined, release: undefined });
    expect(opts.beforeSend).toBe(scrubEvent);
  });
});
