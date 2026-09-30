import { describe, expect, it } from "vitest";
import { heartbeatPing, INGEST_POLL_RETRY } from "@/worker/heartbeat";

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
