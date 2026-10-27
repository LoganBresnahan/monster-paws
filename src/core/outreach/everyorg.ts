import { sql } from "drizzle-orm";
import { formatEin } from "@/core/outreach/ein-match";
import type { Db } from "@/db/client";
import { shelterNonprofits, type EveryorgClaim } from "@/db/schema";

/**
 * Every.org's public nonprofit record by EIN (ADR-0029 §2), and the one
 * writer of `shelter_nonprofits`. Read 2026-10-27 against the live API with
 * `everyorg/api-key`: the record carries `hasAdmin`, false for Border Tails
 * Rescue (the unclaimed case ADR-0002 as amended 2026-10-26 records) and true
 * for PAWS Chicago, and `donationsEnabled` is true for both — so `hasAdmin`
 * is the claim, and `donationsEnabled` is not.
 */
export interface EveryorgNonprofit {
  slug: string;
  /** `36-4219778`, the form the donate link and the IRS print */
  ein: string;
  name: string;
  claim: EveryorgClaim;
  profileUrl: string;
  websiteUrl: string | null;
  locationAddress: string | null;
}

export interface EveryorgClient {
  /** `null` when Every.org holds no nonprofit under that EIN — a normal answer, not an error */
  nonprofitByEin(ein: string): Promise<EveryorgNonprofit | null>;
}

const PUBLIC_API = "https://partners.every.org/v0.2";

/**
 * Never collapse a missing or malformed `hasAdmin` into `claimed`: the claim
 * line in the ask is suppressed only on a confirmed claim, and the shelters
 * that most need the line are the ones the API knows least about
 * (ADR-0029 §3).
 */
export function claimOf(record: { hasAdmin?: unknown }): EveryorgClaim {
  if (record.hasAdmin === true) return "claimed";
  if (record.hasAdmin === false) return "unclaimed";
  return "unknown";
}

export function parseNonprofit(body: unknown): EveryorgNonprofit {
  const record = (body as { data?: { nonprofit?: Record<string, unknown> } })?.data?.nonprofit;
  if (!record || typeof record.primarySlug !== "string" || typeof record.ein !== "string" || typeof record.name !== "string") {
    throw new Error("Every.org's nonprofit response has no data.nonprofit with primarySlug, ein and name — its shape changed (ADR-0029 §2)");
  }
  return {
    slug: record.primarySlug,
    ein: formatEin(record.ein),
    name: record.name,
    claim: claimOf(record),
    profileUrl: typeof record.profileUrl === "string" ? record.profileUrl : `https://www.every.org/${record.primarySlug}`,
    websiteUrl: typeof record.websiteUrl === "string" ? record.websiteUrl : null,
    locationAddress: typeof record.locationAddress === "string" ? record.locationAddress : null,
  };
}

export function everyorgClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): EveryorgClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? PUBLIC_API;
  return {
    async nonprofitByEin(ein) {
      const digits = formatEin(ein).replace("-", "");
      const url = `${baseUrl}/nonprofit/${digits}?apiKey=${encodeURIComponent(options.apiKey)}`;
      const response = await fetchImpl(url);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Every.org answered ${response.status} for EIN ${formatEin(ein)}`);
      return parseNonprofit(await response.json());
    },
  };
}

export function everyorgClientFromEnv(env: Record<string, string | undefined> = process.env): EveryorgClient {
  const apiKey = env.EVERYORG_API_KEY;
  if (!apiKey) throw new Error("EVERYORG_API_KEY is not set — `pass show everyorg/api-key` (ADR-0029 §2)");
  return everyorgClient({ apiKey });
}

export interface CheckedMatch {
  shelterExternalId: string;
  nonprofit: EveryorgNonprofit;
  /** the person who read the IRS row and the Every.org record side by side */
  checkedBy: string;
  fetchedAt: Date;
}

/**
 * Writes a match a person confirmed. `shelter_nonprofits` is a fact table
 * with a source and a time, not an event log, so a re-check after a corrected
 * IRS match REPLACES the row (ADR-0029 §2) — the opposite of
 * `outreach_events`, which only ever grows.
 */
export async function recordShelterNonprofit(db: Db, match: CheckedMatch): Promise<void> {
  const values = {
    shelterExternalId: match.shelterExternalId,
    everyorgSlug: match.nonprofit.slug,
    ein: match.nonprofit.ein,
    source: `IRS BMF + every.org, checked by ${match.checkedBy}`,
    fetchedAt: match.fetchedAt,
    everyorgClaim: match.nonprofit.claim,
    claimCheckedAt: match.fetchedAt,
  };
  await db
    .insert(shelterNonprofits)
    .values(values)
    .onConflictDoUpdate({
      target: shelterNonprofits.shelterExternalId,
      set: {
        everyorgSlug: sql`excluded.everyorg_slug`,
        ein: sql`excluded.ein`,
        source: sql`excluded.source`,
        fetchedAt: sql`excluded.fetched_at`,
        everyorgClaim: sql`excluded.everyorg_claim`,
        claimCheckedAt: sql`excluded.claim_checked_at`,
      },
    });
}
