import type { FullConfig } from "@playwright/test";
import { closeDb, getDb } from "@/db/client";
import { truncateCorpus } from "../tests/support/db";
import { prepareDatabase } from "../tests/support/global-setup";
import { E2E_DATABASE_URL } from "./env";
import { SEEDED, seedE2eCorpus } from "./seed";

/**
 * Create, migrate, empty and reseed `monsterpaws_e2e`, then prove the server
 * under test reads it (ADR-0017 as amended 2026-09-28). The web server is
 * already up when this runs — Playwright starts it first.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  await prepareDatabase(E2E_DATABASE_URL);
  const db = getDb(E2E_DATABASE_URL);
  try {
    await truncateCorpus(db);
    const manifest = await seedE2eCorpus(db);
    // Workers inherit env changes made here; this is how specs learn the ids.
    process.env.E2E_SEED = JSON.stringify(manifest);

    // The canary: a server reading any other database 404s here, and every
    // spec after it would fail for a reason no spec names.
    const baseURL = config.projects[0].use.baseURL!;
    const res = await fetch(`${baseURL}/animals/${manifest.stowaway}`);
    const html = await res.text();
    if (res.status !== 200 || !html.includes(SEEDED.stowaway.name)) {
      throw new Error(
        `the server at ${baseURL} cannot see the e2e seed (GET /animals/${manifest.stowaway} → ${res.status}). ` +
          `Start it with DATABASE_URL=${E2E_DATABASE_URL.replace(/:[^:@]*@/, ":***@")} (ADR-0017 as amended).`,
      );
    }
  } finally {
    await closeDb();
  }
}
