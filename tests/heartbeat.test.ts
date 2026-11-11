import { describe, expect, it } from "vitest";
import { ART_HEARTBEAT_DB_TIMEOUT_MS, ART_HEARTBEAT_MS, artHeartbeat, heartbeatPing, INGEST_POLL_RETRY } from "@/worker/heartbeat";

const URL_ = "https://uptime.example.org/api/v1/heartbeat/abc";
const last = { retryCount: 2, retryLimit: 2 };
const first = { retryCount: 0, retryLimit: 2 };

describe("ADR-0010 poll heartbeat", () => {
  it("pings the plain URL on success, on any attempt", () => {
    expect(heartbeatPing(URL_, "success", first)).toBe(URL_);
    expect(heartbeatPing(URL_, "success", last)).toBe(URL_);
  });

  // An incident for a failure the next retry fixes is alert fatigue.
  it("stays silent on a failure that will be retried", () => {
    expect(heartbeatPing(URL_, "failure", first)).toBeNull();
    expect(heartbeatPing(URL_, "failure", { retryCount: 1, retryLimit: 2 })).toBeNull();
  });

  it("pings /fail on the final attempt's failure", () => {
    expect(heartbeatPing(URL_, "failure", last)).toBe(`${URL_}/fail`);
    expect(heartbeatPing(`${URL_}/`, "failure", last)).toBe(`${URL_}/fail`);
  });

  it("never pings without a configured URL (dev, CI)", () => {
    expect(heartbeatPing(undefined, "success", first)).toBeNull();
    expect(heartbeatPing(undefined, "failure", last)).toBeNull();
  });

  // Delays 600 s then ~1200 s with backoff: every retry inside the 3 h grace.
  it("keeps every retry inside the heartbeat's grace", () => {
    const graceSeconds = 3 * 60 * 60;
    let worst = 0;
    for (let n = 0; n < INGEST_POLL_RETRY.retryLimit; n++) worst += INGEST_POLL_RETRY.retryDelay * 2 ** (n + 1);
    expect(worst).toBeLessThan(graceSeconds);
  });
});

describe("ADR-0010 art worker heartbeat (as amended 2026-11-11)", () => {
  const pinged = () => {
    const urls: string[] = [];
    return { urls, ping: async (url: string) => void urls.push(url) };
  };

  it("pings once the database has answered", async () => {
    const p = pinged();
    expect(await artHeartbeat(URL_, async () => [{ "?column?": 1 }], p.ping)).toBe(true);
    expect(p.urls).toEqual([URL_]);
  });

  // A live process behind a dead tunnel paints nothing: it must go as quiet as a dead one.
  it("stays silent when the database refuses", async () => {
    const p = pinged();
    expect(await artHeartbeat(URL_, async () => Promise.reject(new Error("ECONNREFUSED")), p.ping)).toBe(false);
    expect(p.urls).toEqual([]);
  });

  it("stays silent when the database never answers", async () => {
    const p = pinged();
    expect(await artHeartbeat(URL_, () => new Promise(() => {}), p.ping, 20)).toBe(false);
    expect(p.urls).toEqual([]);
  });

  it("never asks the database or pings without a configured URL (dev, CI)", async () => {
    const p = pinged();
    let asked = false;
    expect(await artHeartbeat(undefined, async () => (asked = true), p.ping)).toBe(false);
    expect(asked).toBe(false);
    expect(p.urls).toEqual([]);
  });

  // Better Stack's grace is 10 minutes: a beat that waits out its whole timeout and the ping's 10 s still lands inside it.
  it("lands every beat inside the 10-minute grace", () => {
    expect(ART_HEARTBEAT_MS + ART_HEARTBEAT_DB_TIMEOUT_MS + 10_000).toBeLessThan(ART_HEARTBEAT_MS + 10 * 60 * 1000);
  });
});
