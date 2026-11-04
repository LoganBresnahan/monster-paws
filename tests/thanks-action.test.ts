import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intentRef } from "@/core/donate/intent";

// Fixing an address: the form chooses among the cookie's gifts and nothing else, and a failure
// must not carry the address into error reporting (ADR-0010, ADR-0027 as amended 2026-11-02).
const ADDRESS = "pat@example.org";
const COOKIE_ID = "abcDEF123_-abcDEF123_-";
const OTHER_ID = "zzzDEF123_-abcDEF123_-";

const captureMessage = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const correctDonorEmail = vi.hoisted(() => vi.fn());
const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("@sentry/nextjs", () => ({ captureMessage }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieValue.value ? { value: cookieValue.value } : undefined) }) }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/core/donate/intent", async (original) => ({
  ...(await original<typeof import("@/core/donate/intent")>()),
  correctDonorEmail,
}));

const OLDER_ID = "yyyDEF123_-abcDEF123_-";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("fixing the address on the thank-you page", () => {
  beforeEach(() => {
    cookieValue.value = COOKIE_ID;
    redirect.mockImplementation((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url });
    });
    correctDonorEmail.mockResolvedValue("saved");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("changes the gift the page showed, even when it isn't the cookie's newest", async () => {
    cookieValue.value = `${COOKIE_ID}.${OLDER_ID}`;
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: ADDRESS, gift: intentRef(OLDER_ID) }))).rejects.toMatchObject({ url: "/thanks?saved=1" });
    expect(correctDonorEmail).toHaveBeenCalledExactlyOnceWith(expect.anything(), OLDER_ID, ADDRESS);
  });

  it("changes nothing for a gift outside this browser's cookie, however the form names it", async () => {
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    for (const gift of [intentRef(OTHER_ID), OTHER_ID, COOKIE_ID, ""]) {
      await expect(fixDonorEmail(form({ email: ADDRESS, gift }))).rejects.toMatchObject({ url: "/thanks" });
    }
    await expect(fixDonorEmail(form({ email: ADDRESS }))).rejects.toMatchObject({ url: "/thanks" });
    expect(correctDonorEmail).not.toHaveBeenCalled();
  });

  it("changes nothing for a browser with no cookie", async () => {
    cookieValue.value = undefined;
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: ADDRESS, gift: intentRef(COOKIE_ID) }))).rejects.toMatchObject({ url: "/thanks" });
    expect(correctDonorEmail).not.toHaveBeenCalled();
  });

  it("doesn't say saved when the address was already erased", async () => {
    correctDonorEmail.mockResolvedValue("erased");
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: ADDRESS, gift: intentRef(COOKIE_ID) }))).rejects.toMatchObject({ url: "/thanks" });
  });

  it("says the painting has gone, never saved, once the mail has left", async () => {
    correctDonorEmail.mockResolvedValue("already-sent");
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: ADDRESS, gift: intentRef(COOKIE_ID) }))).rejects.toMatchObject({ url: "/thanks?problem=sent" });
  });

  it("never says the painting went out when the provider refused it: the page says there's a problem", async () => {
    correctDonorEmail.mockResolvedValue("held");
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: ADDRESS, gift: intentRef(COOKIE_ID) }))).rejects.toMatchObject({ url: "/thanks" });
  });

  it("says saved when a bounced gift takes its new address", async () => {
    correctDonorEmail.mockResolvedValue("resending");
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: ADDRESS, gift: intentRef(COOKIE_ID) }))).rejects.toMatchObject({ url: "/thanks?saved=1" });
  });

  it("refuses what isn't an address, and writes nothing", async () => {
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: "pat" }))).rejects.toMatchObject({ url: "/thanks?problem=email" });
    expect(correctDonorEmail).not.toHaveBeenCalled();
  });

  it("says to try again on a failed write, and reports only the code", async () => {
    correctDonorEmail.mockRejectedValue(
      Object.assign(new Error(`Failed query: update "donation_intents" params: ${ADDRESS}`), { cause: { code: "53300" } }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fixDonorEmail } = await import("@/app/thanks/actions");
    await expect(fixDonorEmail(form({ email: ADDRESS, gift: intentRef(COOKIE_ID) }))).rejects.toMatchObject({ url: "/thanks?problem=retry" });
    const reported = JSON.stringify([error.mock.calls, captureMessage.mock.calls]);
    expect(reported).toContain("53300");
    expect(reported).not.toContain(ADDRESS);
    error.mockRestore();
  });
});
