import { createHash } from "node:crypto";

/**
 * The evidence line for a `SHELTER_EXCLUSIONS` entry (ADR-0029 as amended
 * 2026-10-27): the reply's Message-ID and the SHA-256 of the raw message as
 * exported, headers included — the DKIM-signed original, kept in the vault.
 * Computed from the file so the entry and the vault cannot disagree by hand.
 */
export interface Evidence {
  messageId: string;
  sha256: string;
  /** the `evidence` field as it goes into the entry */
  line: string;
  from: string | null;
  date: string | null;
}

export function evidenceOf(raw: Buffer | string): Evidence {
  const bytes = typeof raw === "string" ? Buffer.from(raw) : raw;
  const text = bytes.toString("utf8");
  const headers = text.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, " ");
  const header = (name: string): string | null => {
    const match = new RegExp(`^${name}:[ \\t]*(.+)$`, "im").exec(headers);
    return match ? match[1].trim() : null;
  };
  const messageId = header("Message-ID");
  if (!messageId || !/^<[^\s<>]+@[^\s<>]+>$/.test(messageId)) {
    throw new Error("the file has no Message-ID header — export the raw message (Gmail: Show original → Download original), not a copy of its text");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { messageId, sha256, line: `${messageId} sha256:${sha256}`, from: header("From"), date: header("Date") };
}
