import { crossTier, resolveClaim, type Claim } from "@/core/trust";
import { MERGED_FIELDS, type AnimalClaims, type AnimalFields } from "@/core/ingest/pipeline";

export interface MergeOutcome {
  /** the claims canonical holds after the merge — the winner per field */
  claims: AnimalClaims;
  /** fields whose VALUE changed (new assertion or replaced value) */
  changed: (keyof AnimalFields)[];
  /** fields whose winning claim changed at all — value OR provenance; what must be written */
  touched: (keyof AnimalFields)[];
  conflicted: (keyof AnimalFields)[];
  /** newest fetchedAt among claims that competed; undefined if none did */
  occurredAt: Date | undefined;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameClaim(a: Claim<unknown>, b: Claim<unknown>): boolean {
  return (
    sameValue(a.value, b.value) &&
    a.source === b.source &&
    a.fetchedAt.getTime() === b.fetchedAt.getTime() &&
    a.rawId === b.rawId
  );
}

/**
 * The one merge (ADR-0013), pure, run by both writers — `memory.ts` and
 * `pg.ts` must never carry their own copy, or the reference stops describing
 * production. Per field: null/undefined claims are skipped; otherwise
 * `resolveClaim(incoming, current)`; a cross-tier disagreement is counted.
 */
export function mergeClaims(
  current: AnimalClaims,
  incoming: AnimalClaims,
  rawId: number,
): MergeOutcome {
  const claims: Record<string, Claim<unknown>> = { ...current };
  const changed: (keyof AnimalFields)[] = [];
  const touched: (keyof AnimalFields)[] = [];
  const conflicted: (keyof AnimalFields)[] = [];
  let occurredAt: Date | undefined;

  for (const field of MERGED_FIELDS) {
    const raw = incoming[field] as Claim<unknown> | undefined;
    // A null claim never competes (ADR-0013): it can't erase a real value,
    // and v1 can't tell absence from retraction.
    if (!raw || raw.value == null) continue;
    const candidate: Claim<unknown> = { ...raw, rawId };
    if (!occurredAt || candidate.fetchedAt.getTime() > occurredAt.getTime()) {
      occurredAt = candidate.fetchedAt;
    }
    const held = current[field] as Claim<unknown> | undefined;
    const winner = held ? resolveClaim(candidate, held) : candidate;
    if (!held || !sameValue(held.value, winner.value)) changed.push(field);
    if (!held || !sameClaim(held, winner)) touched.push(field);
    if (held && crossTier(candidate, held) && !sameValue(held.value, candidate.value)) {
      conflicted.push(field);
    }
    claims[field] = winner;
  }

  return { claims: claims as AnimalClaims, changed, touched, conflicted, occurredAt };
}

/** A canonical row must be able to show a donor something: name and species are the floor (ADR-0013). */
export function viableFirstObservation(claims: AnimalClaims): boolean {
  return claims.name !== undefined && claims.species !== undefined;
}
