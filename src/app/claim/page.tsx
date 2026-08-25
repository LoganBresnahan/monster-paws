import type { Metadata } from "next";
import Link from "next/link";

/**
 * The opt-out destination every aggregated detail page links to (ADR-0015).
 * Instant opt-out is DIRECTION's mitigation for consent optics, not a nicety:
 * never put it behind a form we have to staff, and never promise a shelter
 * anything here that the verified tier (item 7) has not actually built.
 */

const CONTACT = "hello@monsterpaws.org";

export const metadata: Metadata = {
  title: "Claim your shelter — Monster Paws",
  description:
    "Monster Paws is not affiliated with the shelters it lists. Claim your shelter's animals, or have your listings removed.",
};

function mailto(subject: string, body: string): string {
  return `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ClaimPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
        ← Monster Paws
      </Link>

      <h1 className="mt-8 text-3xl font-bold">Is this your shelter?</h1>

      <p className="mt-6 text-lg text-muted">
        Monster Paws is <span className="font-semibold text-foreground">not affiliated</span> with
        the shelters and rescues listed here. We show animals from public adoption listings, the
        same way a business directory shows a shop that never signed up — and we would rather you
        found out from us than from a supporter.
      </p>

      <p className="mt-4 text-lg text-muted">
        Listings refresh at most once a day, so ours can be behind yours. Donations go to your
        organization directly through Every.org —{" "}
        <span className="font-semibold text-foreground">
          we never take a cut and never hold your money.
        </span>
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col rounded-cuddly border-2 border-paw/30 bg-card p-6">
          <h2 className="text-xl font-bold">Claim your shelter</h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
            Tell us it&apos;s yours and we&apos;ll correct anything wrong, credit you properly, and
            walk you through turning on verified updates for your supporters. Free, and you can
            stop any time.
          </p>
          <a
            href={mailto(
              "Claim our shelter on Monster Paws",
              "Our organization:\nOur website:\nYour name and role:\n\n(Anything wrong on our listings?)\n",
            )}
            className="mt-6 inline-block rounded-cuddly bg-leaf px-6 py-3 text-center font-bold text-white transition-colors hover:bg-leaf-deep"
          >
            Email us to claim it
          </a>
        </div>

        <div className="flex flex-col rounded-cuddly border-2 border-paw/30 bg-card p-6">
          <h2 className="text-xl font-bold">Remove your listings</h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
            Say the word and your animals come off Monster Paws — no questions, no retention
            pitch, no form. We remove the pages and delete what we derived from your listings.
          </p>
          <a
            href={mailto(
              "Remove our listings from Monster Paws",
              "Our organization:\nOur website:\nYour name and role:\n",
            )}
            className="mt-6 inline-block rounded-cuddly border-2 border-paw px-6 py-3 text-center font-bold transition-colors hover:bg-paw/10"
          >
            Email us to opt out
          </a>
        </div>
      </div>

      <p className="mt-10 text-sm text-muted">
        Either way you reach a person at <span className="font-medium text-foreground">{CONTACT}</span>.
      </p>
    </main>
  );
}
