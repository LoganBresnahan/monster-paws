import { afterEach, describe, expect, it, vi } from "vitest";

// A failed insert's message carries the donor's address, so the action must not let
// it reach the logs or error reporting (ADR-0010, ADR-0027 as amended 2026-11-02).
const ADDRESS = "pat@example.org";
const REDIRECTED = "NEXT_REDIRECT";

const captureMessage = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const setCookie = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage, captureException }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: setCookie }) }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/core/donate/intent", async (original) => ({
  ...(await original<typeof import("@/core/donate/intent")>()),
  loadSponsorable: vi.fn(async () => ({ listed: true, nonprofit: { slug: "happy-tails", ein: "36-4219778" } })),
  createIntent: vi.fn(async () => {
    throw Object.assign(new Error(`Failed query: insert into "donation_intents" params: abc,${ADDRESS}`), { cause: { code: "53300" } });
  }),
}));

describe("the sponsor action when the intent can't be stored", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends the donor back to try again, sets no cookie, and reports only the code", async () => {
    vi.stubEnv("EVERYORG_ENV", "staging");
    vi.stubEnv("EVERYORG_WEBHOOK_TOKEN", "tok");
    redirect.mockImplementation((url: string) => {
      throw Object.assign(new Error(REDIRECTED), { url });
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startSponsorship } = await import("@/app/animals/[id]/sponsor/actions");

    const form = new FormData();
    form.set("animalId", "7");
    form.set("amount", "5");
    form.set("email", ADDRESS);
    await expect(startSponsorship(form)).rejects.toMatchObject({ url: "/animals/7/sponsor?amount=5&problem=retry" });

    expect(setCookie).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    const reported = JSON.stringify([error.mock.calls, captureMessage.mock.calls]);
    expect(reported).toContain("53300");
    expect(reported).not.toContain(ADDRESS);
  });
});
