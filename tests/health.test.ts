import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assessHealth, newestCompleteRuns, POLL_STALE_AFTER_HOURS } from "@/core/health";
import { createPgRunStore } from "@/core/ingest/pg";
import type { IngestRunRecord } from "@/core/ingest/pipeline";
import { closeDb, type Db } from "@/db/client";
import { INGEST_POLL_CRON, INGEST_POLL_INTERVAL_HOURS } from "@/worker/ingest-poll";
import { SKIP_DB_TESTS, testDb, truncateCorpus } from "./support/db";

/**
 * `/api/health` fails once the newest complete poll is older than one interval
 * plus the heartbeat's grace (ADR-0010 as amended 2026-09-28) — the silent-
 * worker failure made visible to an external check.
 */

const NOW = new Date("2026-10-02T08:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("ADR-0010 health — poll freshness", () => {
  it("is ok with a reachable database and a poll inside the window", () => {
    expect(assessHealth("up", [hoursAgo(25)], NOW)).toEqual({
      ok: true,
      db: "up",
      lastCompletePollAt: hoursAgo(25).toISOString(),
      pollStale: false,
    });
  });

  it("fails once the poll is older than one interval plus grace", () => {
    expect(POLL_STALE_AFTER_HOURS).toBe(27);
    expect(assessHealth("up", [hoursAgo(27)], NOW).ok).toBe(true);
    expect(assessHealth("up", [hoursAgo(27.01)], NOW)).toMatchObject({ ok: false, pollStale: true });
  });

  it("fails before the first complete poll", () => {
    expect(assessHealth("up", [], NOW)).toMatchObject({ ok: false, lastCompletePollAt: null, pollStale: true });
  });

  // One healthy source must never mask another that stopped.
  it("ages the OLDEST source's newest run", () => {
    const health = assessHealth("up", [hoursAgo(1), hoursAgo(30)], NOW);
    expect(health).toMatchObject({ ok: false, lastCompletePollAt: hoursAgo(30).toISOString() });
  });

  it("fails without a reachable or configured database, however fresh the poll", () => {
    expect(assessHealth("down", [], NOW).ok).toBe(false);
    expect(assessHealth("unconfigured", [], NOW).ok).toBe(false);
  });

  // The window is derived from the cron, which it cannot parse: change them together.
  it("reads a daily cron as a 24-hour interval", () => {
    expect([INGEST_POLL_CRON, INGEST_POLL_INTERVAL_HOURS]).toEqual(["0 7 * * *", 24]);
  });
});

describe.skipIf(SKIP_DB_TESTS)("ADR-0010 health — newest complete run per source", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateCorpus(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  const run = (source: IngestRunRecord["source"], finishedAt: Date, complete: boolean): IngestRunRecord => ({
    source,
    startedAt: new Date(finishedAt.getTime() - 900_000),
    finishedAt,
    complete,
    lifecycleSkipped: complete ? null : "run declared partial by caller",
    observed: 1,
    persisted: 1,
    deduped: 0,
    normalized: 1,
    conflicted: 0,
    failures: 0,
    events: { "animal.seen": 1 },
    clockSteppedBackMs: null,
  });

  it("returns each source's newest COMPLETE run, ignoring later partial ones", async () => {
    const store = createPgRunStore(db);
    await store.record(run("rescuegroups", hoursAgo(48), true));
    await store.record(run("rescuegroups", hoursAgo(24), true));
    await store.record(run("rescuegroups", hoursAgo(1), false));
    await store.record(run("scrape:happy-tails", hoursAgo(5), true));

    const newest = (await newestCompleteRuns(db)).map((d) => d.toISOString()).sort();
    expect(newest).toEqual([hoursAgo(24).toISOString(), hoursAgo(5).toISOString()].sort());
  });

  it("returns nothing before any complete run", async () => {
    await createPgRunStore(db).record(run("rescuegroups", hoursAgo(1), false));
    expect(await newestCompleteRuns(db)).toEqual([]);
  });
});
