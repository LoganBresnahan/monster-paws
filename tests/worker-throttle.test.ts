import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The worker's own wiring for the art queue, booted with pg-boss, Sentry and the painter mocked (adapted from verify's
// repro, 2026-11-04): what it reports, how often, and what it holds back.

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), captureMessage: vi.fn(), close: vi.fn(async () => true), withScope: vi.fn() }));
const state = vi.hoisted(() => ({ handlers: {} as Record<string, (e: Error) => void>, work: {} as Record<string, (jobs: unknown[]) => Promise<void>>, ctor: [] as unknown[], generate: vi.fn() }));

vi.mock("@sentry/node", () => sentry);
vi.mock("pg-boss", () => ({
  PgBoss: class {
    constructor(options: unknown) { state.ctor.push(options); }
    on(event: string, fn: (e: Error) => void) { state.handlers[event] = fn; }
    start = async () => {};
    stop = async () => {};
    createQueue = async () => {};
    work = async (name: string, a: unknown, b?: unknown) => { state.work[name] = (b ?? a) as (jobs: unknown[]) => Promise<void>; };
    send = async () => "id";
    schedule = async () => {};
    unschedule = async () => {};
  },
}));
vi.mock("@/worker/art", async (original) => ({
  ...(await original<object>()),
  bindArtStore: async () => "verify",
  generateArt: state.generate,
  guardPainter: () => ({}),
  sharePublisher: () => undefined,
}));

const T0 = new Date("2026-11-04T12:00:00Z").getTime();
const MIN = 60_000;

async function boot(mode: "art" | "normal") {
  vi.resetModules();
  state.handlers = {};
  state.work = {};
  state.ctor = [];
  vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL ?? "postgres://x:y@localhost:5432/none");
  vi.stubEnv("WORKER_MODE", mode === "art" ? "art" : "");
  vi.stubEnv("ART_SWEEP", "");
  vi.stubEnv("EMAIL_SWEEP", "");
  vi.stubEnv("INGEST_POLL_SCHEDULE", "off");
  vi.stubEnv("RESCUEGROUPS_API_KEY", "");
  await import("@/worker/index");
  await vi.waitFor(() => {
    expect(state.handlers.error).toBeDefined();
    if (mode === "art") expect(state.work["art.generate"]).toBeDefined();
    else expect(Object.keys(state.work).length).toBeGreaterThan(0);
  });
  vi.setSystemTime(T0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  sentry.captureException.mockClear();
  sentry.captureMessage.mockClear();
  state.generate.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pg-boss errors", () => {
  it("the normal worker reports every one, with heldBack 0, and registers no art job", async () => {
    await boot("normal");
    expect(typeof state.ctor[0]).toBe("string");
    expect(state.work["art.generate"]).toBeUndefined();
    for (let i = 0; i < 3; i++) state.handlers.error(new Error(`e${i}`));
    expect(sentry.captureException).toHaveBeenCalledTimes(3);
    for (const [i, call] of sentry.captureException.mock.calls.entries()) {
      expect((call[0] as Error).message).toBe(`e${i}`);
      expect(call[1]).toEqual({ tags: { component: "worker", source: "pg-boss" }, extra: { heldBack: 0 } });
    }
    expect(console.error).toHaveBeenCalledTimes(3);
  });

  it("art mode reports the first, holds the rest for ten minutes, and carries the count, to Sentry and its log alike", async () => {
    await boot("art");
    expect(typeof state.ctor[0]).toBe("object");
    for (let i = 0; i < 5; i++) state.handlers.error(new Error(`e${i}`));
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException.mock.calls[0][1].extra).toEqual({ heldBack: 0 });
    vi.setSystemTime(T0 + 10 * MIN - 1);
    state.handlers.error(new Error("still inside"));
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + 10 * MIN);
    state.handlers.error(new Error("next window"));
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    expect((sentry.captureException.mock.calls[1][0] as Error).message).toBe("next window");
    expect(sentry.captureException.mock.calls[1][1].extra).toEqual({ heldBack: 5 });
    state.handlers.error(new Error("held again"));
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    vi.setSystemTime(T0 + 20 * MIN);
    state.handlers.error(new Error("third window"));
    expect(sentry.captureException.mock.calls[2][1].extra).toEqual({ heldBack: 1 });
    // a dropped tunnel errors several times a second, and each line written was ~200 MB a day (verify, 2026-11-04)
    expect(console.error).toHaveBeenCalledTimes(3);
    expect(vi.mocked(console.error).mock.calls[1].slice(0, 2)).toEqual(["[pg-boss]", "(5 held back since the last)"]);
    expect(vi.mocked(console.error).mock.calls[0]).toHaveLength(2);
  });
});

describe("a skipped painting", () => {
  const job = { data: { keepsakeId: 7 } };
  const skip = (reason: string) => state.generate.mockResolvedValueOnce({ status: "skipped", reason });

  it("says why at most hourly, and never for the nightly window", async () => {
    await boot("art");
    const run = state.work["art.generate"];
    skip("the nightly poll's quiet window");
    await run([job]);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    skip("Windows free 18 GB, under 22 GB before a model load");
    await run([job]);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage.mock.calls[0]).toEqual(["art skipped: Windows free 18 GB, under 22 GB before a model load", { level: "warning", tags: { job: "art.generate" } }]);
    vi.setSystemTime(T0 + 59 * MIN);
    skip("a guard batch is running");
    await run([job]);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + 60 * MIN);
    skip("a guard batch is running");
    await run([job]);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  it("doesn't touch the other outcomes", async () => {
    await boot("art");
    const run = state.work["art.generate"];
    state.generate.mockResolvedValueOnce({ status: "painted", keys: [], published: true });
    state.generate.mockResolvedValueOnce({ status: "has-art" });
    await run([job]);
    await run([job]);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    state.generate.mockResolvedValueOnce({ status: "painted", keys: [], published: false, publishError: "x" });
    await run([job]);
    expect(sentry.captureMessage.mock.calls[0][0]).toBe("art painted but not published: x");
    sentry.captureMessage.mockClear();
    state.generate.mockRejectedValueOnce(new Error("keepsake-7-abc: detection stopped: y"));
    await expect(run([job])).rejects.toThrow("detection stopped");
    expect(String(sentry.captureMessage.mock.calls[0][0])).toContain("art not generated:");
  });
});

describe("a job holding its slot for memory", () => {
  const job = { data: { keepsakeId: 7 } };
  const low = "Windows free 18 GB, under 22 GB before a model load";
  const waits = (outcome: object) => state.generate.mockImplementationOnce(async (_db: unknown, _job: unknown, _painter: unknown, opts: { onWaiting: (r: string) => void }) => {
    opts.onWaiting(low);
    return outcome;
  });

  it("says it's waiting and what to do, once, and the skip at its limit doesn't say it again within the hour", async () => {
    await boot("art");
    const run = state.work["art.generate"];
    waits({ status: "skipped", reason: low });
    await run([job]);
    expect(sentry.captureMessage.mock.calls).toEqual([[`art waiting for memory, up to 30 minutes: close something and it paints by itself: ${low}`, { level: "warning", tags: { job: "art.generate" } }]]);
    vi.setSystemTime(T0 + 60 * MIN);
    waits({ status: "painted", keys: [], waitedSeconds: 90 });
    await run([job]);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  it("logs the wait, never the job's photos", async () => {
    await boot("art");
    waits({ status: "painted", keys: [] });
    await state.work["art.generate"]([{ data: { keepsakeId: 7, photos: [{ url: "https://cdn.example/secret.jpg" }] } }]);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ event: "art.generate.waiting", keepsakeId: 7, reason: low }));
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("secret.jpg");
  });

  it("raises no alert for a shutdown's skip, and a SIGTERM ends the wait first", async () => {
    await boot("art");
    let signal: AbortSignal | undefined;
    state.generate.mockImplementationOnce(async (_db: unknown, _job: unknown, _painter: unknown, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return { status: "skipped", reason: "the worker is stopping" };
    });
    await state.work["art.generate"]([job]);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(false);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await (process.listeners("SIGTERM").at(-1) as () => Promise<void>)();
    expect(signal?.aborted).toBe(true);
    exit.mockRestore();
  });
});

describe("a crew set painted with a stand-in head", () => {
  it("is a warning to see, every time, since the crew's photos were vetted with their heads", async () => {
    await boot("art");
    const run = state.work["art.generate"];
    const warning = "live detection found no head in 1 of Plum's photos; a close-up's subject stood in";
    state.generate.mockResolvedValueOnce({ status: "painted", keys: [], published: true, warning });
    state.generate.mockResolvedValueOnce({ status: "painted", keys: [], published: true, warning });
    await run([{ data: { keepsakeId: 7 } }]);
    await run([{ data: { keepsakeId: 8 } }]);
    expect(sentry.captureMessage.mock.calls).toEqual([
      [`art painted with a warning: ${warning}`, { level: "warning", tags: { job: "art.generate" } }],
      [`art painted with a warning: ${warning}`, { level: "warning", tags: { job: "art.generate" } }],
    ]);
  });
});
