import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { visibleAnimalById } from "@/core/animals";
import { isDisplayLicensed, pickLicensedDisplay } from "@/core/display";
import { INTENT_COOKIE, INTENT_COOKIE_DAYS, intentDonorEmail, intentIdsOf, intentRef, thankYouIntent } from "@/core/donate/intent";
import { donationsForIntents } from "@/core/donate/webhook";
import { paintingMailState } from "@/core/email/painting-state";
import { isSuppressed, suppressionKey } from "@/core/email/suppression";
import { intentPaints, shareTokenOfIntent } from "@/core/keepsake";
import { getDb } from "@/db/client";
import { animalDisplay, animals } from "@/db/schema";
import { speciesEmoji, TrackerPixel } from "@/ui/animal";
import { AnimalGallery } from "@/ui/animal-gallery";
import { CONTACT_EMAIL } from "@/ui/site";
import { SiteLogo } from "@/ui/site-logo";
import { WaitingRefresh } from "@/ui/waiting-refresh";
import { fixDonorEmail } from "./actions";

export const metadata: Metadata = { title: "Thank you — Monster Paws", robots: { index: false } };

const button =
  "mx-auto mt-8 inline-block rounded-cuddly bg-leaf px-8 py-3 text-lg font-bold text-white shadow-md transition-colors hover:bg-leaf-deep";

/**
 * Back from Every.org. Anyone can open this URL, so it says money moved only when
 * the webhook recorded it under an intent in this browser's cookie, never because
 * someone arrived here (ADR-0027 §4–5).
 */
export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Before getDb(), always: reading the cookie is what tells Next this page is dynamic, and a
  // build has no database, so the other order fails CI and the image while passing locally.
  const intentIds = intentIdsOf((await cookies()).get(INTENT_COOKIE)?.value);
  const db = getDb();
  const asOf = new Date();
  const subject = await thankYouIntent(db, intentIds, asOf);

  if (!subject) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12 text-center">
        <SiteLogo />
        <h1 className="mt-10 text-4xl font-bold">Thank you! 💛</h1>
        <p className="mt-3 text-lg text-muted">We can&apos;t find a donation from this browser. Every.org emails a receipt for each one.</p>
        <Link href="/animals" className={button}>
          See adoptable animals
        </Link>
      </main>
    );
  }

  const [donation] = await donationsForIntents(db, [subject.intentId]);
  const donorEmail = await intentDonorEmail(db, subject.intentId);
  const mail = await paintingMailState(db, subject.intentId);
  const mailGone = mail === "sent" || mail === "on-its-way";
  const key = suppressionKey();
  // Never promise a mail the sweep will refuse: it can't send here until the address changes (ADR-0027 as amended 2026-11-02, decision 7).
  const blocked = mail === "not-sent" && Boolean(donorEmail) && key !== null && (await isSuppressed(db, donorEmail!, key));
  // The form only while a new address can still change where the mail goes (ADR-0027 as amended 2026-11-02, decision 4).
  const takesAddress = mail === "bounced" || (mail === "not-sent" && Boolean(donorEmail));
  // Never say we're painting for a donation the sweep would refuse, as a test gift or an ungranted listing would be (ADR-0006 decision 6).
  const paints = await intentPaints(db, subject.intentId);
  // Only once the mail has gone: the page 404s until its set is published (ADR-0036).
  const shareToken = mail === "sent" ? await shareTokenOfIntent(db, subject.intentId) : null;
  const { problem, saved } = await searchParams;
  const name = subject.name ?? "your animal";
  const shelter = subject.org ?? donation?.nonprofitName ?? "the shelter";

  // Only a listed animal's photo, and only under its licence: a gift outlives its listing,
  // and a shelter's takedown must close this page's photo too (ADR-0015 decision 3, ADR-0029 §5).
  const [listed] = subject.animalId
    ? await db.select({ id: animals.id }).from(animals).where(visibleAnimalById(subject.animalId, asOf)).limit(1)
    : [];
  const display = listed ? await db.select().from(animalDisplay).where(eq(animalDisplay.animalId, listed.id)) : [];
  const licensed = pickLicensedDisplay(display, asOf);
  const tracker = display.find((row) => row.source === "rescuegroups" && isDisplayLicensed(row.source, asOf))?.trackerUrl;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12 text-center">
      <SiteLogo />

      <h1 className="mt-10 text-4xl font-bold">Thank you! 💛</h1>
      {donation ? (
        <p className="mt-3 text-lg text-muted">
          Your ${donation.amount.replace(/\.00$/, "")} is on its way to {shelter}, for {name}.
        </p>
      ) : (
        <>
          <p role="status" className="mt-3 text-lg text-muted">
            We&apos;re waiting for Every.org to confirm your donation to {shelter}. This page updates when it does.
          </p>
          <WaitingRefresh />
        </>
      )}

      <div className="mt-8">
        {licensed && licensed.photos.length > 0 ? (
          <AnimalGallery photos={licensed.photos.slice(0, 1)} name={name} />
        ) : (
          <div
            aria-hidden
            className="mx-auto flex max-w-md items-center justify-center rounded-cuddly border-2 border-paw/30 bg-paw/10 py-16 text-7xl"
          >
            {speciesEmoji(subject.species ?? "")}
          </div>
        )}
      </div>

      {mail === "bounced" && (
        <p role="status" className="mt-4 font-semibold text-foreground">
          We couldn&apos;t deliver {name}&apos;s painting to the address you gave. Tell us a new one and we&apos;ll try again.
        </p>
      )}

      {mailGone && (
        <p className="mt-4 text-muted">
          {name}&apos;s painting is on its way to your inbox. If it doesn&apos;t arrive, check your spam folder or Promotions tab, or write to{" "}
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      )}

      {shareToken && (
        <p className="mt-2 text-muted">
          <Link className="underline hover:text-foreground" href={`/share/${shareToken}`}>
            You can view the paintings here.
          </Link>
        </p>
      )}

      {mail === "held" && (
        <p role="status" className="mt-4 font-semibold text-foreground">
          We hit a problem sending {name}&apos;s painting, and we&apos;re looking into it. You can write to{" "}
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      )}

      {mail === "not-sent" && paints && donorEmail && !blocked && (
        <p className="mt-4 text-muted">
          {donation ? (
            <>
              As our thank-you, we&apos;re painting {name} now, and we&apos;ll email it to{" "}
              <span className="font-semibold text-foreground">{donorEmail}</span> when it&apos;s ready.
            </>
          ) : (
            <>
              Once Every.org confirms your donation, we&apos;ll try to paint {name} as our thank-you and email it to{" "}
              <span className="font-semibold text-foreground">{donorEmail}</span>.
            </>
          )}{" "}
          Please check that&apos;s right: it&apos;s the only place we&apos;d send it.
        </p>
      )}

      {mail === "not-sent" && !paints && (
        <p className="mt-4 text-muted">
          We&apos;re still teaching our painter, so there&apos;s no watercolour of {name} yet and no date for one.
          {donorEmail && !blocked && (
            <>
              {" "}
              When it&apos;s ready we&apos;ll email it to <span className="font-semibold text-foreground">{donorEmail}</span>.
              Please check that&apos;s right: it&apos;s the only place we&apos;ll send it.
            </>
          )}
        </p>
      )}

      {problem === "sent" && (
        <p role="alert" className="mt-2 text-sm font-semibold text-foreground">
          {name}&apos;s painting had already gone out, so that change wasn&apos;t saved. If it doesn&apos;t arrive, write to {CONTACT_EMAIL}.
        </p>
      )}

      {saved === "1" && donorEmail && takesAddress && (
        <p role="status" className="mt-2 text-sm font-semibold text-foreground">
          Saved.
        </p>
      )}

      {/* In place of a confirmation email: the page is how a typo gets caught (ADR-0027 as amended 2026-11-02). */}
      {takesAddress && (
        <details open={Boolean(problem) || mail === "bounced" || blocked} className="mt-3 text-sm text-muted">
          <summary className="cursor-pointer underline hover:text-foreground">Not the right address?</summary>
          <form action={fixDonorEmail} className="mx-auto mt-3 flex max-w-md flex-col gap-2 sm:flex-row">
            <input type="hidden" name="gift" value={intentRef(subject.intentId)} />
            <label className="flex-1 text-left">
              <span className="sr-only">Your email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                maxLength={254}
                defaultValue={donorEmail ?? ""}
                aria-invalid={problem === "email" || problem === "suppressed" || blocked || undefined}
                className="block w-full rounded-cuddly border-2 border-paw/30 bg-background px-4 py-2 text-foreground outline-none focus:border-leaf"
              />
            </label>
            <button
              type="submit"
              className="rounded-cuddly bg-leaf px-5 py-2 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep"
            >
              Save
            </button>
          </form>
          {problem === "email" && (
            <p role="alert" className="mt-2 font-semibold text-foreground">
              That doesn&apos;t look like an email address. Please check it.
            </p>
          )}
          {(problem === "suppressed" || blocked) && (
            <p role="alert" className="mt-2 font-semibold text-foreground">
              We can&apos;t send email to that address, so our thank-you wouldn&apos;t reach you. This can happen when an
              earlier message bounced or was marked as spam, or you unsubscribed. Please use another address, or write to {CONTACT_EMAIL} and
              we&apos;ll sort it out.
            </p>
          )}
          {problem === "retry" && (
            <p role="alert" className="mt-2 font-semibold text-foreground">
              Something went wrong on our side, and nothing changed. Please try again.
            </p>
          )}
        </details>
      )}

      {/* The URL carries no id, so a bookmark works only where the cookie lives: never promise more than this (ADR-0027 as amended 2026-11-02). */}
      {takesAddress && (
        <p className="mt-4 text-sm text-muted">
          Bookmark this page for now, so you can change the address if you need to. This page only
          lasts {INTENT_COOKIE_DAYS} days after your donation, and only in this browser.
        </p>
      )}

      <Link href={listed ? `/animals/${listed.id}` : "/animals"} className={button}>
        {listed ? `Back to ${name}` : "See adoptable animals"}
      </Link>
      {listed && (
        <Link href="/animals" className="mx-auto mt-3 text-sm text-muted underline hover:text-foreground">
          See more animals
        </Link>
      )}

      {tracker && <TrackerPixel src={tracker} />}
    </main>
  );
}
