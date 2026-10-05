/**
 * Monster Paws worker — the second always-on process (ADR-0001): pg-boss
 * jobs, listing pollers, image generation. Same repo, same types as the app.
 *
 * Run with: npm run worker
 */
import * as Sentry from "@sentry/node";
import { PgBoss } from "pg-boss";
import { getDb } from "@/db/client";
import { createPgStages } from "@/core/ingest/pg";
import { runIngest } from "@/core/ingest/pipeline";
import { createRescueGroupsAdapter, rescueGroupsNormalizer } from "@/core/ingest/rescuegroups";
import { gateAlert, INGEST_POLL, planIngestPoll } from "@/worker/ingest-poll";
import { heartbeatPing, INGEST_POLL_RETRY } from "@/worker/heartbeat";
import { reportingOptions } from "@/core/observability";

// First, before any job can throw. Context lines stay ON here, unlike the app
// server: the worker runs TypeScript through tsx, so its lines are real source
// and there are no maps to resolve (ADR-0010 as amended 2026-09-30).
Sentry.init(
  reportingOptions("worker", {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.BUILD_SHA,
  }),
);

const DATABASE_URL = process.env.DATABASE_URL;

async function registerIngestPoll(boss: PgBoss) {
  const plan = planIngestPoll(process.env);
  if (!plan.register) {
    console.warn(`[worker] ${plan.skipReason}`);
    return;
  }

  await boss.createQueue(INGEST_POLL, INGEST_POLL_RETRY);
  await boss.work(INGEST_POLL, { includeMetadata: true }, async ([job]) => {
    const attempt = { retryCount: job.retryCount, retryLimit: job.retryLimit };
    try {
      const { events, ...report } = await runIngest(
        createRescueGroupsAdapter({ apiKey: plan.apiKey! }),
        createPgStages(getDb(DATABASE_URL), [rescueGroupsNormalizer]),
        { complete: true },
      );
      console.log(
        JSON.stringify({ event: "ingest.run.completed", ...report, events: events.length }),
      );
      const alert = gateAlert(report);
      if (alert) Sentry.captureMessage(alert.message, { level: alert.level, tags: alert.tags });
      await ping(heartbeatPing(process.env.HEARTBEAT_INGEST_POLL_URL, "success", attempt));
    } catch (err) {
      // Every attempt's failure is an event, not a log line — docker logs are
      // read only by someone already looking (ADR-0010 as amended 2026-09-28).
      Sentry.captureException(err, {
        tags: { job: INGEST_POLL, attempt: `${attempt.retryCount + 1}/${attempt.retryLimit + 1}` },
      });
      await ping(heartbeatPing(process.env.HEARTBEAT_INGEST_POLL_URL, "failure", attempt));
      throw err;
    }
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
  boss.on("error", (err: Error) => {
    console.error("[pg-boss]", err);
    Sentry.captureException(err, { tags: { component: "worker", source: "pg-boss" } });
  });
  await boss.start();

  await registerIngestPoll(boss);

  // Job registrations land with their features:
  //   art.generate       — keepsake card generation (roadmap item 4); never
  //                        registered on the droplet, which has no GPU — only
  //                        the home worker (ADR-0004 as amended 2026-10-05)
  //   attestation.publish — sign + R2 mirror (roadmap item 7)

  const shutdown = async () => {
    await boss.stop();
    await Sentry.close(2000);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** A heartbeat that cannot be reached must never fail the poll it reports on. */
async function ping(url: string | null): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    console.error("[worker] heartbeat ping failed", err);
  }
}

main().catch(async (err) => {
  console.error("[worker] fatal", err);
  Sentry.captureException(err);
  await Sentry.close(2000);
  process.exit(1);
});
