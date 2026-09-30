import * as Sentry from "@sentry/nextjs";
import { reportingOptions } from "@/core/observability";

export function register() {
  // Server and edge read the DSN at run time, so one image serves any
  // environment; only the browser's is baked in at build (instrumentation-client).
  Sentry.init({
    ...reportingOptions("app", {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT,
      release: process.env.BUILD_SHA,
    }),
    // Never attach local source lines to server frames: Better Stack skips
    // source-mapping any frame that already carries them, so our own route
    // code stays minified — proven by probe 2026-09-30 (ADR-0010 as amended).
    integrations: (defaults) => defaults.filter((i) => i.name !== "ContextLines"),
  });
}

export const onRequestError = Sentry.captureRequestError;
