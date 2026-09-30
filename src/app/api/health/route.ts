import { NextResponse } from "next/server";
import { assessHealth, newestCompleteRuns, type DbState } from "@/core/health";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 5_000;

/**
 * Target of the external uptime check and /deploy smoke (ADR-0010). It fails
 * with 503 when the database is unreachable or the poll is stale, because
 * the monitor pages a person on either one. Never let a silently dead
 * worker return 200 here.
 */
export async function GET() {
  let db: DbState = "unconfigured";
  let runs: Date[] = [];
  if (process.env.DATABASE_URL) {
    let timer: NodeJS.Timeout | undefined;
    try {
      runs = await Promise.race([
        newestCompleteRuns(getDb()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("health: database timeout")), DB_TIMEOUT_MS);
        }),
      ]);
      db = "up";
    } catch {
      db = "down";
    } finally {
      clearTimeout(timer);
    }
  }
  const health = assessHealth(db, runs, new Date());
  return NextResponse.json(
    {
      ...health,
      sha: process.env.BUILD_SHA ?? "dev",
      uptimeSec: Math.round(process.uptime()),
    },
    { status: health.ok ? 200 : 503 },
  );
}
