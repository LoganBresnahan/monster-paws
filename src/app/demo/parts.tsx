"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PAINTING, pronoun, type CrewPet } from "@/ui/crew";
import { Lightbox } from "@/ui/lightbox";

/**
 * The demo's interactive pieces (ADR-0028 as amended 2026-10-26, later).
 * `useState` only, as the first client island was (ADR-0015 decision 7 as
 * amended): nothing here is stored, and the pet and amount live in the URL.
 */

const AMOUNTS = [5, 10, 25];
const PAINTING_MS = 3000;

const button =
  "inline-block rounded-cuddly bg-leaf px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep";

/** The amount on the sponsor page: three suggestions or any whole dollar from $1 (ADR-0027 as amended 2026-10-26). */
export function AmountPicker({ pet, initial }: { pet: CrewPet; initial: number }) {
  const [amount, setAmount] = useState<number>(AMOUNTS.includes(initial) ? initial : 0);
  const [custom, setCustom] = useState(AMOUNTS.includes(initial) ? "" : String(initial));
  const chosen = custom ? Number(custom) : amount;
  const valid = Number.isInteger(chosen) && chosen >= 1;

  return (
    <div>
      <fieldset>
        <legend className="font-bold">Choose an amount</legend>
        <div className="mt-3 flex flex-wrap gap-3">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={!custom && amount === a}
              onClick={() => {
                setAmount(a);
                setCustom("");
              }}
              className={`rounded-cuddly border-2 px-5 py-2 font-bold transition-colors ${
                !custom && amount === a ? "border-leaf bg-leaf text-white" : "border-paw/30 bg-background hover:border-paw"
              }`}
            >
              ${a}
            </button>
          ))}
          <label className="flex items-center gap-1 rounded-cuddly border-2 border-paw/30 bg-background px-3 focus-within:border-leaf">
            <span className="font-bold text-muted">$</span>
            <input
              inputMode="numeric"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
              placeholder="Other"
              aria-label="Another amount, in dollars"
              className="w-20 bg-transparent py-2 font-bold outline-none placeholder:font-normal"
            />
          </label>
        </div>
        <p className="mt-2 text-sm text-muted">Any amount from $1.</p>
      </fieldset>

      <div className="mt-8">
        {valid ? (
          <Link href={`/demo/${pet.slug}/checkout?amount=${chosen}`} className={button}>
            Continue to checkout · ${chosen}
          </Link>
        ) : (
          <span aria-disabled className={`${button} cursor-not-allowed opacity-50`}>
            Continue to checkout
          </span>
        )}
      </div>
    </div>
  );
}

/** The keepsake still being painted: what the collection card shows until it arrives. */
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
        <p className="text-lg font-bold">Painting {pet.name}&apos;s keepsake…</p>
      </div>
    </div>
  );
}

const UPDATES = (pet: CrewPet) => [
  { emoji: "💉", text: "Vaccinations brought up to date" },
  { emoji: "🦷", text: "A dental cleaning at the vet" },
  { emoji: "🏡", text: `Moved to a foster home while ${pronoun(pet, "they")} waits` },
];

/**
 * The collection card: the keepsake being painted, revealed a few seconds in
 * (the real one arrives when it is ready); below, example updates a tap at a
 * time, ending on adoption day.
 */
export function CollectionCard({ pet, amount, sponsoredOn }: { pet: CrewPet; amount: number; sponsoredOn: string }) {
  const [arrived, setArrived] = useState(false);
  // the first update is there when the card opens; the button brings the rest
  const [shown, setShown] = useState(1);
  const updates = UPDATES(pet);
  const adopted = shown > updates.length;

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
              label={`See ${pet.name}'s keepsake larger`}
              className="block w-full rounded-[1rem] motion-safe:animate-[fade-in_500ms_ease-out]"
            >
              <Image
                src={`/brand/crew/${pet.slug}-painting.jpg`}
                alt={`${pet.name}'s keepsake, painted in watercolour`}
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
        For a real sponsorship the painting takes a while, and you keep all four paintings we make of{" "}
        {pronoun(pet, "them")}.
      </p>

      <h2 className="mt-10 text-2xl font-bold">{pet.name}&apos;s story</h2>
      <p className="mt-2 text-muted">
        While {pronoun(pet, "they")} waits, you hear about the care your donation helped pay for, each
        update confirmed by the shelter.
      </p>
      <p className="mt-5 text-xs font-bold tracking-wide text-muted uppercase">Example updates</p>
      <ul aria-live="polite" className="mt-2 flex flex-col gap-3">
        {updates.slice(0, shown).map((u) => (
          <li
            key={u.text}
            className="flex items-center gap-3 rounded-cuddly border-2 border-paw/20 bg-card px-4 py-3 motion-safe:animate-[fade-in_400ms_ease-out]"
          >
            <span aria-hidden className="text-2xl">
              {u.emoji}
            </span>
            <span className="flex-1">{u.text}</span>
            <span className="shrink-0 rounded-full bg-leaf/15 px-3 py-1 text-xs font-bold text-leaf-deep">
              ✓ Confirmed by the shelter
            </span>
          </li>
        ))}
        {/* Adoption is the story's last update, never a frame over the keepsake:
            the painting stays the donor's to share as it is (Logan, 2026-10-26). */}
        {adopted && (
          <li className="flex items-center gap-3 rounded-cuddly border-2 border-honey bg-honey/15 px-4 py-3 motion-safe:animate-[fade-in_500ms_ease-out]">
            <span aria-hidden className="text-2xl">
              🎉
            </span>
            <span className="flex-1 font-semibold">
              {pet.name} was adopted today. You were part of that.
            </span>
            <span className="shrink-0 rounded-full bg-leaf/15 px-3 py-1 text-xs font-bold text-leaf-deep">
              ✓ Confirmed by the shelter
            </span>
          </li>
        )}
      </ul>
      {adopted && (
        <p className="mt-3 text-center text-sm text-muted motion-safe:animate-[fade-in_500ms_ease-out]">
          {pet.name}&apos;s real ending: {pronoun(pet, "they")}&apos;s home with us.
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        {shown < updates.length && (
          <button type="button" onClick={() => setShown(shown + 1)} className={button}>
            Next update
          </button>
        )}
        {shown === updates.length && (
          <button type="button" onClick={() => setShown(shown + 1)} className={button}>
            Adoption day 🎉
          </button>
        )}
        {adopted && (
          <Link href="/animals" className={button}>
            See adoptable animals
          </Link>
        )}
      </div>
    </div>
  );
}
