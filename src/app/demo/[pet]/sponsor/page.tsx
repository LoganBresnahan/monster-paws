import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CREW, crewPet, parseAmount, pronoun } from "@/ui/crew";
import { SiteLogo } from "@/ui/site-logo";
import { AmountPicker } from "../../parts";

export function generateStaticParams() {
  return CREW.map((pet) => ({ pet: pet.slug }));
}

/**
 * The sponsor page — the first design of the donate loop's own (ADR-0027 as
 * amended 2026-10-26): the amount from $1, where it goes and what it never
 * pays us, what the donor gets, then the hand-off to checkout.
 */
export default async function DemoSponsor({
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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <Link href={`/demo/${pet.slug}`} className="mt-6 text-sm font-semibold text-muted underline hover:text-foreground">
        ← Back to {pet.name}
      </Link>

      <div className="mt-4 flex items-center gap-4">
        <Image
          src={`/brand/crew/${pet.slug}-thumb.jpg`}
          alt=""
          width={480}
          height={480}
          sizes="80px"
          className="h-20 w-20 rounded-[1rem] object-cover"
        />
        <div>
          <h1 className="text-3xl font-bold">Sponsor {pet.name}</h1>
          <p className="text-muted">
            {pet.kind} · {pet.age}
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-cuddly border-2 border-paw/30 bg-card p-6">
        <AmountPicker pet={pet} initial={amount} />
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-cuddly border-2 border-paw/20 bg-card p-5">
          <h2 className="font-bold">Where it goes</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Straight to {pet.name}&apos;s shelter through Every.org, a nonprofit that sends it on and
            emails your tax receipt. <span className="font-semibold text-foreground">We keep $0.</span>{" "}
            Paying by bank sends every cent; a card&apos;s processor keeps a small fee.
          </p>
        </div>
        <div className="rounded-cuddly border-2 border-paw/20 bg-card p-5">
          <h2 className="font-bold">What you get</h2>
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-muted">
            <li>🎨 A watercolour keepsake of {pronoun(pet, "them")}, painted from the shelter&apos;s photos</li>
            <li>💌 Updates on the care you helped pay for</li>
            <li>🎉 Word on the day {pronoun(pet, "they")} goes home</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
