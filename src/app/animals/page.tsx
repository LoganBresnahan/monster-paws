import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { visibleAnimals } from "@/core/animals";
import { getDb } from "@/db/client";
import { animals } from "@/db/schema";
import { formatDate } from "@/ui/dates";

/**
 * A DEV-ONLY stub, not the browse page (ADR-0015 decision 5 and its 2026-09-03
 * amendment): no filters, no keyset cursor, no photos — it exists so detail
 * pages are reachable while `animal-browse-page` is still unbuilt. Never
 * un-gate it and never grow it into browse: the real page's cursor and index
 * shape were measured decisions, and a stub that quietly becomes public is how
 * they get skipped.
 *
 * No `animal_display` read on purpose — a second place picking a licensed row
 * is a second place that can pick wrong (ADR-0006 as amended).
 */

export const metadata: Metadata = { title: "Animals (dev) — Monster Paws" };

const LIMIT = 60;

export default async function AnimalsStubPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const rows = await getDb()
    .select()
    .from(animals)
    .where(visibleAnimals())
    // The real sort, so the stub does not teach a different one: longest
    // listed first, by the source's date and never `created_at`.
    .orderBy(asc(animals.listedAt), asc(animals.id))
    .limit(LIMIT);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
        ← Monster Paws
      </Link>

      <h1 className="mt-8 text-3xl font-bold">Animals</h1>
      <p className="mt-2 text-muted">
        Dev-only stub: the first {LIMIT} visible animals, longest-listed first. The real browse
        page — filters, keyset paging — is the next slice.
      </p>

      <ul className="mt-8 divide-y divide-paw/20">
        {rows.map((animal) => (
          <li key={animal.id}>
            <Link
              href={`/animals/${animal.id}`}
              className="flex items-baseline justify-between gap-4 py-3 hover:text-leaf-deep"
            >
              <span className="font-bold">{animal.name}</span>
              <span className="text-sm text-muted">
                {[animal.breed ?? animal.species, [animal.city, animal.state].filter(Boolean).join(", ")]
                  .filter(Boolean)
                  .join(" · ")}
                {animal.listedAt && ` · listed ${formatDate(animal.listedAt)}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="mt-8 text-muted">
          No visible animals. A null <code>source_updated_at</code> hides an animal — run{" "}
          <code>npm run ingest -- replay rescuegroups</code> before judging this empty.
        </p>
      )}
    </main>
  );
}
