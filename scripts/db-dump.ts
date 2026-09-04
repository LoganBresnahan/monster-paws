import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * A local copy of the corpus, taken after a full poll (ADR-0017 decision 4).
 * Isolation stops the test suite from deleting `raw_payloads`; it does nothing
 * about every other way a single copy dies, and today this is the only copy —
 * the R2 dump in `doc/infra.md` is still blocked on Managed Postgres.
 *
 * Runs `pg_dump` inside the compose container, so no client binary is needed
 * on the host.
 */

const CONTAINER = process.env.PG_CONTAINER ?? "dogchain-db-1";
const DATABASE = process.env.PG_DATABASE ?? "monsterpaws";
const USER = process.env.PG_USER ?? "monsterpaws";
const OUT_DIR = path.resolve("var/dumps");

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(OUT_DIR, `${DATABASE}-${stamp}.sql.gz`);

  // Never restore one of these blindly over a newer database: a dump is a copy
  // of the corpus, not a source of truth (ADR-0017).
  execFileSync("sh", ["-c", `docker exec ${CONTAINER} pg_dump -U ${USER} ${DATABASE} | gzip > "${out}"`], {
    stdio: "inherit",
  });
  console.log(`wrote ${out}`);
}

main();
