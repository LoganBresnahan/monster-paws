import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isDisplayLicensed, pickLicensedDisplay } from "@/core/display";
import { loadSponsorable } from "@/core/donate/intent";
import { donateConfigFromEnv, parseDonateAmount } from "@/core/donate/link";
import { getDb } from "@/db/client";
import { animalDisplay } from "@/db/schema";
import { AnimalPhoto, speciesEmoji, TrackerPixel } from "@/ui/animal";
import { SiteLogo } from "@/ui/site-logo";
import { SponsorForm } from "@/ui/sponsor-form";

export const metadata: Metadata = { title: "Sponsor — Monster Paws", robots: { index: false } };

/**
 * The real sponsor page, from `/demo`'s design (ADR-0027 as amended 2026-10-26).
 * Promises no date for a painting and no updates: no painter is live, and updates
 * need a partnered shelter (ADR-0004, ADR-0006).
 */
export default async function SponsorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const config = donateConfigFromEnv();
  if (!/^\d{1,18}$/.test(id) || !config) notFound();

  const db = getDb();
  const asOf = new Date();
  const sponsorable = await loadSponsorable(db, Number(id), { ...config, asOf });
  if (!sponsorable) notFound();

  const { name, org, listed } = sponsorable;
  const shelter = org ?? "their shelter";
  const query = await searchParams;
  const amount = parseDonateAmount(query.amount) ?? 5;

  // Only a listed animal's photo, and only under its licence (ADR-0015 decision 3).
  const display = listed ? await db.select().from(animalDisplay).where(eq(animalDisplay.animalId, sponsorable.animalId)) : [];
  const licensed = pickLicensedDisplay(display, asOf);
  const photo = licensed?.photos[0];
  // Owed for every RescueGroups-sourced page we render (ADR-0006 decision 2).
  const tracker = display.find((row) => row.source === "rescuegroups" && isDisplayLicensed(row.source, asOf))?.trackerUrl;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      {listed && (
        <Link href={`/animals/${id}`} className="mt-6 text-sm font-semibold text-muted underline hover:text-foreground">
          ← Back to {name}
        </Link>
      )}

      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[1rem] bg-paw/10 text-4xl">
          {photo ? (
            <AnimalPhoto src={photo.url} alt="" width={photo.width} height={photo.height} priority className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden>{speciesEmoji(sponsorable.species)}</span>
          )}
        </div>
        <h1 className="text-3xl font-bold">Sponsor {name}</h1>
      </div>

      {!listed && (
        // Never "adopted": a disappearance is inferred, and an outcome is the shelter's to state (ADR-0020).
        <p role="status" className="mt-6 rounded-cuddly border-2 border-honey bg-card p-4">
          {name} is no longer listed. Your donation still goes to {shelter}, and we keep $0.
        </p>
      )}

      <section className="mt-8 rounded-cuddly border-2 border-paw/30 bg-card p-6">
        <SponsorForm
          animalId={sponsorable.animalId}
          name={name}
          initial={amount}
          unlisted={!listed}
          problem={typeof query.problem === "string" ? query.problem : undefined}
        />
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-cuddly border-2 border-paw/20 bg-card p-5">
          <h2 className="font-bold">Where it goes</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            To {shelter} through Every.org, a nonprofit that sends it on and emails your tax receipt.{" "}
            <span className="font-semibold text-foreground">We keep $0.</span> With a
            card, the processor&apos;s fee comes out of your donation, not on top of it: about 30¢ plus 2%, so about 40¢ of
            a $5 donation.
          </p>
        </div>
        <div className="rounded-cuddly border-2 border-paw/20 bg-card p-5">
          {/* Only a shelter's grant reaches this page on production, so this can't promise a painting early (ADR-0006 decision 6). */}
          <h2 className="font-bold">Our thank-you</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            As our thank-you, we try to paint {name} and email you the paintings.
          </p>
        </div>
      </section>

      {tracker && <TrackerPixel src={tracker} />}
    </main>
  );
}
