import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentHashOf } from "@/core/ingest/hash";
import type { Observation } from "@/core/ingest/observation";
import { createPgRawStore, loadStoredObservations } from "@/core/ingest/pg";
import type { RawStore } from "@/core/ingest/pipeline";
import { closeDb, getDb, type Db } from "@/db/client";
import { rawPayloads } from "@/db/schema";

/**
 * Integration: the stage-1 store against real Postgres. Skipped without
 * DATABASE_URL — run `npm run db:up` first. The dedup semantics are the same
 * ones `memory.ts` implements; this proves the SQL agrees.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("ADR-0009 Postgres raw store", () => {
  // Built inside a hook, not at describe scope: skipIf still evaluates this
  // body, so connecting here would fail collection when the DB is absent.
  let db: Db;
  let store: RawStore;

  beforeAll(() => {
    db = getDb(DATABASE_URL);
    store = createPgRawStore(db);
  });

  const obs = (payload: Record<string, unknown>, at: string): Observation<typeof payload> => ({
    source: "rescuegroups",
    externalId: "rg-1",
    payload,
    fetchedAt: new Date(at),
    contentHash: contentHashOf(payload),
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${rawPayloads} restart identity`);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("inserts a row for a payload it has not seen", async () => {
    const result = await store.persist(obs({ name: "Rex" }, "2026-07-30T12:00:00Z"));

    expect(result.inserted).toBe(true);
    expect(result.stored.rawId).toBeGreaterThan(0);
    const rows = await db.select().from(rawPayloads);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ name: "Rex" });
  });

  it("touches last_seen instead of writing a duplicate row", async () => {
    const first = await store.persist(obs({ name: "Rex" }, "2026-07-30T12:00:00Z"));
    const second = await store.persist(obs({ name: "Rex" }, "2026-07-31T12:00:00Z"));

    expect(second.inserted).toBe(false);
    expect(second.stored.rawId).toBe(first.stored.rawId);

    const rows = await db.select().from(rawPayloads);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSeen.toISOString()).toBe("2026-07-31T12:00:00.000Z");
    // fetched_at records the ORIGINAL observation and must never move.
    expect(rows[0].fetchedAt.toISOString()).toBe("2026-07-30T12:00:00.000Z");
  });

  it("dedups regardless of key order in the payload", async () => {
    await store.persist(obs({ name: "Rex", species: "dog" }, "2026-07-30T12:00:00Z"));
    const second = await store.persist(obs({ species: "dog", name: "Rex" }, "2026-07-31T12:00:00Z"));

    expect(second.inserted).toBe(false);
    expect(await db.select().from(rawPayloads)).toHaveLength(1);
  });

  it("appends a new row when the payload changes, keeping the old one", async () => {
    await store.persist(obs({ name: "Rex" }, "2026-07-30T12:00:00Z"));
    const second = await store.persist(obs({ name: "Rexington" }, "2026-07-31T12:00:00Z"));

    expect(second.inserted).toBe(true);
    const rows = await db.select().from(rawPayloads).orderBy(rawPayloads.id);
    expect(rows.map((r) => r.payload)).toEqual([{ name: "Rex" }, { name: "Rexington" }]);
  });

  it("appends on a revert — A→B→A is three rows, not a match against the older A", async () => {
    await store.persist(obs({ status: "available" }, "2026-07-01T00:00:00Z"));
    await store.persist(obs({ status: "pending" }, "2026-07-02T00:00:00Z"));
    const third = await store.persist(obs({ status: "available" }, "2026-07-03T00:00:00Z"));

    expect(third.inserted).toBe(true);
    expect(await db.select().from(rawPayloads)).toHaveLength(3);
  });

  it("scopes dedup per source — the same external id from two sources is two rows", async () => {
    const payload = { name: "Rex" };
    await store.persist(obs(payload, "2026-07-30T12:00:00Z"));
    const other = await store.persist({
      source: "shelterluv",
      externalId: "rg-1",
      payload,
      fetchedAt: new Date("2026-07-30T12:00:00Z"),
      contentHash: contentHashOf(payload),
    });

    expect(other.inserted).toBe(true);
    expect(await db.select().from(rawPayloads)).toHaveLength(2);
  });

  it("loads stored observations for replay, oldest first", async () => {
    await store.persist(obs({ name: "Rex" }, "2026-07-30T12:00:00Z"));
    await store.persist(obs({ name: "Rexington" }, "2026-07-31T12:00:00Z"));

    const stored = await loadStoredObservations(db, "rescuegroups");

    expect(stored.map((s) => s.rawId)).toEqual([1, 2]);
    expect(stored[0]).toMatchObject({ source: "rescuegroups", externalId: "rg-1" });
    expect(stored[1].payload).toEqual({ name: "Rexington" });
  });
});
