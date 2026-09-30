import { reportingOptions } from "@/core/observability";

// The browser SDK is ~57 KB gzipped — a quarter of the site's JavaScript — so
// it never loads up front: this stub queues errors, and the SDK arrives once
// the page is idle, or at once on the first error (ADR-0010 as amended
// 2026-09-30). Never import "@sentry/nextjs" statically from client code, or
// the SDK lands back in every visitor's first download.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const queued: unknown[] = [];
let loading: Promise<void> | null = null;

function onError(event: ErrorEvent) {
  queued.push(event.error ?? new Error(event.message));
  void loadSdk();
}

function onRejection(event: PromiseRejectionEvent) {
  queued.push(event.reason);
  void loadSdk();
}

function loadSdk(): Promise<void> {
  loading ??= import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(
      reportingOptions("app", {
        dsn,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        release: process.env.NEXT_PUBLIC_BUILD_SHA,
      }),
    );
    // The SDK now installs its own handlers; the stub's would report twice.
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    for (const error of queued.splice(0)) Sentry.captureException(error);
  });
  return loading;
}

if (dsn && typeof window !== "undefined") {
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const whenIdle = () =>
    "requestIdleCallback" in window
      ? window.requestIdleCallback(() => void loadSdk(), { timeout: 5000 })
      : setTimeout(() => void loadSdk(), 2000);
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}
