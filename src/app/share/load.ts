import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import {
  isShareToken,
  paintingImagePath,
  paintingNumber,
  shareSourceFromEnv,
  SHARE_PAINTING,
  type PaintingNumber,
  type ShareManifest,
} from "@/core/share/source";
import { SITE_OPEN_GRAPH } from "@/ui/site";

/** `cache` because Next calls `generateMetadata` and the page separately, and each read is a fetch. */
export const loadShare = cache(async (token: string): Promise<ShareManifest> => {
  // Reject before any key or URL is built: the token comes straight from a URL (ADR-0036).
  if (!isShareToken(token)) notFound();
  const manifest = await shareSourceFromEnv()?.manifest(token);
  if (!manifest) notFound();
  return manifest;
});

export function paintingOr404(raw: string): PaintingNumber {
  const n = paintingNumber(raw);
  if (!n) notFound();
  return n;
}

export function shareMetadata(args: {
  token: string;
  n: PaintingNumber;
  title: string;
  description: string;
  alt: string;
}): Metadata {
  const url = paintingImagePath(args.token, args.n);
  return {
    title: args.title,
    description: args.description,
    // Out of search by noindex, and never fenced in robots.ts: a fenced page can't
    // show a crawler this line, and it would stop the preview bots too (ADR-0036).
    robots: { index: false, follow: false },
    // The sanctioned exception to layout.tsx's rule: this card is the painting itself (ADR-0036).
    openGraph: {
      ...SITE_OPEN_GRAPH,
      title: args.title,
      description: args.description,
      images: [{ url, width: SHARE_PAINTING[0], height: SHARE_PAINTING[1], alt: args.alt }],
    },
    twitter: { card: "summary_large_image", images: [url] },
  };
}
