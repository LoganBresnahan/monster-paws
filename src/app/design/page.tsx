import { notFound } from "next/navigation";
import { Swatches, ThemeToggle } from "./swatches";
import { AnimalGallery } from "@/ui/animal-gallery";
import { agoInWords } from "@/ui/dates";
import { TYPE_SCALE } from "@/ui/tokens";

/** Local, so the guide never hotlinks a real shelter's photo to demo a component. */
function samplePhoto(emoji: string, width: number, height: number) {
  const url =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="%23a97c50" opacity="0.25"/><text x="${width / 2}" y="${height * 0.6}" font-size="96" text-anchor="middle">${emoji}</text></svg>`,
    );
  return { url, width, height };
}

/** Deliberately different shapes: the frame takes each photo's own ratio, and one sample size would hide that. */
const SAMPLE_PHOTOS = [
  samplePhoto("🐶", 400, 300),
  samplePhoto("🐕", 300, 400),
  samplePhoto("🦴", 400, 400),
  samplePhoto("🐾", 500, 250),
];

/** Fixed, not `Date.now()`: a style guide that renders differently each visit cannot be diffed by eye. */
const SAMPLE_NOW = new Date("2026-09-04T12:00:00Z");
const SAMPLE_SEEN = new Date("2026-09-03T00:00:00Z");

/** Living style guide (ADR-0016): every token and pattern the site uses, rendered. Dev only. */

export const metadata = { title: "Design — Monster Paws" };

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Monster Paws design</h1>
        <ThemeToggle />
      </div>
      <p className="mt-2 text-muted">
        Everything here is read from <code>src/app/globals.css</code> — if it
        looks wrong here it looks wrong everywhere.
      </p>

      <Section title="Color tokens">
        <Swatches />
      </Section>

      <Section title="Type scale">
        <div className="space-y-3">
          {TYPE_SCALE.map((t) => (
            <div key={t.label} className="flex items-baseline gap-4">
              <code className="w-28 shrink-0 text-xs text-muted">
                {t.label}
              </code>
              <span className={t.cls}>
                Every monster deserves a happy ending
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Shape & elevation">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-cuddly border-2 border-paw/30 bg-card p-6">
            <code className="text-xs text-muted">
              rounded-cuddly · border-paw/30
            </code>
          </div>
          <div className="rounded-cuddly bg-card p-6 shadow-sm">
            <code className="text-xs text-muted">shadow-sm</code>
          </div>
          <div className="rounded-cuddly bg-card p-6 shadow-lg">
            <code className="text-xs text-muted">shadow-lg</code>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-4">
          <button className="rounded-cuddly bg-leaf px-8 py-4 text-lg font-bold text-white shadow-lg transition-colors hover:bg-leaf-deep">
            Primary (leaf)
          </button>
          <button className="rounded-cuddly bg-honey px-6 py-3 font-bold text-foreground transition-colors hover:bg-honey-deep">
            Celebrate (honey)
          </button>
          <button className="rounded-cuddly border-2 border-paw/40 bg-card px-6 py-3 font-semibold transition-colors hover:border-paw">
            Secondary
          </button>
          <a
            href="#"
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            ← Text link
          </a>
        </div>
      </Section>

      <Section title="Animal photo & freshness (ADR-0015)">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-cuddly bg-card p-4 shadow-sm">
            <AnimalGallery photos={SAMPLE_PHOTOS} name="Biscuit" />
            <div className="p-4">
              <h3 className="text-lg font-bold">Biscuit</h3>
              <p className="mt-1 text-sm text-muted">
                Beagle mix · Female · About 3 years old (estimated) · Austin, TX
              </p>
            </div>
          </div>
          <div className="rounded-cuddly border-2 border-paw/30 bg-card p-6">
            <p className="text-sm text-muted">
              We last checked this listing{" "}
              {agoInWords(SAMPLE_SEEN, SAMPLE_NOW)}. Listings refresh at most
              once a day, so ours can be behind the shelter&apos;s — always confirm with them
              before making plans.
            </p>
            <p className="mt-4 text-sm text-muted">
              The freshness line is copy the detail page renders, not decoration: it is the
              stale-data mitigation, and it never says &ldquo;available now&rdquo;.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-cuddly border-2 border-paw/30 bg-card p-6 shadow-sm">
            <span aria-hidden className="text-4xl">
              🔍
            </span>
            <h3 className="mt-3 text-xl font-bold">Loop step</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The landing-page card as shipped.
            </p>
          </div>
          <div className="overflow-hidden rounded-cuddly border-2 border-paw/30 bg-card shadow-sm">
            <div className="flex h-40 items-center justify-center bg-paw/20 text-5xl">
              🐕
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Biscuit</h3>
                <span className="rounded-full bg-honey px-2 py-0.5 text-xs font-bold">
                  adoptable
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                Dog · Beagle mix · Austin, TX
              </p>
            </div>
          </div>
          <div className="rounded-cuddly border-2 border-paw/30 bg-card p-6 shadow-sm">
            <h3 className="text-lg font-bold">Animal card (proposal)</h3>
            <p className="mt-2 text-sm text-muted">
              Middle card is a sketch of what ADR-0015 browse needs. Not built
              yet.
            </p>
          </div>
        </div>
      </Section>
    </main>
  );
}
