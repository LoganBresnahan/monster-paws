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

const SECRET_IN_PATH = /(\/api\/webhooks\/everyorg\/|\/test-gift\/)[^"/?#\s\\]+/g;
const EMAIL_ADDRESS = /[^\s"<>(),;:\\/?&=]+(?:@|%40)[^\s"'<>(),;:\\/?&=]+\.[^\s"'<>(),;:\\/?&=]+/g;
/** Drizzle ends a failed query's message with its parameters, and on the donor tables those are an intent id or an address. */
const QUERY_PARAMS = /\bparams: .*/g;

export function scrubAddresses(text: string): string {
  return text.replace(EMAIL_ADDRESS, "<email>");
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    return scrubAddresses(value.replace(SECRET_IN_PATH, "$1<secret>")).replace(QUERY_PARAMS, "params: <removed>");
  }
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [scrubValue(key) as string, scrubValue(inner)]));
  }
  return value;
}

/**
 * The last line behind `DATA_COLLECTION`: every string in the event, since the SDK copies
 * the request URL into several places and the webhook's and test page's paths hold secrets
 * (ADR-0027 §4). Walks values and never the JSON text, where a regex eats the `n` of an
 * escaped newline: the parse then throws and the SDK silently drops the report. Identifiers
 * leave this process, never identities (ADR-0010).
 */
export function scrubEvent<T>(event: T): T {
  const plain = scrubValue(JSON.parse(JSON.stringify(event))) as {
    user?: unknown;
    request?: { cookies?: unknown; data?: unknown; query_string?: unknown };
  };
  delete plain.user;
  if (plain.request) {
    delete plain.request.cookies;
    delete plain.request.data;
    delete plain.request.query_string;
  }
  return plain as T;
}

/**
 * Never remove this for `sendDefaultPii`, which SDK 11 ignores: unset, the SDK sends the
 * visitor's IP, every cookie (the intent id among them, which opens a donor's address on
 * `/thanks`), and request bodies (ADR-0010 as amended 2026-11-02).
 */
const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "content-type"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
};

/**
 * What may be reported of a failed query. Never the error itself: its message carries
 * the query's parameters, which on the donor tables are a name or an email (ADR-0010).
 */
export function failureCode(err: unknown): string {
  const { cause, code } = err as { cause?: { code?: unknown }; code?: unknown };
  const found = cause?.code ?? code;
  return typeof found === "string" ? found : "unknown";
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
    dataCollection: DATA_COLLECTION,
    initialScope: { tags: { component } },
    beforeSend: scrubEvent,
  };
}
