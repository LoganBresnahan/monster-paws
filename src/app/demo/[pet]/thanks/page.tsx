import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CREW, crewPet, parseAmount } from "@/ui/crew";
import { SiteLogo } from "@/ui/site-logo";

export function generateStaticParams() {
  return CREW.map((pet) => ({ pet: pet.slug }));
}

/**
 * Back from checkout: the animal as the donor chose them, in their real
 * photo, and the way to their card. The keepsake is under way, never instant
 * (ADR-0004 as amended 2026-10-05) — it is revealed on the collection page.
 */
export default async function DemoThanks({
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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12 text-center">
      <SiteLogo />

      <h1 className="mt-10 text-4xl font-bold">Thank you! 💛</h1>
      <p className="mt-3 text-lg text-muted">
        Your ${amount} is on its way to {pet.name}&apos;s shelter.
      </p>

      <div className="mt-8">
        <Image
          src={`/brand/crew/${pet.slug}-photo.jpg`}
          alt={`A photo of ${pet.name}`}
          width={pet.photo[0]}
          height={pet.photo[1]}
          sizes="(min-width: 672px) 640px, 90vw"
          className="mx-auto h-auto max-h-[28rem] w-auto rounded-cuddly border-2 border-paw/30 shadow-sm"
        />
        <p className="mt-4 text-muted">
          We&apos;re painting {pet.name}&apos;s keepsake now. For a real sponsorship it arrives when
          it&apos;s ready and we email you; here in the demo, it&apos;s waiting in your collection.
        </p>
      </div>

      <Link
        href={`/demo/collection/${pet.slug}?amount=${amount}`}
        className="mx-auto mt-8 inline-block rounded-cuddly bg-leaf px-8 py-3 text-lg font-bold text-white shadow-md transition-colors hover:bg-leaf-deep"
      >
        See {pet.name} in your collection
      </Link>
    </main>
  );
}
