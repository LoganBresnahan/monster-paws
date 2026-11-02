"use server";

import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createIntent,
  INTENT_COOKIE,
  INTENT_COOKIE_OPTIONS,
  loadSponsorable,
  parseDonorEmail,
  withIntent,
} from "@/core/donate/intent";
import { donateConfigFromEnv, donateLink, parseDonateAmount } from "@/core/donate/link";
import { failureCode } from "@/core/observability";
import { getDb } from "@/db/client";

/**
 * Mints the intent and leaves for Every.org (ADR-0027 §3). A POST, never a link: AI
 * crawlers are allowed on this site, and a GET that minted would fill the table with
 * intents nobody meant. Everything is re-read here, since the page may be days old.
 */
export async function startSponsorship(formData: FormData): Promise<void> {
  const rawId = formData.get("animalId");
  if (typeof rawId !== "string" || !/^\d{1,18}$/.test(rawId)) redirect("/animals");
  const page = `/animals/${rawId}`;

  const config = donateConfigFromEnv();
  const amount = parseDonateAmount(formData.get("amount"));
  if (!config || amount === null) redirect(`${page}/sponsor`);

  // Asked here, before any money moves: the painting is emailed, and Every.org shares
  // an address only if the donor chooses (ADR-0027 as amended 2026-11-02). The
  // address is never put in a URL to send them back.
  const donorEmail = parseDonorEmail(formData.get("email"));
  if (!donorEmail) redirect(`${page}/sponsor?amount=${amount}&problem=email`);

  const db = getDb();
  const sponsorable = await loadSponsorable(db, Number(rawId), config);
  if (!sponsorable) redirect(page);

  // Say so, then let them carry on: a gift to the shelter of an animal that just
  // left is still a good gift (ADR-0015 as amended 2026-10-01).
  if (!sponsorable.listed && formData.get("seenUnlisted") !== "1") redirect(`${page}/sponsor?amount=${amount}`);

  let intentId: string;
  try {
    intentId = await createIntent(db, sponsorable, donorEmail);
  } catch (err) {
    // Uncaught, this reaches error reporting with the donor's address in its message.
    const code = failureCode(err);
    console.error(`[sponsor] intent not created: ${code}`);
    Sentry.captureMessage(`sponsor intent not created: ${code}`, { level: "error" });
    redirect(`${page}/sponsor?amount=${amount}&problem=retry`);
  }
  const jar = await cookies();
  jar.set(INTENT_COOKIE, withIntent(jar.get(INTENT_COOKIE)?.value, intentId), INTENT_COOKIE_OPTIONS);

  redirect(
    donateLink(config, {
      nonprofitSlug: sponsorable.nonprofit.slug,
      intentId,
      amount,
      exitPath: sponsorable.listed ? page : "/animals",
      donorEmail,
    }),
  );
}
