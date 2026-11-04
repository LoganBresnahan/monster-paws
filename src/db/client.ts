import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

/**
 * One pool per process (ADR-0001: app and worker are separate processes).
 * Module scope is safe here because a connection pool carries no per-request
 * state — never put per-user state at module scope in Next.js.
 */
let pool: Pool | undefined;

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function getDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  pool ??= createPool(connectionString);
  return drizzle(pool, { schema });
}

/**
 * A dropped connection must fail its one query, never the process — the
 * pool's listener covers idle clients only, so every client gets one on
 * connect (oplog 0005).
 */
export function createPool(connectionString: string): Pool {
  // DB_POOL_MAX caps a worker that shares the 1-vCPU cluster from home (oplog 0027); unset keeps pg's default of 10.
  const max = Number(process.env.DB_POOL_MAX) || undefined;
  const p = new Pool({ connectionString, keepAlive: true, ...(max ? { max } : {}) });
  const report = (err: Error) => console.error(`[db] connection error: ${err.message}`);
  p.on("error", report);
  p.on("connect", (client) => client.on("error", report));
  return p;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
