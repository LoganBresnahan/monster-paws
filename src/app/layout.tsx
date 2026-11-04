import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/ui/site-footer";
import { SITE_OPEN_GRAPH, SITE_ORIGIN } from "@/ui/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "Monster Paws";
const DESCRIPTION =
  "Sponsor a real shelter animal and get a keepsake painting in their likeness. Every donation goes to the shelter, and we keep $0.";

/**
 * Shared links are how donors arrive, so every page sends a card (ADR-0030).
 * Never put a title, description, url or images here, and never set
 * `openGraph` on a page: Next fills the card's title and description from
 * each page's own at the end, and a page-level `openGraph` replaces this
 * whole object, image included. The one sanctioned exception is `/share`, whose
 * card is the painting itself and which spreads `SITE_OPEN_GRAPH` (ADR-0036).
 * The image is `opengraph-image.jpg` beside this file, built by
 * `npm run og:image`; `metadataBase` makes its URL production's on every
 * environment.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: SITE_OPEN_GRAPH,
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
