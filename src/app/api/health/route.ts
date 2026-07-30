import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness endpoint (ADR-0010) — target of the external uptime check and
 * /deploy smoke. Grows with the stack: DB reachability and last-poller-run
 * age land with ingest (roadmap item 2) so silent worker death becomes
 * externally visible.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    sha: process.env.BUILD_SHA ?? "dev",
    uptimeSec: Math.round(process.uptime()),
  });
}
