import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { donateConfigFromEnv } from "@/core/donate/link";
import { secretMatches } from "@/core/donate/webhook";
import { SiteLogo } from "@/ui/site-logo";
import { TestGiftForm } from "./form";

export const metadata: Metadata = { title: "Test gift — Monster Paws", robots: { index: false, follow: false } };

/**
 * Logan's real-money tests of the webhook on production, linked from nowhere (ADR-0027
 * as amended 2026-11-02). The repo is public, so the secret is what keeps this unlisted.
 * Never set `referrer: "no-referrer"` here: it turns the Server Action's Origin into
 * `null`, and the browser's default already sends Every.org only our origin.
 */
export default async function TestGiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ secret: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { secret } = await params;
  if (!secretMatches(secret, process.env.EVERYORG_TEST_PAGE_SECRET) || !donateConfigFromEnv()) notFound();
  const { problem } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12">
      <SiteLogo />
      <h1 className="mt-8 text-3xl font-bold">Test gift</h1>
      <p className="mt-3 text-muted">
        This page isn&apos;t linked anywhere. It gives real money to Rainbow Bridge Hospice Rescue through Every.org, to
        test our webhook. No painting comes of it.
      </p>
      {problem === "form" && (
        <p role="alert" className="mt-4 font-semibold">
          That needs a valid amount and email.
        </p>
      )}
      {problem === "retry" && (
        <p role="alert" className="mt-4 font-semibold">
          Something went wrong on our side, and nothing was charged. Please try again.
        </p>
      )}
      <section className="mt-8 rounded-cuddly border-2 border-paw/30 bg-card p-6">
        <TestGiftForm secret={secret} />
      </section>
    </main>
  );
}
