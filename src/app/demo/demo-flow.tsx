"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CREW, PAINTING, type CrewPet } from "@/ui/crew";
import { Lightbox } from "@/ui/lightbox";

/**
 * The sponsor loop walked through with the crew (pick → sponsor → keepsake →
 * story). A placeholder end to end: no money moves, nothing is stored, and the
 * crew are already home, so no step may read as a real listing, donation or
 * care event a shelter attested (DIRECTION.md, bright lines). `useState` only,
 * as the first client island was (ADR-0015 decision 7 as amended).
 */
type Stage = "pick" | "sponsor" | "painting" | "keepsake" | "story";

const AMOUNTS = [5, 10, 25];
const PAINTING_MS = 3200;
const STAGES: { key: Stage[]; label: string }[] = [
  { key: ["pick"], label: "Pick" },
  { key: ["sponsor"], label: "Sponsor" },
  { key: ["painting", "keepsake"], label: "Keepsake" },
  { key: ["story"], label: "Story" },
];

function updates(pet: CrewPet) {
  return [
    { emoji: "💉", text: "Vaccinations brought up to date" },
    { emoji: "🦷", text: "A dental cleaning at the vet" },
    { emoji: "🏡", text: `Moved to a foster home while ${pet.she ? "she" : "he"} waits` },
  ];
}

const button =
  "inline-block rounded-cuddly bg-leaf px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep disabled:cursor-not-allowed disabled:opacity-50";
const quiet = "text-sm font-semibold text-muted underline hover:text-foreground";

export function DemoFlow() {
  const [stage, setStage] = useState<Stage>("pick");
  const [pet, setPet] = useState<CrewPet | null>(null);
  const [amount, setAmount] = useState<number | null>(10);
  const [custom, setCustom] = useState("");
  const [shown, setShown] = useState(0);
  const top = useRef<HTMLDivElement>(null);

  const chosen = custom ? Math.floor(Number(custom)) : amount;
  const valid = chosen !== null && Number.isFinite(chosen) && chosen >= 1;

  useEffect(() => {
    if (stage !== "painting") return;
    const t = setTimeout(() => setStage("keepsake"), PAINTING_MS);
    return () => clearTimeout(t);
  }, [stage]);

  // a phone keeps its scroll between stages; bring the new one into view, but never on arrival,
  // or the page opens scrolled past its own heading and logo
  const seen = useRef<Stage>("pick");
  useEffect(() => {
    if (seen.current === stage) return;
    seen.current = stage;
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [stage]);

  const restart = () => {
    setStage("pick");
    setPet(null);
    setAmount(10);
    setCustom("");
    setShown(0);
  };

  return (
    <div ref={top} className="w-full max-w-4xl scroll-mt-4">
      <p className="mx-auto w-fit rounded-full bg-honey/25 px-4 py-1.5 text-sm font-semibold text-foreground">
        Demo: no money moves, and the crew are already home
      </p>

      <ol aria-label="Demo progress" className="mt-6 flex items-center justify-center gap-1.5 text-xs sm:gap-4 sm:text-sm">
        {STAGES.map((s, i) => {
          const current = s.key.includes(stage);
          const done = STAGES.findIndex((x) => x.key.includes(stage)) > i;
          return (
            <li key={s.label} className="flex items-center gap-1.5 sm:gap-4">
              <span
                aria-current={current ? "step" : undefined}
                className={`rounded-full px-2.5 py-1 font-bold whitespace-nowrap sm:px-3 ${
                  current ? "bg-leaf text-white" : done ? "bg-leaf/15 text-leaf-deep" : "bg-paw/10 text-muted"
                }`}
              >
                {done ? "✓ " : ""}
                {s.label}
              </span>
              {i < STAGES.length - 1 && <span aria-hidden className="hidden text-paw/50 sm:inline">→</span>}
            </li>
          );
        })}
      </ol>

      {stage === "pick" && (
        <section className="mt-8">
          <h2 className="text-2xl font-bold">Who would you like to sponsor?</h2>
          <ul className="mt-6 flex flex-wrap justify-center gap-6">
            {CREW.map((p) => (
              <li
                key={p.slug}
                className="flex w-full flex-col overflow-hidden rounded-cuddly border-2 border-paw/30 bg-card text-left shadow-sm sm:w-[calc(50%-0.75rem)] lg:w-[calc((100%-3rem)/3)]"
              >
                <div className="relative aspect-square w-full bg-paw/10">
                  <Image src={`/brand/crew/${p.slug}-thumb.jpg`} alt={`A photo of ${p.name}`} fill sizes="(min-width: 1024px) 290px, (min-width: 640px) 45vw, 90vw" className="object-cover" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="text-xl font-bold">{p.name}</h3>
                  <p className="text-sm text-muted">
                    {p.kind} · {p.age} · {p.she ? "Female" : "Male"}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPet(p);
                      setStage("sponsor");
                    }}
                    className={`${button} mt-4`}
                  >
                    Sponsor {p.name}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stage === "sponsor" && pet && (
        <section className="mx-auto mt-8 max-w-lg rounded-cuddly border-2 border-paw/30 bg-card p-6 text-left shadow-sm">
          <div className="flex items-center gap-4">
            <Image src={`/brand/crew/${pet.slug}-thumb.jpg`} alt="" width={480} height={480} sizes="80px" className="h-20 w-20 rounded-[1rem] object-cover" />
            <div>
              <h2 className="text-2xl font-bold">Sponsor {pet.name}</h2>
              <p className="text-sm text-muted">
                {pet.kind} · {pet.age}
              </p>
            </div>
          </div>
          <fieldset className="mt-6">
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
          </fieldset>
          <p className="mt-5 text-sm text-muted">
            <span className="font-semibold text-foreground">100% goes to {pet.name}&apos;s shelter.</span>{" "}
            In the real thing, this opens Every.org&apos;s secure checkout. We never take a cut.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <button type="button" onClick={restart} className={quiet}>
              ← Pick someone else
            </button>
            <button type="button" disabled={!valid} onClick={() => setStage("painting")} className={button}>
              {valid ? `Donate $${chosen}` : "Donate"}
            </button>
          </div>
        </section>
      )}

      {stage === "painting" && pet && (
        <section aria-live="polite" className="mx-auto mt-8 max-w-lg">
          <div className="relative overflow-hidden rounded-cuddly border-2 border-paw/30 bg-card shadow-sm">
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
          <p className="mt-4 text-sm text-muted">
            Thank you! In the real thing the painting takes a while: it&apos;s made on our own
            computer, and arrives when it&apos;s ready.
          </p>
        </section>
      )}

      {stage === "keepsake" && pet && (
        <section className="mx-auto mt-8 max-w-2xl">
          <h2 className="text-2xl font-bold">{pet.name}&apos;s keepsake is here 🎉</h2>
          <div className="mt-5 rounded-cuddly border-4 border-honey bg-card p-3 shadow-lg">
            <Lightbox
              src={`/brand/crew/${pet.slug}-painting.jpg`}
              width={PAINTING[0]}
              height={PAINTING[1]}
              alt={`${pet.name}, painted in watercolour`}
              caption={`${pet.name}, painted in watercolour`}
              label={`See ${pet.name}'s painting larger`}
              className="block w-full rounded-[1rem]"
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
            <div className="mt-3 flex items-center gap-3 px-1 text-left">
              <Image src={`/brand/crew/${pet.slug}-thumb.jpg`} alt="" width={480} height={480} sizes="56px" className="h-14 w-14 rounded-full border-2 border-card object-cover ring-2 ring-paw/30" />
              <div>
                <p className="text-lg font-bold">{pet.name}</p>
                <p className="text-sm text-muted">
                  ${chosen} to {pet.she ? "her" : "his"} shelter · added to your collection
                </p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted">
            In the real thing you get four paintings to choose from, and pick the one that becomes the card.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" onClick={() => setStage("story")} className={button}>
              What happens next →
            </button>
            <button type="button" onClick={restart} className={quiet}>
              Start over
            </button>
          </div>
        </section>
      )}

      {stage === "story" && pet && (
        <section className="mx-auto mt-8 max-w-2xl text-left">
          <h2 className="text-center text-2xl font-bold">{pet.name}&apos;s story</h2>
          <p className="mt-2 text-center text-muted">
            While {pet.she ? "she" : "he"} waits, you hear about the care your donation helped pay for,
            each update confirmed by the shelter.
          </p>
          <p className="mt-5 text-xs font-bold tracking-wide text-muted uppercase">Example updates</p>
          <ul aria-live="polite" className="mt-2 flex flex-col gap-3">
            {updates(pet)
              .slice(0, shown)
              .map((u) => (
                <li key={u.text} className="flex items-center gap-3 rounded-cuddly border-2 border-paw/20 bg-card px-4 py-3 motion-safe:animate-[fade-in_400ms_ease-out]">
                  <span aria-hidden className="text-2xl">
                    {u.emoji}
                  </span>
                  <span className="flex-1">{u.text}</span>
                  <span className="shrink-0 rounded-full bg-leaf/15 px-3 py-1 text-xs font-bold text-leaf-deep">✓ Confirmed by the shelter</span>
                </li>
              ))}
          </ul>

          {shown > updates(pet).length && (
            <div aria-live="polite" className="mt-6 motion-safe:animate-[fade-in_500ms_ease-out]">
              <div className="relative">
                <Image
                  src={`/brand/crew/${pet.slug}-painting.jpg`}
                  alt={`${pet.name}'s card on adoption day`}
                  width={PAINTING[0]}
                  height={PAINTING[1]}
                  sizes="(min-width: 672px) 640px, 90vw"
                  className="h-auto w-full rounded-[1rem] border-4 border-honey shadow-lg"
                />
                <span className="absolute top-4 left-4 rounded-full bg-honey px-4 py-2 font-bold text-foreground shadow">🎉 Adopted!</span>
              </div>
              <p className="mt-4 rounded-cuddly bg-card px-4 py-3 text-center text-lg font-semibold">
                &ldquo;{pet.name} was adopted today. You were part of that.&rdquo;
              </p>
              <p className="mt-3 text-center text-sm text-muted">
                {pet.name}&apos;s real ending: {pet.she ? "she's" : "he's"} home with us.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            {shown < updates(pet).length && (
              <button type="button" onClick={() => setShown(shown + 1)} className={button}>
                {shown === 0 ? "Show the first update" : "Next update"}
              </button>
            )}
            {shown === updates(pet).length && (
              <button type="button" onClick={() => setShown(shown + 1)} className={button}>
                Adoption day 🎉
              </button>
            )}
            {shown > updates(pet).length && (
              <Link href="/animals" className={button}>
                See adoptable animals
              </Link>
            )}
            <button type="button" onClick={restart} className={quiet}>
              Start over
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
