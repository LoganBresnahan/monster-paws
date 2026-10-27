import { AnimalCard, speciesEmoji } from "@/ui/animal";
import { CREW } from "@/ui/crew";
import { SiteLogo } from "@/ui/site-logo";

/** The demo's browse: `/animals`' grid and card, with the crew as the only listings. */
export default function DemoBrowse() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <h1 className="mt-8 text-3xl font-bold">Animals waiting</h1>
      <p className="mt-2 max-w-2xl text-muted">
        This is what browsing looks like, with our own crew standing in for shelter animals. Pick
        one to see their listing, then sponsor them.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CREW.map((pet) => (
          <AnimalCard
            key={pet.slug}
            href={`/demo/${pet.slug}`}
            name={pet.name}
            facts={`${pet.kind} · ${pet.age}`}
            photo={{ url: `/brand/crew/${pet.slug}-photo.jpg`, width: pet.photo[0], height: pet.photo[1] }}
            footer="One of our crew · already home"
            fallbackEmoji={speciesEmoji(pet.species)}
          />
        ))}
      </div>
    </main>
  );
}
