import Link from "next/link";
import { notFound } from "next/navigation";
import { CREW, crewPet, parseAmount } from "@/ui/crew";
import { SiteLogo } from "@/ui/site-logo";

export function generateStaticParams() {
  return CREW.map((pet) => ({ pet: pet.slug }));
}

/**
 * Where the real flow leaves us for Every.org's own checkout (ADR-0027
 * decision 3). A labelled placeholder in our styling — never Every.org's look,
 * logo or wording, which would be impersonating them (ADR-0028 as amended
 * 2026-10-26, later).
 */
export default async function DemoCheckout({
  params,
  searchParams,
}: {
  params: Promise<{ pet: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pet = crewPet((await params).pet);
  if (!pet) notFound();
  const amount = parseAmount((await searchParams).amount);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <section className="mt-10 rounded-cuddly border-2 border-dashed border-paw/50 bg-card p-8 text-center">
        <p className="text-xs font-bold tracking-wide text-muted uppercase">Checkout placeholder</p>
        <h1 className="mt-2 text-2xl font-bold">
          ${amount} for {pet.name}&apos;s shelter
        </h1>
        <p className="mt-4 leading-relaxed text-muted">
          For a real sponsorship, Every.org&apos;s secure checkout opens here. You pay by bank, card,
          PayPal or Venmo, Every.org emails your receipt, and you come straight back to Monster Paws.
          We never see your card.
        </p>
        <Link
          href={`/demo/${pet.slug}/thanks?amount=${amount}`}
          className="mt-8 inline-block rounded-cuddly bg-leaf px-8 py-3 text-lg font-bold text-white shadow-md transition-colors hover:bg-leaf-deep"
        >
          Complete the demo donation
        </Link>
        <p className="mt-4">
          <Link href={`/demo/${pet.slug}/sponsor?amount=${amount}`} className="text-sm font-semibold text-muted underline hover:text-foreground">
            ← Change the amount
          </Link>
        </p>
      </section>
    </main>
  );
}
