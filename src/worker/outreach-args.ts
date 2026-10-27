import { CHICAGOLAND, WAVE_MAX, WAVE_NAME, type WaveSpec } from "@/core/outreach/list";
import { isOutreachEventKind } from "@/core/outreach/events";
import type { OutreachEventKind } from "@/db/schema";

/**
 * The outreach CLI's arguments, parsed with no database and no network so a
 * test can pin every refusal (ADR-0029 §4): `send --live` without a wave, a
 * wave with no region, a kind the ADR does not name.
 */
export type OutreachArgs =
  | { command: "list"; wave: WaveSpec | null }
  | { command: "match"; shelter: string }
  | { command: "find-emails"; shelter: string }
  | { command: "preview"; shelter: string }
  | { command: "prepare"; wave: WaveSpec }
  | { command: "send"; wave: WaveSpec; live: boolean; override: string | null; skip: string[] }
  | {
      command: "record";
      shelter: string;
      wave: string;
      kind: OutreachEventKind;
      messageId: string | null;
      note: string | null;
      at: Date | null;
      eml: string | null;
    }
  | { command: "status" };

export const USAGE = [
  "usage: outreach list [--wave <name> --zip <zip> --miles <n> | --states IL,WI] [--limit <n>]",
  "       outreach match <shelter-key>",
  "       outreach find-emails <shelter-key>",
  "       outreach preview <shelter-key>",
  "       outreach prepare --wave <name> [--zip <zip> --miles <n> | --states IL,WI] [--limit <n>]",
  "       outreach send --wave <name> [--zip <zip> --miles <n> | --states IL,WI] [--limit <n>] [--skip <key,key>] [--live] [--override <note>]",
  "       outreach record <shelter-key> --wave <name> --kind sent|bounced|replied|opted_out|granted [--message-id <id>] [--note <text>] [--at <iso>] [--eml <file>]",
  "       outreach status",
  "a shelter key is animals.shelter_external_id, e.g. rescuegroups:org:3077; chicagoland-1 needs no region",
].join("\n");

function flags(args: readonly string[]): { positional: string[]; flag: Map<string, string | true> } {
  const positional: string[] = [];
  const flag = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flag.set(arg, next);
      i++;
    } else {
      flag.set(arg, true);
    }
  }
  return { positional, flag };
}

function text(flag: Map<string, string | true>, name: string): string | null {
  const value = flag.get(name);
  if (value === undefined) return null;
  if (value === true || !value.trim()) throw new Error(`${name} needs a value`);
  return value;
}

function waveSpec(flag: Map<string, string | true>, required: boolean): WaveSpec | null {
  const name = text(flag, "--wave");
  const zip = text(flag, "--zip");
  const miles = text(flag, "--miles");
  const states = text(flag, "--states");
  const limit = text(flag, "--limit");
  if (!name) {
    if (required) throw new Error("--wave <name> is required: every send is a named wave (ADR-0029 §1)");
    if (zip || miles || states || limit) throw new Error("a region needs a wave name: --wave <name>");
    return null;
  }
  if (!WAVE_NAME.test(name)) throw new Error(`wave name '${name}' is not lowercase kebab-case`);
  const spec: WaveSpec = { name };
  if (zip || miles) {
    if (!zip || !miles) throw new Error("--zip and --miles go together");
    if (!/^\d{5}$/.test(zip)) throw new Error(`--zip takes five digits, not '${zip}'`);
    const n = Number(miles);
    if (!(n > 0 && n <= 500)) throw new Error(`--miles takes a distance in (0, 500], not '${miles}'`);
    spec.within = { zip, miles: n };
  }
  if (states) {
    const list = states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length === 0 || list.some((s) => !/^[A-Z]{2}$/.test(s))) throw new Error(`--states takes two-letter codes, e.g. IL,WI, not '${states}'`);
    if (spec.within) throw new Error("a wave is a radius or states, not both");
    spec.states = list;
  }
  if (limit) {
    const n = Number(limit);
    if (!(Number.isInteger(n) && n > 0 && n <= WAVE_MAX)) throw new Error(`--limit takes a whole number up to ${WAVE_MAX}, not '${limit}'`);
    spec.limit = n;
  }
  if (!spec.within && !spec.states) {
    if (name === CHICAGOLAND.name) return { ...CHICAGOLAND, limit: spec.limit };
    throw new Error(`wave '${name}' names no region — --zip/--miles or --states (ADR-0029 §1)`);
  }
  return spec;
}

const SHELTER_KEY = /^[a-z0-9-]+(?::[a-z0-9-]+)?:org:[^\s]+$/;

export function parseOutreachArgs(args: readonly string[]): OutreachArgs {
  const [command, ...rest] = args;
  const { positional, flag } = flags(rest);
  const shelter = () => {
    const key = positional[0];
    if (!key || !SHELTER_KEY.test(key)) {
      throw new Error(`${command} takes a shelter key like rescuegroups:org:3077\n${USAGE}`);
    }
    return key;
  };

  switch (command) {
    case "list":
      return { command, wave: waveSpec(flag, false) };
    case "match":
    case "find-emails":
    case "preview":
      return { command, shelter: shelter() };
    case "prepare":
      return { command, wave: waveSpec(flag, true)! };
    case "send": {
      const live = flag.get("--live") === true;
      const override = text(flag, "--override");
      if (override !== null && !live) throw new Error("--override only means something with --live");
      // Shelters held out of this run by hand — a city department whose ask would not fit, say — never a filter on the list itself.
      const skip = (text(flag, "--skip") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
      for (const key of skip) if (!SHELTER_KEY.test(key)) throw new Error(`--skip takes shelter keys like rescuegroups:org:3077, not '${key}'`);
      return { command, wave: waveSpec(flag, true)!, live, override, skip };
    }
    case "record": {
      const key = shelter();
      const wave = text(flag, "--wave");
      if (!wave || !WAVE_NAME.test(wave)) throw new Error("record needs --wave <name>, lowercase kebab-case");
      const kind = text(flag, "--kind");
      if (!kind || !isOutreachEventKind(kind)) throw new Error("record needs --kind sent|bounced|replied|opted_out|granted (ADR-0029 §5)");
      const atText = text(flag, "--at");
      const at = atText === null ? null : new Date(atText);
      if (at !== null && Number.isNaN(at.getTime())) throw new Error(`--at '${atText}' is not a date`);
      return { command, shelter: key, wave, kind, messageId: text(flag, "--message-id"), note: text(flag, "--note"), at, eml: text(flag, "--eml") };
    }
    case "status":
      return { command };
    default:
      throw new Error(USAGE);
  }
}

export interface LiveConsole {
  /** whether a person is at the keyboard — `process.stdin.isTTY` */
  isTTY: boolean;
  ask(question: string): Promise<string>;
}

/**
 * The person at the keyboard the ADR requires (ADR-0029 §4): a live send
 * refuses without a terminal, and the confirmation is the wave's name typed
 * back, never a `y`. Throws rather than returning false so no caller can
 * forget to check.
 */
export async function confirmLiveSend(plan: { wave: string; count: number; from: string }, io: LiveConsole): Promise<void> {
  if (!io.isTTY) throw new Error("a live send needs a person at a terminal: stdin is not a TTY (ADR-0029 §4)");
  if (plan.count === 0) throw new Error(`wave '${plan.wave}' has no message to send`);
  const answer = await io.ask(
    `About to send ${plan.count} real message${plan.count === 1 ? "" : "s"} to shelters as ${plan.from} in wave '${plan.wave}'.\nType the wave name to confirm, anything else to stop: `,
  );
  if (answer.trim() !== plan.wave) throw new Error("not confirmed — nothing sent");
}

/** 21:00 ET on 4 November 2026, when the hackathon's building window closes (ADR-0028). */
export const HACKATHON_ENDS = new Date("2026-11-05T02:00:00Z");

/** The ask's timing paragraph while the hackathon is on, and nothing after (ADR-0028; ADR-0029 §3). */
export function timingFor(now: Date): { event: string; until: string } | null {
  if (now.getTime() >= HACKATHON_ENDS.getTime()) return null;
  return { event: "the Meta Global AI Developer Hackathon", until: "4 November 2026" };
}

export interface Sender {
  name: string;
  role: string;
  email: string;
}

/** Who signs: the live `From` is the Gmail account; the signature's address is the one replies should reach. */
export function senderFromEnv(env: Record<string, string | undefined>): Sender {
  return {
    name: env.OUTREACH_SENDER_NAME ?? "Logan Bresnahan",
    role: env.OUTREACH_SENDER_ROLE ?? "founder",
    email: env.GMAIL_USER ?? env.OUTREACH_SENDER_EMAIL ?? "logan@monsterpaws.org",
  };
}
