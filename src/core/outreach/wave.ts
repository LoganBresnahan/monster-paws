import { inArray, isNotNull, and } from "drizzle-orm";
import { renderAsk, type AskInput } from "@/core/outreach/template";
import { sendWave, type WaveMessage, type WaveSendOptions, type WaveSendReport } from "@/core/outreach/send";
import type { OutreachShelter } from "@/core/outreach/list";
import type { MailTransport } from "@/core/outreach/transport";
import type { Db } from "@/db/client";
import { shelterContacts, shelterNonprofits, type EveryorgClaim } from "@/db/schema";

/**
 * A wave's messages, assembled from the record (ADR-0029 §3): each shelter's
 * ask rendered with its claim from `shelter_nonprofits` and the hackathon
 * clause as the caller's input. Addresses are NOT here — the guard reads
 * them (ADR-0029 §2).
 */
export interface WaveShelterStatus {
  claim: EveryorgClaim;
  everyorgProfileUrl: string | null;
  confirmedAddress: string | null;
}

/** What `list` shows beside each shelter: matched or not, claimed or not, an address confirmed or not. */
export async function shelterStatuses(db: Pick<Db, "select">, shelters: readonly OutreachShelter[]): Promise<Map<string, WaveShelterStatus>> {
  const ids = shelters.map((s) => s.shelterExternalId);
  const statuses = new Map<string, WaveShelterStatus>(ids.map((id) => [id, { claim: "unknown", everyorgProfileUrl: null, confirmedAddress: null }]));
  if (ids.length === 0) return statuses;
  const nonprofits = await db
    .select({ id: shelterNonprofits.shelterExternalId, slug: shelterNonprofits.everyorgSlug, claim: shelterNonprofits.everyorgClaim })
    .from(shelterNonprofits)
    .where(inArray(shelterNonprofits.shelterExternalId, ids));
  for (const row of nonprofits) {
    const status = statuses.get(row.id)!;
    status.claim = row.claim;
    status.everyorgProfileUrl = `https://www.every.org/${row.slug}`;
  }
  const contacts = await db
    .select({ id: shelterContacts.shelterExternalId, email: shelterContacts.email, at: shelterContacts.confirmedAt })
    .from(shelterContacts)
    .where(and(inArray(shelterContacts.shelterExternalId, ids), isNotNull(shelterContacts.confirmedAt)))
    .orderBy(shelterContacts.confirmedAt, shelterContacts.email);
  // Ordered ascending, so the last write wins: the most recently confirmed, as `confirmedAddress` picks it.
  for (const row of contacts) statuses.get(row.id)!.confirmedAddress = row.email;
  return statuses;
}

export interface AssembleOptions {
  sender: { name: string; role: string; email: string };
  timing: AskInput["timing"];
  /** the `From` header; the signature's address is `sender.email` */
  from: string;
  origin?: string;
}

export async function assembleWave(db: Pick<Db, "select">, shelters: readonly OutreachShelter[], options: AssembleOptions): Promise<WaveMessage[]> {
  const statuses = await shelterStatuses(db, shelters);
  return shelters.map((shelter) => {
    const status = statuses.get(shelter.shelterExternalId)!;
    const rendered = renderAsk({
      shelter,
      claim: status.claim,
      everyorgProfileUrl: status.everyorgProfileUrl,
      timing: options.timing,
      sender: options.sender,
      origin: options.origin,
    });
    return { shelterExternalId: shelter.shelterExternalId, mail: { from: options.from, ...rendered } };
  });
}

class Rehearsed extends Error {
  constructor(public readonly report: WaveSendReport) {
    super("rehearsal rolled back");
  }
}

/**
 * The whole wave through the real guard and the real loop, into Mailpit,
 * inside one transaction that is rolled back: the record is read, judged
 * against and written exactly as a live run would, and keeps none of it. The
 * clock advances by what the loop would have slept, so forty messages take
 * seconds and the minute's spacing still shows in the rows it would write.
 */
export async function rehearseWave(
  db: Db,
  wave: string,
  messages: readonly WaveMessage[],
  options: { transport: MailTransport; now?: () => Date; exclusions?: WaveSendOptions["exclusions"] },
): Promise<WaveSendReport> {
  const start = (options.now ?? (() => new Date()))().getTime();
  let offset = 0;
  try {
    await db.transaction(async (tx) => {
      const report = await sendWave(tx, wave, messages, {
        transport: options.transport,
        now: () => new Date(start + offset),
        sleep: async (ms) => {
          offset += ms;
        },
        exclusions: options.exclusions,
      });
      throw new Rehearsed(report);
    });
  } catch (error) {
    if (error instanceof Rehearsed) return error.report;
    throw error;
  }
  throw new Error("unreachable: a rehearsal always rolls back");
}
