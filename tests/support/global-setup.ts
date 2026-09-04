import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { SKIP_DB_TESTS, TEST_DATABASE_URL } from "./db";

/**
 * What Rails hands you as `db:test:prepare` and vitest does not: create the
 * test database if it is missing, then migrate it (ADR-0017). Runs once per
 * `npm test`, before any file.
 */

function serverUrlOf(url: string): { admin: string; database: string } {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");
  parsed.pathname = "/postgres";
  return { admin: parsed.toString(), database };
}

export default async function setup(): Promise<void> {
  if (SKIP_DB_TESTS) {
    console.warn("SKIP_DB_TESTS=1 — the Postgres suites will not run (ADR-0017)");
    return;
  }

  const { admin, database } = serverUrlOf(TEST_DATABASE_URL);
  // A timeout, or an unreachable host HANGS the run instead of failing it —
  // which is the silent-green failure this ADR exists to remove, wearing a
  // different hat (ADR-0017).
  const client = new Client({ connectionString: admin, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (cause) {
    // Loud, not skipped: a green run that silently tested nothing is the
    // failure this ADR exists to remove (ADR-0017).
    throw new Error(
      `cannot reach Postgres at ${admin.replace(/:[^:@]*@/, ":***@")} — run \`npm run db:up\`, ` +
        `or set SKIP_DB_TESTS=1 to run only the unit suites (ADR-0017)`,
      { cause },
    );
  }

  try {
    // `create database` has no IF NOT EXISTS, and a race here is one developer
    // running the suite twice — check, then create.
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [
      database,
    ]);
    if (!rowCount) await client.query(`create database "${database}"`);
  } finally {
    await client.end();
  }

  // The same migrations the dev database runs — never `push`, or the test
  // schema stops being the one that ships.
  execFileSync("npx", ["drizzle-kit", "migrate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
