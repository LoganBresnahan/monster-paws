import type { Metadata } from "next";
import { inboxOfToken, suppressionKey } from "@/core/email/suppression";
import { CONTACT_EMAIL } from "@/ui/site";
import { SiteLogo } from "@/ui/site-logo";

export const metadata: Metadata = {
  title: "Stop emails — Monster Paws",
  robots: { index: false },
  referrer: "no-referrer",
};

const button =
  "mt-6 inline-block rounded-cuddly bg-leaf px-8 py-3 text-lg font-bold text-white shadow-md transition-colors hover:opacity-90";

/** Reading this page changes nothing; only the button's POST does (ADR-0035, question 6). */
export default async function UnsubscribeConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const key = suppressionKey();
  const valid = key !== null && inboxOfToken(token, key) !== null;
  const contact = <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <SiteLogo />
      {!valid ? (
        <>
          <h1 className="mt-8 text-3xl font-bold">This link doesn&apos;t work</h1>
          <p className="mt-4 text-lg text-muted">To stop our emails, write to {contact} and we&apos;ll sort it out.</p>
        </>
      ) : done === "1" ? (
        <>
          <h1 className="mt-8 text-3xl font-bold">Done</h1>
          <p className="mt-4 text-lg text-muted">
            We won&apos;t email this address again, even about a painting we&apos;re still working on. If you change your
            mind, write to {contact}.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-8 text-3xl font-bold">Stop emails from Monster Paws?</h1>
          <p className="mt-4 text-lg text-muted">
            We won&apos;t email this address again, even about a painting we&apos;re still working on, and we&apos;ll erase
            this address from any donation it&apos;s on.
          </p>
          <form method="post" action={`/unsubscribe/${token}`}>
            <input type="hidden" name="confirm" value="yes" />
            <button type="submit" className={button}>
              Stop emails
            </button>
          </form>
        </>
      )}
    </main>
  );
}
