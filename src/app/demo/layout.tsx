import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Demo — Monster Paws",
  description:
    "Try sponsoring a shelter animal on Monster Paws with our crew: browse, sponsor, and see their keepsake arrive. No money moves.",
};

/**
 * Every demo page walks a real page's twin with the crew in place of listings
 * (ADR-0028 as amended 2026-10-26, later). This banner is on all of them and is
 * never optional: nothing under /demo may pass for a real listing, a real
 * donation or a care event a shelter attested (DIRECTION.md, bright lines).
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <p className="sticky top-0 z-10 bg-honey px-4 py-2 text-center text-sm font-semibold text-foreground shadow-sm">
        Demo: no money moves, and the crew are already home.
      </p>
      {children}
    </>
  );
}
