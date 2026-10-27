import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  return name
    .toUpperCase()
    .replace(/^%\s*/, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !LEGAL_FORMS.has(token));
}

function normalizePlace(place: string): string {
  return place.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export interface EinQuery {
  name: string;
  city: string | null;
  state: string;
}

export interface EinCandidate {
  row: BmfRow;
  /** 0–1; honest, not calibrated: Logan reads the row, the score only orders them */
  score: number;
  /** what the score is made of, for the person checking it */
  reasons: string[];
  ein: string;
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
  const dice = want.size + have.size === 0 ? 0 : (2 * shared) / (want.size + have.size);
  const reasons: string[] = [];
  let score = dice * 0.8;
  if (dice === 1) reasons.push("same name");
  else if (shared > 0) reasons.push(`${shared} of ${want.size} name words`);

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
  return { row, score: Math.min(1, Number(score.toFixed(3))), reasons, ein: formatEin(row.ein), nameSimilarity: dice };
}

/**
 * The candidates worth a person's look, best first — at most `limit`, and none
 * whose NAME shares fewer than half its words with the listing, so a shelter
 * the file does not hold comes back as an empty list rather than its
 * least-wrong neighbour. The floor is on the name alone: the city and filing
 * nudges order candidates, and must never lift a one-word overlap into one.
 * The state is a filter because the file is one state's; the city is only a
 * tiebreak, since a rescue files from its treasurer's home.
 */
export function matchEin(
  query: EinQuery,
  rows: readonly BmfRow[],
  options: { limit?: number; nameFloor?: number } = {},
): EinCandidate[] {
  const limit = options.limit ?? 5;
  const nameFloor = options.nameFloor ?? 0.5;
  const state = query.state.toUpperCase();
  return rows
    .filter((row) => row.state.toUpperCase() === state)
    .map((row) => scoreCandidate(query, row))
    .filter((c) => c.nameSimilarity >= nameFloor)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)
    .map(({ row, score, reasons, ein }) => ({ row, score, reasons, ein }));
}
