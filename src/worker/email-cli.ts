import { eq } from "drizzle-orm";
import { correctDonorEmail, parseDonorEmail } from "@/core/donate/intent";
import { isSuppressed, suppressionKey } from "@/core/email/suppression";
import { BOUNCED_CODE } from "@/core/email/painting-state";
import { closeDb, getDb } from "@/db/client";
import { keepsake, paintingEmailSends } from "@/db/schema";
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
  if (command !== "list" && command !== "send-owed" && command !== "bounced" && command !== "readdress") {
    console.error("usage: npm run email -- list | send-owed [--keepsake <id>] | bounced | readdress --keepsake <id> <new address>");
    process.exitCode = 2;
    return;
  }
  try {
    const keepsakeId = keepsakeArg(args);
    if (command === "bounced") {
      const rows = await getDb()
        .select({ keepsake: paintingEmailSends.keepsakeId, sentAt: paintingEmailSends.sentAt })
        .from(paintingEmailSends)
        .where(eq(paintingEmailSends.refusedCode, BOUNCED_CODE));
      for (const row of rows) console.log(JSON.stringify(row));
      return;
    }
    if (command === "readdress") {
      // ADR-0027's by-hand resend, for a donor who writes in without the browser that has `/thanks`.
      const address = parseDonorEmail(args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--keepsake"));
      if (!keepsakeId || !address) throw new Error("EMAIL_CLI readdress takes --keepsake <id> and a new address");
      const db = getDb();
      const key = suppressionKey();
      if (!key) throw new Error("EMAIL_SUPPRESSION_KEY is not set");
      if (await isSuppressed(db, address, key)) throw new Error("EMAIL_CLI that address is on the never-mail list");
      const [row] = await db.select({ intentId: keepsake.intentId }).from(keepsake).where(eq(keepsake.id, keepsakeId));
      if (!row) throw new Error("EMAIL_CLI no such keepsake");
      console.log(JSON.stringify({ keepsake: keepsakeId, fix: await correctDonorEmail(db, row.intentId, address) }));
      return;
    }
    if (command === "list") {
      const origin = emailLinkOrigin();
      for (const owed of await loadOwedPaintings(getDb(), { keepsakeId, limit: 50 })) {
        console.log(
          JSON.stringify({
            keepsake: owed.keepsakeId,
            animal: owed.animalName,
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
