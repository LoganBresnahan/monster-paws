# ADR-0031: The anatomy LoRA's training photos — Wikimedia Commons only, which licences, and the record

Status: accepted (2026-10-27). Drafted the same day with two questions
for Logan; he answered both: a shelter's own Commons release stays in the
pool, and CC BY-SA stays in.

## Context

ADR-0004 as amended 2026-10-22 (decision 4) and 2026-10-26 fixes what the
anatomy LoRA trains on: Wikimedia Commons dogs and the crew, never a shelter
photo, each Commons photo recorded in `comfyui/explore/commons-photos.tsv`
with its licence; Plum and Ducky stay out so batch 9b's seeds are a clean
before and after; ~60–100 more dogs to collect and a held-out few for the
test. It asked for the set's photo licences to be decided in their own ADR
before hundreds are pulled. This is that ADR.

What a photo goes through, concretely, so the licence question is asked of
the right acts:

1. The detector finds the dog and cuts the grown subject and head crops
   (ADR-0026). klein-v1 reads the crops as references and paints the dog in
   our look (ADR-0004 as amended 2026-10-14). The painting shows the
   photo's dog in the photo's pose: a **derivative of the photo** in the
   ordinary sense, in a different medium.
2. The hand step edits the painting (`groinlines.py`, klein Base's
   repaint, `groinink.py`) and Logan checks a sheet.
3. The approved pairs — crops in, painting out, captioned — go up to a
   DigitalOcean GPU Droplet for about an hour and come back as a
   `.safetensors` file; the droplet is destroyed (ADR-0004 as amended
   2026-10-22, decision 3). The weights live in our private R2 store with a
   `models.manifest` line, licence "ours", and run at home for every
   keepsake.
4. **Nothing of the photo, the painting or the pair is published.** The
   sheets are Logan's eyes only; the paintings sit under `var/` (ignored);
   a keepsake is a painting of a *shelter's* dog from the *shelter's* photo
   and contains none of a Commons photo's expression.

What the licences say, read 2026-10-27 at creativecommons.org (the FAQ,
"Artificial intelligence and CC licenses", and the 2023-08-18 post
"Understanding CC licenses and generative AI"):

- A CC licence grants permission only where copyright requires it. Where
  an exception covers the use — CC names text-and-data mining as fair use
  in the United States — the licence's conditions do not apply; where we
  rely on the licence, they do. We do not plan to argue fair use: the
  paintings are plainly derived, so the set is built as if every condition
  binds.
- **Attribution** (BY): a copyright notice, the licence (a link to the
  deed suffices), a notice of changes, and for versions before 4.0 the
  work's title; "in a way that is reasonable under the circumstances". A
  link can be enough.
- **ShareAlike** (SA): "the condition only applies if a work is modified
  and if the work is shared publicly", and a collection of SA works is not
  itself SA. Our paintings are modifications; none is shared. CC does not
  say whether a trained model or its outputs are adapted material.
- **NC** and **ND** do not arise: Commons accepts only free licences.
  Commons does accept a few free licences with awkward conditions —
  GFDL-only (the whole licence text travels with every copy), the Free Art
  License (copyleft like SA, little case law), and custom "attribution"
  or "copyrighted free use" templates.
- The licences are silent on things that are not copyright: a person in
  the frame has personality rights; Commons flags trademarks, insignia and
  personality rights in a `Restrictions` field.

What Commons gives a tool (probed 2026-10-27 on three files already in the
record): the `imageinfo` API returns the original's URL, its **sha1**, its
size and MIME type, and `extmetadata` with `LicenseShortName` (the field
the CommonsMetadata extension itself calls the reliable one; `License` is
"a best guess"), `LicenseUrl`, `Artist` and `Credit` (often HTML),
`Attribution` (a custom credit line that replaces them when present),
`AttributionRequired`, `Copyrighted`, `Restrictions` and `ObjectName`.
Multi-licensed files make these fields unreliable, by the extension's own
note. Wikimedia's User-Agent policy requires a client name and version
plus a contact, and the string "bot" in a bot's agent; `python-requests`
and `curl` defaults are blocked.

What we hold today: 66 Commons photos in the record (dogs and other
animals from the detector and tripod work, 2026-10-12 to 10-15), 23 public
domain or CC0, 19 CC BY (2.0, 2.0 fr, 2.5, 4.0), 24 CC BY-SA (2.0, 3.0,
4.0). Both records were typed by hand and have drifted (`doc/issues.md`,
Ops): the committed TSV carries 66 rows, the local one 18, and nothing
records how a file was fetched.

## Decision

### 1. Source: Wikimedia Commons, and the crew; nothing else
A training or held-out photo comes from a Wikimedia Commons file page and
nowhere else — not a search engine's image results, not Flickr directly,
not a stock site, not a research dataset (Alternatives). The crew's photos
enter under `doc/consent/0001-the-crew.md`; Plum and Ducky stay out
(ADR-0004 as amended 2026-10-22). **A shelter's photo never enters**: a
photo that reached us through RescueGroups or a consent grant is bound by
that channel's terms and would be disclosed to the rented GPU's vendor
(ADR-0004 as amended 2026-08-02 §2).

A Commons photo *of* a shelter animal, released by the shelter under a
free licence (the record already holds Alachua County's public-domain
"Adoptable dog"), is a Commons photo: the licence is the test, not the
photographer's job. Logan confirmed (2026-10-27): it stays in.

### 2. The licence allowlist, read from the API, never from the page by eye
A photo enters only if `LicenseShortName` is one of:

| Licence | Why it is in |
| --- | --- |
| **CC0**, **Public domain** (`Copyrighted` = False) | No conditions. |
| **CC BY** 1.0–4.0, ported variants included (`CC BY 2.0 fr`) | Attribution, which decision 3 gives. |
| **CC BY-SA** 1.0–4.0, ported variants included | Attribution, and share-alike only on adapted material that is *shared publicly* — none of ours is (Context 4). |

Everything else is refused by the tool: GFDL-only, the Free Art License,
custom attribution and "free use" templates, any file whose
`Restrictions` is non-empty (trademark, insignia, personality rights),
and any file `Copyrighted` = True with no CC licence named. A
multi-licensed file (the page shows more than one licence box) enters under
the one the API names when that one is allowed — a reuser may choose any
licence offered — and the extension's own note that its fields are
unreliable there means the row's `note` names the others, read from the
page.

**CC BY-SA stays in, and is recorded as such.** Cutting the pool to CC0
and public domain would discard about two thirds of what Commons offers
for an obligation we do not incur. The record's licence column is what
keeps the option open: if a painting, the set or the weights is ever
published, decision 6 says what happens to the SA rows. Logan chose this
over the cautious alternative (CC0, public domain and CC BY only, at the
cost of a smaller pool) on 2026-10-27.

### 3. Attribution: the committed TSV is the credits file
`comfyui/explore/commons-photos.tsv`, in a public repository, is the
attribution for every photo in the set: the work's title (`ObjectName`),
the author (`Artist` with its HTML stripped, or `Attribution` when
Commons gives one), the source (the file page URL), the licence's short
name and URL, the sha256 we hold, the set, and the date fetched. That is
a copyright notice, a licence link and a title for the pre-4.0 licences,
reasonable to a medium in which the works themselves are never shown.

If a painting or sheet from the set is ever shown publicly — committed
under `doc/`, posted, put on the site — it carries a credit line to its
photo's row (author, licence), and the changes notice is the line "a
painting after the photo".

### 4. What else disqualifies a photo
- An identifiable **person** in the frame: skipped, not cropped — the
  crops are the detector's, not a promise.
- More than one dog, or a dog too small for the detector's grown crops:
  skipped, for the set's sake (the plan says two-dog paintings are thrown
  out).
- The record's hash does not match the file we hold, or the API's sha1
  does not match what we downloaded: refused, never "close enough".

### 5. Where the photo goes, and what comes back
Only the approved pairs and the TSV go up to the rented droplet, for the
run, and the droplet is destroyed with them on it (ADR-0004 as amended
2026-10-22, decision 3). The weights that come home are ours and private;
nothing in them is a copy of a photo. No photo is ever uploaded to a
hosted model service (the checker bake-off sends *paintings* to the
Claude API, never photos — its own line in the plan).

### 6. Publication, withdrawal, and the SA rows
- **Publishing** the set, a painting from it, or the weights is a decision
  by amendment here, and either excludes the CC BY-SA rows' paintings or
  licenses the published thing CC BY-SA. The TSV's `set` and `licence`
  columns make that a filter, not a hunt.
- **A rights holder's request** to withdraw a photo is honoured in good
  faith: the file is deleted, its row stays with `set` = `withdrawn` and
  the date in a note (the record is append-only in spirit: a row is never
  removed), and the next training run excludes it. A LoRA already trained
  is not retrained for one photo unless Logan decides to; the weights
  carry no reproducible copy of it.

### 7. The fetch is a tool that writes the record (Logan's standing rule: a workaround becomes a tool)
`comfyui/commons_fetch.py`, host-side Python with the standard library
only (the explore container mounts both record locations read-only):

- `fetch <set> File:…` — reads `imageinfo` for each title with the agent
  `MonsterPawsCommonsFetchBot/<version> (https://monsterpaws.org; <contact>)`;
  applies decision 2's allowlist and the `Restrictions` rule and refuses
  by name; downloads the original to `var/photos/commons/<set>/`; checks
  the API's sha1 against the bytes; computes the sha256; appends a row to
  `comfyui/explore/commons-photos.tsv` (set, file, sha256, source, author,
  licence, licence_url, size, fetched) and to
  `var/photos/commons/SOURCES.tsv`; a sha256 already in the record is
  skipped, so a rerun is idempotent. One request a second.
- `backfill` — writes the local `SOURCES.tsv` from the committed TSV and
  the files on disk, re-hashing each, and reports any file or row without
  its partner (closes the Ops entry in `doc/issues.md`).
- `verify` — re-hashes every file against the record; a mismatch is a
  refusal, as `models.py` treats the models store.

The set names for this work are `lora-train` and `lora-holdout`; the
horse LoRA's are `lora-horse-train` and `lora-horse-holdout`. An npm
script `explore:fetch` fronts it.

## Consequences
- `comfyui/explore/commons-photos.tsv` gains a `fetched` column and, for
  by-hand rows, a `note`; its header comment names this ADR as the rule
  for what may be added.
- Every photo's row exists before any painting of it is made: the tool
  writes the row in the same run as the download, so there is no
  unrecorded file to paint.
- The record is public attribution, so the author column must be the
  author's name as Commons gives it, not a handle we shortened.
- Collection is slower than a browser's save-as: one title at a time
  through the API, with the refusals read. That is the point.
- The horse set follows the same rules without a new decision.

## Alternatives
- **CC0 and public domain only.** No attribution to keep, no SA question
  ever. Rejected (Logan, 2026-10-27): it discards about two thirds of the
  pool for an obligation we do not incur, and the set needs standing side
  views, the rarest pose.
- **Shelter photos with consent.** Rejected: ADR-0004 as amended
  2026-10-22 and 2026-08-02 §2 — the rented vendor would hold them, and the
  consent would have to say so.
- **Flickr, or image search, directly.** Flickr shows a licence but has no
  permanent file page, no stable hash and no machine-readable
  `Restrictions`; a Commons file is a curated copy with its licence
  reviewed and its history kept. Image search results have no licence at
  all.
- **Research datasets (Stanford Dogs, Open Images, LAION subsets).**
  Rejected: research-only terms, or per-image licences never verified and
  URLs that rot; a set built on them cannot be attributed.
- **Our own photographs, or commissioned ones.** Clean, but slow and
  costly for ~100 dogs across breeds and poses; stays available for the
  held-out test if Commons runs thin in a pose.
- **Reading the licence off the page by eye** (how the 66 were done).
  Rejected by the drift it already produced; the API's fields are what
  Commons itself uses to render the licence box.

## Revisit triggers
- Anyone wants to publish the set, a painting from it, or the weights:
  decision 6, by amendment.
- A rights holder asks for a photo's withdrawal: decision 6; if it
  happens more than once, reconsider CC BY-SA in the pool.
- Creative Commons, a court or a regulator holds that training a model is
  itself an adaptation, or that outputs are: the SA rows' paintings leave
  the set, by amendment.
- Commons changes the `extmetadata` fields or the User-Agent policy: the
  tool follows, this ADR's decision 2 does not change.
- The set needs a pose Commons does not have: the "own photographs"
  alternative, by amendment.
