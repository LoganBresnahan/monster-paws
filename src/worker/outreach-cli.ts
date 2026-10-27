/**
 * Shelter outreach, by hand, one command at a time (ADR-0029):
 *
 *   npm run outreach -- list [--wave <name> …]     the shelters with visible animals, or one wave's
 *   npm run outreach -- match <shelter>            IRS rows for the name → Logan picks → Every.org by EIN → recorded
 *   npm run outreach -- find-emails <shelter>      the shelter's own site → candidates → Logan confirms one
 *   npm run outreach -- preview <shelter>          the rendered ask into Mailpit (localhost:8025)
 *   npm run outreach -- send --wave <name> [--live] the wave through the guard: into Mailpit and rolled back,
 *                                                  or, with --live, as Logan through Gmail — a person confirms
 *   npm run outreach -- record <shelter> --wave … --kind …   a bounce, a reply, an opt-out, a yes
 *   npm run outreach -- status                     per-wave counts and the revisit triggers
 *
 * There is no scheduled send and no other door: `--live` needs a terminal
 * and the wave's name typed back (ADR-0029 §4).
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { findAddresses, politeFetcher } from "@/core/outreach/addresses";
import { confirmAddress, recordAddressCandidates } from "@/core/outreach/contacts";
import { ensureBmf, matchEin, readBmf } from "@/core/outreach/ein-match";
import { recordOutreachEvent } from "@/core/outreach/events";
import { everyorgClientFromEnv, recordShelterNonprofit } from "@/core/outreach/everyorg";
import { evidenceOf } from "@/core/outreach/evidence";
import { liveSendGate, waveHealth } from "@/core/outreach/health";
import { approachedShelters, loadOutreachShelters, selectWave, type OutreachShelter, type WaveSpec } from "@/core/outreach/list";
import { sendWave, type WaveSendReport } from "@/core/outreach/send";
import { renderAsk } from "@/core/outreach/template";
import { gmailTransport, mailpitTransport } from "@/core/outreach/transport";
import { assembleWave, rehearseWave, shelterStatuses } from "@/core/outreach/wave";
import { closeDb, getDb, type Db } from "@/db/client";
import { confirmLiveSend, parseOutreachArgs, senderFromEnv, timingFor, type LiveConsole } from "@/worker/outreach-args";

const out = (value: unknown) => console.log(JSON.stringify(value));

function console_(): LiveConsole & { close(): void } {
  const rl = createInterface({ input: stdin, output: stdout });
  return { isTTY: stdin.isTTY === true, ask: (q) => rl.question(q), close: () => rl.close() };
}

async function shelterByKey(db: Db, key: string): Promise<OutreachShelter> {
  const shelter = (await loadOutreachShelters(db)).find((s) => s.shelterExternalId === key);
  if (!shelter) throw new Error(`${key} has no visible animal on the site — nothing to write about, nothing to ask`);
  return shelter;
}

async function waveShelters(db: Db, spec: WaveSpec): Promise<OutreachShelter[]> {
  return selectWave(await loadOutreachShelters(db), spec, await approachedShelters(db));
}

function printReport(report: WaveSendReport, rehearsal: boolean): void {
  out({
    wave: report.wave,
    rehearsal,
    sent: report.sent.length,
    refused: report.refused.length,
    failed: report.failed,
    remaining: report.remaining.length,
  });
  for (const s of report.sent) console.error(`  sent     ${s.shelterExternalId} → ${s.to} ${s.messageId}`);
  for (const r of report.refused) console.error(`  refused  ${r.shelterExternalId}: ${r.reason}`);
  if (report.failed) console.error(`  FAILED   ${report.failed.shelterExternalId}: ${report.failed.error}`);
  if (report.remaining.length) console.error(`  ${report.remaining.length} not reached: ${report.remaining.join(" ")}`);
}

async function main(argv: string[]) {
  const args = parseOutreachArgs(argv);
  const db = getDb();
  const io = console_();
  const sender = senderFromEnv(process.env);
  const from = `${sender.name} <${sender.email}>`;
  try {
    if (args.command === "list") {
      const shelters = args.wave ? await waveShelters(db, args.wave) : await loadOutreachShelters(db);
      const statuses = await shelterStatuses(db, shelters);
      for (const shelter of shelters) out({ ...shelter, ...statuses.get(shelter.shelterExternalId) });
      console.error(`${shelters.length} shelters${args.wave ? ` in wave '${args.wave.name}'` : ""}`);
    } else if (args.command === "match") {
      const shelter = await shelterByKey(db, args.shelter);
      if (!shelter.name || !shelter.state) throw new Error(`${args.shelter} has no listed name or state to match on`);
      const { file, fetchedAt } = await ensureBmf(shelter.state);
      const candidates = matchEin({ name: shelter.name, city: shelter.city, state: shelter.state }, readBmf(file));
      console.error(`${shelter.name} (${shelter.city ?? "?"}, ${shelter.state}) against ${file} of ${fetchedAt.toISOString().slice(0, 10)}:`);
      if (candidates.length === 0) throw new Error("no IRS row within reach of that name — nothing written");
      candidates.forEach((c, i) => console.error(`  ${i + 1}. ${c.ein}  ${c.row.name}  ${c.row.city}  score ${c.score.toFixed(2)}  (${c.reasons.join(", ")})`));
      const pick = Number((await io.ask("Which is it? [number, or n]: ")).trim());
      if (!(Number.isInteger(pick) && pick >= 1 && pick <= candidates.length)) throw new Error("no pick — nothing written");
      const nonprofit = await everyorgClientFromEnv(process.env).nonprofitByEin(candidates[pick - 1].ein);
      if (!nonprofit) throw new Error(`Every.org holds nothing under EIN ${candidates[pick - 1].ein} — nothing written`);
      console.error(`Every.org: ${nonprofit.name}  ${nonprofit.profileUrl}  ${nonprofit.claim}  ${nonprofit.locationAddress ?? ""}`);
      if ((await io.ask("Record this match? [y/n]: ")).trim().toLowerCase() !== "y") throw new Error("not recorded");
      await recordShelterNonprofit(db, { shelterExternalId: args.shelter, nonprofit, checkedBy: sender.name, fetchedAt: new Date() });
      out({ recorded: args.shelter, ein: nonprofit.ein, slug: nonprofit.slug, claim: nonprofit.claim });
    } else if (args.command === "find-emails") {
      const shelter = await shelterByKey(db, args.shelter);
      // No website listed: nothing to read, so the only address is one a person types.
      const found = shelter.website
        ? await findAddresses(shelter.website, politeFetcher())
        : { candidates: [], contactFormOnly: false, pagesRead: [], blockedByRobots: [], errors: [`${args.shelter} lists no website`] };
      await recordAddressCandidates(db, args.shelter, found.candidates, new Date());
      out({ ...found, website: shelter.website });
      found.candidates.forEach((c, i) => console.error(`  ${i + 1}. ${c.email}  (${c.sourceUrl})`));
      if (found.contactFormOnly) console.error("  a contact form and no address: write through the form by hand, or skip");
      if (!shelter.website) console.error("  no website listed: type an address you found yourself (their Every.org page, a directory), or n");
      const answer = (await io.ask("Confirm which? [number, an address to type, or n]: ")).trim();
      const pick = Number(answer);
      const email = Number.isInteger(pick) && pick >= 1 && pick <= found.candidates.length ? found.candidates[pick - 1].email : answer.includes("@") ? answer : null;
      if (!email) throw new Error("nothing confirmed");
      await confirmAddress(db, args.shelter, email, sender.name, new Date());
      out({ confirmed: args.shelter, email });
    } else if (args.command === "preview") {
      const shelter = await shelterByKey(db, args.shelter);
      const status = (await shelterStatuses(db, [shelter])).get(args.shelter)!;
      const rendered = renderAsk({ shelter, claim: status.claim, everyorgProfileUrl: status.everyorgProfileUrl, timing: timingFor(new Date()), sender });
      const sent = await mailpitTransport(process.env).send({ from, to: status.confirmedAddress ?? "preview@example.org", ...rendered });
      out({ preview: args.shelter, to: status.confirmedAddress ?? "preview@example.org", messageId: sent.messageId, inbox: process.env.MAILPIT_API_URL ?? "http://localhost:8025" });
    } else if (args.command === "send") {
      const shelters = await waveShelters(db, args.wave);
      const messages = await assembleWave(db, shelters, { sender, from, timing: timingFor(new Date()) });
      if (!args.live) {
        printReport(await rehearseWave(db, args.wave.name, messages, { transport: mailpitTransport(process.env) }), true);
        console.error(`rehearsal only — the record is unchanged; the messages are in Mailpit (${process.env.MAILPIT_API_URL ?? "http://localhost:8025"})`);
        return;
      }
      const transport = gmailTransport(process.env); // throws without the pair, before anything is asked
      const gate = liveSendGate(await waveHealth(db), args.wave.name);
      for (const warning of gate.warnings) console.error(`WARNING ${warning}`);
      let note: string | undefined;
      if (!gate.ok) {
        if (!args.override) throw new Error(`${gate.reason}\n(--override "<why it is safe now>" records the reason on every send of this wave)`);
        note = `override of the wave-health stop — ${gate.reason} — ${args.override}`;
        console.error(`OVERRIDE ${note}`);
      }
      await confirmLiveSend({ wave: args.wave.name, count: messages.length, from }, io);
      printReport(await sendWave(db, args.wave.name, messages, { transport, note }), false);
    } else if (args.command === "record") {
      const evidence = args.eml ? evidenceOf(readFileSync(args.eml)) : null;
      const id = await recordOutreachEvent(db, {
        shelterExternalId: args.shelter,
        wave: args.wave,
        kind: args.kind,
        occurredAt: args.at ?? new Date(),
        messageId: args.messageId ?? evidence?.messageId ?? null,
        note: args.note,
      });
      out({ recorded: id, shelter: args.shelter, wave: args.wave, kind: args.kind });
      if (evidence) {
        const shelter = (await loadOutreachShelters(db)).find((s) => s.shelterExternalId === args.shelter);
        console.error("the SHELTER_EXCLUSIONS entry (src/core/shelters.ts), once the .eml is in the vault under consent/:");
        console.error(
          JSON.stringify(
            { shelterExternalId: args.shelter, name: shelter?.name ?? "", askedBy: evidence.from ?? "", askedAt: new Date(evidence.date ?? Date.now()).toISOString().slice(0, 10), evidence: evidence.line },
            null,
            2,
          ),
        );
      }
    } else {
      for (const h of await waveHealth(db)) out(h);
    }
  } finally {
    io.close();
    await closeDb();
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
