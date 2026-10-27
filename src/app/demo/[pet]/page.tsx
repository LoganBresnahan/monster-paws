import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimalGallery } from "@/ui/animal-gallery";
import { CREW, crewPet, DEMO_SHELTER, pronoun } from "@/ui/crew";
import { SiteLogo } from "@/ui/site-logo";

export function generateStaticParams() {
  return CREW.map((pet) => ({ pet: pet.slug }));
}

/**
 * The demo's listing: the animal page's layout and gallery with a crew pet,
 * plus the Sponsor button the real page gains with the donate loop (ADR-0027
 * as amended 2026-10-26). The facts are only what we know of our own pets —
 * never a made-up shelter, place or care history.
 */
export default async function DemoListing({ params }: { params: Promise<{ pet: string }> }) {
  const pet = crewPet((await params).pet);
  if (!pet) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <Link href="/demo" className="mt-6 text-sm font-semibold text-muted underline hover:text-foreground">
        ← All the crew
      </Link>

      <div className="mt-4">
        <AnimalGallery
          photos={[{ url: `/brand/crew/${pet.slug}-photo.jpg`, width: pet.photo[0], height: pet.photo[1] }]}
          name={pet.name}
        />
      </div>

      <div className="mt-6">
        <h1 className="text-3xl font-bold">{pet.name}</h1>
        <p className="mt-2 text-lg text-muted">
          {[pet.kind, pet.she ? "Female" : "Male", pet.age].join(" · ")}
        </p>
      </div>

      <p className="mt-10 text-lg leading-relaxed text-muted">
        On a real listing, this is where the shelter&apos;s own description goes, word for word.{" "}
        {pet.name} is one of our crew, so here {pronoun(pet, "they")} stands in for an animal waiting
        at a shelter near you.
      </p>

      <div className="mt-10 rounded-cuddly border-2 border-paw/30 bg-card p-6">
        <h2 className="text-xl font-bold">Sponsor {pet.name}</h2>
        <p className="mt-2 text-muted">
          A donation for {pet.name} goes to {pronoun(pet, "their")} shelter, and we keep $0. You get
          a watercolour keepsake of {pronoun(pet, "them")} and follow {pronoun(pet, "their")} story
          until adoption day.
        </p>
        <Link
          href={`/demo/${pet.slug}/sponsor`}
          className="mt-5 inline-block rounded-cuddly bg-leaf px-8 py-3 text-lg font-bold text-white shadow-md transition-colors hover:bg-leaf-deep"
        >
          Sponsor {pet.name}
        </Link>
        <p className="mt-4 text-sm text-muted">Listed by {DEMO_SHELTER}, for this demo only.</p>
      </div>
    </main>
  );
}
