"use server";

import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createIntent, INTENT_COOKIE, INTENT_COOKIE_OPTIONS, parseDonorEmail, withIntent } from "@/core/donate/intent";
import { donateConfigFromEnv, donateLink, parseDonateAmount } from "@/core/donate/link";
import { TEST_GIFT } from "@/core/donate/test-gift";
import { secretMatches } from "@/core/donate/webhook";
import { failureCode } from "@/core/observability";
import { getDb } from "@/db/client";

/** A Server Action is its own public endpoint, so the secret is checked here as well as on the page. */
export async function startTestGift(formData: FormData): Promise<void> {
  const secret = formData.get("secret");
  if (typeof secret !== "string" || !secretMatches(secret, process.env.EVERYORG_TEST_PAGE_SECRET)) redirect("/");
  const page = `/test-gift/${secret}`;

  const config = donateConfigFromEnv();
  const amount = parseDonateAmount(formData.get("amount"));
  const donorEmail = parseDonorEmail(formData.get("email"));
  if (!config || amount === null || !donorEmail) redirect(`${page}?problem=form`);

  let intentId: string;
  try {
    intentId = await createIntent(getDb(), TEST_GIFT, donorEmail);
  } catch (err) {
    // Uncaught, this reaches error reporting with the address in its message.
    const code = failureCode(err);
    console.error(`[test-gift] intent not created: ${code}`);
    Sentry.captureMessage(`test gift intent not created: ${code}`, { level: "error" });
    redirect(`${page}?problem=retry`);
  }
  const jar = await cookies();
  jar.set(INTENT_COOKIE, withIntent(jar.get(INTENT_COOKIE)?.value, intentId), INTENT_COOKIE_OPTIONS);

  // exitPath is "/" and never this page: the exit URL goes to Every.org, and this path holds the secret.
  redirect(donateLink(config, { nonprofitSlug: TEST_GIFT.nonprofit.slug, intentId, amount, exitPath: "/", donorEmail }));
}
