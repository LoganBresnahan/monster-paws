import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A failed query's message carries its parameters, so the route must report the code alone (ADR-0010).
const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage, captureException: vi.fn() }));
vi.mock("@/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: async () => {
          throw Object.assign(new Error('Failed query: params: {"email":"pat@example.org"}'), { cause: { code: "57P01" } });
        },
      }),
    }),
  }),
}));

const BODY = JSON.stringify({ event: "donation.completed", chargeId: "charge-1", firstName: "Pat", email: "pat@example.org" });
const post = () =>
  import("@/app/api/webhooks/everyorg/[secret]/route").then(({ POST }) =>
    POST(new Request("https://example.test/x", { method: "POST", body: BODY }), { params: Promise.resolve({ secret: "s3cret" }) }),
  );

describe("the route when the database is down (ADR-0027 as amended 2026-11-03)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "webhook-route-"));
    vi.stubEnv("EVERYORG_WEBHOOK_SECRET", "s3cret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureMessage.mockClear();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("answers a bare 200 with the delivery on disk, and reports the code alone", async () => {
    vi.stubEnv("WEBHOOK_SPOOL_DIR", dir);
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");

    const [name] = await readdir(dir);
    const text = await readFile(path.join(dir, name), "utf8");
    expect(text).not.toContain("pat@example.org");
    expect(text).not.toContain("Pat");
    expect(captureMessage).toHaveBeenCalledWith("everyorg webhook spooled: 57P01", { level: "warning" });
    expect(JSON.stringify([captureMessage.mock.calls, vi.mocked(console.error).mock.calls])).not.toContain("pat@example.org");
  });

  it("answers 500 when the file can't be written either, because nothing has it", async () => {
    const notADirectory = path.join(dir, "file");
    await writeFile(notADirectory, "");
    vi.stubEnv("WEBHOOK_SPOOL_DIR", notADirectory);
    expect((await post()).status).toBe(500);
    expect(captureMessage.mock.calls.flat().join(" ")).toContain("not stored");
  });

  it("answers 500 with no spool configured, as it always did", async () => {
    vi.stubEnv("WEBHOOK_SPOOL_DIR", "");
    expect((await post()).status).toBe(500);
  });
});
