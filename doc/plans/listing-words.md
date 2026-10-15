# The listing's words — what the painter and the detector are told (ADR-0004 as amended 2026-10-05, ADR-0026)

Status: investigation 2026-10-11/12; nothing here is built. Decided items
are marked with who decided; the rest are proposals. Owner: Logan decides;
Claude runs the measurements.

Two stages read the listing's structured fields. The painter's prompt
carries a short description ("female tan pit bull mix"), and the subject
detector (ADR-0026) prompts with the species and colour and votes on the
colour it measures. Both need the same thing: each source value turned
into words by a rule we wrote and reviewed. Today the words are typed by
hand into each batch spec (`comfyui/explore/batch4c.json`), and no colour
reaches `animals` at all.

## What RescueGroups sends, and what the adapter keeps

Measured on the dev corpus 2026-10-11: 94,029 animals, latest payload each.
"Kept" means `src/core/ingest/rescuegroups.ts` promotes it.

| Field | Filled | Values | Kept |
| --- | --- | --- | --- |
| species (`singular`) | 100% | 30 species; dog 49.1%, cat 47.7%, rabbit 1.07%, bird 0.96%, guinea pig 0.39%, … | ✅ `species` |
| species (`youngSingular`) | 100% | Puppy, Kitten, … | ❌ |
| `breedPrimary` | 98.7% | 435 breeds | ✅ `breed` |
| `breedSecondary` | 18.6% | Terrier, … | ❌ |
| `isBreedMixed` | 82.9% present, 50.8% true | | ❌ |
| `breedString` | 99.96% | "Chihuahua / Mixed (short coat)" | ❌ |
| `sex` | 98.1% | Female, Male | ✅ `sex` |
| `ageGroup` | 95.6% | Baby, Young, Adult, Senior | ✅ `ageGroup` |
| **`colors`** | **81.2%, exactly one per animal** | **161 ids, 85 names; compounds inside one entry ("Black and White")** | ❌ |
| `patterns` | 18.5%, one per animal | 15 ids, 13 names (Tuxedo, …) | ❌ |
| `colorDetails` | 6.7% | free text ("marble") | ❌ |
| `coatLength` | 76.3% | Short, Medium, Long | ❌ |
| `sizeGroup` | 83.5% | Small … X-Large | ❌ |
| `eyeColor`, `earType`, `tailType` | ~5% each | | ❌ |
| `distinguishingMarks` | 0.8% | free text | ❌ |

Behaviour, care and adoption fields (temperament, home fit, health) are
filled 1–42% and none is kept. Photos: the adapter keeps the 500-px
`large` size for the page; the median `original` has a short side of 1024
px (10th percentile 480, 90th 3024).

**There is no primary and secondary colour.** Batch 4c's rule "primary
colour only" was written for a shape the source does not have: the
compound sits inside one entry's name. The rule has to be restated per
entry.

## How much the words matter (batches 1b–4c)

| Run | What the words did |
| --- | --- |
| 1b (SDXL) | without a description, under the LoRA, Plum came out brown-and-tan and Ducky a collie |
| 3a (klein, words only) | right colour and breed, no likeness |
| 3b | "storybook" against "cartoon" changed the style completely; identity held |
| 4a | the pose phrase overrode the reference's pose; "white chest patch" painted a bandana |
| 4b | "grey and white" painted Ducky's blaze and socks on Plum |
| 4c | primary colour only was right; "mostly grey with a little white" added nothing |
| 3c (Z-Image, no photo) | "tan pit bull mix" painted brindle |
| 4a/4b | without "male" or "female" the painter guesses the sex |

Words decide what the photos do not settle (style, pose, framing, sex);
photos win on identity where they are clear. Every error came from words
about details the model could not place. **Not yet measured directly on
klein:** a batch that removes the words one at a time (species only; + sex;
+ age; the full template; + coat length) on two references plus head.

## Proposals and decisions

- **Fields become words through a reviewed lookup table, no language model
  at runtime** (proposed, Claude 2026-10-11). The values are closed lists
  — 85 colour names, 13 patterns, 435 breeds, 30 species, 3 coat lengths, 4
  age groups — so a table written once, reviewed by Logan and unit-tested
  gives the same words for the same dog every time. klein's text encoder
  is itself a language model, so the fix for "grey and white" is which
  words, not commas. A model may draft the table offline for review. Each
  colour entry also names the palette colours the detector's colour vote
  counts. Already missing in testing: blue, brindle, calico.
- **How the table works** (proposed, Claude 2026-10-13; Logan to
  review). Measured the same day on the same corpus:
  - **The colours are RescueGroups' own pick-lists, not shelter text.**
    Each species has its own list with stable ids, so the 161 ids are 85
    names ("Black" carries 12 ids, one per species). 40 names cover 96.3%
    of the animals that have a colour, and 60 names cover 99.7%. A new
    value appears only when RescueGroups adds one.
  - **Pattern often says what the colour does not.** "Brown" + Tabby
    (2,648) and "Brown/Chocolate" + Brindle (975) are examples. Sometimes
    it only repeats the colour: "Tortoiseshell" + Tortie (954), "Black and
    White" + Tuxedo (546). So the words come from the colour and pattern
    pair, and a repeat is said once.
  - **The claim keeps the shelter's value verbatim**: `colour` and
    `pattern` claims, with source and `fetched_at`, merged by the trust
    hierarchy. The words are derived where they are used. A table edit
    therefore changes the next keepsake without replaying the corpus, and
    the keepsake (ADR-0022) snapshots the words it was painted with.
  - **An entry**, keyed by (source, name), gives:
    - the painter's words;
    - the palette colours the detector's colour vote counts. This
      replaces `COLOUR_SETS` in `comfyui/detect.py`, so there is one
      table.
    It lives in the TypeScript worker, which passes the words and palette
    sets into the detect and paint jobs.
  - **An unknown or missing value** (18.8% of RescueGroups animals have
    no colour):
    - no colour words are used, and the detector's colour vote abstains;
    - the value is never guessed from its spelling;
    - the ingest run counts the value as unmapped, and its entry arrives
      by a reviewed commit.
    Batch 6b found that no colour words is not neutral: the rat drifted
    from white-and-grey to cream. What stands in for the words is still
    open (below).
  - **A unit test** holds every name in a committed snapshot of the
    source's list to an entry.
  - **Free text** (`colorDetails` 6.7%, `distinguishingMarks` 0.8%) never
    feeds the table.
  - **A consented shelter's own feed** brings its own vocabulary: a small
    table of its own onto the same words, written at grant time.
  - **The art reads only a colour held on a basis that allows art.**
    RescueGroups' colour is display-only for now, because our key
    application kept the artwork program off API data. The roadmap item 10
    carry-in holds the three ways out. Development batches may use
    RescueGroups' vocabulary on Commons photos (batch 6b): that tests the
    words, not the data.
  - **RescueGroups publishes the full lists**
    (`/v5/public/animals/colors`, `/patterns`, `/species`; fetched
    2026-10-13): 597 colour ids across 41 species, 100 names, 15
    patterns. The corpus shows 161 of the ids. The table and its test use
    the published list. In the corpus, patterns appear only on dogs and
    cats.
  - **The words for compounds are not settled.** The words batch decides
    them: the full compound, the dominant colour only, or the dominant
    colour plus the pattern word.
- **The pose stays fixed**: three-quarter sitting or standing, never the
  photo's pose (Logan, 2026-10-12). The donor expects the face and body,
  not the photo's pose. A three-legged listing is painted standing only
  (Logan, 2026-10-15; ADR-0004 as amended 2026-10-15), keyed on the
  visible-traits keywords below: "tripod", "three-legged" / "three
  legged" / "3-legged" / "3 legs", "amputee", "missing a leg" (proposed;
  the list is settled with its prose-reading ADR note).
- **Visible traits go into the words** where the fixed pose would
  contradict them (Logan, 2026-10-12): three legs, one eye, ear-tipped. A
  keyword search of the corpus's free text found them in about 1% of
  listings (three legs 316, one eye 256, blind 247, bob or docked tail
  138, ear-tipped 134; unverified hits). The likely source is a fixed
  keyword list over the listing's text: a fact is not copyrightable
  (ADR-0006 as amended 2026-08-02), but taking it from prose needs writing
  into an ADR before it is built. The painter test ran in batch 6a
  (2026-10-12, `base-model-candidates.md`): **"three-legged" was ignored,
  12 of 12 with four legs**, so the word alone is not enough — the
  phrasing, or a reference that shows the trait, is the next test.
- **Shelter prose is not read** for the words (unchanged). A small local
  model filling a fixed form is the option if a batch shows prose-derived
  words beating fields alone; its own ADR.
- **Art takes the largest photo the consented source offers**, never the
  page's display copy (Logan, 2026-10-12).

## Batch 6b — the colour as RescueGroups would send it, first read (Claude, 2026-10-13; Logan's picks decide)

`comfyui/explore/batch6b.json` is batch 6a exactly, except for the colour
words. For each animal, a shelter's likely choice from RescueGroups'
published list for that species (`_rg` in the spec) goes through the draft
table into words. Only the five animals whose words changed were run;
the other seven would repeat 6a image for image. 20 images, pool flat at
0.9 GB. Side by side in `var/explore/batch6b/compare.jpg`: crop | 6a's
four | crop | 6b's four.

| Animal | 6a words (from the photo) | RescueGroups value → words | Likeness 6a → 6b | What changed |
| --- | --- | --- | --- | --- |
| pig | black and ginger | Black → "black" | 0.583 → 0.566 | the ginger band is gone; all four solid black |
| Great Dane | black and white harlequin | White with Black + Patches → "white with black patches" | 0.579 → 0.601 | **better**: a white dog with black patches, as in the photo, where 6a painted a mostly black dog |
| budgie | yellow and blue | Blue → "blue" | 0.680 → 0.683 | the yellow head mostly gone; the scorer does not see it |
| chinchilla | grey and white | Gray → "grey" | 0.676 → 0.661 | about the same: the photo carries the white |
| rat | grey and white | Multi/Mixed → no colour words | 0.678 → 0.649 | drifted to cream and tan; the grey hood is lost |

- **The word beats the reference when the two disagree.** One colour
  from a single-colour list erased a second colour the photo plainly shows
  (pig, budgie). Outside dogs and cats, RescueGroups' lists have no
  compounds, so this will happen to every two-coloured rabbit, bird and
  pig.
- **No words is not "the photo decides."** With no colour, the rat took
  klein's own idea of a fancy rat. The rat's crop is the weakest
  reference in the set (no head was detected, so the subject crop stands
  in for it), so this needs one more animal before it is a rule.
- **A pattern word helped where the colour alone could not.** "with
  black patches" did what "harlequin" did not in 6a. This is the first
  evidence for the pattern field.
- **Both failures point at the detector's measurement.** It already
  measures the coat's colour shares on the outline (`comfyui/detect.py`).
  It could check the listing's colour, so that a word naming one colour
  of a measured two-colour coat is dropped or widened. It could also
  stand in when there is no colour at all. Untested. Measured words carry
  batch 4b's risk ("grey and white" painted Ducky's blaze on Plum), so
  the test is the measurement against the listing's word on these five,
  scored by eye.

Yours to overrule. Your picks go in `var/explore/batch6b/picks.txt`.

