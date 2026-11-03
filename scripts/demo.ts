import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { assertDemoDatabase, DEMO_DATABASE, rehearsalGift, REHEARSAL_NONPROFIT, seedCrew } from "@/core/crew-seed";
import { closeDb, getDb } from "@/db/client";

/**
 * `npm run demo -- seed [--slug s --ein e --name n]` creates, migrates and fills the demo database.
 * `npm run demo -- gift <pet> <email>` records a rehearsal gift through the real decision.
 */
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { slug: { type: "string" }, ein: { type: "string" }, name: { type: "string" } },
  });
  const url = assertDemoDatabase(process.env.DATABASE_URL);
  const [command, ...rest] = positionals;

  if (command === "seed") {
    const maintenance = new URL(url);
    maintenance.pathname = "/postgres";
    const client = new Client({ connectionString: maintenance.toString() });
    await client.connect();
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [DEMO_DATABASE]);
    if (!rowCount) await client.query(`create database "${DEMO_DATABASE}"`);
    await client.end();
    execFileSync("npx", ["drizzle-kit", "migrate"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    const nonprofit = values.slug && values.ein && values.name ? { slug: values.slug, ein: values.ein, name: values.name } : REHEARSAL_NONPROFIT;
    const count = await seedCrew(getDb(url), nonprofit);
    console.log(`seeded ${count} crew pets, nonprofit ${nonprofit.slug}`);
  } else if (command === "gift" && rest.length === 2) {
    const intentId = await rehearsalGift(getDb(url), rest[0], rest[1]);
    console.log(`recorded a rehearsal gift to ${rest[0]}, intent ending ${intentId.slice(-4)}`);
  } else {
    throw new Error("usage: demo seed [--slug s --ein e --name n] | demo gift <pet> <email>");
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
