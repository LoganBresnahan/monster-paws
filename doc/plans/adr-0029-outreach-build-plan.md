# ADR-0029 build plan — shelter outreach

Derived from `doc/adr/0029-shelter-outreach.md` by the `adr-plan` workflow on
2026-10-27 (12 slices, 14 agents); wording edited by hand. Nothing has
shipped: no `src/core/outreach/`, no `outreach_events` (migrations stop at
`drizzle/0011`), no `SHELTER_EXCLUSIONS`, no `nodemailer`. The ground already
there is `shelter_nonprofits` (ADR-0027, `drizzle/0011`), which the Every.org
lookup fills, and two patterns phase 1 copies: `BrowseExclusion` /
`notExcluded` in `src/core/browse.ts` and the consent registry's shape in
`src/core/shelters.ts`.

Every slice is opus-grade, so this ADR has no Fable slice. One slice carries
an adversarial verify pass (⚠): the live send guard, the only code that can
email a real shelter. Check items off as they ship.

## Phases

1. **foundations: the opt-out, the events table, the transport, the EIN
   matcher** (dependency-free leaves, disjoint files; the opt-out in its
   own commit, the other three batched)
   - [x] `shelter-exclusions-opt-out` — **done 2026-10-27** (`tests/animal-browse.test.ts` pins browse, detail, random and the shelter view; the predicate takes the list as a parameter like `asOf`). Medium, moderate. `SHELTER_EXCLUSIONS`
     in `src/core/shelters.ts`, keyed by (source, organisation id), each
     entry with who asked, when and the email it came in, shape-checked by
     `registryProblems` like the grants. The predicate is a
     `animals.shelter_external_id NOT IN (...)` composed **inside
     `visibleAnimals`** (or one wrapper every caller goes through), never in
     `matchingParts` beside `BROWSE_EXCLUSIONS` — that one deliberately
     leaves the detail page open (ADR-0015 decision 2) and
     `tests/animal-browse.test.ts` pins it; this one must close browse,
     detail (`visibleAnimalById`), "Surprise me" (`pickRandomAnimalId`),
     `loadShelter` and the whole donation path. Three vitest cases (browse,
     detail, random) assert the distinction. Ships with an empty list; it
     rolls to production with the next deploy so the first opt-out is a
     one-line registry change, committed and deployed the day it arrives
     (ADR-0029 §5).
   - [x] `outreach-events-table` — **done 2026-10-27** (`drizzle/0012_flat_juggernaut.sql`; `recordOutreachEvent` in `src/core/outreach/events.ts`; keyed by the one `shelter_external_id` string the two sibling tables use). Medium, mechanical. `outreach_events` in
     `src/db/schema.ts` beside `shelterNonprofits` (same
     `rescuegroups:org:NNN` key) with `kind` as a `$type` union
     (`sent | bounced | replied | opted_out | granted`), wave, time, message
     id, note; a partial unique index on (shelter source, external id, wave)
     where kind = `sent` encodes "one send per shelter per wave"; the
     never-UPDATE / never-DELETE comment at the point of temptation.
     `drizzle/0012`, a catalog test in the shape of
     `tests/donor-schema.test.ts`, and the table added to the truncate list
     in `tests/support/db.ts` or every later suite leaks rows. Exports
     `recordOutreachEvent` for the CLI; `granted` is interest only, never a
     registry write (ADR-0028). The seven-day follow-up rule lives in the
     send guard, not here.
   - [x] `smtp-transport-mailpit` — **done 2026-10-27** (Mailpit v1.32.0 in compose and in CI's `verify` services; `mailpitTransport` / `gmailTransport` in `src/core/outreach/transport.ts`, the Gmail one throwing without its pair; `nodemailer` 10.2.1 + `@types/nodemailer`). Low, mechanical. A `MailTransport`
     interface in `src/core/outreach/transport.ts`, one `nodemailer` SMTP
     implementation parameterised by host, port and auth (Mailpit and Gmail
     are the same code, another host), a `mailpit` service in
     `docker-compose.dev.yml` (SMTP 1025, inbox 8025), `.env.example` keys.
     The test sends through Mailpit and reads its REST API to assert
     delivery, and FAILS rather than skips when Mailpit is down — the
     `SKIP_DB_TESTS` discipline of `tests/support/db.ts`, same flag or a
     sibling. Resend is never wired to this interface (ADR-0029 §4), stated
     on the interface. The `nodemailer` dependency line lands in the ADR.
   - [x] `irs-bmf-ein-matcher` — **done 2026-10-27** (`src/core/outreach/ein-match.ts`: Dice over name tokens with legal forms dropped, a floor of half the words on the NAME alone, city and filing codes as nudges; `ensureBmf` fetches `eo_<state>.csv` into `var/irs/` and checks the header; fixture `tests/fixtures/irs-bmf-sample.csv`). Medium, moderate. `src/core/outreach/ein-match.ts`:
     a candidate proposer over the IRS Business Master File (per-state
     files, `irs.gov/pub/irs-soi/eo_XX.csv`, streamed and filtered by state,
     downloaded to `var/irs/`, never committed) — a name normaliser (case,
     punctuation, Inc / The / NFP suffixes, the `% CARE OF` prefix), a
     token-overlap score filtered by city and state, honest confidence, and
     the raw BMF row travelling with every candidate (DBA vs legal names,
     a rescue under a parent's EIN; EINs stored without leading zeros).
     Writes nothing; Logan confirms each match. Fixture: a small hand-made
     BMF excerpt (public domain) with attributed expectations per
     `tests/fixtures/README.md`, never the real download.

2. **the wave list and the Every.org client** (parallel)
   - [x] `outreach-list-query` — **done 2026-10-27** (`src/core/outreach/list.ts`: `loadOutreachShelters` groups the visible set by shelter and takes the mode of each displayed field; `selectWave` applies a radius or states, drops the already-approached and caps at 200; `CHICAGOLAND` is the first wave; `tests/outreach-list.test.ts`). Medium, moderate. The organisations whose
     animals are visible: `visibleAnimals` (now carrying the exclusions)
     grouped by `shelter_external_id` the way `loadShelter` does, with the
     most frequent name, city, state, zip and `org_url`, the visible count
     and the shelter-view link; a wave is a zip radius (`zipsWithin` in
     `src/core/geo.ts`, Chicagoland = 50 miles of 60614) or a named region,
     at most 200; shelters already `sent` in a wave and shelters with no
     placeable zip are dropped. Reads only displayed columns — the `animals`
     table has no email or phone column, so "never RescueGroups' contact
     fields" is structural as long as the query never touches
     `raw_payloads`; one comment with the ADR says so. **This slice defines
     the row type** the finder and renderer consume; export it and do not
     start phase 3 on a provisional one.
   - [x] `everyorg-nonprofit-lookup` — **done 2026-10-27** (`src/core/outreach/everyorg.ts`; the claim is Every.org's `hasAdmin`, read live against Border Tails Rescue and PAWS Chicago; recorded by name in two new `shelter_nonprofits` columns, `drizzle/0013`, where ADR-0002 as amended 2026-10-26 says the claim lives; `recordShelterNonprofit` upserts; `tests/everyorg.test.ts`). Medium, moderate. An adapter over
     Every.org's public nonprofit endpoint by EIN behind a small interface
     (`everyorg/api-key` into `.env.example` and the `env-dev.sh` fill, by
     name), a fake client in vitest, and the insert into
     `shelter_nonprofits` on Logan's confirmation with source
     "IRS BMF + every.org, checked by Logan". The claimed state is a
     tri-state `claimed | unclaimed | unknown` and **unknown never collapses
     into claimed** — the renderer suppresses the claim line only on a
     confirmed claimed; pin it in the fake-client test.
     `shelter_nonprofits` is a fact table with source and fetched_at, not
     event data, so a re-check after a corrected match is an upsert; one
     comment with the ADR.

3. **the address finder and the template** (parallel; both consume the
   phase-2 row type)
   - [x] `shelter-email-finder` — **done 2026-10-27** (`src/core/outreach/addresses.ts`: `extractAddresses` over mailto, entities and the bracketed obfuscations with the file-name look-alikes refused; a robots.txt matcher for our token or `*`, longest rule, allow on a tie; `politeFetcher` one request a second with `MonsterPawsBot/1.0 (+https://monsterpaws.org; hello@monsterpaws.org)`; `findAddresses` over home, the standard contact/about paths and the home page's own contact links; candidates and Logan's confirmation in `shelter_contacts`, `drizzle/0014`, the page each was read from a stored column; `src/core/outreach/contacts.ts`, `confirmedAddress` the only thing a send may read). Medium, moderate. For each shelter on the
     wave list: its website's home, contact and about pages, a minimal
     `robots.txt` matcher (user-agent groups, Allow / Disallow prefixes, no
     library), one request a second with timeouts and redirects behind a
     fetcher interface, an honest user agent naming Monster Paws and its
     contact address, and a pure `extractAddresses(html)` reading `mailto:`
     links, plain addresses and the `[at]` / `(dot)` obfuscations while
     rejecting look-alikes such as `icon@2x.png`. Candidates persist per
     (source, org id) with the source URL and a confirmed flag that outlives
     a session; a contact-form-only shelter is recorded as such. Every
     address is a candidate until Logan confirms it. The Every.org page is
     one more candidate source, not a dependency.
   - [x] `outreach-template-renderer` — **done 2026-10-27** (`src/core/outreach/template.ts`, `renderAsk`; every clause pinned in `tests/outreach-template.test.ts`, the hackathon a `timing` input, the claim line on unclaimed and unknown, Ducky's painting the one image, from our origin; a rendered ask sent through Mailpit in the suite). **The lawyer's read of the rendered text is still open** — `preview` prints it once the CLI lands. Medium, moderate. One template to
     subject, plain text and HTML from a list row plus the claimed
     tri-state. Each obligation is a clause a fixture test pins present or
     absent: who we are and "we keep $0"; their count and shelter-view link
     (displayed fields only); the crew and `/demo` as the example; the ask —
     permission to paint from their listing photos with third-party AI
     services, stoppable any time, **and** that they hold the photo rights
     (ADR-0004 §2 — read the ADR, not this line); the retention sentence
     (ADR-0022 §5: keepsakes already given stay with donors); the claim line
     only on unclaimed or unknown; the hackathon as timing, never
     endorsement, **as a renderer input, not a constant**, since it comes
     out if a wave slips past 11-04; "reply 'remove' and we take your
     listings down"; images only from monsterpaws.org, the text whole with
     images blocked. Acceptance: `preview <shelter>` lands in Mailpit. A
     lawyer reads the rendered ask before any shelter does.

4. **the live send guard** (alone, so the verify pass reads only this)
   - [x] `live-send-throttled` — **done 2026-10-27** (`src/core/outreach/send.ts`: `judgeSend` is the pure rule set over `SendFacts`, `loadSendFacts` reads them from the record before EACH message, `sendWave` the loop; the day is a rolling 24 hours, so no calendar midnight in any zone resets it; the follow-up clock runs from the first send and a third contact is refused outright; an `opted_out`, `replied` or `granted` row refuses a follow-up; the `to` comes only from `confirmedAddress`; the transport's throw stops the wave with no row; `google/gmail-user` and `google/gmail-app-password` in infra.md's table and `env-dev.sh`, not yet in `pass`. Verify pass the same day, a fresh agent on its own database: single-process the guard held on every attack, but two concurrent runs each sent the 40th and the same shelter twice in one wave, and a row insert failing after SMTP accepted threw the report away — fixed by judging, sending and recording inside one transaction under `pg_advisory_xact_lock`, the insert inside the guarded section with the message id in the error; also from the pass: a future-dated `sent` row refuses instead of sleeping, a bounce refuses the follow-up, a `granted` or `replied` row refuses any send). Medium, moderate ⚠ verify. A guard over
     `outreach_events` with six predicates — one `sent` per shelter per
     wave; a follow-up only seven or more days after the **first** send;
     fewer than 40 today; at least 60 s since the last send; the address
     confirmed; the shelter not excluded — then a send loop with an injected
     transport and clock in the `ingest-cli.ts` style, writing the `sent`
     row only after the transport returned. The Gmail transport takes
     `google/gmail-app-password` from `pass` (infra.md table, `env-dev.sh`
     fill, a commented `.env.example` line). Verify with a fake transport
     and clock, the verifier trying to construct a 41st send, a second send
     in a wave, a follow-up on day six, and a `sent` row after a throw; the
     specific traps are the day boundary (UTC vs Logan's day), counting
     `sent` across waves, measuring from the latest send, reading the
     spacing from the wrong kind, and checking the cap after the send.

5. **the CLI entry and wave health** (one batch, in order — both edit the
   dispatcher)
   - [x] `outreach-cli` — **done 2026-10-27** (`src/worker/outreach-cli.ts` the dispatcher, `src/worker/outreach-args.ts` the pure `parseOutreachArgs`, `confirmLiveSend` (a TTY, the wave's name typed back), `timingFor` (the hackathon clause until 21:00 ET 11-04) and `senderFromEnv`; `src/core/outreach/wave.ts` assembles a wave's messages from `shelter_nonprofits` and rehearses it — the real guard and loop into Mailpit inside a transaction that is rolled back, the clock advancing by what it would have slept; `src/core/outreach/evidence.ts` hashes the exported `.eml` for the exclusion entry; `npm run outreach`; run against the dev database: 33 shelters in `chicagoland-1`, a preview in Mailpit, the rehearsal refusing all 33 for want of a confirmed address and leaving the record empty, `--live` refusing on the missing Gmail pair before it asks). Medium, moderate. `src/worker/outreach-cli.ts` in
     the shape of `ingest-cli.ts` (`main([command, ...rest])`, db opened and
     closed in `finally`, pure modules wired with the fetchers and transport
     injected, JSON out) and `npm run outreach -- list | match | find-emails |
     preview | send | record`. A pure `parseOutreachArgs` tested like
     `parsePollArgs`: `send` defaults to Mailpit; `--live` needs a wave name
     and a person at a TTY answering a readline prompt, and the tests pin
     that a missing wave or a non-TTY stdin refuses. The two check points
     (EIN matches, addresses) are interactive confirmations whose rejections
     write no row. `record opted_out` takes the exported `.eml`, hashes it
     and prints the `evidence` line for the entry in `SHELTER_EXCLUSIONS`,
     so the hash in the repo and the file in the vault cannot disagree by
     hand (ADR-0029 as amended 2026-10-27).
   - [x] `wave-health-stop` — **done 2026-10-27** (`src/core/outreach/health.ts`: `tallyWaves` / `waveHealth` per wave by kind with the rates against its sends, a zero-send wave neither divided by nor healthy; `liveSendGate` judges the previous wave — the latest anything was sent in other than the one resuming — and refuses over 5% bounced or a complaint in any note, `--override <note>` recorded on every `sent` row of the wave it allowed; the reply-rate warning after two waves). Medium, moderate. A `status` verb: per-wave
     counts by kind, bounced / sent and replied / sent, waves ordered by
     first `sent`; a zero-send wave is neither divided by nor healthy. The
     ADR's revisit triggers as a precondition on `send --live`: refuse when
     the previous wave bounced over 5% or any of its events notes a
     complaint, unless an override flag and note are given — the override
     itself appended as an event; a reply-rate warning after two waves that
     points at the message. Unit tests on the >5% path, the complaint-note
     path and the override.

6. **docs and flow** (closes the track; the boxes must grep against real
   symbols)
   - [x] `outreach-docs-and-flow` — **done 2026-10-27** (the "Shelter outreach" flow in `doc/flows.md`, every box greppable; infra.md: the Gmail section carries the Mailpit and `var/irs/` notes, `everyorg/api-key` lands in `.env` by `env:dev`, `outreach_events` / `shelter_contacts` / the vault's `consent/` in the custody picture; `npm run outreach` in CLAUDE.md; roadmap item 5 NOT ticked — its milestone is a donation, not the code — but carries the wave, the count and the two gates). Low, mechanical. One ASCII diagram in
     `doc/flows.md` with the external boundaries drawn (the IRS file,
     Every.org's API, the shelter's site, Gmail SMTP); `doc/infra.md`'s pass
     table gains `google/gmail-app-password` (`everyorg/api-key` is there
     already), a Mailpit note and the `var/irs/` download; roadmap item 5
     ticked with the Chicagoland wave pinned as the first run and its two
     gates named: the lawyer's read of the rendered ask, and the Gmail app
     password in `pass`.

**Critical path:** `shelter-exclusions-opt-out` → `outreach-list-query` →
`shelter-email-finder` → `live-send-throttled` → `outreach-cli` →
`outreach-docs-and-flow`. The chain `irs-bmf-ein-matcher` →
`everyorg-nonprofit-lookup` is off it and can run in a second session
beside phases 1–2; it rejoins at the CLI's `match` command. Forty a day
makes Chicagoland about two days of sending once the list is checked
(ADR-0029, Consequences).

## Sequencing risks

1. **The opt-out predicate in the wrong place.** Composed only in
   `matchingParts`, like `BROWSE_EXCLUSIONS`, it leaves detail, random and
   the donation path open. It goes inside `visibleAnimals` (or a wrapper
   every caller uses), and the new tests assert the difference from the
   browse exclusion that the existing suite pins.
2. **The row type is the fan-in.** `outreach-list-query` waits on both the
   exclusions and the events table; phase 3 waits on its exported type.
3. **A flaky Mailpit gate poisons phase 3.** The transport's test fails
   rather than skips when Mailpit is down, decided before the renderer's
   `preview` acceptance is written against it.
4. **Unknown is not claimed.** The claim line goes out on unclaimed *and*
   unknown; a default that collapses unknown drops the ask on the shelters
   that most need it.
5. **The hackathon clause has a date.** It is a renderer input; a wave after
   11-04 renders without it.
6. **The truncate list.** `outreach_events` joins `tests/support/db.ts` in
   phase 1, or every later test-DB suite leaks rows between tests.
7. **Two slices, one dispatcher.** Phase 5 is one session, CLI first, the
   health gate on top.
8. **Two gates outside code.** The first live wave needs the lawyer's read
   of the rendered ask (ADR-0004, ADR-0022) and `google/gmail-app-password`
   in `pass`; they are pinned on the roadmap in phase 6 so `send --live` is
   not the first time anyone notices.
