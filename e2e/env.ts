/**
 * Never `DATABASE_URL`, and never `monsterpaws_test`, which the unit suites
 * truncate mid-run (ADR-0017 as amended 2026-09-28).
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://monsterpaws:monsterpaws@localhost:5432/monsterpaws_e2e";

/** Not :3000 — that is the developer's `npm run dev`, reading the dev database. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
