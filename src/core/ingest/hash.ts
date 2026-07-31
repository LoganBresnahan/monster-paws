import { createHash } from "node:crypto";

/**
 * Content hashing for dedup (ADR-0009). Instability here is the trap in both
 * directions: a hash that collides across different payloads silently drops
 * corpus signal, and one that never matches bloats the corpus with identical
 * rows — so serialization must be canonical, never `JSON.stringify` directly.
 */

const ALGORITHM = "sha256";

function canonicalize(value: unknown, exclude: ReadonlySet<string>, path: string): string {
  if (value === null || value === undefined) return "null";

  if (Array.isArray(value)) {
    // Array order is meaningful — never sort. Elements share the parent's
    // `[]` path so an exclusion can target a field inside every element.
    const items = value.map((item) => canonicalize(item, exclude, `${path}[]`));
    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    const entries: string[] = [];
    // Sorted keys are the whole point: two fetches of the same record must
    // hash identically regardless of the order the source serialized them.
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const child = path ? `${path}.${k}` : k;
      if (exclude.has(child)) continue;
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      entries.push(`${JSON.stringify(k)}:${canonicalize(v, exclude, child)}`);
    }
    return `{${entries.join(",")}}`;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`non-finite number at '${path || "<root>"}' — payload is not JSON-safe`);
  }

  return JSON.stringify(value);
}

/** Deterministic serialization: sorted object keys, preserved array order. */
export function canonicalJson(payload: unknown, exclude: readonly string[] = []): string {
  return canonicalize(payload, new Set(exclude), "");
}

/**
 * The dedup key. `exclude` drops volatile paths (request ids, server clocks)
 * that would otherwise change every fetch and defeat dedup entirely — the raw
 * payload is still stored verbatim, so nothing is lost by omitting them here.
 * Dotted from the root; `items[].updatedAt` targets a field in every element.
 *
 * Algorithm-prefixed so a future change is visible in the corpus rather than
 * silently making every row look modified.
 */
export function contentHashOf(payload: unknown, exclude: readonly string[] = []): string {
  const digest = createHash(ALGORITHM).update(canonicalJson(payload, exclude)).digest("hex");
  return `${ALGORITHM}:${digest}`;
}
