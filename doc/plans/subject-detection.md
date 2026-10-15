# Subject detection — which animal is the listing's (ADR-0026)

Status: experiment run 2026-10-12; the decision is ADR-0026. The worker
build is a roadmap item 4 carry-in. Owner: Logan decides; Claude runs the
experiments.

The job: in each of a listing's photos, put a box around the one animal the
listing means and a box around its head, so the painter (ADR-0004 as
amended 2026-10-05) never copies a kennel-mate, a person or a whole litter.
Until now `comfyui/explore/boxes.json` held boxes drawn by hand.

## How to run it

`npm run explore:detect` runs `comfyui/detect.py` in the `explore`
container on the CPU over the listings in `comfyui/explore/detect.json`;
`DETECT_SPEC` names another listings file beside it, `DETECT_OUT` another
output folder under `var/explore/`, and `DETECT_PIPELINES` brings back
Grounding DINO or the pooled version for a comparison. Detector boxes,
outlines and embeddings are cached, so a rule change re-scores in seconds.
Output: an overlay per photo (chosen box and outline in green, other
candidates red, dropped groups purple, head yellow, margin in the header),
`sheet-<pipeline>.jpg`, `sheet-heads.jpg`, `results.jsonl` with every
candidate's votes.

## The photo sets

All from Wikimedia Commons, each file's licence recorded in
`comfyui/explore/commons-photos.tsv`; the files live in
`var/photos/commons/`. Listings (species, colour, which animal is meant)
are written from the photo before a run, standing in for listing fields.

| Set | Listings file | Photos | Status |
| --- | --- | --- | --- |
| set 1 | `detect.json` | 18 Commons + Logan's 11 crew photos (Plum, Ducky) | the rules were tuned on it |
| held-out | `detect-holdout.json` | 19, seven species new to the rules | blind for run 3, seen since |
| blind 3 | `detect-blind3.json` | 20, mostly dogs and cats | blind for run 4, seen since |

What the sets cover: two animals of different colours, two identical ones,
a mother with her young, a pile of puppies, people in frame, kennel mesh,
cage bars, a café window, a carrier, three-legged animals, low resolution,
sepia prints, and 15 species. Rejected sources: RescueGroups photos
(ADR-0006 as amended 2026-08-25 §2, development included) and Oxford-IIIT
Pet (its photos are unlicensed scrapes; its licence covers the
annotations).

## Runs

| Run | What changed | Set | Right | Notes |
| --- | --- | --- | --- | --- |
| 1 | OWLv2 and Grounding DINO side by side; first weights; votes stretched min-to-max | set 1 | 28 · 27 of 29 | the failures were merged boxes: the black cat with the tabby (OWLv2); Ducky with Plum, the cat pile (Grounding DINO) |
| 2 | pooled detectors, lower floor, group and part rules, colour weight up | set 1 | 25 of 29 | **worse**: a green leaf beat the parakeet; a cat cut off at the frame's edge beat the longhaired cat; Ducky's couch shot kept dog plus a leg; the black cat's own box was swallowed |
| 3 | relative floor 0.3; groups before duplicates; part or loose; votes scaled to their best | set 1 | 29 of 29 | tuned on it |
| 3 | nothing | held-out | **17 of 19** blind | a cat chosen for a dog listing (margin 0.01); a chinchilla called a group, head cut off (0.08) |
| 4 | OWLv2 alone; absolute shares; dog/cat species check; groups need separate outlines; second look under 0.1 | **blind 3** | **19 of 20** blind | the puppy pile: the listing's dark puppy was never boxed |
| 4 | same | set 1 · held-out | 29 · 18 | regression check; the species check first dropped both chinchilla boxes and was limited to dogs and cats |

OWLv2 against Grounding DINO on the held-out set: 18 against 17 of 19,
~3.7 s against ~15.6 s a photo, pooled 17 — pooling inherited one failure
from each. Grounding DINO merged more and missed more (the black hen, the
dark rabbit, the carrier kittens) and once boxed a cat as "a dog".

## What each lever does, and the photo that set it

| Lever | Now | Set by |
| --- | --- | --- |
| measured colour weight | 1.5, absolute | black cat beside a tabby: 0.93 against 0.05; absolute after a dim photo blew 0.02 against 0.08 up to a wrong pick |
| recurrence weight | 1.5, stretched | Ducky over Plum in both shared photos (0.79 against 0.71) |
| species margin | 1.0, absolute (new) | the cat curled against a dog |
| colour-prompt weight | 0.5 (from 1.0) | "a black cat" scored the merged two-cat box 0.45, the black cat alone 0.12 |
| species and size weights | 0.5 each | tiebreaks; each pointed the wrong way at least once |
| score floor | 0.06 (from 0.10) | the dark rabbit and the carrier kittens |
| relative floor | 0.3 of the best box (new) | the green leaf and the parakeet |
| group test | separate outlines (new) | the black cat and tabby; the headless chinchilla |
| close-call margin | 0.1, second look on crops (new) | both held-out failures sat under it |

The visual version of this table, as of 2026-10-12:
https://claude.ai/artifact/1obZNhWyPTEoBDqx6oBb6M (private to Logan).

## Head boxes

Usable on about 25 of 29 in set 1: every crew photo but Ducky's top-down
kitchen shot, and most Commons animals. Weak: a black cat whose face is
tucked away (the crop is black fur), a grey rabbit's crop taking in its
neighbour's ear, and 640-pixel photos giving tiny heads.

## Batch 5a — nothing drawn by hand, first read (Claude, 2026-10-12; Logan's picks decide)

`comfyui/explore/batch5a.json`: the batch-4c recipe (klein, two references
plus head, "male grey cane corso puppy" / "female tan pit bull mix",
sitting and standing three-quarter, seeds 7 and 11) with the hand-drawn
crops (`subject`, `head`) beside the detector's (`detsubject`, `dethead`,
from `comfyui/explore/boxes-detected.json`, run 4). 16 images, 16–21 s
each, pool flat at 1.2 GB. Grids `var/explore/batch5a/grid-plum.jpg` and
`grid-ducky.jpg`, hand on the right.

- **Plum: no difference that matters.** The detector's boxes are within a
  few percent of the hand ones, and the eight portraits are the same dog.
  The detector versions sit a little more front-on and paint the white
  chest patch a little larger; the hand versions keep the chain and tag
  more often. Likeness 0.68–0.72 against 0.70–0.74.
- **Ducky: the detector clipped her muzzle** in both reference photos —
  the cover shot loses her nose at the left edge (her head rests on a leg
  the box left out), the standing shot the tip of her nose at the right.
  Three of four portraits are still plainly Ducky, scoring at or above the
  hand ones (0.66, 0.67, 0.66 against 0.62–0.65).
- **One broken image: two Duckys** (`014`, standing, seed 7, detector
  crops), the same failure batch 4a met with three references. The
  likely reading: a body crop with no face plus a large face crop read as
  two animals. The judge's agreement rule catches it — 0.907 against its
  siblings' 0.95 — so production would have rejected it.

So detector crops paint as well as hand crops when the box holds the whole
animal, and the one way they fall short is the known partial-box limit.
**Next: grow the chosen box to its SAM outline's extent, then batch 5b**
(the same spec, regrown boxes) — yours to overrule.

## Crop comparison — how the chosen animal is cut out (2026-10-12)

`comfyui/crops.py` (`npm run explore:crops`, CPU) cuts each of set 1's 29
chosen animals four ways: the detector's box; the box grown to its SAM
outline; that plus a 10% margin; and SAM asked again with a box 20% looser,
cut to the new outline. Growth stops at another candidate's box unless it
already touches. Sheets: `var/explore/detect-v4/crops-{1,2,3}.jpg`.

- **Growing fixes the clipped animals.** Ducky's cover shot gets her whole
  muzzle back with the margin or the re-ask (the outline alone just
  reaches her nose); her standing shot gets the tip of her nose back with
  any of the three.
- **Growing brings neighbours back where they touch.** The grey rabbit's
  outline runs into the dark rabbit, so every grown crop holds both; the
  same for the guinea pigs, the black cat (more tabby each step), the cat
  pile, and Plum's ear at the edge of Ducky's kitchen crop. The box alone
  was the cleanest cut in each of those.
- **The re-ask over-grows.** Given room, SAM traced the whole scene on
  seven photos (Plum in his cone, the county dog, the iguana, the longhair,
  the orange cat, Lulu, the cat pile): crops near the full frame.

No method wins outright among those three.

### Own outline, margin where it grew — run on all three sets (2026-10-12)

Two more columns: the box grown only by outline pixels that no other
candidate's outline claims (kept only where they connect to the box), and
that plus the 10% margin on a side only where the own outline grew past
the detector's box by more than 1% — the box cut the animal there. The
margin stops at the first pixel of another candidate's outline. Sheets
`crops-*.jpg` in `var/explore/detect-v4/`, `detect-holdout-v4/`,
`detect-blind3/`; no new model calls, so it costs nothing at run time.

- **Every clipped animal comes back.** Ducky's whole muzzle (cover shot)
  and nose tip (standing); the brindle boxer's and the car beagle's noses;
  the tuxedo tabby's face; the three-legged dog's feet (+28% down).
- **No neighbouring animal comes back, on any of the 68 photos.** The
  rabbits, the guinea pigs, the cat pile, the bichons and Plum beside
  Ducky are cut as the box cut them; the outline-plus-margin column
  brought each neighbour in.
- **A tight box stays the box.** 36 of 68 grow by under 2% on every side.
- **People are not fenced.** A handler's hand or arm already inside the
  box reaches further in on the fence dog and the marine dog: people are
  never candidates, so their outlines claim nothing. Whether hands get
  painted is batch 5b's question.

So this is the cut for batch 5b: the batch-5a spec with the regrown boxes
— yours to overrule. A tight box that cuts the animal and whose outline
also stops at the cut (SAM stops where the box stops) still gets no
margin; Ducky's cover shot shows the outline usually leaks a little past.

## Batch 5b — the grown box, first read (Claude, 2026-10-12; Logan's picks decide)

`comfyui/explore/batch5b.json`: batch 5a's spec with a third cut,
`grownsubject` (the own-outline rule above, written by `crops.py` to
`grown.json` and copied into `boxes-detected.json`). 24 images at
16.5–18 s; the 16 repeated from 5a came out identical (same likeness to
the last digit), so any difference is the cut. Grids
`var/explore/batch5b/grid-ducky.jpg` and `grid-plum.jpg`, columns
detector · grown · hand.

- **Ducky: the grown cut paints like the hand cut.** All four grown
  portraits are one dog with her whole muzzle, composed seed for seed
  like the hand-cut ones; the two-headed Ducky (detector cut, standing,
  seed 7) does not recur. Likeness 0.636–0.654 against hand 0.619–0.649
  and detector 0.607–0.666.
- **Plum: grown ≈ detector**, as expected — his boxes grew by under 2%
  except 11% upward on the portrait (an ear). Likeness 0.694–0.715
  against detector 0.684–0.723 and hand 0.700–0.740. The hand versions
  still differ in the same way as in 5a (chain and tag kept, smaller chest
  patch).
- One hand-cut Plum (standing, seed 11) has a painted signature in the
  corner — the recipe's, not the cut's.

So the grown cut closes the one gap 5a found: **detector boxes, grown,
paint as well as hand-drawn ones** on the crew — yours to overrule. Next:
the best-two-photos rule.

### Batch 5b — Logan's picks (2026-10-12)

`var/explore/batch5b/picks.txt`: two each — Plum `005` (sit, seed 11,
detector cut; Logan swapped it in for the hand-cut `000`) and `003`
(stand, seed 11, hand); Ducky `013` (sit, seed 11) and `014` (stand,
seed 7), **both hand-cut**. Logan: the Plum images are "really good …
legit hard to pick" — Plum splits one and one, Ducky goes to the hand
cut. Comparing the boxes behind them finds two gaps the grown cut
leaves:

- **The head box is never grown.** Ducky's head reference (the cover
  shot) starts at 0.46 by the detector against 0.30 by hand, with her
  nose near 0.38 — the face the painter copies has no muzzle, though
  the grown subject crop now has one. Next: grow the head box by the
  subject's own outline in the head's rows.
- **A box the outline stops at is not grown.** Plum's portrait: hand
  0.00–0.97 across, grown 0.00–0.77 — the limit noted above.

Likeness with the picks (`explore:score -- batch5b --picks`): the picks
rank 1, 3, 21 and 23 of 24 — the scorer agrees on Plum and puts both
Ducky picks near the bottom, the same coin flip as before.

## Trace first — one timing test (2026-10-12)

The pipeline is box first: OWLv2 boxes, SAM outlines what was boxed, so an
animal OWLv2 never boxes is never seen (the puppy pile, run 4). Trace first
turns that round: SAM 2.1 outlines everything in the photo from a grid of
single-point prompts, keeps outlines it scores at 0.88 or more, merges
near-duplicates (mask IoU over 0.7), and only then would each outline be
asked what it is. One probe on the puppy pile, CPU, 4 threads, 1200×1600
(the probe is not committed; it comes in with the step if that is built):

| Grid | Encode | Outline | Distinct shapes | The five puppies |
| --- | --- | --- | --- | --- |
| 32×32 | 1.5 s | 70 s | 37 | four whole; the cream one at the bottom mottled |
| 16×16 | 2.4 s | 21 s | 26 | all five whole, the dark one included |

- **It finds what the detector missed.** The listing's dark puppy is one
  clean shape, separated from its littermates along the fur.
- **Most shapes are not animals.** 21 of 26 are ground, sacking, cloth and
  stones; a per-shape question (OWLv2 or the colour measure on the shape)
  still has to be built and measured, and is not in the time above.
- **Time: ~25 s a photo against ~6 s** for the whole box-first pipeline.
  Most of it is upscaling three candidate masks per point to full size;
  upscaling only the best would cut it, unmeasured.

So trace first fits as the rescue step, not the main path: run it only
when the margin is small and no candidate matches the listing's colour
(the recall carry-in below). Not built.

## SAM 3 — what it would bring (read 2026-10-12, not downloaded)

SAM 3 (Meta, November 2025) is trace first from words: given "dog" it
returns a mask, box and score for every dog, with no detector in front.
`facebook/sam3` is 0.9B parameters (OWLv2 base is ~0.15B, SAM 2.1 small
~0.05B); the container's transformers already has `Sam3Model`. SAM 3.1
(`facebook/sam3.1`) adds faster multi-object video tracking and has no
transformers support. CPU speed is not published.

It could replace two stages (OWLv2 boxes and SAM outlines) with one, and
it answers the pile and touching-animal cases directly. What stops it
going into the manifest today:

- **Licence: the "SAM License"**, not Apache-2.0 like every detect model
  now. Royalty-free, distribution allowed with the licence attached; it
  forbids military, nuclear, espionage and ITAR uses and reverse
  engineering, requires indemnifying Meta, and **Meta may change the terms
  with continued use counting as acceptance**. Needs reading in full and a
  decision before any download (ADR-0026's revisit trigger names "a
  licence we can ship").
- **Gated download:** a Hugging Face account that shares contact details
  with Meta. Logan's to accept or not.
- **Unmeasured:** speed on this CPU and on the Arc, and accuracy on our
  three sets against run 4.
- **The card has no room beside klein.** Batch 5b measured klein's set at
  13.2–14.4 GB of the A770's 15.9 (`doc/infra.md`, Home GPU), leaving
  1.5–2.7 GB against SAM 3's estimated 3–4; on the card it would have to
  take the text encoder's place in the same process. The CPU is the
  place to measure it first.

## The grown head (2026-10-14)

Batch 5b's Ducky picks went to the hand cut because the detector's head
box, the painter's second reference, clipped her muzzle. `crops.py` now
writes a fourth box, `grownhead`: the detector's head grown to the
subject's own outline (the same outline as `grownsubject`) on a side
where that outline ends close by. Sideways it may grow up to half the
head's width (a muzzle), upward up to 0.15 of its height (an ear tip),
and never down; then a 5% pad, never past the grown subject, and never
smaller than the detector's head. A second fault was in the harness: it
read every head through a square centre crop, which trims the sides of a
wide head box. `grownhead` is read at its own aspect instead.
`heads-grown.jpg` in each detector run's folder shows both cuts.

The limits come from set 1's 26 heads, as a share of the head's size.
Muzzles grew sideways 0.19–0.47. The one bad sideways growth (the black
cat taking in the tabby) was 0.58. Every downward growth (0.24–0.64) was
the neck, chest or a standing puppy's whole body, which risks the "two
animals" reading of batch 5a. Upward growth past 0.15 was the back of a
face-on Plum, the pig's back, or the cat pile. Checked blind on the
holdout's 16 heads: no growth made a head worse. It recovered half of the
snow dog's face, the chinchilla's ears and the budgie's crown. The
holdout heads that are wrong (turtle on its leg, the puppy's body, the
sepia rabbit's ear, the kennel pup) were placed wrong by the detector,
and growth cannot move them.

### Batch 5c — the grown head, first read (Claude, 2026-10-14; Logan's picks decide)

`comfyui/explore/batch5c.json`: batch 5b's recipe on Plum and Ducky with
BFL's fp8 klein (batch 7a), three cuts: by hand; the grown subject with
the detector's head; the grown subject with the grown head. A new
`heads` axis in the harness pairs a detector head only with a
detector-cut subject. 24 images. Grid
`var/explore/batch5c/grid-animal-prompt-seed-x-crop-head.jpg`.

- **Ducky's muzzle is whole in all three cuts.** Close up
  (`ducky-faces`, sit seeds 7 and 11, stand seed 7), the three faces
  differ only in small details: the blaze's width, a whisker line. With
  BFL's weights and the grown subject crop, the grown head adds little
  over the detector's head for her.
- **Plum: the grown head paints like the detector's head**, and the hand
  cut differs as it did in 5b (lighter grey, smaller chest patch).

So the grown head is kept: it is never worse, and on the holdout it fixes
the head box that cut a face in half. But the gap Logan saw in 5b's Ducky
is closed mostly by the grown subject crop. Yours to overrule.

## The tripods set (2026-10-15)

Nine Commons photos of three-legged animals (`detect-tripods.json`,
`var/explore/detect-tripods`), run with the rules unchanged for batch 8f
(`base-model-candidates.md`). The right animal was chosen in all nine,
including the white dog among people and the brindle beside a car. **No
head was found for Lucca or Lulu**, both clearly in view: Lucca in
profile carrying a toy, Lulu lying on a carpet. Their batch ran on the
subject alone. A head the detector misses is a gap in the grown-head
recipe, and an animal photographed only in profile may be the usual
case for it.

## Open

Each is a roadmap item 4 carry-in.

- **The best two photos.** The detector supplies the subject's size, a
  head found or not, and the margin; add sharpness on the head crop and
  rank. Check: does it pick the pairs chosen by hand in batch 4c (Plum's
  portrait with `downloadfile`, Ducky's cover shot with her standing
  portrait)?
- **A batch with nothing drawn by hand**: detector boxes in place of
  `boxes.json`, the batch-4c recipe on the crew, beside the hand-cropped
  batch. It tests the paintings, not the boxes.
- **Recall in piles.** A small margin and no candidate matching the
  listing's colour means the subject is probably missing: re-detect on
  tiles or with a lower floor before choosing.
- **Partial boxes.** Grow by the own outline plus a margin where it grew
  (above); batch 5b paints from it, and the head grows by the same
  outline (batch 5c). A box the outline stops at is still not grown
  (Plum's portrait).
- **The part rule and litters.** Puppies inside their mother's box are
  dropped as parts: right for her listing, wrong for a puppy's.
- **The colour table** — see `listing-words.md`.
- **A fresh blind set.** All three sets have been seen. The next honest
  measure is Logan's shelter-grade crew photos (crate door, leash and hand,
  fluorescent light, from above, across the room, lying down) or a fourth
  Commons set.
