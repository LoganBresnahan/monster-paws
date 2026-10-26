import type { Metadata } from "next";
import { SiteLogo } from "@/ui/site-logo";
import { DemoFlow } from "./demo-flow";

export const metadata: Metadata = {
  title: "Demo — Monster Paws",
  description:
    "Try sponsoring a shelter animal on Monster Paws with our crew: pick one, donate, and see their keepsake painting. No money moves.",
};

export default function Demo() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-12 text-center">
      <SiteLogo />
      <h1 className="mt-8 text-4xl font-bold sm:text-5xl">Try it with our crew</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        Pick one of the founders&apos; pets, sponsor them, and see what a sponsor gets.
      </p>
      <div className="mt-8 flex w-full justify-center">
        <DemoFlow />
      </div>
    </main>
  );
}
