import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { lastSeenOf, loadAnimalDetail, type AnimalDetail } from "@/core/animals";
import { isDisplayLicensed, pickLicensedDisplay } from "@/core/display";
import { getDb } from "@/db/client";
import { TrackerPixel } from "@/ui/animal";
import { AnimalGallery } from "@/ui/animal-gallery";
import { agoInWords, formatDate } from "@/ui/dates";
import { decodeEntities, tidyWhitespace } from "@/ui/text";

/**
 * The animal detail page (ADR-0015). Two rules this file exists to keep, both
 * invisible in the markup: it reaches the database only through
 * `loadAnimalDetail`, which composes the ONE visibility predicate, and it
 * renders source prose and photos only through `pickLicensedDisplay`. A page
 * that assembles either for itself is how a just-adopted dog reaches a donor,
 * or how an unlicensed photo reaches the public.
 */

/**
 * The feed moves once a day, so an hour is the useful floor (ADR-0015
 * decision 1). Raising it is a promise to donors that gets staler; lowering it
 * buys nothing until on-demand revalidation from the poll exists.
 */
export const revalidate = 3600;

/** Any deeper facts must come from `animals` — never from `animal_display`, which is licensed expression, not fact. */
function speciesEmoji(species: string): string {
  if (species === "dog") return "🐶";
  if (species === "cat") return "🐱";
  return "🐾";
}

/**
 * Never state a birth date as exact unless the source said it is — most
 * sources estimate, and "born 3 March 2021" reads as a fact a shelter would
 * have to defend (ADR-0009).
 */
function ageLine(animal: AnimalDetail["animal"], asOf: Date): string | null {
  if (animal.birthDate && animal.isBirthDateExact) {
    return `Born ${formatDate(animal.birthDate)}`;
  }
  if (animal.birthDate) {
    const approx = agoInWords(animal.birthDate, asOf);
    // "today"/"yesterday" carry no duration to turn into an age, and a
    // future birth date is a broken record, not a newborn.
    if (approx.endsWith(" ago")) return `About ${approx.slice(0, -" ago".length)} old (estimated)`;
  }
  return animal.ageGroup;
}

function placeOf(animal: AnimalDetail["animal"]): string | null {
  return [animal.city, animal.state].filter(Boolean).join(", ") || null;
}

/**
 * `cache` because Next calls `generateMetadata` and the component separately:
 * without it every request runs the visibility query twice, and the two could
 * straddle a poll and disagree about whether the animal is visible at all.
 */
const load = cache(async (idParam: string): Promise<AnimalDetail> => {
  // Reject before the query, not after: `Number("12abc")` is NaN and a NaN
  // bigint parameter is a database error where a 404 is the honest answer.
  if (!/^\d+$/.test(idParam)) notFound();
  const detail = await loadAnimalDetail(getDb(), Number(idParam));
  if (!detail) notFound();
  return detail;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { animal } = await load((await params).id);
  const place = placeOf(animal);
  // Our own words, never the licensed description: a display license covers
  // the page, and a meta tag is syndicated far past it.
  return {
    title: `${animal.name} — Monster Paws`,
    description: `${animal.name} is a ${animal.breed ?? animal.species} looking for a home${
      place ? ` in ${place}` : ""
    }${animal.orgName ? `, listed by ${animal.orgName}` : ""}.`,
  };
}

export default async function AnimalPage({ params }: { params: Promise<{ id: string }> }) {
  const asOf = new Date();
  const { animal, identities, display } = await load((await params).id);

  const licensed = pickLicensedDisplay(display, asOf);
  // Driven by the RescueGroups row itself, NOT by whichever row won
  // precedence: the tracker is owed for every RG-sourced page we render
  // (ADR-0006 decision 2), and a shelter's own display row outranking RG's
  // must never be what silently drops the pixel.
  const tracker = display.find(
    (row) => row.source === "rescuegroups" && isDisplayLicensed(row.source, asOf),
  )?.trackerUrl;

  const lastSeen = lastSeenOf(identities);
  const place = placeOf(animal);
  const age = ageLine(animal, asOf);
  const facts = [
    animal.breed ?? animal.species,
    animal.sex,
    age,
    place,
  ].filter(Boolean) as string[];
  const org = licensed?.listingOrg ?? animal.orgName;
  // The link back the API terms owe (ADR-0006 decision 2, ADR-0015 decision 5).
  // `orgUrl` is a claim, never assembled here: a page that builds a URL from an
  // org id links a donor to the wrong shelter and calls it attribution.
  const orgLabel = org ?? "a shelter";
  const orgLink = animal.orgUrl ? (
    <a
      href={animal.orgUrl}
      target="_blank"
      rel="noopener"
      className="font-semibold text-foreground underline decoration-honey-deep underline-offset-4"
    >
      {orgLabel}
    </a>
  ) : (
    <span className="font-semibold text-foreground">{orgLabel}</span>
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
        ← Monster Paws
      </Link>

      <div className="mt-8">
        {licensed && licensed.photos.length > 0 ? (
          <AnimalGallery photos={licensed.photos} name={animal.name} />
        ) : (
          // Same aspect box as the gallery, so a page with photos and a page
          // without settle at the same height instead of one of them jumping.
          <div
            aria-hidden
            className="flex aspect-[4/3] w-full items-center justify-center rounded-cuddly border-2 border-paw/30 bg-paw/10 text-7xl"
          >
            {speciesEmoji(animal.species)}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h1 className="text-3xl font-bold">{animal.name}</h1>
        <p className="mt-2 text-lg text-muted">{facts.join(" · ")}</p>
      </div>

      {licensed?.description ? (
        <blockquote className="mt-10 border-l-4 border-honey pl-6 text-lg leading-relaxed whitespace-pre-line">
          {/* Verbatim, and a quotation on purpose: these are the shelter's own
              words under their license, so we never edit, trim or summarize
              them into ours (ADR-0015 decision 4). */}
          {/* Decoded, not edited: the source publishes prose HTML-encoded and
              we render it as text, so `&nbsp;` reaches the reader as a space
              instead of as five characters, and tidying runs after decoding
              because the blank lines ARE decoded `&nbsp;` (ADR-0018). */}
          {tidyWhitespace(decodeEntities(licensed.description))}
          {org && <footer className="mt-3 text-sm text-muted">— {org}</footer>}
        </blockquote>
      ) : (
        <p className="mt-10 text-lg leading-relaxed text-muted">
          We show {animal.name}&apos;s details exactly as {org ?? "their shelter"} published them.
          For the full story, and to meet {animal.name}, talk to them directly.
        </p>
      )}

      <div className="mt-10 rounded-cuddly border-2 border-paw/30 bg-card p-6">
        <h2 className="text-xl font-bold">Where {animal.name} is</h2>
        <p className="mt-2 text-muted">
          Listed by {orgLink}
          {place ? ` in ${place}` : ""}. When sponsoring opens, every cent of a donation for{" "}
          {animal.name} goes to {org ?? "their shelter"} — we never take a cut and never hold the
          money.
        </p>
        {/* No sponsor button here: item 4 owns the Every.org flow, and a page
            with a dead button is worse than a page without one (ADR-0015
            decision 6). */}
        <p className="mt-4 text-sm text-muted">
          {org ?? "This shelter"} has not partnered with us yet, so we can&apos;t promise updates
          on {animal.name} — only that the donation reaches them.
          {/* The verified-tier promise (signed care updates) belongs to roadmap
              item 7. Do not branch on "verified" before shelters can be: a
              branch nothing can take is a promise waiting to be made by
              accident. */}
        </p>
      </div>

      <p className="mt-8 text-sm text-muted">
        {lastSeen
          ? `We last checked this listing ${agoInWords(lastSeen, asOf)}.`
          : "We have no record of when this listing was last checked."}{" "}
        {/* Never "available now": we are a day behind the shelter at best, and
            the honest sentence is the mitigation DIRECTION asks for. */}
        Listings refresh at most once a day, so ours can be behind{" "}
        {org ?? "the shelter"}&apos;s — always confirm with them before making plans.
        {animal.listedAt && ` Listed ${formatDate(animal.listedAt)}, ${agoInWords(animal.listedAt, asOf)}.`}
      </p>

      {animal.listingUrl && (
        <p className="mt-6">
          <a
            href={animal.listingUrl}
            target="_blank"
            rel="noopener"
            className="inline-block rounded-cuddly border-2 border-paw px-6 py-3 font-bold transition-colors hover:bg-paw/10"
          >
            Read {animal.name}&apos;s full listing at {orgLabel} →
          </a>
        </p>
      )}

      <p className="mt-4 text-sm text-muted">
        Not affiliated with {org ?? "this shelter"}.{" "}
        <Link href="/claim" className="font-medium text-foreground underline">
          Is this your shelter? Claim it or remove your listings.
        </Link>
      </p>

      {tracker && <TrackerPixel src={tracker} />}
    </main>
  );
}
