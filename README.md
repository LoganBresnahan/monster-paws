<p align="center">
  <img src="public/brand/wordmark-v1.png" alt="Monster Paws" width="360" />
</p>

<p align="center"><em>every monster deserves a happy ending</em></p>

**Monster Paws** is a free website where you sponsor a real shelter animal.
Your donation goes to the animal's shelter through [Every.org](https://www.every.org),
and we keep $0: no cut, no ads, and we never process a payment. As our
thank-you, we try to paint the animal in watercolour from its listing photos,
with the shelter's permission, and email you the paintings.

Planned, not built yet: shelters signing their animals' care events, so a donor
can see what their support did without having to trust us.

[![CI](https://github.com/LoganBresnahan/monster-paws/actions/workflows/ci.yml/badge.svg)](https://github.com/LoganBresnahan/monster-paws/actions/workflows/ci.yml)

## What was built during the hackathon

- Verify: `git log --since=2026-10-27T00:00:00-04:00 origin/topdog`, or with no dates `git log e4922cf..origin/topdog` (`e4922cf` is the last commit before the building period, "the window" below). A bare `--since=2026-10-27` takes your clock's time of day and timezone and lists the wrong commits.
- Dates are author dates in US Central time; the window opens at midnight Eastern. As of `27c96d1`, every commit in that range is in exactly one row of the first table. `ADR-NNNN` is a decision record in `doc/adr/`.
- "The crew" are the founders' own pets: five animals, already home, not up for adoption. Their photos and the painting workflow are from before the window; the portraits on the site were painted in it.

### Built in the window (2026-10-27 onward)

| Piece | What it is | Author dates (2026) | Commits |
| --- | --- | --- | --- |
| **Meta SAM 3.1 detection (this `meta` branch only, ADR-0028)** | *Runs here on the crew's photos; never on a shelter's.* SAM 3.1 through Meta's Model API finds the animal and its head in a photo, as one selectable detector beside the local OWLv2 + SAM 2.1 one, and a listing always uses the local one. It chose the right animal on all 16 crew photos it was given, for $0.25 in all (photos we already knew, so not a blind test). Run through the real painting job on a crew pet: both cleaned photos cut, four paintings, $0.02. Photos are sent as pixels only, with personal details covered. `topdog` has none of this. | Oct 26 to Nov 4 | `d711474` `d6de70f` `af2cd0e` `17456a0` `355fcbd` |
| **Production launch, second half** | *Live.* In the window: the first full production poll of RescueGroups listings finished (63,435 listings, no failures), the first full nightly backup ran, and the founder walked the live site. Both commits are run logs with no code: every image deployed then was built before the window. The first half is in the second table. | Oct 27 | `e3f39e6` `fad9634` |
| **Next.js security upgrade** | *Live since Oct 27.* An error report turned out to be a scanner probing production, so Next.js moved from 16.3.8 to 16.4.3, which fixes three advisories. None was exposed as built. | Oct 27 | `ace3ae6` `775e5f0` `a2610f5` `bd45851` |
| **Shelter outreach (ADR-0029)** | *Run by hand, not a web feature.* A command-line tool that lists shelters from our own listings, matches each to its IRS record and Every.org profile, finds addresses on the shelter's own site for a person to confirm, and sends one email asking to paint its animals from their listing photos, at most 40 in 24 hours, rehearsed first. The founder sent it to 46 shelters in the Chicago area and the rest of Illinois, Oct 28 to 30, and to shelters with a claimed Every.org profile on Nov 4. One shelter said yes on Nov 4, and one asked to be removed the same day and was (`SHELTERS` and `SHELTER_EXCLUSIONS` in `src/core/shelters.ts`). From before the window: the `shelter_nonprofits` table and the crew painting behind the email's image. | Oct 27 to Nov 4 | `cca3da1` `5cc617d` `830e974` `d6af373` `954d18f` `382f65c` `4d26a98` `3229daf` `31d5e8c` `c45e085` `c60eaf6` `669d0f9` `3ca266d` `90f7b65` `7d9bc40` `6b981b1` `428ba31` `dc47142` `7e267d8` `459cba3` `151cb7b` `96ffa9a` `be13ae8` `c98e7e0` `3f343f1` `281260d` `bd17b12` |
| **Link previews (ADR-0030)** | *Live since Oct 27.* Every page sends an Open Graph and Twitter card, so a shared link shows a title, a description and one image. New: the card tags, a script that lays the wordmark on the image, and a browser test. The painting in the image is a crew pet's, made before the window. The last two commits plan and log the deploy, which also carried the first footer links and the outreach tables. | Oct 27 | `da83275` `8bf25a9` `08f25f6` |
| **Anatomy LoRA, tried and dropped (ADR-0031, ADR-0004)** | *Dropped (`5b678a3`); nothing in the product uses it.* A small add-on model for the painter, meant to keep unwanted anatomy out of the paintings. In the window: a licence rule and fetcher for training photos (Wikimedia Commons only), training sets painted and approved by hand, two training runs on a rented GPU, and before-and-after tests at home. The best checkpoint still failed 26 of 48 tests and softened the paintings, so none ships. The decision to try it came before the window (second table). | Oct 27 to Nov 1 | `3fd4cf2` `90ceae3` `90c08a7` `1dae02a` `237dcdc` `71c8f10` `ad37bc5` `4d6c2a2` `161c602` `55cf59c` `bef7764` `5e55f09` |
| **Social accounts and footer links (ADR-0032)** | *Live.* Project accounts on X, Bluesky, YouTube, Instagram and Facebook, a script that builds their banners, and links to all of them and LinkedIn in the site footer. Posts are written by hand, with no scheduler or API key. From before the window: the LinkedIn page (made Oct 26, as `b1d6ab0` records) and the crew painting in the banners. | Oct 27 to Oct 28 | `b1d6ab0` `d8657c2` `9a10fae` `575d7fc` `95b9ae8` `a74dab8` |
| **Poll bridge and nightly poll (ADR-0033)** | *Live; scheduled every night since Oct 29.* RescueGroups refuses connections from the production server, so the poll runs there and sends only its RescueGroups requests through a restricted proxy over an SSH tunnel to the founder's home machine. Also: the poll handles each listing as it arrives instead of holding the whole feed in memory, retries a failed run (added after the Oct 30 run failed and was rerun by hand), and reports to uptime monitors. The first poll-from-home script came before the window (second table). | Oct 28 to Nov 2 | `4418229` `409fb03` `3e65a90` `c01cb25` `9bde630` `8efb414` `40cb846` `3269579` `650caa3` `d234f90` `20ede77` `8cf206d` `c9379eb` `cff9a81` `05b2fbd` `233c62d` `47246af` `1f2c89d` `8c364bf` `9c7edf1` `109df8e` `a5aa12a` |
| **Donate loop, no accounts (ADR-0027, ADR-0002, ADR-0022)** | *Live since Nov 2, with no public Sponsor button.* A donor gives an email on our sponsor page and pays on Every.org, the donation platform, which handles the money; its webhook records the donation, and `/thanks` and `/privacy` explain what follows. Also a tunnel for staging webhooks and a hidden test page, used for the founder's own card and PayPal donations and since removed along with their rows. The button shows only for a shelter with a claimed Every.org profile and a recorded permission to paint; the first opened Nov 4 (`doc/oplog/0029`). `7177dfa` limits the donate link to card and PayPal for now. The tables and the first sponsor-page design came before the window (second table). | Nov 2 to Nov 4 | `68a56ef` `e9ee694` `231c4ef` `3b031d2` `eeb56c7` `42ce9a6` `7335343` `c6b300e` `cc8ca32` `fcbc5a6` `552ba45` `7177dfa` `e018831` `2377033` |
| **Error-report privacy fix (ADR-0010)** | *Live since Nov 2.* Error reports stop carrying visitors' data. A setting we relied on did nothing in the current SDK, so reports had carried that data since error reporting shipped on Sep 30 (`815ac9a`). Two tries at purging the stored reports were refused by the provider, so they age out by about Jan 27, 2027. | Nov 2 | `a7c9b11` `f7d16bd` `d831480` |
| **First-signal painting, design (ADR-0035)** | *Design accepted Nov 3; mostly not built.* A painting should start at the first signal of a donation, the webhook or the donor's return to an unguessable thank-you address, because a webhook can be slow or lost. Only a paid donation paints for now, so the thank-you address and the limits it needs are marked planned in `doc/flows.md`. The code in this row is wording on `/privacy` and a link on `/thanks`. | Nov 3 | `39193db` `b61bac5` `681df6a` |
| **Webhook hardening (ADR-0027 as amended Nov 3)** | *Live since Nov 4* (`doc/oplog/0023`). It makes a lost webhook delivery less likely during a deploy or a database failover: the web server holds a request for up to 30 s during a restart, a delivery the database can't take goes to a file on disk and still answers 200, and a timer in the worker replays that file every minute. | Nov 3 | `12c451f` `41c464d` `3bcb2dd` `80c2676` |
| **`/demo` and home page copy (ADR-0028)** | *Live since Nov 4.* Takes care updates and adoption day out of `/demo` and the home page because they won't be ready; `/demo` now ends when the painting arrives. The pages themselves came before the window (second table). | Nov 3 | `42db886` |
| **Painting chain's sweep (ADR-0035, ADR-0028)** | *Live since Nov 4* (`doc/oplog/0028`). The crew get their own database, never beside real listings, and a command records a rehearsal donation with no money moving. A worker sweep turns a recorded donation into a `keepsake` record with its own share token and queues the painting job. It reaches crew pets, or a shelter's animal once that shelter's permission to paint is recorded. | Nov 3 | `fa00bd9` `e6952e5` `f29142f` `37f1ce1` `e1d0b5f` |
| **Portrait look (ADR-0004 as amended Nov 3, ADR-0022)** | *Live on the home page since Nov 4, and what every painting uses.* Test batches 22a to 39a on a GPU in the founder's home settled the look: a chest-up watercolour portrait in three-quarter view for every species, four per donation, with a new short prompt on the klein workflow from before the window. New portraits of the crew. Adds `comfyui/mark.py`, which stamps the site's mark on a painting, and `comfyui/signname.py`, for lettering a name, tried and left out. `5b678a3` also records dropping the anatomy LoRA. | Nov 3 | `5b678a3` `ea7e57b` `be6be50` `8c9d86e` |
| **Public media bucket (ADR-0036, `doc/oplog/0026`)** | *Public since Nov 3.* The storage bucket for published paintings answers public reads through the project's domain. These commits are the plan and run log, with no code. One crew pet's set is published (`fa03faa`, in the painting job's row). | Nov 3 | `e36c4f0` `c2c862e` `d759711` `c45e070` `e6446d4` `7ac14dc` |
| **Painting worker's access to production (ADR-0004, `doc/oplog/0027`)** | *Run Nov 4* (`doc/oplog/0027`). A database role limited to the painting queue and the painting's own facts, and a restricted tunnel key, so a painting job on the home GPU can reach production's database without being able to read a donor's address or donation; each refusal was proved. Two small scripts and the run log. | Nov 3 | `a889cc7` `f913d9a` |
| **Share page (ADR-0036)** | *Live since Nov 4, with one crew pet's set published.* `/share/<token>` shows a set of four paintings with no login and no donor on the page, and `/share/<token>/<n>` shows one with its own link-preview card and links to post it on social sites. A command publishes a set to the media bucket and takes it down. Link previews checked as Twitter's and Facebook's bots see them; not yet checked on a real phone's share sheet. | Nov 3 to Nov 4 | `000b541` `450dab3` `9d297c9` `604a76c` `31cbdc9` `87a4fab` `a6e1725` |
| **Painting job on the home GPU (`art.generate`, ADR-0004, ADR-0022)** | *Running from the founder's home since Nov 4.* A worker on the same queue paints four marked portraits on an Intel Arc A770 through ComfyUI, finds the animal in each photo by live detection, and publishes the set. For a listing it fetches the photos from one host and deletes them when the attempt ends. Proved on a crew pet (Nov 4, 4 min 48 s) and on Wikimedia Commons photos treated as a listing's: a dog in 223 s and a cat in 182 s. A photo with no head found paints only as a close-up, and the job waits for memory to come back from the VM rather than skip a donation. | Nov 3 to Nov 4 | `ac90f6f` `8cc3c7e` `ce4d076` `5ff5076` `d469b17` `0b587cc` `fa03faa` `993a4cb` `a081344` `a6709d3` `8409487` `27c96d1` |
| **The painting email (ADR-0035)** | *Built and tested with real sends to the founder; its sweep goes on with the first real donation.* The email carries the four paintings as attachments and a link to their share page, with one-click unsubscribe, bounce handling through Resend's webhook, and a never-mail list kept only as keyed hashes. | Nov 3 | `66fa705` `993ac71` `72d6e7e` `f14efc4` |
| **The painting is our thank-you (ADR-0037)** | *Live since Nov 4.* An audit of every page, email and shelter message, because Every.org's receipts say no goods or services are provided for a donation and our words said otherwise. The money goes to the shelter; a painting is our own thank-you, which we try to make. Tests fail if the old words return. | Nov 3 to Nov 4 | `ad68563` `da8ab57` `92f1513` `5e564f4` `ec81e6c` `0989a18` `503dfde` `389fea4` `08f3dde` `83b2bc9` `f77f1a5` |
| **Deploys and runbook (`doc/oplog/0021`, `0025`, `0028`, `0029`, `0030`, `0031`, `0032`)** | *Run Nov 4.* Run logs, plans and a restart checklist, with no code: each deploy rehearsed against a production image first and rolled under a live request loop with no failed request, including one while the GPU was painting. The founder's test donations were removed, and old images were cleared off the production server. | Nov 3 to Nov 4 | `d40b6da` `d91a9a6` `dee8709` `c8b6c89` `c4cb52b` `04f8c0e` `6f09ed3` `11a07f1` `80bb607` `335c07d` `77a543b` `3adaabc` `297ce83` `7d6db1b` `9c53fee` `2ec7438` `15a0c30` `4445141` `4d1be8e` `1dba71b` `4833aab` `6786a83` `9a81d1a` `1e401b1` `16753f2` `f94fb3a` `71233b1` `4f3a897` `7af0ab1` `bc0e6c5` `b1bb67d` |
| **A local photo reader (ADR-0004)** | *In the painting job since Nov 4, for dogs.* Qwen3-VL-4B, on the CPU, reads the head, face and ears from the listing's photo and adds those words to the painter's prompt. The founder's blind read of 52 paintings a side: a likeness 35 to 45, the ears right 38 to 47. The photo stays on the machine, and the words reach only the prompt and are deleted with the run. A failure or a hang costs its words, never the painting. | Nov 4 | `d7f90c8` `67718d5` `ab34160` |
| **Sponsorable animals first (ADR-0015)** | *Live with the first shelter.* The plain `/animals` list puts animals with a real Sponsor button first, by rule and never by a shelter's name. A "Can be sponsored" filter and a true "Newest first" sit beside it, and with no sponsorable shelter the page is what it was. | Nov 4 | `133fcc0` `6fbce04` `cc6e8df` `221b6cd` |
| **Notes only, nothing built** | No code: a proposed future shelter data source (ADR-0034, PetPoint), a parked roadmap idea about regranting donations, and an issue note about test databases. | Oct 29 to Nov 3 | `b0088ce` `ce9d4fe` `8cf7281` `ff570bb` |

### Existed before 2026-10-27

| Piece | What existed by the end of Oct 26 | Commits (author date, 2026) | What the window changed |
| --- | --- | --- | --- |
| **Browse and animal pages** | `/animals` and `/animals/<id>`: listing pages with filters, rendered from RescueGroups data. | `2553a73` (Sep 4), `df658df` (Sep 28), `0d2db11` (Oct 5), `df0e816` (Oct 5), `7c60ca9` (Oct 26), `d2ab0d8` (Oct 26). All: `git log e4922cf -- src/app/animals` | The sponsor page and its gated button (`eeb56c7`, `7177dfa`), a comment about link previews (`da83275`), and a shelter opt-out that hides its listings (`5cc617d`). |
| **klein painter** | The FLUX.2 klein 4B workflow, `comfyui/workflows/klein-v1.api.json`, run by hand on a GPU in the founder's home through a test harness. No job painted on a donation. | `382b6d5` (Oct 9), `966b08f` (Oct 15), `50d7a00` (Oct 15), `bdb70c0` (Oct 23) | The workflow file is unchanged: `git log e4922cf..origin/topdog -- comfyui/workflows` prints nothing. New: the portrait prompt and the mark (first table). |
| **OWLv2 + SAM 2.1 detector** | `comfyui/detect.py` (ADR-0026): finds the listing's animal in a photo, run locally on the CPU. | `e46dd0a` (Oct 12), `20e1ab0` (Oct 12), `72998f1` (Oct 12), `803ace2` (Oct 14) | One fix for unreadable photo metadata (`90ceae3`). The SAM 3.1 pipeline is a placeholder in the first table. |
| **Donor schema** | Empty tables for accounts, donation intents, donations, webhook payloads, painting records and shelter nonprofits (`drizzle/0011`), with ADR-0027 and its build plan. No page used them. | `26da757` (Oct 16), `6db87a3` (Oct 20), `e0d8969` (Oct 22) | Migrations 0015 to 0017 change them (`eeb56c7`, `12c451f`, `fa00bd9`); 0012 to 0014 are the outreach tool's. |
| **Home page, the crew and `/demo`** | The home page with the crew's paintings and photos (consent record: `doc/consent/0001-the-crew.md`), and `/demo`, a walk through the site with the crew where no money moves. | `bdb70c0` (Oct 23), `32a4c70` (Oct 26), `462812c` (Oct 26), `abdb94d` (Oct 26) | `42db886` (first table), `eeb56c7` (a shared amount picker and the fee wording) and `7177dfa` (payment-method wording). The crew's image files are unchanged: `git log e4922cf..origin/topdog -- public/brand/crew` prints nothing. |
| **Listings pipeline** | The ingest pipeline and RescueGroups adapter that fill the database. | `e713544` (Jul 31), `d42ca37` (Aug 18). All: `git log e4922cf -- src/core/ingest` | `40cb846`, a comment in `f29142f`, and the poll bridge (first table). |
| **Production launch, first half** | The landing page has been live since Jul 30 and error reporting since Sep 30. On the evening of Oct 26, from 20:12 Central: Managed Postgres created, images built at `34d36ff` started on production (the home page, `/demo` and an empty `/animals`), and the first poll started from the founder's home machine because RescueGroups refused the server. `doc/oplog/0001` logs this in UTC, where that evening is already Oct 27; we count it as before the window. | `8993168` (Jul 30), `815ac9a` (Sep 30), `be1a80a` (Oct 26), `abf4447` (Oct 26), `34d36ff` (Oct 26), `2be3acb` (Oct 26), `47e74a9` (Oct 26), `e4922cf` (Oct 26) | `e3f39e6` and `fad9634` (first table). |
| **Anatomy LoRA, the start** | The decision to try one, the GPU rental script and the first cleanup tests (batches 12a to 12h). | `2be24dc` (Oct 22), `bdb70c0` (Oct 23), `25773c2` (Oct 23), `0731e21` (Oct 23), `32a4c70` (Oct 26) | The rest of the experiment, and dropping it (first table). |
| **Hackathon plan** | ADR-0028, and the build plan `doc/plans/meta-hackathon.md` on `meta`. Documents, no code. | `f8f9efc` (Oct 23), `18d2eb1` (Oct 26). Plan: `git log origin/meta -- doc/plans/meta-hackathon.md` (author date Oct 26; that branch is rebased, so its commit date is later and `--since` lists it) | The Meta pipeline, once committed (first table). |
| **Everything else** | Brand, tests, CI, infrastructure and the other decision records. | `git log e4922cf` lists all 155 commits before the window. | Not part of the entry. |

## Status

Live at [monsterpaws.org](https://monsterpaws.org). Sponsoring opens shelter by
shelter, as each gives permission. `doc/roadmap.md` is the build order;
`doc/DIRECTION.md` is the product source of truth; every decision has an
ADR in `doc/adr/`.

## Mission & bright lines

**Inspire joy.** And some things we will never do: no rarity tiers on
animals, nothing tradeable, no dark-pattern pressure, no programmatic ads,
and generated donor updates never claim care that isn't attested.

## Stack

Full-stack TypeScript: Next.js (App Router) + Postgres (the platform:
relational + append-only event log + JSONB corpus + pgvector + pg-boss
jobs) + Drizzle, on a single DigitalOcean droplet behind Cloudflare, images
in R2. Paintings by FLUX.2 [klein] on a GPU in the founder's home, generated
only on donation and only with a shelter's permission. Details: `CLAUDE.md`,
`doc/infra.md`, ADRs 0001–0008.

## Development

```sh
npm install
npm run dev        # http://localhost:3000
npm test           # vitest units
npm run typecheck
npm run e2e        # Playwright (boots the dev server)
npm run db:up      # local Postgres (docker, pgvector)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code: [AGPL-3.0](LICENSE). The Monster Paws name and brand assets are
**not** licensed — see [TRADEMARKS.md](TRADEMARKS.md).
