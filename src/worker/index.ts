/**
 * Monster Paws worker — the second always-on process (ADR-0001): pg-boss
 * jobs, listing pollers, image generation. Same repo, same types as the app.
 *
 * Run with: npm run worker
 */
import { PgBoss } from "pg-boss";

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }

  const boss = new PgBoss(DATABASE_URL);
  boss.on("error", (err: Error) => console.error("[pg-boss]", err));
  await boss.start();

  console.log("[worker] pg-boss started; no jobs registered yet (roadmap item 2)");

  // Job registrations land with their features:
  //   ingest.poll        — RescueGroups poller (roadmap item 2)
  //   art.generate       — keepsake card generation (roadmap item 4)
  //   attestation.publish — sign + R2 mirror (roadmap item 7)

  const shutdown = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
