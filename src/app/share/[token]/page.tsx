import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  paintingImagePath,
  paintingPagePath,
  PAINTING_NUMBERS,
  SHARE_PAINTING,
} from "@/core/share/source";
import { SiteLogo } from "@/ui/site-logo";
import { AboutMonsterPaws, ShelterCredit } from "../about";
import { loadShare, paintedLine, shareMetadata } from "../load";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { name, kind } = await loadShare(token);
  return shareMetadata({
    token,
    n: 1,
    title: `${name}'s paintings — Monster Paws`,
    description: `Watercolour paintings of ${name}${kind ? `, ${kind}` : ""}. Painted by Monster Paws.`,
    alt: `${name}, painted in watercolour`,
  });
}

/**
 * One keepsake's four paintings, for anyone holding the link: no login and no
 * cookie, and never the donor's address, amount or name (ADR-0036). Images are
 * `unoptimized`: the optimizer keeps its own copy, which a takedown wouldn't reach.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { name, kind, shelter } = await loadShare(token);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <h1 className="mt-8 text-3xl font-bold">{name}&apos;s paintings</h1>
      <p className="mt-2 text-lg text-muted">{paintedLine(kind)}. Pick one to save or share it.</p>
      <ShelterCredit shelter={shelter} />

      <ul className="mt-8 grid gap-6 sm:grid-cols-2">
        {PAINTING_NUMBERS.map((n) => (
          <li key={n} className="rounded-cuddly border-2 border-paw/30 bg-card p-3 shadow-sm">
            <Link
              href={paintingPagePath(token, n)}
              aria-label={`Save or share painting ${n} of ${name}`}
              className="block rounded-[1rem] transition-opacity hover:opacity-90"
            >
              <Image
                src={paintingImagePath(token, n)}
                alt={`${name}, painted in watercolour: painting ${n} of ${PAINTING_NUMBERS.length}`}
                width={SHARE_PAINTING[0]}
                height={SHARE_PAINTING[1]}
                sizes="(min-width: 1024px) 480px, (min-width: 640px) 45vw, 90vw"
                unoptimized
                loading={n <= 2 ? "eager" : "lazy"}
                className="h-auto w-full rounded-[1rem]"
              />
            </Link>
          </li>
        ))}
      </ul>

      <AboutMonsterPaws />
    </main>
  );
}
