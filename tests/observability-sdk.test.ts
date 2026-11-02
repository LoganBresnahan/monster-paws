import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it } from "vitest";
import { reportingOptions } from "@/core/observability";

/**
 * Against the real SDK with a stub transport, because a test of our own options passed for
 * a month while SDK 11 ignored `sendDefaultPii` and sent the visitor's IP and every cookie
 * (ADR-0010 as amended 2026-11-02). Nothing leaves the process.
 */

const INTENT_ID = "abcDEF123_-abcDEF123_-";
const REQUEST = {
  method: "POST",
  url: "https://monsterpaws.org/thanks?email=pat%40example.org",
  query_string: "email=pat%40example.org",
  cookies: { mp_intents: INTENT_ID },
  data: 'name="email"\r\n\r\npat@example.org\r\n',
  headers: {
    cookie: `mp_intents=${INTENT_ID}`,
    "cf-connecting-ip": "203.0.113.9",
    "x-forwarded-for": "203.0.113.9",
    referer: `https://www.every.org/x?partner_donation_id=${INTENT_ID}&email=pat%40example.org`,
    "user-agent": "test-agent",
  },
};

type Options = Partial<Parameters<typeof Sentry.init>[0]>;

async function capture(overrides: Options = {}, message = "boom"): Promise<string> {
  const sent: unknown[] = [];
  Sentry.init({
    ...reportingOptions("app", { dsn: "https://k@o.invalid/1", environment: "test", release: "x" }),
    // Off here only: it would copy this file's own source, literals included, into the report.
    integrations: (defaults) => defaults.filter((integration) => integration.name !== "ContextLines"),
    transport: () => ({
      send: async (envelope) => {
        sent.push(envelope[1]);
        return {};
      },
      flush: async () => true,
    }),
    ...overrides,
  });
  await Sentry.withIsolationScope(async (scope) => {
    scope.setSDKProcessingMetadata({ normalizedRequest: REQUEST, ipAddress: "203.0.113.9" });
    Sentry.captureMessage(message);
    await Sentry.flush(500);
  });
  expect(sent.length, "the event reached the transport").toBeGreaterThan(0);
  return JSON.stringify(sent);
}

describe("what actually leaves in an error report (ADR-0010)", () => {
  afterEach(async () => {
    await Sentry.close(50);
  });

  it("is the SDK's default dangerous, or this suite proves nothing", async () => {
    const report = await capture({ dataCollection: undefined, beforeSend: undefined });
    expect(report).toContain(INTENT_ID);
    expect(report).toContain("203.0.113.9");
  });

  it("carries no IP, cookie, intent id, address or body", async () => {
    const report = await capture();
    for (const leak of [INTENT_ID, "203.0.113.9", "pat@example.org", "pat%40example.org", "mp_intents"]) {
      expect(report, leak).not.toContain(leak);
    }
    expect(report).toContain("boom");
  });

  it("isn't saved by the scrub alone: the collection switch holds with it removed", async () => {
    const report = await capture({ beforeSend: undefined });
    for (const leak of [INTENT_ID, "203.0.113.9", "mp_intents"]) {
      expect(report, leak).not.toContain(leak);
    }
  });

  it("still arrives when its message holds an address after a newline, which used to drop it", async () => {
    const report = await capture({}, "failed\npat@example.org");
    expect(report).toContain("failed");
    expect(report).not.toContain("pat@example.org");
  });
});
