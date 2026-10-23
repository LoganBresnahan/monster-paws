# ADR-0028: The Meta hackathon is a branch — exposure for the permanent product, Meta tooling only there

Status: accepted (2026-10-23). Decisions agreed with Logan 2026-10-22 and
2026-10-23.

> Self-amended 2026-10-23: production gets its database and the browse and
> animal pages before the donate loop, so shelters see real animals (below).

## Context
Logan was accepted on 2026-10-22 to the Meta Global AI Developer Hackathon
(Meta with Cerebral Valley; virtual; building 2026-10-26 to 2026-11-04,
submissions due 2026-11-04 21:00 ET, judging to 2026-11-08, live finals and
winners 2026-11-09; up to 20,000 participants; $150 of Meta Model API
credits each). Indie Developer track, teams of up to four. Prizes per track
$150k / $100k / $75k / $50k / $25k (indie) and a $50k bonus pool with a
community vote and a "most viral" award. Projects are judged **Impact 30%**,
**Use of Meta AI tooling 25%** ("beyond a basic integration … unexpected
capabilities"), **Technical depth 20%**, **Demo 25%** ("holds up live", the
video's quality). The Official Rules publish before 2026-10-26; whether
pre-existing code is allowed is not yet known.

The event waiver (read 2026-10-22): the entrant keeps ownership of the
Submission; the organisers and their "partner companies" take a perpetual,
irrevocable, royalty-free, **non-exclusive** licence to it "for any purpose
without restriction", and nothing shared during the event is confidential.
That licence sits beside the AGPL (ADR-0008), so for the Submission alone the
organisers hold a copy with no copyleft on it. The entrant warrants the
Submission infringes no copyright or privacy right and indemnifies the
organisers — a stray photo we do not own in the video is the one clause that
costs money.

**The purpose is exposure, once.** Monster Paws is self-funded and Logan
has no salary; the permanent product runs every model locally on the home
A770 (ADR-0004 as amended 2026-10-05) and will not pay per API call. The
prize money is a lottery ticket. What the ten days can buy is a public
demo, a domain with attention on it, a list of people to write to at
launch, and shelters seeing a real product when the consent email
(roadmap item 5) reaches them.

The Meta Model API (dev.meta.ai, read 2026-10-22): `sam-3.1` on the
Responses endpoint takes **one short noun phrase** and an image and returns
a box and a pixel mask for every instance, confidence optional; multi-concept
prompts return nothing, negation and spatial phrasing are unreliable; $2.50
per 1,000 images, 3,000 requests a minute. `muse-image-1.0` generates and
edits at $0.01 an image. Third-party readings of the API terms say outputs
are ours and may not train a model "that competes with Meta's"; the current
terms were not fetched directly.

Where the product stands: browse and animal pages are built and run on
the dev database, and monsterpaws.org is still the v0.1.0 landing page
(corrected by the amendment below); the donor schema is phase 1 of ADR-0027; nothing can be
donated to yet; the detector (ADR-0026, OWLv2 + SAM 2.1, local CPU) scores
19 of 20 blind; the painter is klein on the A770 (ADR-0004 as amended
2026-10-15); no shelter has granted anything (item 5's email is undrafted);
the crew's photos are not yet on the site (item 3c). DigitalOcean approved
GPU droplets on 2026-10-23, so the anatomy LoRA (ADR-0004 as amended
2026-10-22) is unblocked and runs beside this.

## Decision

### 1. A `meta` branch holds every Meta API call; topdog never does
The branch is cut from topdog after this ADR lands, and rebased on topdog
through the window so production progress flows in. On it: SAM 3.1 through
the Model API as a `sam3` pipeline in `comfyui/detect.py` **beside** owlv2
(`DETECT_PIPELINES` already selects pipelines for comparison runs), scored
by the same votes, overlays and sheets. Muse Image is a **maybe**: a
cleanup comparison against Qwen-Image-Edit on batch 9b's 22 paintings for
the anatomy LoRA set, gated — before any training on its output — on
reading the Model API terms; never a painter of cards. Muse Spark is a
maybe for the colour-word table the detector needs. Nothing on the branch
reaches topdog by merge. **Anything that comes back comes back through its
own ADR**, with a blind-set measurement; the long-term detector and painter
stay local on the card (ADR-0004, ADR-0026), and SAM 3's open weights stay
the separate question `doc/plans/subject-detection.md` records.

### 2. The branch is thin
Meta pieces are selectable providers or pipelines; the branch changes the
defaults and adds the demo surface, nothing else. A piece that could not be
switched off by configuration could not be merged back or thrown away
cleanly, and both have to stay cheap.

### 3. klein paints the demo; SAM 3.1 finds the animal
Every card a judge, a voter or a journalist sees is a production card. The
Meta story is the model that decides **which** animal gets painted, measured
against run 4 on a blind set the rules have never seen. Muse Image never
paints a card a person sees (ADR-0004 as amended 2026-10-15 holds on the
branch). The look the exposure lands on is the look we ship.

### 4. The demo runs on its own stack under our domain
A second compose project on the droplet, at a subdomain of monsterpaws.org,
with its own Postgres seeded through the real pipeline (as the e2e suite
seeds `monsterpaws_e2e`, ADR-0017) with **rights-cleared animals only**: the
crew, and any shelter's first-party photos under a recorded grant. It never
reads or writes the production database. Standing it up and tearing it down
(after 2026-11-10) are oplog entries (ADR-0023), and `doc/infra.md`'s
diagram shows it while it exists. Every link in the Submission points at
monsterpaws.org: the domain, not a hosted preview, gets the attention.

### 5. Real donations land on production, never on the demo stack
A donor who gives $10 to a shelter gets a real keepsake; it cannot live in a
database deleted on 2026-11-10. So the happy path ships ADR-0027's donate
loop **on topdog**, account-less as ADR-0027 §5 already allows: the donation
intent and donate link, the webhook endpoint, the thank-you page (phases
3–5 of `doc/plans/adr-0027-accounts-build-plan.md`), with the production
Every.org partner webhook and the hooks hostname's DNS record. Sessions,
passkeys, export and deletion wait. Precondition: at least one Chicago-area
shelter's grant — display and digify on photos the shelter sends us
directly (ADR-0006 decision 6; first-party, the highest tier), recorded in
the registry with granter, date, basis and the email — because art is
generated only from photos we hold rights to. **Decision point 2026-10-30:**
no grant by then, and the entry is the base demo (decision 3 on the crew)
with the donate loop still shipped and the roadmap a week ahead. The demo
video shows Logan making a real donation either way.

### 6. The rules that follow the code onto the branch
The bright lines (DIRECTION.md), because the exposure is under the Monster
Paws name. AGPL and the brand carve-out (ADR-0008): same public repo, the
Submission links to the branch. ADR-0006's rights rule: the demo paints the
crew or consented first-party photos, never a RescueGroups listing's photo,
which also keeps the waiver's warranty clean. No faked care updates:
attestations are not built, so the demo ends at the card and shows updates
as what the shelter will send, never as examples of what it sent.
"Generate only on donation" and "art arrives when it is ready" (ADR-0004)
stand: the live finals use a pre-painted set, the video shows the wait.

### 7. What topdog ships in the window, and why
Only roadmap work the hackathon pulls forward: the crew's real photos on the
home section (item 3c) so a shelter reading the consent email sees a real
product; an email capture on the root site ("tell me when sponsorship
opens", and a line for shelters) built on ADR-0027 phase 2's transport, so
November's traffic becomes a list; and the donate loop of decision 5. No
other topdog change is hackathon-driven.

### 8. Where it is written down
This ADR on topdog, a **Meta hackathon** row in the roadmap's Active tracks,
and the ten-day plan at `doc/plans/meta-hackathon.md` **on the branch**,
which also records the branch's own choices; they become ADRs only if they
come back. Findings go to `doc/issues.md` (ADR-0019) as always.

### 9. Submission hygiene
Upload the video and the write-up and link the branch; no archive of the
code, since the waiver's licence covers what is uploaded. Every photo in the
video is owned or consented. Nothing unpublished is floated in the event's
Discord or office hours.

## Consequences
- Ten days of Logan's attention, 2026-10-26 to 2026-11-04, go to the branch
  and to decision 7; the anatomy LoRA's DigitalOcean job runs beside them.
- The $150 of credits cover the window many times over (60,000 SAM 3.1
  images); there is no recurring Meta spend, and none after 2026-11-10.
- The branch dies after 2026-11-10 unless a piece earns an ADR; the demo
  stack is torn down on an oplog entry.
- The home GPU paints the demo set and must stay healthy to 2026-11-09:
  `/gpu-health` before the window and before the finals.
- Meta and Cerebral Valley hold a non-AGPL, non-exclusive licence to the
  Submission and may show the name, the wordmark and the cards in their
  marketing. Accepted: it is the exposure we entered for.
- If the Official Rules forbid pre-existing work, the entry is the
  branch's new work on top of Monster Paws and the write-up says so plainly.
- A missed Every.org webhook at demo volume is recovered by hand from the
  Every.org dashboard, which lists donations by our intent id; the
  thank-you page keeps polling. This is what ADR-0027 phase 4 learns against
  staging anyway.
- The consent email goes out without a lawyer's read; the formal letter
  with the three grants follows the first yes.

## Alternatives
- **Enter with Monster Paws unchanged, SAM 2.1 as the Meta tie.** Honest by
  the letter; scores near the floor on the 25% for tooling.
- **Muse Image paints the cards.** The most Meta surface and the most
  exposure for a look we will never ship. Rejected for cards; kept as a
  maybe for the LoRA cleanup step.
- **Meta models on topdog behind flags.** Dead code and API clients in the
  permanent product after 2026-11-10. Rejected.
- **The demo on the production stack.** Demo writes beside production data
  and a Cloudflare-fronted browse spike on one database. Rejected.
- **Real donations into the demo database.** A donor's keepsake in a
  database with a deletion date. Rejected.
- **Not entering.** No cost, no exposure, no deadline forcing the donate
  loop and the first shelter ask.

## Revisit triggers
- The Official Rules forbid pre-existing projects.
- No shelter grant by 2026-10-30.
- SAM 3.1 beats run 4 on a blind set: the open-weight SAM 3 question in
  `doc/plans/subject-detection.md` reopens under ADR-0026's trigger "a newer
  open-vocabulary detector with a licence we can ship".
- The Model API terms, read in full, forbid training on Muse Image's
  output: Muse Image leaves the LoRA step.
- Another hackathon: this ADR is the template only when the sponsor's model
  already does real work in the pipeline.

## Amendment (2026-10-23): production browse before the donate loop

### Context
The Context above said browse and animal pages were live on monsterpaws.org.
They are not: production is the v0.1.0 landing page, `/animals` returns 404,
and there is no production database — roadmap item 3b's re-sequencing of
2026-10-05 held it back "until the basic loop works end to end". The
Chicago consent ask goes out 2026-10-23 or 10-24, and a shelter that clicks
through should find a real site with real animals on it.

### Decision
**Production gets Managed Postgres, the worker's daily RescueGroups poll and
the browse and animal pages now, ahead of the donate loop** (Logan,
2026-10-23: "get the production database up and running before the whole
donation loop is finished so we can try to impress shelters"). This reverses
3b's 2026-10-05 re-sequencing and joins §7's list of what topdog ships in
the window. The launch runs as `doc/oplog/0001-production-launch.md` revised
to browse-first: the database, the pages, the poll, error reporting and the
heartbeat; the donate loop, the home worker and keepsake art follow in
their own entries. Nothing on the pages offers a donation until §5's loop
ships.

### Consequences
- Managed Postgres (about $15 a month) starts billing now rather than at
  the MVP launch, and the dev corpus stops being the only copy (ADR-0017).
- 3b's prerequisites still hold for this run as 0001 lists them (CI green
  with sourcemaps, e2e on the commit, the droplet back on topdog); the UI
  audit's open launch-blocking findings in `doc/issues.md` are fixed or
  explicitly deferred by Logan in the entry.
- RescueGroups listings render under `aggregator-display` (ADR-0006 as
  amended 2026-08-25): hotlinked photos, the Tracker on every detail page,
  purgeable — the same terms the dev pages already follow.

