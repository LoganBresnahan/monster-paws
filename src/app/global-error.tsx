"use client";

import { useEffect } from "react";

/**
 * The last boundary: a crash in the root layout itself lands here, so this
 * page cannot lean on the layout's fonts or anything it loads.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Lazily, like instrumentation-client: a static import would put the SDK
    // back into every visitor's first download (ADR-0010 as amended 2026-09-30).
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground">
        <h1 className="text-3xl font-bold">Something went wrong on our side.</h1>
        <p className="mt-4 max-w-md text-muted">
          We&apos;ve been told about it. Try again in a moment, or head back to the start.
        </p>
        <a href="/" className="mt-8 rounded-cuddly border-2 border-paw px-6 py-3 font-bold">
          ← Monster Paws
        </a>
      </body>
    </html>
  );
}
