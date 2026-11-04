"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { startSponsorship } from "@/app/animals/[id]/sponsor/actions";
import { AmountFields } from "@/ui/amount-picker";

const button =
  "inline-block rounded-cuddly bg-leaf px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep disabled:cursor-not-allowed disabled:opacity-50";

/** Disabled once pressed: a second press would mint a second intent for one gift. */
function Continue({ amount, valid }: { amount: number; valid: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!valid || pending} className={button}>
      {valid ? `Continue to Every.org · $${amount}` : "Continue to Every.org"}
    </button>
  );
}

export function SponsorForm({
  animalId,
  name,
  initial,
  unlisted,
  problem,
}: {
  animalId: number;
  name: string;
  initial: number;
  unlisted: boolean;
  problem: string | undefined;
}) {
  return (
    <AmountFields initial={initial}>
      {(chosen, valid) => (
        <form action={startSponsorship}>
          <input type="hidden" name="animalId" value={animalId} />
          <input type="hidden" name="amount" value={chosen} />
          {unlisted && <input type="hidden" name="seenUnlisted" value="1" />}
          <label className="block">
            <span className="font-bold">Your email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              maxLength={254}
              aria-invalid={problem === "email" || problem === "suppressed" || undefined}
              aria-describedby="sponsor-email-help"
              className="mt-2 block w-full rounded-cuddly border-2 border-paw/30 bg-background px-4 py-2 outline-none focus:border-leaf"
            />
          </label>
          {problem === "email" && (
            <p role="alert" className="mt-2 text-sm font-semibold text-foreground">
              That doesn&apos;t look like an email address. Please check it.
            </p>
          )}
          {problem === "suppressed" && (
            <p role="alert" className="mt-2 text-sm font-semibold text-foreground">
              We can&apos;t send email to that address, so our thank-you wouldn&apos;t reach you. This can happen when
              an earlier message bounced or was marked as spam, or you unsubscribed. Please use another address, or write to{" "}
              <a href="mailto:hello@monsterpaws.org" className="underline">
                hello@monsterpaws.org
              </a>{" "}
              and we&apos;ll sort it out.
            </p>
          )}
          {problem === "retry" && (
            <p role="alert" className="mt-2 text-sm font-semibold text-foreground">
              Something went wrong on our side, and nothing was charged. Please try again.
            </p>
          )}
          <p id="sponsor-email-help" className="mt-2 mb-6 text-sm text-muted">
            Where we&apos;d send a painting of {name}, as our thank-you. We use it only for this donation, and erase it once it&apos;s
            delivered unless you keep it in an account.{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy
            </Link>
          </p>
          <Continue amount={chosen} valid={valid} />
          <p className="mt-3 text-sm text-muted">Every.org takes your payment and emails your tax receipt. We never see your card.</p>
        </form>
      )}
    </AmountFields>
  );
}
