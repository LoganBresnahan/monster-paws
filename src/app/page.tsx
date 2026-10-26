import Image from "next/image";
import Link from "next/link";
import { CREW, PAINTING } from "@/ui/crew";
import { Lightbox } from "@/ui/lightbox";

// Ducky is a founder's pet who is already home: every step is an illustration,
// never a real listing, donation or attested care event (DIRECTION.md, bright lines).
const HOW = [
  { title: "Find", blurb: "Browse real adoptable animals from shelters near you." },
  { title: "Sponsor", blurb: "Donate any amount. It goes to their shelter, and we keep $0." },
  { title: "Keepsake", blurb: "Get a watercolour keepsake painted in their likeness." },
  { title: "Follow", blurb: "Hear about the care you helped pay for, confirmed by the shelter." },
  { title: "Celebrate", blurb: "Their card changes on the day they go home." },
];

function HowVisual({ step }: { step: string }) {
  const frame = "relative aspect-[4/3] w-full overflow-hidden rounded-[1rem] bg-background";
  switch (step) {
    case "Find":
      return (
        <div className={`${frame} flex items-center gap-2 p-3`}>
          <Image src="/brand/crew/ducky-thumb.jpg" alt="" width={480} height={480} sizes="64px" className="h-16 w-16 shrink-0 rounded-[0.75rem] object-cover" />
          <div className="text-left">
            <p className="font-bold">Ducky</p>
            <p className="text-xs text-muted">Pit Bull mix · 5</p>
          </div>
        </div>
      );
    case "Sponsor":
      return (
        <div className={`${frame} flex flex-col items-center justify-center gap-2`}>
          <span className="rounded-cuddly bg-leaf px-5 py-2 text-lg font-bold text-white shadow">$5</span>
          <span className="text-xs text-muted">→ to the shelter, $0 to us</span>
        </div>
      );
    case "Keepsake":
      return (
        <div className={frame}>
          <Image src="/brand/crew/ducky-painting.jpg" alt="" fill sizes="(min-width: 1024px) 190px, (min-width: 640px) 30vw, 90vw" className="object-cover" />
        </div>
      );
    case "Follow":
      return (
        <div className={`${frame} flex flex-col justify-center gap-2 p-3 text-left text-xs`}>
          {["💉 Vaccinations", "🦷 Dental cleaning"].map((u) => (
            <span key={u} className="flex items-center justify-between gap-1 rounded-full bg-card px-3 py-1.5 shadow-sm">
              {u}
              <span className="font-bold text-leaf-deep">✓</span>
            </span>
          ))}
        </div>
      );
    default:
      return (
        <div className={`${frame} border-2 border-honey`}>
          <Image src="/brand/crew/ducky-painting.jpg" alt="" fill sizes="(min-width: 1024px) 190px, (min-width: 640px) 30vw, 90vw" className="object-cover" />
          <span className="absolute top-2 left-2 rounded-full bg-honey px-2.5 py-1 text-xs font-bold text-foreground shadow">🎉 Adopted!</span>
        </div>
      );
  }
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-8 text-center sm:py-12">
      <h1>
        <Image
          src="/brand/wordmark-v1.png"
          alt="Monster Paws"
          width={582}
          height={326}
          preload
          className="h-auto w-48 sm:w-72"
        />
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Sponsor a real shelter animal, get a keepsake painting in their
        likeness, and follow their story all the way to adoption day.{" "}
        <span className="font-semibold text-foreground">
          Every donation goes to the shelter. We keep $0.
        </span>
      </p>

      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <Link
          href="/animals"
          className="inline-block rounded-cuddly bg-leaf px-8 py-4 text-lg font-bold text-white shadow-lg transition-colors hover:bg-leaf-deep"
        >
          See adoptable animals
        </Link>
        <Link
          href="/demo"
          className="inline-block rounded-cuddly border-2 border-leaf bg-card px-8 py-[calc(1rem-2px)] text-lg font-bold text-leaf-deep shadow-sm transition-colors hover:bg-leaf hover:text-white"
        >
          See a demo
        </Link>
      </div>

      <section aria-labelledby="crew" className="mt-10 w-full max-w-5xl">
        <h2 id="crew" className="text-3xl font-bold">
          Meet the crew
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-muted">
          The founders&apos; own pets, already home. Each watercolour is painted
          by AI from a real photo, like the keepsake a sponsor collects.
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-8">
          {CREW.map((pet) => (
            <li
              key={pet.slug}
              className="w-full rounded-cuddly border-2 border-paw/30 bg-card p-3 pb-5 text-left shadow-sm sm:w-[calc(50%-1rem)] lg:w-[calc((100%-4rem)/3)]"
            >
              <Lightbox
                src={`/brand/crew/${pet.slug}-painting.jpg`}
                width={PAINTING[0]}
                height={PAINTING[1]}
                alt={`${pet.name}, painted in watercolour`}
                caption={`${pet.name}, painted in watercolour`}
                label={`See ${pet.name}'s painting larger`}
                className="block w-full rounded-[1rem] transition-opacity hover:opacity-90"
              >
                <Image
                  src={`/brand/crew/${pet.slug}-painting.jpg`}
                  alt={`${pet.name}, painted in watercolour`}
                  width={PAINTING[0]}
                  height={PAINTING[1]}
                  sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"
                  className="h-auto w-full rounded-[1rem]"
                />
              </Lightbox>
              <div className="mt-3 flex items-center gap-3 px-1">
                <Lightbox
                  src={`/brand/crew/${pet.slug}-photo.jpg`}
                  width={pet.photo[0]}
                  height={pet.photo[1]}
                  alt={`A photo of ${pet.name}`}
                  caption={pet.name}
                  label={`See the photo of ${pet.name}`}
                  className="shrink-0 rounded-full transition-transform hover:scale-105"
                >
                  <Image
                    src={`/brand/crew/${pet.slug}-thumb.jpg`}
                    alt=""
                    width={480}
                    height={480}
                    sizes="80px"
                    className="h-20 w-20 rounded-full border-4 border-card object-cover shadow-md ring-2 ring-paw/30"
                  />
                </Lightbox>
                <div>
                  <h3 className="text-lg font-bold">{pet.name}</h3>
                  <p className="text-sm text-muted">{pet.about}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className="mt-20 w-full max-w-5xl">
        <h2 id="how" className="text-3xl font-bold">
          How it works, with Ducky
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-muted">
          Ducky&apos;s already home with us, so this is an illustration of what a sponsor sees.
        </p>
        <ol className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {HOW.map((step, i) => (
            <li key={step.title} className="rounded-cuddly border-2 border-paw/30 bg-card p-3 pb-4 text-left shadow-sm">
              <HowVisual step={step.title} />
              <p className="mt-3 px-1 text-xs font-bold tracking-wide text-honey-deep uppercase">Step {i + 1}</p>
              <h3 className="px-1 text-lg font-bold">{step.title}</h3>
              <p className="mt-1 px-1 text-sm leading-relaxed text-muted">{step.blurb}</p>
            </li>
          ))}
        </ol>
        <Link
          href="/demo"
          className="mt-8 inline-block rounded-cuddly border-2 border-leaf bg-card px-6 py-3 font-bold text-leaf-deep shadow-sm transition-colors hover:bg-leaf hover:text-white"
        >
          Try it yourself
        </Link>
      </section>
    </main>
  );
}
