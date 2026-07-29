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
      <span aria-hidden className="text-7xl">
        🐾
      </span>
      <h1 className="mt-4 text-5xl font-bold tracking-tight sm:text-6xl">
        Monster Paws
      </h1>
      <p className="mt-2 text-lg font-medium text-honey-deep">
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
