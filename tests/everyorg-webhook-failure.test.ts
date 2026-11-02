import { afterEach, describe, expect, it, vi } from "vitest";

// A failed query's message carries its parameters, here a donor's name and email,
// so the route must not hand the error to the logs or to error reporting (ADR-0010).
const FAILED_QUERY = 'Failed query: insert into "everyorg_webhook_payloads" params: {"email":"pat@example.org"}';

const captureMessage = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage, captureException }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/core/donate/webhook", async (original) => ({
  ...(await original<typeof import("@/core/donate/webhook")>()),
  receiveWebhook: vi.fn(async () => {
    throw Object.assign(new Error(FAILED_QUERY), { cause: { code: "53300" } });
  }),
}));

describe("the webhook when it can't store a delivery (ADR-0027 §4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers a bare 500, so a retry may come, with no donor data anywhere", async () => {
    vi.stubEnv("EVERYORG_WEBHOOK_SECRET", "s3cret");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/webhooks/everyorg/[secret]/route");

    const response = await POST(new Request("https://example.test/x", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ secret: "s3cret" }),
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(captureException).not.toHaveBeenCalled();
    const reported = JSON.stringify([error.mock.calls, captureMessage.mock.calls]);
    expect(reported).toContain("53300");
    expect(reported).not.toContain("pat@example.org");
  });
});
