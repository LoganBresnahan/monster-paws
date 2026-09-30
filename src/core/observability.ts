/**
 * The one set of error-reporting options every runtime shares — server, edge,
 * browser and worker (ADR-0010 as amended 2026-09-29). The SDK is Sentry's and
 * the destination is whatever DSN is set, so the provider stays a config value.
 */

export type Component = "app" | "worker";

export interface ReportingEnv {
  dsn: string | undefined;
  environment: string | undefined;
  release: string | undefined;
}

export function reportingOptions(component: Component, env: ReportingEnv) {
  return {
    dsn: env.dsn,
    // No DSN, no reporting: local dev and CI's e2e send nothing, so a
    // development event can never page anyone (ADR-0010 as amended).
    enabled: Boolean(env.dsn),
    environment: env.environment ?? "production",
    release: env.release,
    // Fixed by ADR-0010, never by a wizard: no tracing in v1, no session
    // replay, and identifiers — never identities — leave the process.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    initialScope: { tags: { component } },
  };
}
