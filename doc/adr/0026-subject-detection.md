# ADR-0026: The listing's animal is found by an open-vocabulary detector, and one is always chosen

## Context
A listing's photos are not portraits. They hold two cats on one chair, a
mother with her litter, a volunteer's hands, a kennel's bars, a dog behind
chain-link. The painter copies whatever it is shown, so before any
keepsake is painted the pipeline has to put a box around the one animal the
listing means, and a second box around its head (ADR-0004 as amended
2026-10-05; the exploration drew both by hand in `comfyui/explore/boxes.json`).

Roadmap item 4 planned this as a COCO detector (dog/cat) plus clustering
the boxes across a listing's photos. Two facts from 2026-10-12 retired that
plan. The RescueGroups corpus holds **30 species**: dogs and cats are 96.8%,
and the other ~1,800 animals (rabbits, guinea pigs, chickens, goats, pigs,
reptiles, rodents) are invisible to COCO's 80 classes; RT-DETR named the
iguana "bird", the parakeet "bear", the goat and the pigs "cow", the
rabbits and guinea pigs "cat". And the listing already says what we are
looking for — species, colour — so the detector can be asked for it.

The experiment (`doc/plans/subject-detection.md`) ran four iterations on
29 photos, then blind on 19 and on 20 photos never seen while the rules were
written.

## Decision
1. **OWLv2 finds the candidates**, prompted from the listing: its species,
   its species with its colour, its species' head, and the other common
   species (`a photo of a cat` for a dog listing). Base/16 ensemble,
   Apache-2.0, on the CPU; weights and configs hashed in
   `comfyui/models.manifest` under `detect/`.
2. **SAM 2.1 outlines every box** that clears the floors: a detector score
   of 0.06 and 0.3 of the photo's best box.
3. **Boxes that cannot be the animal are dropped, in this order**:
   - for a dog or cat listing, a box that scores higher as the other one —
     never emptying the pool, and never for other species, where OWLv2's
     "cat" score is not evidence (it calls a grey chinchilla a cat);
   - a **group** box: one holding two inner boxes that are apart from each
     other and whose outlines share less than half the smaller one. A group
     never wins — it hands the painter two animals;
   - duplicates (overlap 0.5), after groups, or a merged box swallows the
     good box of the animal it overlaps;
   - a box mostly inside another is a **part** (a head inside its body) and
     goes, unless the outer box is much weaker, when the outer one is
     **loose** and goes instead.
4. **The survivors are scored on six votes**: measured colour inside the
   outline (weight 1.5), recurrence across the listing's photos (1.5),
   species margin over the other common species (1.0), the detector's
   species score (0.5), its colour-prompt score (0.5), size and centrality
   (0.5). Shares already in 0–1 (measured colour, species margin) are used
   as they are; recurrence is stretched min-to-max; the rest are scaled to
   their best candidate.
5. **The top scorer is always chosen** — an unclear subject never falls back
   to the framed photo (Logan, 2026-10-12). The margin to the runner-up is
   recorded on every choice, and under **0.1** the top two get a second look:
   OWLv2 again on each one's own crop, where the colour words bind to the
   right animal.
6. **The head box** is the best head-prompt box inside the chosen box.
7. **A rule change is measured on photos it has never seen.** Test photos
   come from Wikimedia Commons with a licence on every file, recorded in
   `comfyui/explore/commons-photos.tsv`; listings are written before a run.
   RescueGroups photos are never used, in development either (ADR-0006 as
   amended 2026-08-25 §2), and Oxford-IIIT Pet is not used: its licence
   covers the annotations, and its photos' copyright "remains with the
   original owners".

## Consequences
- Blind accuracy: **19 of 20** on the third set, after 17 of 19 on the
  first held-out set led to the fixes in decisions 3–5. The miss: a puppy
  pile whose dark puppy was never boxed, so it chose another at margin 0.03.
- About 6 s a photo on the CPU (OWLv2 ~4.6 s, SAM ~2 s), plus two crops on a
  close call. The home worker can afford it beside the painter.
- **The colour vote needs the listing's colour.** `animals` has no colour
  column and the RescueGroups adapter claims none, and the palette needs a
  word for each of the source's 161 colour entries; three test photos have
  already needed blue, brindle and calico. That work is item 4's colour
  carry-in, and it feeds the description template too.
- **Always choosing one makes a missed subject a guaranteed wrong pick.**
  The recorded margin is the only signal; a small margin with no candidate
  matching the listing's colour is the case to re-detect before choosing.
- Known limits, each a roadmap carry-in: recall in piles and litters;
  partial boxes (grow the box to its outline); the part rule drops puppies
  inside their mother's box, wrong for a puppy's listing.
- The flow: `doc/flows.md`, Keepsake art.
- `comfyui/detect.py` is the experiment and the evaluation; RT-DETR stays in
  the manifest as its yardstick and never votes. Not built in the worker:
  this records the decision.

## Alternatives
- **A COCO detector (RT-DETR, YOLO) plus clustering.** Rejected: blind to
  ~1,800 animals in the corpus, and Ultralytics' YOLO is AGPL-3.0. Its
  clustering idea survives as the recurrence vote.
- **Grounding DINO.** Measured: 17 of 19 against OWLv2's 18 on the held-out
  set, about four times slower, and it merged more animals and missed more
  (the black hen, the dark rabbit, the carrier kittens).
- **Both detectors pooled.** Measured: 17 of 19 — it inherited one failure
  from each instead of the best of both.
- **The framed photo when the subject is unclear.** Rejected by Logan: the
  donor gets art.
- **A local vision-language model reading each photo.** Not now: heavier,
  shares the card with the painter, and can invent attributes. Its own ADR
  if a batch shows the votes failing where it would not.
- **A hosted model.** Ruled out: the photo never leaves a machine we control
  (ADR-0004 as amended 2026-10-05).

## Revisit triggers
- A blind set scores below 18 of 20, or one shelter's photos fail
  repeatedly (litters, kennel walls, piles).
- The colour table lands: re-measure the colour vote and its weight.
- Most close calls turn out wrong: re-detect before choosing.
- A newer open-vocabulary detector with a licence we can ship.
- Art volume makes ~6 s a photo matter.
