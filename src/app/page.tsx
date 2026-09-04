import Image from "next/image";
import Link from "next/link";

/**
 * Dev-only navigation. Both destinations are dev-gated pages — `/animals` is a
 * stub standing in for the unbuilt browse page and `/design` is the style
 * guide — so a link that renders in production is a link to a 404.
 */
const DEV_LINKS = [
  { href: "/animals", label: "Animals (stub)" },
  { href: "/design", label: "Design" },
];

const LOOP = [
  {
    emoji: "🔍",
    title: "Meet",
    blurb: "Browse real shelter animals near you — every single one is real, and really waiting.",
  },
  {
    emoji: "💛",
    title: "Sponsor",
    blurb: "Donate any amount. 100% goes to their shelter — we never take a cut.",
  },
  {
    emoji: "🎉",
    title: "Cheer",
    blurb: "Collect their card, follow their story, and celebrate the day they go home.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-20 text-center">
      {process.env.NODE_ENV !== "production" && (
        <nav className="mb-10 flex gap-4 text-sm font-medium text-muted">
          {DEV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="underline hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
      )}
      <h1>
        <Image
          src="/brand/wordmark-v1.png"
          alt="Monster Paws"
          width={582}
          height={326}
          priority
          className="h-auto w-64 sm:w-80"
        />
      </h1>
      <p className="mt-4 text-lg font-medium text-honey-deep">
        every monster deserves a happy ending
      </p>
      <p className="mt-6 max-w-xl text-lg text-muted">
        Sponsor a real shelter animal, collect their story, and cheer them all
        the way to adoption day.{" "}
        <span className="font-semibold text-foreground">
          100% of every donation goes to the shelter.
        </span>
      </p>

      <a
        href="#"
        aria-disabled
        className="mt-8 inline-block rounded-cuddly bg-leaf px-8 py-4 text-lg font-bold text-white shadow-lg transition-colors hover:bg-leaf-deep"
      >
        Meet the monsters (soon!)
      </a>

      <div className="mt-16 grid w-full max-w-4xl gap-6 sm:grid-cols-3">
        {LOOP.map((step) => (
          <div
            key={step.title}
            className="rounded-cuddly border-2 border-paw/30 bg-card p-6 text-left shadow-sm"
          >
            <span aria-hidden className="text-4xl">
              {step.emoji}
            </span>
            <h2 className="mt-3 text-xl font-bold">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {step.blurb}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-16 text-sm text-muted">
        Built with 🐕 by people with rescue dogs. Under construction — inspiring
        joy shortly.
      </p>
    </main>
  );
}
