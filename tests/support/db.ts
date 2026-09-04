import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { animalDisplay, animalIdentities, animals, eventLog, rawPayloads } from "@/db/schema";

/**
 * The one door every Postgres suite goes through (ADR-0017). It exists because
 * the corpus is append-only and these tests are not: on 2026-08-25 a complete
 * poll wrote 64,110 animals into the dev database, and a later `npm test`
 * truncated them with nothing to restore from.
 */

/**
 * Never `DATABASE_URL`, and never a fallback to it — the fallback IS the bug
 * this file exists to prevent. A default is safe here only because it names a
 * `_test` database, which `truncateCorpus` independently refuses to leave.
 */
const DEFAULT_TEST_URL = "postgres://monsterpaws:monsterpaws@localhost:5432/monsterpaws_test";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;

/**
 * Set `SKIP_DB_TESTS=1` to skip. Unset, a missing database FAILS the run — a
 * suite that quietly declines to run reports the same green as one that ran,
 * which is how 42 skipped tests went unnoticed long enough to matter.
 */
export const SKIP_DB_TESTS = process.env.SKIP_DB_TESTS === "1";

export function testDb(): Db {
  return getDb(TEST_DATABASE_URL);
}

/** The database name the URL points at — what decision 3 checks. */
function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

/**
 * Empties every table these suites write. The name check is deliberately
 * redundant with `TEST_DATABASE_URL`: it is the last thing standing if a
 * fallback to `DATABASE_URL` is ever reintroduced, and it throws at the point
 * of temptation rather than after the corpus is gone (ADR-0017).
 */
export async function truncateCorpus(db: Db): Promise<void> {
  assertTestDatabase();
  await db.execute(
    sql`truncate table ${rawPayloads}, ${animals}, ${animalIdentities}, ${animalDisplay}, ${eventLog} restart identity`,
  );
}

/**
 * Drops the DERIVED tables and leaves `raw_payloads` standing — what a replay
 * test needs, since the corpus is the thing it rebuilds from. Never widen this
 * to the raw table: a rebuild with nothing to rebuild from passes vacuously.
 */
export async function truncateDerived(db: Db): Promise<void> {
  assertTestDatabase();
  await db.execute(sql`truncate table ${animals} cascade`);
}

function assertTestDatabase(): void {
  const name = databaseNameOf(TEST_DATABASE_URL);
  if (!name.endsWith("_test")) {
    throw new Error(
      `refusing to truncate '${name}': tests only run against a database whose name ends in _test (ADR-0017)`,
    );
  }
}
