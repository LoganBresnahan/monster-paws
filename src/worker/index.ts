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
import { eraseAbandonedAddresses } from "@/core/donate/intent";
import { ART_GENERATE, ART_QUEUE_OPTIONS, sweepKeepsakes } from "@/core/keepsake";
import { sweepWebhookSpool } from "@/core/donate/webhook-replay";
import { artReaderFromEnv } from "@/core/email/art-source";
import { runPaintingEmailTick } from "@/core/email/painting-sweep";
import { chooseEmailSender } from "@/core/email/sender";
import { suppressionKey } from "@/core/email/suppression";
import { webhookSweepAlerts } from "@/worker/webhook-sweep";
import { gateAlert, INGEST_POLL, planIngestPoll } from "@/worker/ingest-poll";
import { heartbeatPing, INGEST_POLL_RETRY } from "@/worker/heartbeat";
import { failureCode, reportingOptions } from "@/core/observability";

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
  if (!plan.schedule) {
    // Not registering is not enough: pg-boss keeps the cron row and goes on
    // creating jobs until it is unscheduled (ADR-0033 as amended 2026-10-28).
    await boss.unschedule(INGEST_POLL);
    console.warn(`[worker] INGEST_POLL_SCHEDULE=off — ${INGEST_POLL} unscheduled; the bridge polls`);
    return;
  }
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

const ERASE_ABANDONED = "donate.erase-abandoned";

/** Daily, because the privacy page promises a date. A failed run is reported; a run that never fires reports nothing, and the next one catches up. */
async function registerAddressErasure(boss: PgBoss) {
  await boss.createQueue(ERASE_ABANDONED);
  await boss.work(ERASE_ABANDONED, async () => {
    try {
      const erased = await eraseAbandonedAddresses(getDb(DATABASE_URL));
      console.log(JSON.stringify({ event: "donate.erase_abandoned", erased }));
    } catch (err) {
      // The code alone: a failed query's message can carry its parameters (ADR-0010).
      const code = failureCode(err);
      Sentry.captureMessage(`abandoned addresses not erased: ${code}`, { level: "error", tags: { job: ERASE_ABANDONED } });
      throw new Error(`abandoned addresses not erased: ${code}`);
    }
  });
  await boss.schedule(ERASE_ABANDONED, "0 6 * * *");
}

const WEBHOOK_SWEEP_MS = 60_000;
const WEBHOOK_REPEAT_ALERT_MS = 60 * 60 * 1000;

/**
 * A plain timer, never pg-boss: once this worker is up it must keep running and reporting through
 * a database outage, and a 1,440-a-day queue would only add rows. A worker booting into an outage
 * exits at `boss.start()` and restarts until it ends; the files wait (ADR-0027 as amended 2026-11-03).
 * Only the droplet's compose sets the directory: the home worker registers nothing else.
 */
function startWebhookSweep(): () => void {
  const dir = process.env.WEBHOOK_SPOOL_DIR;
  if (!dir) return () => {};
  let running = false;
  let lastRepeatAlert = 0;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const report = await sweepWebhookSpool(getDb(DATABASE_URL), dir);
      if (report.replayed > 0 || Object.keys(report.decided).length > 0 || report.staleFiles > 0 || report.failure) {
        console.log(JSON.stringify({ event: "donate.webhook_sweep", ...report }));
      }
      const now = Date.now();
      for (const alert of webhookSweepAlerts(report)) {
        if (alert.repeats && now - lastRepeatAlert < WEBHOOK_REPEAT_ALERT_MS) continue;
        if (alert.repeats) lastRepeatAlert = now;
        Sentry.captureMessage(alert.message, { level: alert.level, tags: { job: "donate.webhook-sweep" } });
      }
    } catch (err) {
      Sentry.captureMessage(`webhook sweep failed: ${failureCode(err)}`, { level: "error", tags: { job: "donate.webhook-sweep" } });
    } finally {
      running = false;
    }
  }, WEBHOOK_SWEEP_MS);
  return () => clearInterval(timer);
}

const KEEPSAKE_SWEEP_MS = 60_000;

/**
 * Only with `ART_SWEEP=on`: the compose files never set it, so turning it on is a line in that machine's `.env`
 * with its own oplog entry. It queues art and never paints: `art.generate` has no handler here (ADR-0004 as amended 2026-10-05).
 */
async function startKeepsakeSweep(boss: PgBoss): Promise<() => void> {
  if (process.env.ART_SWEEP !== "on") return () => {};
  await boss.createQueue(ART_GENERATE, ART_QUEUE_OPTIONS);
  let running = false;
  let lastStalledAlert = 0;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const report = await sweepKeepsakes(getDb(DATABASE_URL), (name, data, options) => boss.send(name, { ...data }, options));
      if (report.written > 0 || report.sent > 0 || report.stalled > 0) console.log(JSON.stringify({ event: "keepsake.sweep", ...report }));
      const now = Date.now();
      if (report.stalled > 0 && now - lastStalledAlert >= WEBHOOK_REPEAT_ALERT_MS) {
        lastStalledAlert = now;
        Sentry.captureMessage(`paid paintings waiting past 30 minutes: ${report.stalled}`, { level: "error", tags: { job: "keepsake.sweep" } });
      }
    } catch (err) {
      Sentry.captureMessage(`keepsake sweep failed: ${failureCode(err)}`, { level: "error", tags: { job: "keepsake.sweep" } });
    } finally {
      running = false;
    }
  }, KEEPSAKE_SWEEP_MS);
  return () => clearInterval(timer);
}

const EMAIL_SWEEP_MS = 60_000;

/**
 * Only with `EMAIL_SWEEP=on`, which the droplet's compose must never set until the painting email's
 * carry-ins land: nothing there erases an address on delivery yet (doc/roadmap.md, ADR-0035).
 */
function startPaintingEmailSweep(): () => void {
  if (process.env.EMAIL_SWEEP !== "on") return () => {};
  try {
    if (!suppressionKey()) throw new Error("EMAIL_SUPPRESSION_KEY is not set");
    chooseEmailSender();
    artReaderFromEnv();
  } catch (err) {
    // Said once at boot, in its own words: these name a setting, never a value or an address.
    const problem = err instanceof Error ? err.message : "unknown";
    console.error(`[worker] EMAIL_SWEEP=on but not started: ${problem}`);
    Sentry.captureMessage(`painting email sweep not started: ${problem}`, { level: "error", tags: { job: "painting_email.sweep" } });
    return () => {};
  }
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const report = await runPaintingEmailTick(getDb(DATABASE_URL));
      const { via, sent, noAddress, suppressed, stale, held, incomplete, artUnreadable, failures } = report;
      const failed = Object.keys(failures).length > 0;
      if (sent + noAddress + suppressed + stale + held + incomplete + artUnreadable > 0 || failed) {
        console.log(JSON.stringify({ event: "painting_email.sweep", ...report, via }));
      }
      if (failed || stale > 0) {
        Sentry.captureMessage(`painting email sweep: ${stale} stale, failures ${Object.keys(failures).join(",") || "none"}`, {
          level: "error",
          tags: { job: "painting_email.sweep" },
        });
      }
    } catch (err) {
      // The code alone: a failed query's message can carry its parameters, here an address (ADR-0010).
      Sentry.captureMessage(`painting email sweep failed: ${failureCode(err)}`, { level: "error", tags: { job: "painting_email.sweep" } });
      console.error(`[worker] painting email sweep failed: ${failureCode(err)}`);
    } finally {
      running = false;
    }
  }, EMAIL_SWEEP_MS);
  return () => clearInterval(timer);
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
  await registerAddressErasure(boss);
  const stopWebhookSweep = startWebhookSweep();
  const stopPaintingEmailSweep = startPaintingEmailSweep();
  const stopKeepsakeSweep = await startKeepsakeSweep(boss);

  // Job registrations land with their features:
  //   art.generate       — keepsake card generation (roadmap item 4); never
  //                        registered on the droplet, which has no GPU — only
  //                        the home worker (ADR-0004 as amended 2026-10-05)
  //   attestation.publish — sign + R2 mirror (roadmap item 7)

  const shutdown = async () => {
    stopWebhookSweep();
    stopPaintingEmailSweep();
    stopKeepsakeSweep();
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
