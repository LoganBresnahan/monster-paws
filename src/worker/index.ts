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

const DATABASE_URL = process.env.DATABASE_URL;

const INGEST_POLL = "ingest.poll";

/**
 * Daily, not hourly: RescueGroups' terms set a weekly-minimum refresh
 * (ADR-0006), and their corpus is discovery data we re-read, not a stream we
 * must not miss. Polling harder buys staleness we don't need and goodwill we
 * do.
 */
const INGEST_POLL_CRON = "0 7 * * *";

async function registerIngestPoll(boss: PgBoss) {
  const apiKey = process.env.RESCUEGROUPS_API_KEY;
  if (!apiKey) {
    console.warn(`[worker] RESCUEGROUPS_API_KEY not set — ${INGEST_POLL} not registered`);
    return;
  }

  await boss.createQueue(INGEST_POLL);
  await boss.work(INGEST_POLL, async () => {
    const adapter = createRescueGroupsAdapter({ apiKey });
    const rawStore = createPgRawStore(getDb(DATABASE_URL));
    let persisted = 0;
    let deduped = 0;

    // Stage 1 only until the Postgres resolver and writer land (ADR-0009
    // phases 6–8). Collecting raw from day one is the point — stages 2–4
    // replay over this corpus later, so nothing is lost by starting here.
    for await (const obs of adapter.fetch()) {
      const { inserted } = await rawStore.persist(obs);
      if (inserted) persisted += 1;
      else deduped += 1;
    }

    console.log(
      JSON.stringify({ event: "ingest.run.completed", source: "rescuegroups", persisted, deduped }),
    );
  });

  await boss.schedule(INGEST_POLL, INGEST_POLL_CRON);
  console.log(`[worker] ${INGEST_POLL} registered (${INGEST_POLL_CRON})`);
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
