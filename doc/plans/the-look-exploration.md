# The look — exploration plan (roadmap item 3c, ADR-0004 as amended 2026-10-05)

Status: decided 2026-10-14 — ADR-0004 as amended 2026-10-14 names the look (FLUX.2 klein 4B in BFL's fp8, the photo read as references, the storybook prompt, no LoRA) and `comfyui/workflows/klein-v1.api.json` is committed. The SDXL batches below are the record of how the fallback was built; the klein batches (3a onward) are in `base-model-candidates.md`. Open: traits the words do not carry (batch 8a), the best-two-photos rule (`subject-detection.md`). Owner: Logan picks; Claude runs.

## Why a matrix, not taste

ADR-0004 decision 1 makes the workflow product code: the look is whatever
API-format JSON we commit, with its model hashes and licences. Choosing that
JSON from two hand-made images is guessing. This plan generates the candidates
systematically — same animals, one axis moved at a time — and Logan picks from
contact sheets. The picks, not the settings, are the decision; the settings
behind a pick are read off its record.

Three questions, asked in order because each needs the others held still:

1. **Identity** — what keeps the animal recognisable: adapter weight, weight
   type, how far into denoising the photo applies, one photo or several.
2. **Style** — what SDXL can say without a LoRA, so the LoRA (item 9) has a
   target instead of a wish.
3. **Graph shape** — adapter from noise (the committed v0), image-to-image
   with the photo in the latent, or both.

## The crew

Logan's own animals, consent on file at the home section (item 3c's last
sub-item); photos under `var/crew/<Animal>/` (gitignored, never leave the
machine). He chose them to look like shelter listings: odd angles, another
animal in frame, one clean portrait among several. That is the point — the
pipeline gets one listing's photos, not a studio session.

First run: **Plum** (grey cane corso puppy, dog) and **Ducky** (tan pit mix,
dog). Per animal, one *clean* photo (a listing-quality portrait) and one
*hard* one (the other dog in frame, top-down or side-on):

| Animal | clean | hard |
| --- | --- | --- |
| Plum | `downloadfile.jpg` — **his actual shelter listing photo**, sitting in grass, facing camera | `PXL_20250422_224209397.jpg` — sidewalk, Ducky's face in frame |
| Ducky | `PXL_20250621_160612271.PORTRAIT.jpg` — standing side profile | `PXL_20250411_123028993.jpg` — kitchen, top-down, Plum beside her |

Three more animals (one dog, two cats) join once batch 1 has settled the
identity settings.

## Photo handling

`comfyui/explore.py prep` copies each photo into ComfyUI's input folder as a
PNG with **every EXIF field dropped** — all eleven phone photos carry GPS —
rotated upright first (the orientation tag goes with the rest), long side
1536 px. Production does the same strip to consented owner photos (roadmap
item 4 carry-in); this is the first use of it.

**Crops (batch 1b).** The encoder sees a 224 px centre crop of the whole
frame — Plum's face in his listing photo is about sixty of those pixels, and
a companion in the corner is as much of the embedding as he is. So `prep`
also writes one PNG per box in `comfyui/explore/boxes.json`: `subject` (the
whole animal) and `head`, as fractions of the upright photo, drawn by hand
on a tenths grid so the companion stays outside every box. A box is cut out
and set on a square whose margins are the crop itself, stretched and
blurred — **never grown into the photo** (that is how the companion gets
back in) and **never padded flat** (the first 46 images of batch 1b padded
with the crop's mean colour, and the adapter copied it as grey bands down
both sides; those cells were pruned and rerun). A run's `crop` names
which PNG the encoder gets; the latent of an image-to-image graph always
starts from the whole photo. Production draws the boxes with a detector,
not a person (roadmap item 4 carry-in): the animal present in every photo
of a listing is the subject.

## Graph variants

All share the SDXL base checkpoint, the two text encoders, `dpmpp_2m` /
`karras`, 25 steps, cfg 6, 1024². Only the way the photo enters differs:

| graph | photo enters as | latent starts from | knobs that apply |
| --- | --- | --- | --- |
| `adapter` (the committed v0) | ViT-H tokens → IP-Adapter | noise | weight, weight_type, end_at |
| `img2img` | VAE-encoded pixels | the photo | denoise |
| `both` | both of the above | the photo | all four |

Multi-photo (batch 3) adds two mechanisms for several photos in the adapter:
an image batch into `IPAdapterAdvanced` with `combine_embeds`, and the
node pack's encoder path — one `IPAdapterEncoder` per photo into
`IPAdapterCombineEmbeds` → `IPAdapterEmbeds`. Production will do the latter
with a listing's photo set.

Every photo passes `PrepImageForClipVision` (centre crop, 224) before the
adapter, which is the node pack's recommended input.

A run with a `lora` inserts `LoraLoader` (strength 1.0, model and CLIP)
between the checkpoint and the adapter; the text encoders use the LoRA's
CLIP. The two LoRAs in `models.manifest` are stand-ins for our own (roadmap
item 9) with licences we can run — ostris *Watercolor Style* (Apache-2.0)
and alvdansen *Little Tinies* (CreativeML Open RAIL-M), neither needing a
trigger word. They never ship; they answer one question: does a style
survive the adapter when it lives in the weights rather than the prompt?

## Batches

**Batch 1 — identity, one photo** (Plum, Ducky; 136 images, ~45 min)

| axis | values |
| --- | --- |
| photo | clean, hard |
| graph | adapter, both (denoise 0.6), img2img (denoise 0.6, no adapter) |
| weight | 0.5, 0.8 |
| weight_type | linear, style and composition |
| end_at | 1.0, 0.6 |
| prompt | `photo`, `storybook` (fixed wording, below) |
| seed | 7 |

The `img2img` graph has no adapter knobs, so it contributes one image per
photo × prompt.

**Batch 1b — identity with the subject in frame** (Plum, Ducky; 192 images,
~1 h). Adapter graph only, linear, full range: the three inputs batch 1
never had, each held against the others.

| axis | values |
| --- | --- |
| photo | clean, hard |
| crop | full, subject, head (`boxes.json`) |
| describe | generic (`{kind}` = "dog"), listing (the animal's own description, below) |
| lora | none, watercolor, tinies — stylised prompts only; `photo` runs without |
| prompt | `photo` (identity control), `storybook` |
| weight | 0.6, 0.8 |
| seed | 7 |

The description stands in for what production reads off the listing —
breed, colour, age — and is written by hand for the crew: Plum "grey cane
corso puppy with a white chest patch", Ducky "tan pit bull mix with a white
chest and white paws". The `animals` table carries breed and age group but
no colour yet; that column is item 4's (carry-in). Stylised prompts in this
and later batches also get "photograph, photorealistic" in the negative, so
the text pushes away from the photograph the adapter is copying; batch 1
did not have it, and 1b's uncropped, generic, no-LoRA cells are the clean
comparison.

Success looks like: a weight-0.8 image that is still a watercolor, and a
head-crop image that Logan says is Plum.

**Batch 1c — correctness, step 1: the pose from the photo** (Plum, Ducky;
40 images). Logan's bar (2026-10-09): a stylised rendering is acceptable
when the animal is anatomically right, the same colour, and carries the
distinguishing features; the failures to remove are two bodies under one
head, broken outlines and odd colour. Four steps, cheapest first, each a
batch: (1) a canny ControlNet from the same crop the encoder sees, so the
body comes from the real dog and the adapter supplies colour and features;
(2) more candidates per keepsake with CLIP selection and a second pass on
the face; (3) a better base model — candidates, licences and the FLUX
experiment in `base-model-candidates.md`; (4) a per-animal LoRA on the Arc
to learn its cost. Batch 1c is step 1, held at the picked corner
(subject crop, listing description, Little Tinies, weight 0.6):

| axis | values |
| --- | --- |
| control strength | 0 (none), 0.4, 0.7 |
| control end | 0.5, 0.8 of the schedule |
| seed | 7, 11 |

The ControlNet is xinsir's SDXL canny V2 (Apache-2.0, `models.manifest`);
Canny is a core ComfyUI node, so no node pack is added. Depth would need
an estimator and a node pack; canny first.

**Batch 2 — style, from the weights** (all five animals; proposed after 1b,
Logan's picks set the weight range). Batch 1b showed a prompt family is
invisible at any weight that keeps the animal, so the six prompt families
are replaced by style LoRAs with licences we can run, each a stand-in for a
family our own LoRA (item 9) could be trained toward: watercolor and Little
Tinies from 1b, plus candidates still to be read, hashed and listed in
`models.manifest` (StoryBookRedmond, ColoringBookRedmond and pixel-art-xl
are OpenRAIL-M on Hugging Face; claymation, plush and oil candidates are
unsearched). Held still from 1b: subject crop, listing description, linear.
Axes: LoRA × weight {0.5, 0.6} × end_at {1.0, 0.8} × three seeds.

**Batch 3 — several photos** (all five; every photo of each animal; adapter
batch with concat vs average, encoder path with concat vs average; the two
best settings) — and the head crop as a second image beside the subject
crop of the same photo, which is where 1b says its identity signal belongs.

Prompts are short and fixed per family so the axis is the family, not the
wording:

- `photo`: "a photo of a {kind}, soft natural light, shallow depth of field"
- `storybook`: "a gentle storybook illustration of a {kind}, soft watercolor,
  warm pastel palette, plain background"
- negative, all runs: "blurry, text, watermark, extra limbs, deformed, two
  animals"

## How a batch runs now

Never `npm run explore -- run` directly against a long-lived server until a
whole batch has completed clean under the guard (`doc/infra.md`, Home GPU,
for the leak and its fix). Batches
run as `npm run explore:guarded -- batch1 8` — `comfyui/guard.sh` starts a
fresh ComfyUI, runs eight images, stops it, checks Windows free memory, and
repeats; a watcher kills the server if the driver's shared pool passes 4 GB
(the leak's signature) or free memory crosses 10 GB mid-chunk.
The harness resumes from `runs.jsonl`, so a stopped batch picks up where it
left off, and runs a batch **grouped by LoRA**: a LoRA switch every image
took 12 GB of host memory in one step after five switches and tripped the
watchdog twice on 2026-10-08 (`doc/infra.md`, Home GPU); one LoRA held is
flat. Experiments on the leak itself live in `comfyui/leak_probe.py`.

## What comes out

`var/explore/<batch>/` holds `runs.jsonl` (one line per image: every setting,
the photo(s), the output file, seconds) and `index.html`, a contact sheet:
thumbnails with the settings under each, filters per axis, click for full
size, a checkbox per image that builds a picks list to paste back. Open it
from Windows at
`\\wsl.localhost\monsterpaws-dev\home\oof\monsterpaws\var\explore\<batch>\index.html`.

Any image is reproducible from its `runs.jsonl` line: the harness builds the
same graph from the same record. The output PNGs also carry the graph in
their metadata (dev only — production strips it, item 4 carry-in).

## How a pick becomes the look

Logan's picks from batch 2 name a style family and a handful of settings.
Those settings go into `comfyui/workflows/sdxl-ipadapter-v1.api.json`, the
ADR-0004 style note records the family with the reference images, and the
picked images become the first entries of the style set the LoRA learns
from (decision 5: our own reference art, never a shelter photo).

## Batch 1 — first read (Claude, 2026-10-08; Logan's picks decide)

From a strip of twenty representative images, before the sheet was opened:

- **Weight 0.8, linear, full range reproduces the photo.** Composition,
  background, lighting and the *other dog in frame* all come through; the
  storybook prompt is invisible at that weight — the "photo" and
  "storybook" columns are near-identical. Identity is strongest here and
  style is absent.
- **Weight 0.5, "style and composition", ending at 0.6 lets the prompt
  in** and costs identity: Plum loses the wrinkles and ear set and reads as
  a generic grey puppy; Ducky smooths toward a cartoon pit. On the hard
  photos the second dog is dropped or hallucinated into another breed.
  This corner is where batch 2's style families must start, not 0.8.
- **Photo-in-latent ("both") keeps the exact pose and crop** and brings
  everything in the frame with it; the adapter adds little on top at 0.8.
  Image-to-image without the adapter loses the animal (Plum becomes a
  brown spaniel, Ducky a golden) — identity is the adapter's job alone.
- **The second animal is the real shelter-photo problem.** The adapter sees
  the whole 224 px centre crop, so a companion in frame is reproduced as
  faithfully as the subject. Before batch 3: crop or mask to the subject
  before the encoder (the node's `attn_mask`, or a detector-driven crop) —
  a pipeline stage, not a knob.

## Batch 1 — verdict (Logan, 2026-10-08)

"In general very poor in terms of accuracy." Four picks, chosen for the art
and explicitly *not* for likeness:

- `067-Plum-hard-img2img-storybook-s7-d0.6`
- `066-Plum-hard-img2img-photo-s7-d0.6`
- `077-Ducky-clean-adapter-storybook-s7-w0.5-linear-e0.6`
- `135-Ducky-hard-img2img-storybook-s7-d0.6`

Three of the four have no adapter at all; the fourth is the weakest adapter
setting in the batch. Read together with the first-read strip, the finding
is structural, not a matter of a better weight: the adapter's weight scales
*one* embedding that carries identity and style together, so 0.8 is a
photocopy (companion, sidewalk and all, the storybook prompt invisible) and
0.5 is a different dog in a nice style. There is no setting in between, and
the encoder was only ever shown a 224 px frame in which the face is a few
dozen pixels. That is what batch 1b separates: identity from the pixels of
the subject (crops) and the listing's words (describe), style from the
weights (LoRA) — which is the ADR-0004 architecture, tested before we train
anything.

## Batch 1b — first read (Claude, 2026-10-08 evening; Logan's picks decide)

From the four comparison grids (`var/explore/b1b-<animal>-<photo>.jpg`:
storybook prompt, rows crop × describe, columns LoRA × weight):

- **Weight 0.6 with a LoRA in the weights is the first configuration that
  is both styled and recognisable.** Little Tinies gives a cartoon grey
  cane corso with the chest patch; watercolor a soft wash over a Plum who
  keeps his wrinkles, and Ducky standing in a painted field. At 0.8 the
  adapter overrides even the LoRA — the watercolor column is a photograph
  again. Batch 2's weights are 0.5–0.6, not 0.8.
- **The listing description fixes what the LoRA breaks.** Under Little
  Tinies with "dog", Plum comes out brown and tan and the top-down Ducky
  becomes a collie; with the description both keep colour and breed. It
  costs nothing and is the default from here.
- **The subject crop removes the companion every time** — no Ducky on
  Plum's sidewalk, no Plum on the kitchen floor — and keeps the pose. **The
  head crop is the strongest identity signal and the narrowest picture**:
  every output is a head portrait, and it copies the photo's defects
  faithfully (Plum's eye-shine, Ducky mid-lick). Subject crop is the
  production default; the head crop's place is as a second image beside
  it in the multi-photo path (batch 3).
- **Padding still shows at 0.8** as soft bands where a tall box was
  squared; at 0.6 it is absorbed into the background. The rule for the
  detector stage: grow the box to a square inside the photo, stopping at
  any other animal's box, and pad only what is left.
- **Prompt-only style is dead.** The `none` column is a photograph at both
  weights in all 24 rows, stronger negative included. Style comes from
  weights — the ADR-0004 architecture, now observed rather than assumed.
  The question this leaves for Logan: can an openly licensed LoRA *be* a
  look (watercolor is Apache-2.0), or is it only the target item 9 trains
  toward? Decision 5 currently says our own.
- Throughput unchanged: 16.5 s median over 192 images; a LoRA load adds
  ~8 s to the first image after a switch. Clean across eleven restarts once
  grouped by LoRA.

## Batch 1b — Logan's picks (2026-10-09)

Eleven picks "for an interesting art style, not fully correct in likeness
or anatomy": ten Little Tinies, nine of them at weight 0.6; one watercolor
head crop; seven subject or head crops; six with the listing description.
No full-frame photocopy, no plain-prompt cell, no 0.8 except one head crop.

```
004-Plum-clean-adapter-storybook-s7-tinies-w0.6-linear-e1.0
020-Plum-clean-adapter-storybook-s7-subject-tinies-w0.6-linear-e1.0
028-Plum-clean-adapter-storybook-s7-subject-listing-tinies-w0.6-linear-e1.0
068-Plum-hard-adapter-storybook-s7-subject-tinies-w0.6-linear-e1.0
156-Ducky-hard-adapter-storybook-s7-listing-tinies-w0.6-linear-e1.0
164-Ducky-hard-adapter-storybook-s7-subject-tinies-w0.6-linear-e1.0
172-Ducky-hard-adapter-storybook-s7-subject-listing-tinies-w0.6-linear-e1.0
191-Ducky-hard-adapter-storybook-s7-head-listing-tinies-w0.8-linear-e1.0
044-Plum-clean-adapter-storybook-s7-head-listing-tinies-w0.6-linear-e1.0
092-Plum-hard-adapter-storybook-s7-head-listing-tinies-w0.6-linear-e1.0
179-Ducky-hard-adapter-storybook-s7-head-watercolor-w0.6-linear-e1.0
```

His read, which sets the bar for batch 2: a stylised rendering hides the
gap in likeness as long as the animal is anatomically a dog, the same
colour, and carries the same distinguishing features; realism exposes
every error (two bodies under one head, broken outlines, odd colour).
Batch 2 is on hold while that bar and the base-model question are talked
through (2026-10-09).

## Batch 1c — first read (Claude, 2026-10-09; Logan's picks decide)

Grid: `var/explore/b1c.jpg` (rows photo × seed, columns control strength
@ end). Sheet: `var/explore/batch1c/index.html`.

- **The outline fixes anatomy and most of the likeness in one move.** All
  32 controlled images are a correctly built dog in the photo's exact pose;
  Plum's wrinkles, ear set and head tilt and Ducky's chest blaze, collar
  and tongue come from the canny, not the adapter. The eight uncontrolled
  cells are the cute cartoons of 1b with the looser likeness. Seeds change
  little once the pose is locked, which is a throughput fact: fewer
  candidates per keepsake.
- **The cost is style.** The Tinies look softens toward a painted
  photograph as strength rises; 0.4 ending at 0.5 of the schedule keeps the
  most illustration, 0.7 ending at 0.8 the least. Batch 2's style question
  now includes a control strength axis, and the LoRA has to be strong
  enough to survive it.
- **The canny inherits the padding.** A tall subject box padded to square
  gives an outline with nothing in the margins, and the model paints flat
  bands there (Plum's sidewalk, Ducky's floor). Padding was always a
  stand-in; the fix is to render the box at its own aspect.

**Batch 1d — correctness step 1b: no padding** (Plum, Ducky; small). The
subject box is cut without padding and the latent takes the nearest SDXL
bucket to its aspect (1024², 896×1152, 832×1216, 1152×896, 1216×832); the
canny comes from the unpadded box scaled to that bucket; the encoder's
`PrepImageForClipVision` crops from the top for tall boxes so the head
stays in its 224 px. Held at 1c's best corner (control 0.4 @ 0.5 and 0.7 @
0.8), two seeds. If it holds, the detector rule in the roadmap simplifies
to "the box, at its aspect".

## Batch 1d — first read (Claude, 2026-10-09; Logan's picks decide)

Grid: `var/explore/b1d.jpg`; sheet `var/explore/batch1d/index.html`.

- **No padding, no bands.** Plum's sidewalk box renders at 832×1216, Ducky's
  standing box at 1152×896, and every controlled image is a clean portrait
  with the subject filling its frame. The detector rule in the roadmap
  simplifies to "the box, at its aspect, snapped to an SDXL bucket".
- **Likeness and anatomy hold from 1c**, and the tall portraits of Plum's
  face from the hard photo are the strongest likeness in the exploration.
- **The outline is only as good as the photo's composition.** Ducky's
  top-down kitchen shot gives a top-down kitchen keepsake, correct and
  unflattering, where the uncontrolled cell is a cuter sitting cartoon.
  Production therefore needs to *choose* the photo for the pose (a
  listing's best shot by a pose/quality score, roadmap item 4 carry-in
  beside the detector) and may lower control strength for odd angles.
- Throughput: 18 s median at these buckets, same as 1024².

## Batches 1c and 1d — Logan's picks (2026-10-10)

"We seem to be going the storybook route. Closer to likeness balanced with
an art style." Seven picks, all Tinies at 0.6 on the subject crop with the
listing description; six of seven with the outline on, 0.7 @ 0.8 in the
square batch and 0.4 @ 0.8 at the box's own aspect; six of seven from the
clean photos.

```
batch1c: 004 Plum clean cn0.7e0.8 · 013 Plum hard cn0.7e0.5 · 020 Ducky clean (no control)
         024 Ducky clean cn0.7e0.8 · 029 Ducky clean s11 cn0.7e0.8
batch1d: 007 Plum clean s11 box cn0.4e0.8 · 027 Ducky clean s11 box cn0.4e0.8
```

The corner for step 2: Tinies 0.6, subject box at its aspect, listing
description, canny 0.4–0.7 ending at 0.8, the listing's cleanest photo.

## Step 2 — the likeness scorer, first measurement (2026-10-10)

`comfyui/likeness.py` (`npm run explore:score -- <batch> [--picks]`) embeds
each output and the subject crop the model was shown with the same ViT-H
encoder the adapter uses, and scores their cosine; the sheet shows the
number and sorts by it; `tests/likeness.test.ts` pins the ranking math.
It runs on the CPU in the bounded explore container with the weights
loaded directly, not through ComfyUI's loader (which stalled the WSL VM
three times that day).

Measured against Logan's eighteen picks across 1b, 1c and 1d:

| batch | pick ranks, whole batch | pick ranks, among same-workflow siblings |
| --- | --- | --- |
| 1b (192) | 110–188 | 5 of 11 first of two, 6 second |
| 1c (40) | 11–40 | 5, 6, 6, 10, 10 of 10 |
| 1d (40) | 1, 15 | 1 of 10, 1 of 10 |

What the number rewards: the uncontrolled photocopies (0.90–0.92), then
watercolor (0.78), then Little Tinies (0.69); the eight lowest scores in
1b are the most stylised images, several of them good cartoons with the
right markings, and the four highest are reproductions of Plum's listing
photo. **Cosine to the photo in CLIP space measures how little style was
applied, not whether the animal is the animal.** Among siblings of one
workflow it is near a coin flip against Logan's eye.

So ADR-0004's "CLIP similarity picks best of 3–4" needs a style-invariant
form before it can choose anything. Candidates, each testable against the
same eighteen picks:

1. **A styled reference**: pass the photo itself through the same LoRA at
   low denoise, and score candidates against *that*, so the style term
   cancels and what is left is the animal.
2. **Consensus**: among a workflow's candidates, the one nearest the
   others' centroid is the one without the artefact; outliers are the
   broken ones. Needs no reference at all.
3. **A shape-first embedding** (DINOv2) in place of CLIP, which weighs
   structure over texture.
4. **Keep CLIP only as a floor**: reject below a threshold, choose by (2).

The eighteen picks are the first labelled set of the image eval harness;
every candidate metric is judged by where it ranks them. They have one
weakness for the consensus test: no batch so far has more than two seeds
per workflow, and consensus among two is a coin toss by construction.

**Batch 2a — candidates** (Plum, Ducky; 48 images) is production's shape:
the picked corner held still (subject box at its aspect, listing
description, Little Tinies, weight 0.6, canny 0.4 and 0.7 ending at 0.8),
six seeds per photo and control setting. Logan picks the best of each six
— eight labelled groups — and every judge (cosine to the photo, consensus,
the styled reference, a shape-first embedding) is scored by how often it
agrees. `npm run explore:consensus -- batch2a` reports the consensus ranks
once picks.txt exists. Ran 2026-10-10 evening: 48/48 at 18 s median; grid
`var/explore/batch2a/grid-candidates.jpg` (eight rows of six). First look:
the pose is identical down a row, the seeds move background, wash and
small facial detail; the top-down Ducky rows hold the only candidates with
a visibly wrong face, which is what consensus exists to catch.

## Step 2 — the judge, second measurement (batch 2a, 2026-10-10)

Logan picked four, one per photo rather than one per row, all seed 11 but
one, split evenly between control 0.4 and 0.7:

```
004 Plum clean s11 cn0.4 · 017 Plum hard s11 cn0.7 · 028 Ducky clean s11 cn0.4 · 045 Ducky hard s23 cn0.7
```

| pick | cosine to photo, in its row of 6 | consensus, in its row of 6 |
| --- | --- | --- |
| Plum clean | 1 | 5 |
| Plum hard | 2 | 2 |
| Ducky clean | 3 | 1 |
| Ducky hard | 3 | 2 |

Both beat chance (3.5) by a little and neither is a chooser. What the
outlier strip (`grid-outliers.jpg`) shows is the useful half: the three
candidates consensus ranks lowest *by a margin* — centrality 0.85–0.90
against row bests of 0.92–0.97 — are the batch's three real defects:
Ducky sliding out of the top-down frame twice, and a Plum painted with a
mustard-yellow body and a scribbled tag (Logan: not smeared, and at full
size he is right — it is a colour defect, not a broken face). The other
five "outliers" are good pictures with a different background, Logan's
Plum pick among them. With the pose locked, what Logan
chooses on is wash, background and expression, and no embedding distance
sees that; what an embedding distance does see is the picture that went
wrong.

**Auto-QC v0, the rule to build (runs silent: ADR-0004 as amended 2026-10-14 gives the donor all four, so the rule scores and records but does not gate):** generate
four; compute each candidate's mean cosine to the other three; **reject**
any more than ~0.03 below the best; among the survivors prefer the highest
cosine to the subject crop, and treat the remaining choice as taste —
which is the donor's, or a seed we like, not the machine's. Thresholds are
read off this batch and will move with the LoRA; every batch Logan picks
grows the labelled set (22 picks now) the rule is re-checked against.

**v1 check (2026-10-10, `var/explore/batchv1/`)**: the settings on two
photos the exploration had never seen (Plum lying in grass, Ducky on the
couch), four candidates each, the rule applied blind. Plum: all four
clean, agreement within 0.02, likeness chose seed 11 — a strong Plum. Ducky:
seed 11 sat 0.04 below its siblings and was rejected; at full size it is
the one with the misplaced eye and widened face, the only defect among the
eight. The rule chose seed 19. Two for two on the defects it has met; the
choice among the clean ones remains a nudge. `grid-verdict.jpg` shows all
eight with the verdict.

Deferred, not dropped: the styled reference and a shape-first embedding,
when the labelled set is large enough to tell a 2.2 from a 2.5.

## Throughput — potential improvements (not started)

Measured 2026-10-07 during batch 1: SDXL 1024², 25 steps, 2.3 it/s, ~16 s
per image warm, the card at 100% engine utilisation and 54 °C — compute
never idle but nowhere near its 225 W budget, which is normal for Alchemist
under diffusion kernels and about what an A770 does natively. Headroom, in
the order worth trying, each timed on the same graph and seed so the
numbers compare:

1. **Candidates per sampler call.** Production wants 3–4 candidates per
   keepsake; `EmptyLatentImage.batch_size` 2 or 4 renders them in one pass
   and amortises the fixed cost. Likely the largest win; a workflow change,
   so it lands in the v1 JSON, not a flag.
2. **Arc Control power and temperature limits** (Windows side, Logan): slide
   both to their maximum. Free on a card this cool; worth 5–10% at best.
3. **ComfyUI precision and attention flags** on XPU — `--fp16-unet` vs
   `--bf16-unet`, `--fp16-intermediates`, `--use-pytorch-cross-attention`
   vs the default: the defaults are chosen for CUDA. A ten-minute sweep.
4. **Resolution.** 896² or 768² then a 1024 upscale is a product decision
   (the card is 1024 native) and only if the above is not enough.

Run the sweep after batch 1, before the throughput number goes into
ADR-0004's financials or item 4's worker sizing.
