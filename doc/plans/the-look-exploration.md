# The look — exploration plan (roadmap item 3c, ADR-0004 as amended 2026-10-05)

Status: batch 1b complete 2026-10-08 (192 images, sheet built), awaiting Logan's picks; batch 2 is redesigned below from 1b's first read and follows the picks. Owner: Logan picks; Claude runs.

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
repeats; a watcher kills the server if free memory crosses 20 GB mid-chunk.
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
