"use client";

import { useState, type ReactNode } from "react";
import { MIN_AMOUNT } from "@/core/donate/link";

const AMOUNTS = [5, 10, 25];

/** Three suggestions or any whole dollar from Every.org's minimum (ADR-0002 as amended 2026-11-02). `useState` only: nothing here is stored. */
export function AmountFields({
  initial,
  children,
}: {
  initial: number;
  children: (chosen: number, valid: boolean) => ReactNode;
}) {
  const [amount, setAmount] = useState<number>(AMOUNTS.includes(initial) ? initial : 0);
  const [custom, setCustom] = useState(AMOUNTS.includes(initial) ? "" : String(initial));
  const chosen = custom ? Number(custom) : amount;
  const valid = Number.isInteger(chosen) && chosen >= MIN_AMOUNT;

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
        <p className="mt-2 text-sm text-muted">Any amount from ${MIN_AMOUNT}.</p>
      </fieldset>

      <div className="mt-8">{children(chosen, valid)}</div>
    </div>
  );
}
