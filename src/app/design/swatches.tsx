"use client";

import { useEffect, useState } from "react";
import { COLOR_TOKENS } from "@/ui/tokens";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="flex gap-2">
      {(["system", "light", "dark"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={`rounded-cuddly border-2 px-3 py-1 text-sm font-medium ${
            theme === t
              ? "border-leaf bg-leaf text-white"
              : "border-paw/30 bg-card"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function Swatches() {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      setValues(
        Object.fromEntries(
          COLOR_TOKENS.map((t) => [
            t.name,
            cs.getPropertyValue(`--${t.name}`).trim(),
          ]),
        ),
      );
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", read);
    };
  }, []);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {COLOR_TOKENS.map((t) => (
        <div
          key={t.name}
          className="rounded-cuddly border-2 border-paw/30 bg-card p-3"
        >
          <div
            className="h-16 rounded-cuddly border border-paw/20"
            style={{ background: `var(--${t.name})` }}
          />
          <div className="mt-2 flex items-baseline justify-between">
            <code className="text-sm font-semibold">--{t.name}</code>
            <code className="text-xs text-muted">{values[t.name] ?? "…"}</code>
          </div>
          <p className="mt-1 text-xs text-muted">{t.role}</p>
        </div>
      ))}
    </div>
  );
}
