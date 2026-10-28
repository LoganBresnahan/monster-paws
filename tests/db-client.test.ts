import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPool } from "@/db/client";
import { SKIP_DB_TESTS, TEST_DATABASE_URL } from "./support/db";

/**
 * Oplog 0005: one dropped connection, an unhandled `error` on a pg Client, and
 * the whole poll exited. A terminated backend stands in for the dropped link —
 * if any client is left without a listener, vitest fails the run on the
 * unhandled error.
 */
describe.skipIf(SKIP_DB_TESTS)("db client — a dropped connection fails a query, never the process", () => {
  const pools: Pool[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(pools.splice(0).map((p) => p.end()));
  });

  async function terminate(pid: number) {
    const admin = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    pools.push(admin);
    await admin.query("SELECT pg_terminate_backend($1)", [pid]);
    await new Promise((r) => setTimeout(r, 200));
  }

  it("survives a checked-out client's connection dropping, as inside a transaction", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = createPool(TEST_DATABASE_URL);
    pools.push(pool);

    const client = await pool.connect();
    const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await client.query("BEGIN");
    await terminate(rows[0].pid);

    await expect(client.query("SELECT 1")).rejects.toThrow();
    client.release();
    expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[db] connection error"));
  });

  it("survives an idle client's connection dropping", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = createPool(TEST_DATABASE_URL);
    pools.push(pool);

    const client = await pool.connect();
    const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    client.release();
    await terminate(rows[0].pid);

    expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
  });
});
