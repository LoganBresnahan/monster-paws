import { closeDb, getDb } from "@/db/client";
import { emailLinkOrigin } from "@/core/email/painting-email";
import { loadOwedPaintings, runPaintingEmailTick } from "@/core/email/painting-sweep";
import { failureCode } from "@/core/observability";

/**
 * The painting email by hand, beside the worker's `EMAIL_SWEEP=on` (ADR-0035 as amended 2026-11-03).
 * Prints counts, ids and codes only, never an address (ADR-0010). Mailpit unless `EMAIL_LIVE` is set.
 */
function keepsakeArg(args: readonly string[]): number | undefined {
  const at = args.indexOf("--keepsake");
  if (at < 0) return undefined;
  const id = Number(args[at + 1]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("EMAIL_CLI --keepsake takes a keepsake id");
  return id;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "list" && command !== "send-owed") {
    console.error("usage: npm run email -- list | send-owed [--keepsake <id>]");
    process.exitCode = 2;
    return;
  }
  try {
    const keepsakeId = keepsakeArg(args);
    if (command === "list") {
      const origin = emailLinkOrigin();
      for (const owed of await loadOwedPaintings(getDb(), { keepsakeId, limit: 50 })) {
        console.log(
          JSON.stringify({
            keepsake: owed.keepsakeId,
            animal: owed.animalName,
            hasAddress: owed.to !== null,
            art: owed.artKeys,
            share: owed.shareToken ? `${origin}/share/${owed.shareToken}` : null,
          }),
        );
      }
      return;
    }
    console.log(JSON.stringify(await runPaintingEmailTick(getDb(), process.env, { keepsakeId })));
  } catch (err) {
    console.error(`painting email: ${err instanceof Error && /^(EMAIL_|ART_|SHARE_)/.test(err.message) ? err.message : failureCode(err)}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
