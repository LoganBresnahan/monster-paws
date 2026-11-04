import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  paintingImagePath,
  paintingPagePath,
  PAINTING_NUMBERS,
  SHARE_PAINTING,
  sharePagePath,
} from "@/core/share/source";
import { SITE_ORIGIN } from "@/ui/site";
import { SiteLogo } from "@/ui/site-logo";
import { AboutMonsterPaws } from "../../about";
import { loadShare, paintingOr404, shareMetadata } from "../../load";
import { ShareActions } from "../../share-actions";

type Params = { params: Promise<{ token: string; n: string }> };

/**
 * One URL per painting because a share link carries only a URL, and a
 * platform takes the card from that page's `og:image` (ADR-0036).
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token, n: raw } = await params;
  const n = paintingOr404(raw);
  const { name, kind } = await loadShare(token);
  return shareMetadata({
    token,
    n,
    title: `${name}, painted in watercolour — Monster Paws`,
    description: `${name}, ${kind}, painted in watercolour. A Monster Paws keepsake.`,
    alt: `${name}, painted in watercolour`,
  });
}

export default async function SharePaintingPage({ params }: Params) {
  const { token, n: raw } = await params;
  const n = paintingOr404(raw);
  const { name, kind } = await loadShare(token);
  const fileName = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-monster-paws-${n}.jpg`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <SiteLogo />

      <Link href={sharePagePath(token)} className="mt-6 text-sm font-semibold text-muted underline hover:text-foreground">
        ← See all {PAINTING_NUMBERS.length}
      </Link>

      <h1 className="mt-4 text-3xl font-bold">{name}</h1>
      <p className="mt-1 text-lg text-muted">{kind} · painted in watercolour</p>

      <div className="mt-6 rounded-cuddly border-2 border-paw/30 bg-card p-3 shadow-sm">
        <Image
          src={paintingImagePath(token, n)}
          alt={`${name}, painted in watercolour`}
          width={SHARE_PAINTING[0]}
          height={SHARE_PAINTING[1]}
          sizes="(min-width: 800px) 720px, 90vw"
          unoptimized
          preload
          className="h-auto w-full rounded-[1rem]"
        />
      </div>

      <div className="mt-6">
        <ShareActions
          pageUrl={`${SITE_ORIGIN}${paintingPagePath(token, n)}`}
          imagePath={paintingImagePath(token, n)}
          fileName={fileName}
          title={`${name}, a Monster Paws keepsake`}
        />
      </div>

      <AboutMonsterPaws />
    </main>
  );
}
