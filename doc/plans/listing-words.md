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
| **`colors`** | **81.2%, exactly one per animal** | **161 entries; compounds inside one entry ("Black and White")** | ❌ |
| `patterns` | 18.5%, one per animal | 15 entries (Tuxedo, …) | ❌ |
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
  — 161 colours, 15 patterns, 435 breeds, 30 species, 3 coat lengths, 4
  age groups — so a table written once, reviewed by Logan and unit-tested
  gives the same words for the same dog every time. klein's text encoder
  is itself a language model, so the fix for "grey and white" is which
  words, not commas. A model may draft the table offline for review. Each
  colour entry also names the palette colours the detector's colour vote
  counts. Already missing in testing: blue, brindle, calico.
- **The pose stays fixed**: three-quarter sitting or standing, never the
  photo's pose (Logan, 2026-10-12). The donor expects the face and body,
  not the photo's pose.
- **Visible traits go into the words** where the fixed pose would
  contradict them (Logan, 2026-10-12): three legs, one eye, ear-tipped. A
  keyword search of the corpus's free text found them in about 1% of
  listings (three legs 316, one eye 256, blind 247, bob or docked tail
  138, ear-tipped 134; unverified hits). The likely source is a fixed
  keyword list over the listing's text: a fact is not copyrightable
  (ADR-0006 as amended 2026-08-02), but taking it from prose needs writing
  into an ADR before it is built. Then a painter test: does "three-legged"
  with "sitting in three-quarter view" come out right?
- **Shelter prose is not read** for the words (unchanged). A small local
  model filling a fixed form is the option if a batch shows prose-derived
  words beating fields alone; its own ADR.
- **Art takes the largest photo the consented source offers**, never the
  page's display copy (Logan, 2026-10-12).
