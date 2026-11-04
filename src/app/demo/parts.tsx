"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PAINTING, pronoun, type CrewPet } from "@/ui/crew";
import { AmountFields } from "@/ui/amount-picker";
import { Lightbox } from "@/ui/lightbox";

/**
 * The demo's interactive pieces (ADR-0028 as amended 2026-10-26, later).
 * `useState` only, as the first client island was (ADR-0015 decision 7 as
 * amended): nothing here is stored, and the pet and amount live in the URL.
 */

const PAINTING_MS = 3000;

const button =
  "inline-block rounded-cuddly bg-leaf px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep";

/** The amount on the demo's sponsor page, leading to the demo's checkout. */
export function AmountPicker({ pet, initial }: { pet: CrewPet; initial: number }) {
  return (
    <AmountFields initial={initial}>
      {(chosen, valid) =>
        valid ? (
          <Link href={`/demo/${pet.slug}/checkout?amount=${chosen}`} className={button}>
            Continue to checkout · ${chosen}
          </Link>
        ) : (
          <span aria-disabled className={`${button} cursor-not-allowed opacity-50`}>
            Continue to checkout
          </span>
        )
      }
    </AmountFields>
  );
}

/** The keepsake still being painted: what the card shows until it arrives. */
function PaintingUnderWay({ pet }: { pet: CrewPet }) {
  return (
    <div className="relative overflow-hidden rounded-[1rem] bg-card">
      <Image
        src={`/brand/crew/${pet.slug}-painting.jpg`}
        alt=""
        width={PAINTING[0]}
        height={PAINTING[1]}
        sizes="(min-width: 640px) 512px, 90vw"
        className="h-auto w-full blur-md saturate-50 motion-safe:animate-pulse"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/40">
        <span aria-hidden className="text-5xl motion-safe:animate-bounce">
          🖌️
        </span>
        <p className="text-lg font-bold">Painting {pet.name}…</p>
      </div>
    </div>
  );
}

/**
 * The sponsor history's card: the painting under way, revealed a few seconds in
 * (the real one arrives when it is ready). The demo ends here: never bring back
 * example updates or adoption day before attestations exist (ADR-0028 as
 * amended 2026-11-03).
 */
export function SponsorHistoryCard({ pet, amount, sponsoredOn }: { pet: CrewPet; amount: number; sponsoredOn: string }) {
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setArrived(true), PAINTING_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div>
      <div className="rounded-cuddly border-4 border-paw/30 bg-card p-3 shadow-lg">
        <div aria-live="polite" className="relative">
          {arrived ? (
            <Lightbox
              src={`/brand/crew/${pet.slug}-painting.jpg`}
              width={PAINTING[0]}
              height={PAINTING[1]}
              alt={`${pet.name}, painted in watercolour`}
              caption={`${pet.name}, painted in watercolour`}
              label={`See ${pet.name}'s painting larger`}
              className="block w-full rounded-[1rem] motion-safe:animate-[fade-in_500ms_ease-out]"
            >
              <Image
                src={`/brand/crew/${pet.slug}-painting.jpg`}
                alt={`${pet.name}, painted in watercolour`}
                width={PAINTING[0]}
                height={PAINTING[1]}
                sizes="(min-width: 672px) 640px, 90vw"
                className="h-auto w-full rounded-[1rem]"
              />
            </Lightbox>
          ) : (
            <PaintingUnderWay pet={pet} />
          )}
        </div>
        <div className="mt-3 px-1 text-left">
          <p className="text-xl font-bold">{pet.name}</p>
          <p className="text-sm text-muted">
            ${amount} to {pronoun(pet, "their")} shelter · sponsored {sponsoredOn}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted">
        For a real sponsorship the painting takes a while.
      </p>

      <p className="mt-8 text-center text-muted">
        {pet.name}&apos;s real ending: {pronoun(pet, "they")}&apos;s home with us.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href="/animals" className={button}>
          See adoptable animals
        </Link>
      </div>
    </div>
  );
}
