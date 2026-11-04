import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A suppressed address is refused before any money moves, and told why (ADR-0027 as amended 2026-11-02, decision 7).
const ADDRESS = "pat@example.org";

const redirect = vi.hoisted(() => vi.fn());
const setCookie = vi.hoisted(() => vi.fn());
const createIntent = vi.hoisted(() => vi.fn(async () => "intent-id-intent-id-12"));
const isSuppressed = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: setCookie }) }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/core/donate/intent", async (original) => ({
  ...(await original<typeof import("@/core/donate/intent")>()),
  loadSponsorable: vi.fn(async () => ({ listed: true, nonprofit: { slug: "happy-tails", ein: "36-4219778" } })),
  createIntent,
}));
vi.mock("@/core/email/suppression", async (original) => ({
  ...(await original<typeof import("@/core/email/suppression")>()),
  isSuppressed,
}));

describe("the sponsor action and a suppressed address", () => {
  beforeEach(() => {
    vi.stubEnv("EVERYORG_ENV", "staging");
    vi.stubEnv("EVERYORG_WEBHOOK_TOKEN", "tok");
    redirect.mockImplementation((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url });
    });
    createIntent.mockClear();
    isSuppressed.mockClear();
    setCookie.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function start() {
    const { startSponsorship } = await import("@/app/animals/[id]/sponsor/actions");
    const form = new FormData();
    form.set("animalId", "7");
    form.set("amount", "5");
    form.set("email", ADDRESS);
    return startSponsorship(form);
  }

  it("sends them back to the form with no intent, no cookie, and the address out of the URL", async () => {
    vi.stubEnv("EMAIL_SUPPRESSION_KEY", "k");
    await expect(start()).rejects.toMatchObject({ url: "/animals/7/sponsor?amount=5&problem=suppressed" });
    expect(createIntent).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("checks nothing with no key, since nothing has been mailed", async () => {
    vi.stubEnv("EMAIL_SUPPRESSION_KEY", "");
    await start().catch(() => {});
    expect(isSuppressed).not.toHaveBeenCalled();
    expect(createIntent).toHaveBeenCalledTimes(1);
  });

  it("a failed check asks them to retry, with no intent", async () => {
    vi.stubEnv("EMAIL_SUPPRESSION_KEY", "k");
    isSuppressed.mockRejectedValueOnce(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(start()).rejects.toMatchObject({ url: "/animals/7/sponsor?amount=5&problem=retry" });
    expect(createIntent).not.toHaveBeenCalled();
  });
});
