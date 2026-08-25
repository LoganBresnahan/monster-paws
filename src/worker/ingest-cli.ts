/**
 * One-shot ingest commands, same stages the worker runs (ADR-0009):
 *
 *   npm run ingest -- poll [--max-pages N]   fetch → all four stages
 *   npm run ingest -- replay <source>        stages 2–4 over the corpus
 *
 * Replay is how a normalizer fix is applied retroactively with no source
 * contact; it touches `animals` and `event_log` only through the writer,
 * never `raw_payloads`.
 */
import { closeDb, getDb } from "@/db/client";
import { createPgStages, loadStoredObservations } from "@/core/ingest/pg";
import { replay, runIngest, type IngestRunReport } from "@/core/ingest/pipeline";
import { createRescueGroupsAdapter, rescueGroupsNormalizer } from "@/core/ingest/rescuegroups";
import { planIngestPoll } from "@/worker/ingest-poll";

function print(report: IngestRunReport) {
  const { events, failures, ...counts } = report;
  const kinds: Record<string, number> = {};
  for (const e of events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  console.log(JSON.stringify({ ...counts, events: kinds, failures: failures.length }));
  for (const f of failures.slice(0, 20)) console.error(`  ${f.stage} ${f.externalId}: ${f.error}`);
  if (failures.length > 20) console.error(`  … ${failures.length - 20} more`);
}

async function main([command, ...rest]: string[]) {
  const db = getDb();
  const stages = createPgStages(db, [rescueGroupsNormalizer]);
  try {
    if (command === "poll") {
      const plan = planIngestPoll(process.env);
      if (!plan.register) throw new Error(plan.skipReason);
      const flag = rest.indexOf("--max-pages");
      const maxPages = flag === -1 ? undefined : Number(rest[flag + 1]);
      // A page-capped run is partial by construction: it must never
      // disappear the animals it did not fetch (ADR-0014).
      const adapter = createRescueGroupsAdapter({ apiKey: plan.apiKey!, maxPages });
      print(await runIngest(adapter, stages, { complete: maxPages === undefined }));
    } else if (command === "replay" && rest[0]) {
      const stored = await loadStoredObservations(db, rest[0]);
      print(await replay(rest[0] as never, stored, stages));
    } else {
      throw new Error("usage: ingest poll [--max-pages N] | ingest replay <source>");
    }
  } finally {
    await closeDb();
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
