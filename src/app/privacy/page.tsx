import type { Metadata } from "next";
import { ABANDONED_AFTER_DAYS, INTENT_COOKIE_DAYS } from "@/core/donate/intent";
import { CONTACT_EMAIL } from "@/ui/site";
import { SiteLogo } from "@/ui/site-logo";

export const metadata: Metadata = {
  title: "Privacy — Monster Paws",
  description: "What Monster Paws keeps about you, for how long, and how to have it deleted.",
};

const heading = "mt-8 text-xl font-bold";
const paragraph = "mt-2 text-muted";
const list = "mt-2 list-disc space-y-2 pl-6 text-muted";

/**
 * A promise, so each line must stay true of the code (ADR-0027 as amended 2026-11-02):
 * change what a donor table holds, who processes it or how long it stays, and change
 * this page in the same commit.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <SiteLogo />

      <h1 className="mt-8 text-3xl font-bold">Privacy</h1>
      <p className="mt-6 text-lg text-muted">
        Monster Paws helps people sponsor real shelter animals. We keep as little about you as we can.
      </p>

      <h2 className={heading}>Browsing</h2>
      <p className={paragraph}>
        We don&apos;t use analytics or advertising trackers, and we set no cookies while you browse. Cloudflare carries
        this site&apos;s traffic, so it sees your IP address, and its security logs can hold it for a while. Our own
        server keeps no log of visits. Listing photos load directly from RescueGroups, and pages showing them include
        their tracking pixel because their terms require it, so RescueGroups sees those requests. If something breaks,
        an error report goes to our monitoring service, Better Stack, without your name, email or cookie. If it comes
        from your browser, Better Stack sees your IP address, as any site you connect to does.
      </p>

      <h2 className={heading}>When you sponsor an animal</h2>
      <ul className={list}>
        <li>We ask for your email so we can try to send you our thank-you painting. We use it only for this donation.</li>
        <li>
          We pass it to Every.org so you don&apos;t have to type it twice. Every.org handles your payment and receipt,
          and we never see your card. Their privacy policy covers what they hold, and they keep their own donation
          records.
        </li>
        <li>Every.org also tells us your name, your email and any address you gave them. We don&apos;t keep those.</li>
        <li>We set one cookie, so this browser can show your thank-you page. It lasts {INTENT_COOKIE_DAYS} days.</li>
      </ul>
      <p className={paragraph}>
        The painting is our thank-you, and it should reach your inbox once it&apos;s ready. In rare cases, an error or
        something out of our control can stop one being made or sent. If that happens, write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-foreground">
          {CONTACT_EMAIL}
        </a>{" "}
        and we&apos;ll sort it out. Your donation goes to the shelter either way.
      </p>

      <h2 className={heading}>What we keep, and for how long</h2>
      <ul className={list}>
        <li>
          Your email, until the painting has been delivered, and then we erase it. If you start a donation and don&apos;t
          finish it, we erase it after {ABANDONED_AFTER_DAYS} days.
        </li>
        <li>
          Your donation&apos;s record (the amount, date, shelter and Every.org&apos;s charge id), until you ask us to delete
          it. Once your email is erased, nothing in it says who you are.
        </li>
        <li>Totals with nothing about you in them (animal, shelter, amount and day). We keep these permanently, even if you ask us to delete everything else.</li>
        <li>
          If an email to you bounces or is marked as spam, or you unsubscribe, we keep a scrambled marker so we don&apos;t email that address
          again. It isn&apos;t your address, and only someone who already has your address could match it.
        </li>
      </ul>

      <h2 className={heading}>The painting&apos;s own page</h2>
      <p className={paragraph}>
        The painting also gets its own page, so you can share it. Anyone with the link can open that page. It shows the
        painting and the animal&apos;s name, and nothing about you. We take it down if you ask, or if the shelter withdraws
        permission. Paintings we&apos;ve already emailed you stay in your inbox either way.
      </p>

      <h2 className={heading}>If a shelter withdraws permission</h2>
      <p className={paragraph}>
        We stop taking donations for its animals and take down their public pages. For a donation already made, we still try
        to paint our thank-you, and we delete the photos once that&apos;s done. Paintings already sent, with the animal&apos;s
        name, breed and age, can&apos;t be recalled.
      </p>

      <h2 className={heading}>If you make an account</h2>
      <p className={paragraph}>We keep your email and your donations until you delete it.</p>

      <h2 className={heading}>Who helps us</h2>
      <p className={paragraph}>
        Every.org (donations), Resend (email we send), Google (email you send us), DigitalOcean and Cloudflare (hosting
        and storage), Better Stack (error reports).
      </p>

      <h2 className={heading}>Deleting your data</h2>
      <p className={paragraph}>
        Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-foreground">
          {CONTACT_EMAIL}
        </a>{" "}
        and we&apos;ll do it by hand. Once your email has been erased, we can&apos;t look you up by it, so please include
        your Every.org receipt.
      </p>

      <p className="mt-10 text-sm text-muted">Last changed 4 November 2026.</p>
    </main>
  );
}
