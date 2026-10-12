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

No method wins outright. The next shape to try: grow only by the outline
pixels that belong to no other candidate's outline, and add the margin
only on a side where that outline reaches the box's edge — the animal
continues there — never where it stops inside the box.

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
- **Partial boxes.** Grow the chosen box to its outline's extent (the
  chinchilla's outline reached further than its box).
- **The part rule and litters.** Puppies inside their mother's box are
  dropped as parts: right for her listing, wrong for a puppy's.
- **The colour table** — see `listing-words.md`.
- **A fresh blind set.** All three sets have been seen. The next honest
  measure is Logan's shelter-grade crew photos (crate door, leash and hand,
  fluorescent light, from above, across the room, lying down) or a fourth
  Commons set.
