/**
 * Monster Paws worker — the second always-on process (ADR-0001): pg-boss
 * jobs, listing pollers, image generation. Same repo, same types as the app.
 *
 * Run with: npm run worker
 */
import { PgBoss } from "pg-boss";
import { getDb } from "@/db/client";
import { createPgRawStore } from "@/core/ingest/pg";
import { createRescueGroupsAdapter } from "@/core/ingest/rescuegroups";
import { INGEST_POLL, planIngestPoll, runRawOnlyPoll } from "@/worker/ingest-poll";

const DATABASE_URL = process.env.DATABASE_URL;

async function registerIngestPoll(boss: PgBoss) {
  const plan = planIngestPoll(process.env);
  if (!plan.register) {
    console.warn(`[worker] ${plan.skipReason}`);
    return;
  }

  await boss.createQueue(INGEST_POLL);
  await boss.work(INGEST_POLL, async () => {
    const report = await runRawOnlyPoll(
      createRescueGroupsAdapter({ apiKey: plan.apiKey! }),
      createPgRawStore(getDb(DATABASE_URL)),
    );
    console.log(
      JSON.stringify({ event: "ingest.run.completed", source: "rescuegroups", ...report }),
    );
  });

  await boss.schedule(INGEST_POLL, plan.cron);
  console.log(`[worker] ${INGEST_POLL} registered (${plan.cron})`);
}

async function main() {
  if (!DATABASE_URL) {
    // Pre-database deploys (landing only): idle instead of crash-looping so
    // `compose up` stays green. The worker becomes real with roadmap item 2.
    console.warn(
      "[worker] DATABASE_URL not set — idling (no jobs to run before ingest exists)",
    );
    setInterval(() => {}, 1 << 30);
    return;
  }

  const boss = new PgBoss(DATABASE_URL);
  boss.on("error", (err: Error) => console.error("[pg-boss]", err));
  await boss.start();

  await registerIngestPoll(boss);

  // Job registrations land with their features:
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
