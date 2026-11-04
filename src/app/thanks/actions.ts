"use server";

import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type AddressFix, correctDonorEmail, INTENT_COOKIE, intentIdsOf, intentRef, parseDonorEmail } from "@/core/donate/intent";
import { isSuppressed, suppressionKey } from "@/core/email/suppression";
import { failureCode } from "@/core/observability";
import { getDb } from "@/db/client";

/**
 * Fixes the address on the gift the page showed. Never work the gift out again here: a gift
 * can change between render and Save, and the address would land on another. The form only
 * chooses among the ids in this browser's cookie, or anyone could point someone's painting
 * at their own inbox.
 */
export async function fixDonorEmail(formData: FormData): Promise<void> {
  const donorEmail = parseDonorEmail(formData.get("email"));
  if (!donorEmail) redirect("/thanks?problem=email");

  const db = getDb();
  let fix: AddressFix | null = null;
  let suppressed = false;
  try {
    const ids = intentIdsOf((await cookies()).get(INTENT_COOKIE)?.value);
    const shown = ids.find((id) => intentRef(id) === formData.get("gift"));
    // Refused here, or the sweep would skip this gift forever with nobody told (ADR-0027 as amended 2026-11-02, decision 7).
    const key = suppressionKey();
    suppressed = Boolean(shown) && key !== null && (await isSuppressed(db, donorEmail, key));
    if (shown && !suppressed) fix = await correctDonorEmail(db, shown, donorEmail);
  } catch (err) {
    // Uncaught, this reaches error reporting with the donor's address in its message.
    const code = failureCode(err);
    console.error(`[thanks] address not changed: ${code}`);
    Sentry.captureMessage(`thanks address not changed: ${code}`, { level: "error" });
    redirect("/thanks?problem=retry");
  }
  if (suppressed) redirect("/thanks?problem=suppressed");
  if (fix === "already-sent") redirect("/thanks?problem=sent");
  redirect(fix === "saved" || fix === "resending" ? "/thanks?saved=1" : "/thanks");
}
