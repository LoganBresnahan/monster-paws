"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const EVERY_MS = 5_000;
const FOR_MS = 2 * 60_000;

/** Re-reads the page while a confirmation may be on its way, then stops, so an open tab never polls forever. */
export function WaitingRefresh() {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > FOR_MS) clearInterval(timer);
      else router.refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
