import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CREW, crewPet, parseAmount } from "@/ui/crew";
import { formatDate } from "@/ui/dates";
import { SiteLogo } from "@/ui/site-logo";
import { CollectionCard } from "../../parts";

export function generateStaticParams() {
  return CREW.map((pet) => ({ pet: pet.slug }));
}

/** The donor's collection with one card — a pretend profile: no account exists, and nothing is stored. */
export default async function DemoCollection({
  params,
  searchParams,
}: {
  params: Promise<{ pet: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pet = crewPet((await params).pet);
  if (!pet) notFound();
  const amount = parseAmount((await searchParams).amount);
  const others = CREW.filter((p) => p.slug !== pet.slug);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <h1 className="mt-8 text-3xl font-bold">Your collection</h1>
      <p className="mt-1 text-muted">A pretend profile for the demo — nothing here is saved.</p>

      <div className="mt-8">
        <CollectionCard pet={pet} amount={amount} sponsoredOn={formatDate(new Date())} />
      </div>

      <section className="mt-14">
        <h2 className="text-xl font-bold">Room for more</h2>
        <p className="mt-1 text-sm text-muted">Every animal you sponsor joins your shelf.</p>
        <ul className="mt-4 flex flex-wrap gap-3">
          {others.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/demo/${p.slug}`}
                className="flex items-center gap-2 rounded-full border-2 border-dashed border-paw/40 bg-card py-1 pr-4 pl-1 text-sm font-semibold text-muted transition-colors hover:border-paw hover:text-foreground"
              >
                <Image src={`/brand/crew/${p.slug}-thumb.jpg`} alt="" width={480} height={480} sizes="32px" className="h-8 w-8 rounded-full object-cover opacity-70" />
                Sponsor {p.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
