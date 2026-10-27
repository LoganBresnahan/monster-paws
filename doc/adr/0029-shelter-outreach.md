# ADR-0029: Shelter outreach — a list from our own listings, one email from Logan per shelter, sent in waves

Status: accepted (2026-10-27). Decisions agreed with Logan 2026-10-27.

## Context
Roadmap item 5 and ADR-0028's happy path need the consent ask in front of
shelters this week: may we paint your animals (`digify`, ADR-0006 decision
6), and will you claim your free Every.org profile, without which a
donation cannot reach you (ADR-0002 as amended 2026-10-26). Logan wants it
tailored per shelter and sent as application code, tested, not by hand.

What we hold and what binds it (measured 2026-10-27 unless noted):

- **The shelters.** 1,429 RescueGroups organisations list visible animals;
  53 are in Illinois, and only four inside Chicago itself (the city's large
  shelters list through other systems). The zip radius (ADR-0015 as amended
  2026-10-26) finds Chicagoland's.
- **RescueGroups' terms scope its data to the uses our key application
  declared** — displaying animals with links back (`doc/rescuegroups-api-terms.md`,
  `doc/rescuegroups-application.md`). The payload carries each
  organisation's email and phone; building a mailing list from them is not
  a declared use, and RescueGroups already resets every connection from our
  droplet while we ask them a favour (oplog 0001).
- **No EIN in RescueGroups' data**, so matching a shelter to its Every.org
  page by name alone is guesswork ("Paws Chicago" against "PAWS Chicago
  Inc."). The IRS Exempt Organizations Business Master File is public and
  carries name, city, state and EIN.
- **Email services forbid this kind of send.** Resend, which will carry
  donor receipts and keepsake mail, prohibits unsolicited mail to collected
  addresses in its acceptable-use terms, as such services do; one complaint
  wave risks the account and the domain's reputation. A personal Gmail
  account allows roughly 500 sends a day, and near-identical cold mail at
  volume is what its filters flag.
- **Carry-ins already pinned to item 5:** the first opt-out needs a
  per-organisation exclusion that overrides `aggregator-display`; the ask
  states the retention terms (ADR-0022 §5); the formal three-grant letter
  gets a lawyer's read after the first yes (ADR-0028 as amended).
- **ADR-0004 as amended** requires the `digify` ask to say photos are
  processed by third-party AI services.

## Decision

### 1. Who: shelters with visible animals, sent in waves
The list is the organisations whose animals are visible in our corpus. It
goes out in **waves**: the first is Chicagoland (shelter zips within 50
miles of 60614); later waves are regional, at most 200 shelters each, each
wave named and chosen by Logan. Nothing goes to the whole list at once.

### 2. What each fact comes from
- **From RescueGroups' data, only what we display:** the shelter's name,
  city, state, zip, website, its visible animal count and the link to its
  shelter view. Their own listings, described back to them.
- **Never RescueGroups' `email` or `phone` fields.** The address comes from
  the shelter's own website — its home, contact and about pages, `robots.txt`
  respected, one request a second, an honest user agent naming Monster Paws
  and its contact address — or from its Every.org page, or Logan types it.
  A shelter with only a contact form is recorded as such and handled by hand
  or skipped. A found address is a candidate until Logan confirms it.
- **The EIN from the IRS Business Master File** (public domain, downloaded to
  `var/irs/`, never committed), by name, city and state, each match checked
  by Logan; then **Every.org by EIN** through its public API
  (`everyorg/api-key`). Checked matches are written to `shelter_nonprofits`
  (ADR-0027) with source "IRS BMF + every.org, checked by Logan".
  Whether the profile is claimed is read from the API if it reports it;
  otherwise it is unknown.

### 3. The message
One template, rendered per shelter into subject, plain text and HTML:
who we are and that we keep $0; their animal count and the link to their
shelter view; the crew and `/demo` as the example; the ask — permission to
paint their animals from their listing photos, with AI image tools that are
third-party services, stoppable any time; the retention terms in one plain
sentence (ADR-0022 §5); the Every.org claim line **only when the profile is
unclaimed or unknown**, with its link; the Meta hackathon as the reason it
is this week, never as Meta's endorsement; and "reply 'remove' and we take
your listings down". Images are ours, hosted on monsterpaws.org — the home
page and the crew — never a stored screenshot of a shelter's listing, which
would be a lasting copy of photos we may only display (RescueGroups' terms);
the shelter gets the live link instead. The text reads whole with images
blocked.

### 4. Sending: Gmail as Logan, Mailpit locally, never Resend
Live mail goes through **Gmail's SMTP as Logan** (an app password in `pass`
at `google/gmail-app-password`), throttled to **at most 40 a day, a minute
or more apart**. Locally every message goes to **Mailpit** (a container in
`docker-compose.dev.yml`, SMTP on 1025, the inbox at localhost:8025), and so
do the tests: the same transport code, another host. A live send needs
`--live`, a wave name and a person at the keyboard; there is no scheduled
send. **Resend is never used for outreach.** New dependency: `nodemailer`
(MIT) for SMTP.

### 5. Records, replies and the opt-out
- **An append-only `outreach_events` table**: shelter (source and external
  id), wave, kind (`sent`, `bounced`, `replied`, `opted_out`, `granted`),
  time, the message id, a note. Never updated; one send per shelter per
  wave; at most one follow-up, seven or more days later. Logan reads replies
  in Gmail and records them through the CLI.
- **An opt-out is a consent record, so it lives in git** beside the grants:
  a `SHELTER_EXCLUSIONS` list in `src/core/shelters.ts`, keyed by (source,
  organisation id), each with who asked, when and the email it came in. It
  is applied beside the visibility predicate, as `BROWSE_EXCLUSIONS` is, so
  an excluded shelter's animals leave browse, detail and "Surprise me", and
  the outreach list skips it. It is committed and deployed the day it
  arrives.
- **A yes** is recorded as `granted` interest; the grant itself enters the
  registry from the formal letter after the lawyer's read (ADR-0028), with
  its evidence under `doc/consent/`.

### 6. Shape
`src/core/outreach/` holds the pure parts — the list query, the IRS
matcher, the template renderer, the address extractor — unit-tested on
fixtures; the transport and the fetches sit behind small interfaces;
`npm run outreach -- list | match | find-emails | preview | send | record`
drives it.

## Consequences
- A shelter hears from us about its own listings, from a person, with a way
  to say no that we honour within a day.
- Building the list needs Logan's checks at two points — the EIN matches and
  the addresses — so a wave is hours of his attention, not a button.
- Forty a day keeps Chicagoland to about two days; a 200-shelter wave takes
  five.
- RescueGroups' contact fields stay unused, so the key stays within its
  declared use.
- The opt-out list is the per-organisation exclusion item 5 was waiting on,
  and the donation path inherits it.
- One new dependency (`nodemailer`) and one new local service (Mailpit).

## Alternatives
- **Resend.** Rejected: its acceptable use forbids it, and it is the
  account donor mail depends on.
- **Gmail drafts through Claude's connector, sent by hand.** Workable for one
  wave, but not application code: nothing tested, nothing recorded, and it
  depends on a session.
- **RescueGroups' email field.** Rejected: outside the key's declared use.
- **The whole list at once.** Rejected: filters, reputation, and a template
  nobody has seen a reply to.
- **Matching Every.org by name search alone.** Rejected as the source of
  record: too many near-duplicates; it stays a hint beside the EIN.

## Revisit triggers
- A bounce rate over 5% or any spam complaint in a wave: stop, and fix the
  list or the message before the next.
- Gmail throttles or warns the account.
- A shelter, RescueGroups or Every.org objects to the method.
- The lawyer's read changes what the first email must say (ADR-0028).
- Replies under one in ten after two waves: rethink the message, not the
  volume.

## Amendment (2026-10-27): the evidence stays out of the repo

### Context
§5 above puts an opt-out in git "with the email it came in", and a grant's
evidence "under `doc/consent/`", where the crew's consent lives. Logan asked
(2026-10-27) whether a shelter's email belongs in plain text in a public
repository, and whether the database would serve attestation better. The
crew's consent is Logan's own; a shelter's reply is a third party's
correspondence — a person's name, address and words — and a shelter that
asked to be left alone would find its request indexed. A database row, on
the other hand, proves nothing on its own: we can change it and nobody
outside can tell. What the reply actually carries is a DKIM signature from
the shelter's mail provider: the raw message with its headers is proof that
their domain sent those words at that time, as long as it is kept intact.

### Decision
- **The record stays in git, the evidence stays private, a hash joins them.**
  A `SHELTER_EXCLUSIONS` entry names the shelter, who asked and their role,
  the date, and as `evidence` the message's `Message-ID` and the SHA-256 of
  the exported raw message (`.eml`, headers included). Nothing in the repo
  quotes the email; `exclusionProblems` refuses an entry whose evidence is a
  path or lacks the hash.
- **The raw message is kept twice, both privately:** the original in Gmail,
  and the `.eml` export in the vault bucket under `consent/`
  (`r2:monsterpaws-vault/consent/<shelter-key>-<date>.eml`, the vault pair,
  infra.md), the same custody as the attestation mirror. Its hash matches the
  entry's, so anyone we show it to can check it was not altered.
- **The database keeps the event**, an `opted_out` row in `outreach_events`
  with the same message id, which the send guard reads.
- **A grant's evidence takes the same shape**: the signed letter's hash in
  the registry entry, the letter itself in the vault. `doc/consent/` holds
  first-party consent only (the crew). The registry's check is tightened the
  same way when the first shelter grant lands (ADR-0028).

### Consequences
- An opt-out takes three writes, all the same day: the `.eml` to the vault,
  the entry to git with its hash, the `opted_out` row through the CLI. The
  CLI's `record` verb computes the hash from the file so the two cannot
  disagree by hand.
- The repo never holds a shelter's words; the proof is reproducible from a
  file only we hold, which is the right way round for a public repository.

## Amendment (2026-10-27, later): no lawyer's read of the ask

Logan, with the first wave's runbook in hand: a lawyer's read of the rendered
ask is not realistic for this project, so it is not a gate. Logan reads the
`preview` in Mailpit himself before the wave; that is the read. The ask's
clauses are the ADRs' own terms (ADR-0004 as amended §2, ADR-0022 §5 as
amended 2026-10-27, ADR-0002 as amended 2026-10-26, ADR-0028), each pinned
by a test, so the wording promises nothing the system does not do. The
ADR-0028 read of the formal three-grant letter after the first yes is a
separate line and is not changed here. The remaining gate on the first live
wave was the Gmail pair in `pass`, in since the same day.

