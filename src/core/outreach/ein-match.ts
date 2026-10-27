import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Which nonprofit a shelter on our list is, proposed from the IRS Exempt
 * Organizations Business Master File (public domain) and CONFIRMED by Logan
 * (ADR-0029 §2). This module ranks candidates and writes nothing: a wrong
 * ranking costs a minute at the check, and the checked EIN is what
 * `shelter_nonprofits` receives, through the Every.org lookup.
 */

/** The columns we read from the BMF's 28; the raw line travels with every candidate so the check can see the rest. */
export interface BmfRow {
  /** nine digits, as the file carries them (leading zeros kept) */
  ein: string;
  name: string;
  /** the in-care-of line, `% SOMEONE`, or empty */
  ico: string;
  city: string;
  state: string;
  zip: string;
  /** `03` is a 501(c)(3) */
  subsection: string;
  /** `1` means contributions are deductible */
  deductibility: string;
  /** NTEE code; `D` is animal-related */
  ntee: string;
  sortName: string;
  line: string;
}

const COLUMNS = ["EIN", "NAME", "ICO", "CITY", "STATE", "ZIP", "SUBSECTION", "DEDUCTIBILITY", "NTEE_CD", "SORT_NAME"] as const;

/**
 * One state's file, e.g. `eo_il.csv`. The IRS has moved these before; the
 * header is checked on every read so a moved or reshaped file fails loudly
 * instead of matching nothing.
 */
export function bmfUrl(state: string): string {
  return `https://www.irs.gov/pub/irs-soi/eo_${state.toLowerCase()}.csv`;
}

export function bmfPath(state: string, dir = "var/irs"): string {
  return path.join(dir, `eo_${state.toLowerCase()}.csv`);
}

/**
 * The state's file under `var/irs/` (gitignored, never committed), fetched
 * once. Returns when it was fetched so the match's `source` can say so.
 */
export async function ensureBmf(
  state: string,
  options: { dir?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ file: string; fetchedAt: Date }> {
  const file = bmfPath(state, options.dir);
  if (!existsSync(file)) {
    const response = await (options.fetchImpl ?? fetch)(bmfUrl(state));
    if (!response.ok) throw new Error(`IRS BMF ${bmfUrl(state)} answered ${response.status}`);
    const text = await response.text();
    parseBmfCsv(text.slice(0, 2000)); // the header, before anything is written
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return { file, fetchedAt: statSync(file).mtime };
}

export function readBmf(file: string): BmfRow[] {
  return parseBmfCsv(readFileSync(file, "utf8"));
}

/** A field is quoted only when it holds a comma or a quote; the BMF rarely does, but the parser allows it. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

export function parseBmfCsv(text: string): BmfRow[] {
  const lines = text.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.trim());
  const at = Object.fromEntries(
    COLUMNS.map((name) => {
      const index = header.indexOf(name);
      if (index < 0) throw new Error(`IRS BMF file has no ${name} column — its layout changed (ADR-0029 §2)`);
      return [name, index];
    }),
  ) as Record<(typeof COLUMNS)[number], number>;

  const rows: BmfRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const cell = (name: (typeof COLUMNS)[number]) => (cells[at[name]] ?? "").trim();
    rows.push({
      ein: cell("EIN"),
      name: cell("NAME"),
      ico: cell("ICO"),
      city: cell("CITY"),
      state: cell("STATE"),
      zip: cell("ZIP"),
      subsection: cell("SUBSECTION"),
      deductibility: cell("DEDUCTIBILITY"),
      ntee: cell("NTEE_CD"),
      sortName: cell("SORT_NAME"),
      line,
    });
  }
  return rows;
}

/** `36-1234567`: the form Every.org and the IRS print; the BMF stores the digits alone, sometimes short of nine. */
export function formatEin(raw: string): string {
  const digits = raw.replace(/\D/g, "").padStart(9, "0");
  if (digits.length !== 9) throw new Error(`not an EIN: '${raw}'`);
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * Words that tell two organisations apart only by legal form, not identity:
 * "PAWS Chicago" and "PAWS CHICAGO INC" are one body. Kept deliberately
 * short — "rescue", "animal" and "humane" DO tell shelters apart.
 */
const LEGAL_FORMS = new Set([
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "CO",
  "LLC",
  "LTD",
  "NFP",
  "THE",
  "OF",
  "AND",
  "A",
  "AN",
]);

export function normalizeOrgName(name: string): string[] {
  const tokens = name
    .toUpperCase()
    .replace(/^%\s*/, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // "A R F" is how the IRS prints some acronyms: one token, like "ARF" —
  // joined before the legal forms go, or the A would be read as an article.
  const joined: string[] = [];
  let runLength = 0;
  for (const token of tokens) {
    if (token.length === 1 && runLength > 0) {
      joined[joined.length - 1] += token;
      runLength++;
      continue;
    }
    joined.push(token);
    runLength = token.length === 1 ? 1 : 0;
  }
  return joined.filter((token) => !LEGAL_FORMS.has(token));
}

const STATE_CODE = /^[A-Z]{2}$/;

/**
 * What a listing may be filed under that its words never share: the
 * acronym in its parentheses ("Animal Rescue Foundation (ARF-IL)" → ARF,
 * the state suffix dropped) and the initials of its own words (ARF again).
 * The IRS holds many bodies by acronym or a DBA alone.
 */
export function acronymsOf(name: string, state?: string): string[] {
  const out = new Set<string>();
  for (const [, inside] of name.matchAll(/\(([^)]*)\)/g)) {
    for (const part of inside.toUpperCase().split(/[^A-Z0-9]+/)) {
      if (part.length >= 2 && part.length <= 6 && !(STATE_CODE.test(part) && part === (state ?? "").toUpperCase())) out.add(part);
    }
  }
  const words = normalizeOrgName(name.replace(/\([^)]*\)/g, " "));
  if (words.length >= 2) {
    const initials = words.map((w) => w[0]).join("");
    if (initials.length <= 6) out.add(initials);
  }
  return [...out];
}

function normalizePlace(place: string): string {
  return place.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export interface EinQuery {
  name: string;
  city: string | null;
  state: string;
  /** the organisation's own site as listed; a platform's domain (Facebook, Petfinder, RescueGroups) is ignored */
  website?: string | null;
}

/** Hosts that are somebody's platform, not the organisation's own name. */
const PLATFORM_HOSTS = /(^|\.)(facebook|fb|instagram|petfinder|rescuegroups|adoptapet|linktr|wixsite|wix|squarespace|weebly|wordpress|blogspot|google|sites|shelterluv|petango|youtube|tiktok|x|twitter|gofundme|paypal)\.(com|org|net|ee|io)$/i;

/**
 * The site's own label, the thing a shelter chose to be known by:
 * `www.touchedbyananimal.org/adopt` → `touchedbyananimal`, `arf-il.org` →
 * `arf`. The IRS name squashed the same way ("TOUCHED BY AN ANIMAL INC" →
 * `touchedbyananimal`) is compared whole, so no word list is needed to cut
 * the run-together text: the file's names are the dictionary.
 */
export function websiteLabel(website: string | null | undefined, state?: string): string | null {
  if (!website) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (PLATFORM_HOSTS.test(host)) return null;
  const parts = host.replace(/^www\./, "").split(".");
  if (parts.length < 2) return null;
  let label = parts[parts.length - 2];
  if (state && label.endsWith(`-${state.toLowerCase()}`)) label = label.slice(0, -3);
  label = label.replace(/[^a-z0-9]/g, "");
  // Three letters is an acronym (arf); under that is noise.
  return label.length >= 3 ? label : null;
}

/** An IRS name as a domain label would be written: letters and digits, the trailing legal form dropped. */
export function squashOrgName(name: string): string {
  const tokens = normalizeOrgName(name);
  return tokens.join("").toLowerCase();
}

/** Whether a site's label is the IRS name itself, or begins with it word for word (a long enough label, so "aurora" never claims Aurora Cares). */
export function labelMatchesName(label: string, name: string): boolean {
  const squashed = squashOrgName(name);
  if (!squashed) return false;
  if (label === squashed) return true;
  const squashedRaw = name.toUpperCase().replace(/[^A-Z0-9]/g, "").toLowerCase();
  if (label === squashedRaw) return true;
  // Only the name beginning with the label, never the label beginning with
  // the name: projecthopearf.org is not every "Project Hope Inc" in the state.
  return label.length >= 10 && (squashed.startsWith(label) || squashedRaw.startsWith(label));
}

export interface EinCandidate {
  row: BmfRow;
  /** 0–1; honest, not calibrated: Logan reads the row, the score only orders them */
  score: number;
  /** what the score is made of, for the person checking it */
  reasons: string[];
  ein: string;
  /** `nearby`: in the listing's city and animal-related, offered although its name matches nothing — a DBA or an acronym the file holds another way */
  via: "name" | "nearby";
}

/** Whether the first candidate is one to trust, or a list to read with suspicion. */
export function matchConfidence(candidates: readonly EinCandidate[]): "strong" | "weak" | "none" {
  const top = candidates[0];
  if (!top) return "none";
  return top.via === "name" && top.score >= 0.7 ? "strong" : "weak";
}

/**
 * Dice over name tokens, the city as a tiebreak, and a nudge for what a
 * shelter files as — never a filter: a rescue under a parent's EIN, or filed
 * under an NTEE code nobody expected, must still surface for the check.
 */
export function scoreCandidate(query: EinQuery, row: BmfRow): EinCandidate & { nameSimilarity: number } {
  const want = new Set(normalizeOrgName(query.name));
  const have = new Set(normalizeOrgName(row.name));
  const shared = [...want].filter((t) => have.has(t)).length;
  let dice = want.size + have.size === 0 ? 0 : (2 * shared) / (want.size + have.size);
  const reasons: string[] = [];
  // Filed under its acronym: "ARF" for "Animal Rescue Foundation (ARF-IL)" — the
  // words share nothing, the identity is the same (found on ARF-IL, 2026-10-27).
  // Only a BMF name that IS the acronym counts: two long names with the same
  // initials (Aurora Animal Care and Control, Asian American Culture Center) are not one body.
  // ... and it must lead a short name: "CARE" inside "Turning Point Behavioral
  // Health Care Center" is a word, not Community Animal Rescue Effort.
  const haveTokens = [...have];
  const acronym = acronymsOf(query.name, query.state).find((a) => haveTokens[0] === a && haveTokens.length <= 3);
  // The site the listing links is often the only bridge from the name a
  // shelter goes by to the one it filed under: touchedbyananimal.org for
  // "Cats-Are-Purrsons-Too" (found 2026-10-27).
  const label = websiteLabel(query.website, query.state);
  if (label && labelMatchesName(label, row.name) && dice < 1) {
    dice = Math.max(dice, 0.95);
    reasons.push(`website ${label}`);
  } else if (acronym && dice < 1) {
    dice = Math.max(dice, 0.9);
    reasons.push(`acronym ${acronym}`);
  } else if (dice === 1) reasons.push("same name");
  else if (shared > 0) reasons.push(`${shared} of ${want.size} name words`);
  let score = dice * 0.8;

  if (query.city && normalizePlace(query.city) === normalizePlace(row.city)) {
    score += 0.1;
    reasons.push("same city");
  }
  if (row.ntee.startsWith("D")) {
    score += 0.05;
    reasons.push(`NTEE ${row.ntee} (animal-related)`);
  }
  if (row.subsection === "03") {
    score += 0.05;
    reasons.push("501(c)(3)");
  }
  if (row.ico) reasons.push(`in care of ${row.ico.replace(/^%\s*/, "")}`);
  return { row, score: Math.min(1, Number(score.toFixed(3))), reasons, ein: formatEin(row.ein), via: "name", nameSimilarity: dice };
}

/**
 * The candidates worth a person's look, best first — at most `limit`, and none
 * whose NAME shares fewer than half its words with the listing, so a shelter
 * the file does not hold comes back as an empty list rather than its
 * least-wrong neighbour. The floor is on the name alone: the city and filing
 * nudges order candidates, and must never lift a one-word overlap into one.
 * The state is a filter because the file is one state's; the city is only a
 * tiebreak, since a rescue files from its treasurer's home. After the named
 * candidates come up to three animal-related bodies in the listing's own
 * city whose names match nothing — the file holds many by a DBA or an
 * acronym, and the person checking can tell "ARF" from "Animal Rescue
 * Foundation" when the matcher cannot.
 */
export function matchEin(
  query: EinQuery,
  rows: readonly BmfRow[],
  options: { limit?: number; nameFloor?: number } = {},
): EinCandidate[] {
  const limit = options.limit ?? 5;
  const nameFloor = options.nameFloor ?? 0.5;
  const state = query.state.toUpperCase();
  const scored = rows.filter((row) => row.state.toUpperCase() === state).map((row) => scoreCandidate(query, row));
  const byName = scored
    .filter((c) => c.nameSimilarity >= nameFloor)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)
    .map(({ row, score, reasons, ein }): EinCandidate => ({ row, score, reasons, ein, via: "name" }));
  if (!query.city) return byName;
  const city = normalizePlace(query.city);
  const taken = new Set(byName.map((c) => c.ein));
  const nearby = scored
    .filter((c) => !taken.has(c.ein) && c.row.ntee.startsWith("D") && normalizePlace(c.row.city) === city)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, 3)
    .map(({ row, score, reasons, ein }): EinCandidate => ({ row, score, reasons: ["in the listing's city and animal-related, the name matching nothing", ...reasons], ein, via: "nearby" }));
  return [...byName, ...nearby];
}
