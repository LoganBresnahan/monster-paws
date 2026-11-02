"use client";

import { useFormStatus } from "react-dom";
import { AmountFields } from "@/ui/amount-picker";
import { startTestGift } from "./actions";

const button =
  "inline-block rounded-cuddly bg-leaf px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep disabled:cursor-not-allowed disabled:opacity-50";

/** Disabled once pressed: a second press would mint a second intent for one gift. */
function Donate({ amount, valid }: { amount: number; valid: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!valid || pending} className={button}>
      {valid ? `Donate $${amount} on Every.org` : "Donate on Every.org"}
    </button>
  );
}

export function TestGiftForm({ secret }: { secret: string }) {
  return (
    <AmountFields initial={2}>
      {(chosen, valid) => (
        <form action={startTestGift}>
          <input type="hidden" name="secret" value={secret} />
          <input type="hidden" name="amount" value={chosen} />
          <label className="block">
            <span className="font-bold">Your email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              maxLength={254}
              className="mt-2 mb-6 block w-full rounded-cuddly border-2 border-paw/30 bg-background px-4 py-2 outline-none focus:border-leaf"
            />
          </label>
          <Donate amount={chosen} valid={valid} />
        </form>
      )}
    </AmountFields>
  );
}
