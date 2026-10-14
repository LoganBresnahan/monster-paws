# Base-model candidates for the keepsake look (ADR-0004 as amended 2026-10-05)

Status: written 2026-10-10 from the look exploration's correctness step 3
(`the-look-exploration.md`). SDXL base is what runs; everything below is a
candidate for an experiment, not a decision. Licences were read from each
model card on 2026-10-10 and must be re-read before any of them ships.
Owner: Logan decides which experiments run; Claude runs them.

## What a candidate has to offer

The look is not the base model alone. It is base model × identity
conditioning (an IP-Adapter class model that reads the photo) × pose
(a ControlNet that reads the outline) × style (a LoRA). A better base with
no adapter and no ControlNet ecosystem is a better painter who cannot see
the dog. So each row carries three questions: can it run on the A770's
16 GB beside a 32 GB VM; can we ship its licence; and does its ecosystem
have the two conditioning models we depend on.

Speed figures are estimates against our measured SDXL baseline (18 s an
image at 25 steps, 1024², the card ~full) and will be replaced by
measurements. "In RAM" means the weights stay in system memory and stream
over the bus (~25 GB/s against ~560 GB/s on-card): usable, and roughly
twenty times slower per step than resident weights.

*Second look* notes were added on 2026-10-11 after a re-check of the
table. Where a note disagrees with its cell, the note wins. The cell
stays as written so the record shows what changed. **Confirmed
2026-10-11** against the model cards and file listings: Stability's
ControlNet repo holds only `sd3.5_large_*` files and InstantX's IP-Adapter
names Large as its base, with no Medium counterpart of either; FLUX.2
[klein] 4B and its non-distilled base are Apache-2.0 on their cards and
the card states text-to-image plus multi-reference editing in one model
at 13 GB VRAM, while klein 9B is FLUX Non-Commercial; Z-Image-Turbo's
encoder is `qwen_3_4b.safetensors` at 7.5 GB (fp8 5.2 GB) beside an
11.5 GB transformer; Qwen-Image's fp8 transformer is 19.0 GB plus an
8.7 GB encoder; Lumina 2's `model_index.json` names `Gemma2Model` as the
text encoder; Kolors' README opens the weights for research and asks
commercial users to register with Kuaishou by questionnaire.

## The list

| model | params | licence (read 2026-10-10) | ship? | on the Arc | identity + pose tooling | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **SDXL 1.0 base** (running) | 2.6 B UNet | CreativeML OpenRAIL++-M | yes | fits with adapter + ControlNet + LoRA, 18 s | richest: IP-Adapter Plus (ours), xinsir ControlNets, thousands of LoRAs | the baseline; anatomy is its weakness |
| SDXL fine-tunes: Juggernaut XL v9, DreamShaper XL | 2.6 B | CreativeML OpenRAIL-M / OpenRAIL++ | yes | identical to base | identical to base — every SDXL adapter and ControlNet works | cheapest "better": same graph, swap the checkpoint; better prompt adherence and anatomy than base; worth one batch |
| **SD 3.5 Medium** | 2.5 B MMDiT | Stability AI Community (free under US$1 M annual revenue; gated download) | yes, with the revenue clause recorded | fits comfortably, est. 15–25 s | official ControlNets (canny, depth, blur), InstantX IP-Adapter; no style-LoRA ecosystem to speak of | the step that costs nothing: better anatomy and text understanding than SDXL, same card budget; **first candidate to run** *Second look 2026-10-11: Stability's official ControlNets (canny, depth, blur) and the InstantX IP-Adapter are for SD 3.5 Large. Stability promised 2B versions in Nov 2024; none found. Without them Medium runs text-to-image and image-to-image only, so "first candidate" is withdrawn and the order is Logan's to set.* |
| SD 3.5 Large | 8 B | Stability AI Community | yes, same clause | fp8 ~8 GB on card or fp16 in RAM; est. 40–90 s | as Medium | Medium first; Large only if Medium's anatomy is not enough *Second look 2026-10-11: the official ControlNets and the InstantX IP-Adapter are Large's, not Medium's. Large is the SD 3.5 that comes with identity + pose tooling, and fp8 fits the card.* |
| **FLUX.1 [dev]** | 12 B | FLUX.1-dev Non-Commercial | **no** — experiment only, never serves a donor | fp16 23.8 GB **in RAM** (needs the VM cap at 48 GB); fp8 ~12 GB on card with offload; GGUF Q4 ~7 GB on card; est. 1–3 min / 40–60 s / 30–45 s | XLabs and InstantX IP-Adapters, InstantX ControlNet union (licences to read); Kontext is the editing variant | the quality reference: tells us how far SDXL is from the state of the art; the licence makes it a yardstick, not a venue |
| FLUX.1 [schnell] | 12 B, 4-step distilled | Apache-2.0 | yes | as dev | adapters built for dev mostly work, less well | the only FLUX we could ship; distilled models take LoRAs and adapters worse — test, do not assume *Second look 2026-10-11: no longer the only one. FLUX.2 [klein] 4B is Apache-2.0, smaller and newer (row below).* |
| Chroma | 8.9 B, from schnell | Apache-2.0 | yes | fp8 ~9 GB; est. 40–60 s | FLUX-family tooling, partially | the community's "shippable FLUX"; worth a run after schnell |
| FLUX.2 [dev] | 32 B | FLUX Non-Commercial | no | Q4 ~18 GB — over the card; in RAM only | young | out of reach on this card and this licence; note and move on |
| **FLUX.2 [klein] 4B** *(added on second look, 2026-10-11)* | 4 B, 4-step distilled; a non-distilled Base 4B exists for fine-tuning | Apache-2.0 (model card read 2026-10-11; the non-distilled Base 4B is Apache-2.0 too) | yes | ~13 GB VRAM by the card; est. 5–15 s | generation and reference-image editing in one model (to verify), so the photo itself can carry identity; ControlNet and IP-Adapter: to check | the shippable FLUX. It is newer and smaller than schnell and may do what Kontext does under a licence we can ship. A strong candidate for Experiment B. |
| FLUX.2 [klein] 9B *(added on second look, 2026-10-11)* | 9 B | FLUX Non-Commercial | no | fits the card | as 4B | a yardstick only, like FLUX.1 [dev]; it measures what the 4B gives up |
| FLUX.1 Kontext [dev] | 12 B editing model | FLUX.1-dev Non-Commercial | no | as FLUX dev | none needed — it edits the photo itself | the likeness breakthrough we cannot ship; one experiment to measure the gap we are closing with adapters |
| **Z-Image-Turbo** | 6 B, 8-step distilled | Apache-2.0 | yes | fp16 ~12 GB; est. 10–20 s | ControlNet exists; IP-Adapter: to check | new (late 2025), strong, fast, permissive; the most interesting unknown on the list *Second look 2026-10-11: the ~12 GB is the transformer alone. Its Qwen3-4B text encoder (~8 GB) fits beside it only because ComfyUI moves it off the card after encoding.* |
| Qwen-Image | 20 B | Apache-2.0 | yes | Q4 ~11 GB on card, slow; fp16 in RAM impossible under 48 GB | ControlNet (InstantX); IP-Adapter: none known | the open editing-model family; Qwen-Image-Edit does what Kontext does under a licence we can ship, at a size this card struggles with *Second look 2026-10-11: fp8 is ~20 GB, the largest shippable form on the list that runs on a card. A 24 GB card holds it with little room for a ControlNet or LoRA beside it.* |
| HiDream-I1 | 17 B | MIT | yes | Q4 ~10 GB, slow; needs Llama-3.1 text encoder (Llama licence) | thin | permissive but heavy; the encoder's licence travels with it |
| Lumina-Image 2.0 | 2.6 B | Apache-2.0 | yes | fits easily | thin | light and permissive; little tooling *Second look 2026-10-11: the text encoder is Gemma-2-2B, so Gemma's terms come with it, as Llama's do with HiDream. Read them before it ships.* |
| Kolors | SDXL-class UNet | Apache-2.0 | yes | fits | IP-Adapter-Plus (Kolors), ControlNets | an SDXL-shaped model with a stronger text encoder (ChatGLM); interesting if SDXL fine-tunes are not enough *Second look 2026-10-11: Apache-2.0 covers the code only. The README opens the weights for research and requires commercial users to register with Kuaishou by questionnaire. Ship means register first.* |
| PixArt-Σ | 0.6 B DiT | OpenRAIL++ | yes | tiny, est. <10 s | thin | fast, but no identity tooling to speak of |
| Playground v2.5 | SDXL-class | Playground community licence (read before use) | read it | fits | SDXL tooling mostly | aesthetic SDXL variant; licence first |

Gated repositories (Stability, Black Forest Labs) need a Hugging Face
token to download; `Comfy-Org/flux1-dev` and `city96/FLUX.1-dev-gguf`
mirror the same weights ungated under the same licence. The fetcher reads
`hf:` sources anonymously, so gated models land through the mirror or a
one-time manual fetch into the store, and the manifest line still carries
the hash and the licence as read.

## Experiment A — FLUX.1 [dev] on this card, three ways (Logan's ask, 2026-10-10)

The question is quality and cost, not shipping: how much better is the
state of the art at the two photos the v1 check used, and what does it
cost on this box in each form.

| form | weights | where | needs | expected |
| --- | --- | --- | --- | --- |
| A1 fp16 | 23.8 GB transformer + T5-XXL fp8 4.9 GB + CLIP-L + VAE | system RAM, streamed | VM cap raised to 48 GB in `.wslconfig` for the experiment (the box has 64; Windows keeps ~16); back to 32 after | 1–3 min an image; the reference quality |
| A2 fp8 | 11.9 GB transformer | on card with offload | nothing new | 40–60 s; near-reference quality |
| A3 GGUF Q4_K_S | ~6.8 GB | on card | the ComfyUI-GGUF node pack, pinned by sha (Apache-2.0) | 30–45 s; visible but small quality cost |

All three: the two v1-check photos, text-to-image with the listing
description first (how does the painter paint "a grey cane corso puppy
lying in grass" with no help), then image-to-image from the subject box at
denoise 0.5–0.7 (the cheapest identity help). The adapter and ControlNet
for FLUX are a second experiment once A says the base is worth it. Every
run under `comfyui/guard.sh`; the pool rule applies unchanged; the VM cap
change is Logan's `wsl --shutdown`.

*Second look 2026-10-11: A1 streams ~29 GB of weights through the VM's
CPU memory. A sudden multi-GB CPU allocation is what froze the VM three
times on 2026-10-10 (`doc/issues.md`, the ViT-H loads). A1 waits until
the scorer's re-test proves the `.wslconfig` change, and then runs with
VM memory watched from a second shell. A2 and A3 keep their weights on
the card and are not affected.*

Manifest lines for the experiment carry licence `FLUX-1-dev-NC` and the
comment *experiment only — never serves a donor*; the entrypoint's refusal
to serve an unlisted model is unchanged, and the worker never references
these files.

## Experiment B — the cheap steps first

In the order of cost, each one batch against the v1-check photos with the
current adapter, ControlNet and LoRA where the model allows:

1. SDXL fine-tune (Juggernaut XL v9 or DreamShaper XL): the same graph,
   one checkpoint swap. Measures how much of SDXL's anatomy problem is the
   base checkpoint rather than the architecture.
2. SD 3.5 Medium with its official canny ControlNet and the InstantX
   IP-Adapter: the same idea on a better architecture, same card budget.
3. Z-Image-Turbo: the permissive unknown; text-to-image and image-to-image
   first, tooling second.

*Second look 2026-10-11: step 2's ControlNet and IP-Adapter exist for SD
3.5 Large, not Medium (see its row). Step 2 either runs Medium with
text-to-image and image-to-image only, or becomes Large at fp8 with the
tooling. FLUX.2 [klein] 4B is a candidate fourth step: shippable, fits,
and possibly able to carry identity through reference editing. The SD
3.5 Medium row's "first candidate" and this list's order disagree, and Experiment A is
Logan's own ask; Logan sets the order across A and B.*

## Running it (2026-10-11)

Experiment B is `comfyui/explore/batch3a.json`: the harness gained a
`families` axis (`zimage`, `klein`, `chroma`; `sdxl` is the default) with
one graph builder per family carrying the sampler settings each release
documents — Z-Image-Turbo 8 steps at cfg 1 with AuraFlow shift 3, klein 4
steps at cfg 1, Chroma 26 steps at cfg 4 with a real negative — and three
ways the photo enters: not at all, in the latent at denoise 0.6, or (klein)
as a `ReferenceLatent` the model reads. Models and their text encoders are
in `models.manifest` with licences; klein 4B and Z-Image share one Qwen3-4B
encoder file. Chroma ran as planned (8 images, 102–147 s each, the card full and the
pool at 2.9 GB — slow because it spills). Klein and Z-Image in bf16 beside
the 7.5 GB Qwen3 encoder pushed the pool to 4.4 GB and the guard killed
them, so both run with fp8 weights and the fp8 encoder (noted in the
family table); their quality is therefore the fp8 quality, which is also
what this card could ship. The batch runs under the guard in chunks of four so a
process never holds two families; the SDXL baseline for the same two
photos is `batchv1`. Grid, sheet and likeness score apply unchanged;
seconds per image are in the run records.

## Experiment B — first read (Claude, 2026-10-11; Logan's picks decide)

Grid: `var/explore/batch3a/grid-bakeoff.jpg` — rows Plum and Ducky at two
seeds, columns the SDXL v1 stack (adapter + outline + Little Tinies), then
each family unaided, with the photo in the latent, and klein with the
photo as a read reference. Sheet: `var/explore/batch3a/index.html`.

| column | seconds | likeness | what the eye says |
| --- | --- | --- | --- |
| SDXL v1 stack | 27–30 | 0.72 | the known look: identity from the adapter and outline, Tinies style |
| Z-Image txt2img | 12–55 | 0.64 | a clean, well-drawn watercolor of *a* grey puppy / tan pit, colours and markings from the words, no likeness |
| Z-Image img2img 0.6 | 14 | 0.89 | the photo, barely touched — eight distilled steps at denoise 0.6 restyle nothing |
| klein txt2img | 4–8 | 0.63 | as Z-Image, softer and simpler |
| klein img2img 0.6 | 6–8 | 0.83 | the photo with a light wash; identity by copying |
| **klein reference** | **9** | 0.67 | **a watercolor illustration that is recognisably the dog** — Plum's grey, ear set, tag and head pose; Ducky's blaze, collar and lie — from the photo read as a reference, with no adapter, ControlNet or LoRA, in four steps |
| Chroma txt2img | 102–147 | 0.59 | a cute cartoon dog, generic; the card is too small for it to be fast |
| Chroma img2img 0.6 | 104–116 | 0.85 | the photo, lightly painted |

The likeness number behaves as it always has: it rewards the photocopies
(img2img at 0.83–0.89) and reads styled images low, so it ranks klein
reference below the SDXL stack while the eye puts them close. The eye is
the judge here; Logan's picks decide.

Three things that look true from this batch:

- **FLUX.2 klein 4B's reference mode is the result.** It does in one
  nine-second, four-step pass what the SDXL stack needed three bolt-ons
  for, under Apache-2.0, at fp8 on this card. Likeness is softer than the
  outline gives (the pose is interpreted, not traced) and the style is
  whatever the prompt says — a generic soft watercolor today, with no LoRA
  ecosystem yet, though the non-distilled Base 4B exists for training one.
- **Unaided, every candidate draws a better dog than SDXL base** — clean
  anatomy, colours and markings straight from the description — and none
  of them knows which dog. Identity still has to come from the photo.
- **Image-to-image at 0.6 is not a style path for distilled models**: with
  four or eight steps it returns the photo. Chroma is correct and far too
  slow here; it stays a yardstick.

Logan's read (2026-10-11): "all better than the SDXL. klein seems to be
the front runner for sure but I don't want to forgo Z-Image yet — the
images have a sort of speckled quality I would try to reduce, but the
realism was really good, though accuracy definitely less than klein."
So two tracks: klein forward on identity, Z-Image forward on the speckle
(fp8 weights and eight distilled steps are the two suspects) and on
accuracy (its own ControlNet, below).

What would decide klein: Logan's read of likeness on these eight; a run
at the full 1024 bucket set with two or three reference crops (the
subject and the head together, which its card says it supports); whether
a style can be held across animals by prompt alone or needs a klein LoRA;
and the auto-QC rule re-measured on klein candidates. If those hold, the
ADR-0004 amendment is "FLUX.2 klein 4B, reference-conditioned" with SDXL
kept as the known-good fallback.

## Batch 3b — klein forward, first read (2026-10-11)

Grid `var/explore/batch3b/grid-references.jpg` (one reference beside two),
pairs at full size in `pair-large.jpg`. 24 images, 9–12 s each, pool flat.

- **Style follows the prompt, identity follows the reference, across two
  families.** "Cel-shaded cartoon" gives flat colour and clean outlines,
  "storybook watercolor" gives washes and paper; both hold Plum's grey and
  tag and Ducky's blaze and ears. Seeds move little, because the reference
  fixes the composition — the couch, the shirt's lettering and the grass
  all come along, so the crop is doing the framing job here too.
- **The head as a second reference sharpens the face** — more defined
  wrinkles and jowls on Plum, a tighter muzzle on Ducky — at no cost in
  time (9 → 10–12 s). Worth keeping.
- **Two tells to watch.** Plum's white chest patch is painted as a white
  bandana or scarf in the watercolors (the description's words "white
  chest patch" read as clothing, or the collar region misread), and his
  grey leans taupe. The description wording and the reference crop are
  both levers; neither is a model fault yet.

## Batch 3c — Z-Image forward, first read (2026-10-11)

Grid `var/explore/batch3c/grid-speckle.jpg` (8 steps beside 16, fp8, two
seeds per dog, unaided). What ran and what could not:

- **bf16 weights do not fit**: beside the 5 GB fp8 encoder the 11.5 GB
  transformer pushed the driver pool to 4.5–4.8 GB on six attempts and
  the guard cut each. The fp8-versus-bf16 half of the speckle question is
  unanswerable on this card. *Second look 2026-10-13: unanswerable only
  with the encoder on the card — see "A second card, and the encoder on
  the CPU" below.*
- **The Fun ControlNet does not fit either**: the 2.9 GB patch on the fp8
  transformer spilled the pool to 4.4 GB. The one lever left is the fp4
  encoder (3.2 GB, in the same repackage); it goes on the avenues list.
  *Second look 2026-10-13: not the one lever left — the encoder can run
  on the CPU instead, at no loss (below).*
- **Eight against sixteen steps: the same picture.** Distilled models
  stop improving at their training step count; the extra eight steps cost
  10 s and changed nothing visible. The grain Logan called speckle is
  still there at 16 — and looking at it closely, much of it is the model
  painting a *brindle* coat on "tan pit bull mix" (Ducky is solid tan) and
  a mottled grey on Plum. Part prior, part fp8, and only the prior can be
  tested here (a wording change: "solid tan", "smooth grey coat").
- Unaided, the drawings remain the cleanest anatomy of the day; identity
  is zero without a reference path, and Z-Image's reference path (Omni)
  needs an image encoder we have not located.

## Direction: klein only for now (Logan, 2026-10-11 evening)

Logan's read of 3b: "cartoon looks awful so we don't have to go that
route for now. The Plum portraits with the storybook prompt look really
good, though it does think his chest mark is a bandana sometimes. The
Ducky photos are less accurate as far as anatomy goes — the storybook
versions make her look very stubby. It's good we are testing with these
variations because other photos from shelters will be all over the place."

So: storybook family only; the two tells become the next batch's axes.
The stubbiness is the reference doing its job too well — Ducky's couch
photo is foreshortened, lying toward the camera, and the reference fixes
the pose, foreshortening included. Three levers, one batch (**4a**):

| lever | values |
| --- | --- |
| description | as listed · reworded: "a small patch of white fur on his chest", "solid tan … white fur on her chest and paws" |
| pose in the prompt | none · "sitting upright and facing the viewer" |
| references | the one photo · plus the clean portrait · plus the hard photo too — a listing's whole set, each a further reference the model reads |

Head crop of the first photo always included. Two seeds. 48 images at
~10 s. What success looks like: a Ducky with legs, Plum with fur on his
chest rather than cloth, identity holding or improving as references are
added — which is production's shape, since a listing arrives with several
photos.

## Batch 4a — first read (2026-10-11 evening)

Grids `var/explore/batch4a/grid-Plum.jpg` and `grid-Ducky.jpg`: rows
prompt × wording × seed, columns one, three, two photos (alphabetical).
48 images, 10–17 s.

- **The bandana was the wording.** "A small patch of white fur on his
  chest" paints fur in every cell; "white chest patch" paints cloth in
  every one-photo cell. Production's template therefore names markings as
  colours in the listing's own field form and never as positioned nouns
  (roadmap item 4 carry-in, updated).
- **A pose in the prompt beats the reference's pose.** "Sitting upright
  and facing the viewer" seats both dogs front-on with identity intact,
  which removes Ducky's foreshortened stubbiness — and presents the
  underside, where the painter guesses the sex (Logan: Ducky is female;
  the listing says so, the template now does too). Three-quarter poses
  are the fix, batch 4b.
- **A second photo changes the pose and can bring a second dog.** With
  Ducky's standing portrait as the second reference, every storybook cell
  stands her up in profile, proportions right, collar from that photo;
  with the hard photo as a third, one cell composed *two* Duckys. More
  references steady identity and loosen the first photo's pose, and past
  two the model starts arranging them as a scene. Two references plus the
  head is the working number; the judge's outlier rule is what catches
  the two-dog cell.

**Batch 4b**: the production template ("male grey and white cane corso
puppy", "female tan and white pit bull mix"), two references plus head,
three poses (as photographed, sitting three-quarter, standing
three-quarter), three seeds — 18 images, the first run of the recipe as
the worker would build it.

## Batch 4b — first read (2026-10-11 evening)

Grid `var/explore/batch4b/grid-poses.jpg`: rows animal × seed, columns as
photographed, sitting three-quarter, standing three-quarter. 18 images.

- **The three-quarter poses are keepsake poses.** Both dogs sit and stand
  in clean, well-proportioned three-quarter views with the underside out
  of frame, identity intact across three seeds, Ducky's collar carried
  from her second photo. This is the pose set for production.
- **"grey and white" paints Ducky's markings on Plum** (Logan saw it in
  the first images): a face blaze and white socks appear in every
  three-quarter cell and fade only in the as-photographed cells, where
  the reference's own white patch dominates. The listing's two colour
  fields cannot be joined with "and"; batch 4c tests primary-only and
  "mostly grey with a little white" against it.
- Ducky's "female tan and white" produced no such error, because her
  white *is* a blaze and socks. The failure is the template meeting a dog
  whose secondary colour is a small patch, which shelter listings will
  present constantly.

## Batch 4c — first read (2026-10-11 evening)

Grid `var/explore/batch4c/grid-colours.jpg`: columns "grey and white" ·
primary colour only · "mostly grey with a little white"; sitting
three-quarter, two references plus head, two seeds.

- **Primary colour only is the rule.** "Male grey cane corso puppy" gives
  a solid grey Plum with his real white chest patch, carried from the
  reference; "grey and white" gives the blaze and socks again; "mostly
  grey with a little white" is also right but says nothing the photo does
  not already say. Ducky is right in all three, because her white *is* a
  blaze and socks and the reference supplies it either way.
- So the secondary and tertiary colour fields are dropped from the
  template. The photo carries the markings; the words carry sex, the
  primary colour, breed, age and species. Written into the roadmap item 4
  carry-in.

## Batch 6a — beyond the crew, first read (Claude, 2026-10-12; Logan's picks decide)

`comfyui/explore/batch6a.json`: the batch-5b recipe (klein, the grown
subject crop plus the detector's head, the listing's words, sit and stand
three-quarter, seeds 7 and 11) on twelve Commons test animals, one photo
each, cut entirely by the detector (ADR-0026). Words written from the
photo, no sex. 48 images at 10.5–12 s (one reference photo, not two), pool
flat at 0.8 GB. Grid `var/explore/batch6a/grid-animal-x-prompt-seed.jpg`;
the three-legged rows in `grid-great-dane.jpg`, `grid-orange-cat.jpg`,
`grid-white-dog.jpg`.

- **Every species comes out as itself**, all 48 single, whole animals:
  iguana, pig, goat, turtle, rat, rabbit, chinchilla, budgie, parakeet,
  two dogs and a cat. The recipe built on two dogs carries over.
- **"Three-legged" is ignored: 12 of 12 have four legs** — the Great
  Dane, whose photo stands on three, the orange cat and the white dog.
  Words alone do not take a leg off with this prompt.
- **Markings are where likeness is lost.** The white dog loses its dark
  ear patch and becomes a plain cream lab (likeness 0.38–0.40, the
  batch's lowest); the harlequin's patches become a black coat with a
  white chest; the parakeet loses its orange face. The coat's colour
  survives, its pattern does not.
- **The fixed pose bends sensibly for animals that cannot sit**: the
  iguana crouches, the turtle and birds stand or perch; sit and stand
  barely differ for them.
- Likeness: iguana 0.75–0.78 at the top; the rabbit 0.49–0.52, its crop
  kept bars and a dark neighbour that the painting (rightly) drops.

So the open questions move from species to traits: how to make a missing
leg and a marking stick. Candidates, unmeasured: a trait phrased as an
instruction ("with only three legs, missing its front left leg"), the
photo that shows the trait as the head-side reference, and the
words-one-at-a-time batch already planned (`listing-words.md`).
Batch 6b re-ran five of these animals with the colour as RescueGroups
would send it; the read is in `listing-words.md`.

## Batch 7a — klein precision, first read (Claude, 2026-10-14; Logan's picks decide)

`comfyui/explore/batch7a.json`: batch 6a exactly (twelve Commons animals,
two poses, seeds 7 and 11), run once with our on-the-fly fp8 cast of the
bf16 file (`klein`) and once with BFL's own per-tensor-scaled fp8
(`kleinbfl8`, `black-forest-labs/FLUX.2-klein-4b-fp8`, Apache-2.0, card and
LICENSE.md read 2026-10-14). Our ComfyUI reads BFL's quantisation metadata
and, with no fp8 compute on the Arc, multiplies each weight by its scale
back to bf16 per layer, so the weight rounding is the only difference.
bf16 itself was not run (Logan). 96 images, both arms 10.5–12 s (median
12.0), pool flat at 0.9–1.0 GB. Grid
`var/explore/batch7a/grid-animal-seed-x-prompt-family.jpg` (cast left,
BFL right within each pose).

- **The cast arm reproduces batch 6a bit for bit** (48 of 48, pixel
  difference 0). The harness is deterministic on this card, so the BFL
  column differs only by the weights.
- **Same picture every time.** All 48 pairs keep the composition, pose,
  colours and markings. The mean pixel difference is 4.3 of 255 (2.6 on
  the goat, 9.3 on the turtle). What moves is detail: the turtle's head
  turns slightly, and the Great Dane (sit, seed 7) loses the cast's
  hanging tag and gets a slightly crisper face. Close up, BFL's rat fur
  and whiskers are a little finer (rat sit, seed 11).
- **One trait comes back a little**: the parakeet's orange face, which
  batch 6a lost, is stronger in BFL's sit seed 7. That is one image, not
  a rule.
- **Likeness does not separate them**: BFL is +0.004 on average, higher
  in 31 of 48 pairs. That is within the noise between siblings that the
  scorer cannot rank (Step 2).
- **Neither arm shows grain.** In this batch the rounding changes which
  small details are drawn. It does not change their quality.

Read (yours to overrule): BFL's file is at least as good as our cast, often
a little crisper, and costs nothing — same speed, same card, one file
instead of a conversion at load. So it is a candidate for the default
klein weights. The size of the difference also suggests what bf16 would
buy: probably more of the same kind of detail change, not a quality step.
Two guard floor stops (Windows free 9.5 and 7.3 GB, pool flat) are
recorded in `doc/infra.md`. The second came at the switch between the two
weights files, when one process held both, so a production worker should
load one klein file and never switch.

## Avenues (Logan, 2026-10-11)

"Just because we find something that works doesn't mean I don't want to
try other ways of going about it. It's best that we go down many avenues
to figure out the Monster Paws image style." So a result closes nothing
by itself; each avenue below runs until it has a read, and the ADR
amendment names the winner among tried things, not the first thing that
worked.

- klein, reference only (batch 3a/3b) — the front runner.
- klein with two references, subject and head (batch 3b).
- klein with a reference-control LoRA for pose (`xocialize/refcontrol-FLUX.2-klein-4B-pose-lora`; canny and depth exist for the 9B) — licence to read; the klein way of locking a pose, and the lever aimed at Ducky's stubbiness (the reference copies a foreshortened pose). Memory is not the blocker (below).
- klein with a style LoRA (community ones exist for the 4B; our own on Base 4B is the item-9 path).
- klein precision, three ways on the same seeds: our on-the-fly fp8 cast, BFL's own calibrated fp8 (`black-forest-labs/FLUX.2-klein-4b-fp8`), and bf16 with the encoder on the CPU (below). The first two ran (batch 7a): same pictures, BFL's a little crisper, no likeness difference. bf16 is skipped for now (Logan, 2026-10-14).
- Z-Image unaided, 8 vs 16 steps — ran (batch 3c): no difference; bf16 does not fit this card. Next lever: coat wording ("solid tan", "smooth grey").
- Z-Image with its Fun ControlNet from the outline — did not fit at fp8 beside the 5 GB encoder (batch 3c); retry with the encoder on the CPU rather than the fp4 encoder (below). Low priority: the outline locks shape, not colour or markings, and Z-Image has no reference path yet, so it fixes a problem klein does not have.
- Z-Image Omni's reference images (`TextEncodeZImageOmni`), once its image encoder is located.
- SDXL as the known-good fallback; SD 3.5 Large fp8 with its tooling when a token for the gated download is set up.
- FLUX.1 dev as the yardstick (Experiment A), after the VM memory re-test.

## A second card, and the encoder on the CPU (discussion, 2026-10-13)

Logan asked what a second 16 GB A770 would buy if it went to more or
better models rather than to development or queue capacity (the trigger
for buying one is ADR-0004's revisit list). Working through it turned up
a lever on the one card we have, which takes most of the list away.

**Two cards are not one 32 GB card.** They do not pool memory, and core
ComfyUI places a model on one device. Splitting one model's layers across
cards is a community custom node, written for CUDA first; XPU support is
unchecked.

**The encoder can leave the card.** ComfyUI's `CLIPLoader` takes
`device: cpu` (read in the `monster-paws-comfyui:dev` image's `nodes.py`,
2026-10-13). The Qwen3-4B encoder is 5.4 GB of klein's resident 9.3 GB and
runs once per prompt — once per keepsake, however many candidates — so on
the CPU it costs a few seconds per keepsake (unmeasured) and frees 5.4 GB
of card. Every "does not fit" in batch 3a and 3c had the encoder on the
card. Unmeasured; the guard's pool rule and the VM's 10 GB floor judge it
as usual.

What that opens, all on one card, all unmeasured:

| Blocked today | With the encoder on the CPU | Expectation |
| --- | --- | --- |
| bf16 klein (batch 3a: killed beside the bf16 encoder) | ~7.7 GB of weights (4 B × 2 bytes) + VAE + working memory; plausibly fits | **Small gain.** The Arc has no fp8 compute — fp8 is storage, upcast to bf16 per layer — so bf16 removes only weight rounding: fine texture and colour drift, not likeness, pose or anatomy. klein's tells so far (the chest bandana, the taupe grey, the stubby Ducky) are wording and reference, not precision, and BFL ships an fp8 klein as a production form. Our cast (`weight_dtype: fp8_e4m3fn` in `comfyui/explore.py`) is the naive one, so if precision costs anything it is there. The three-way avenue decides: all alike closes it; bf16 clearly better makes the CPU encoder the production recipe; between, BFL's fp8. |
| Z-Image + Fun ControlNet (batch 3c: spilled) | ~5.8 + 2.9 GB + VAE, about klein's footprint today | Fits, but fixes shape only (avenue above). |
| klein + pose LoRA + style LoRA + references | **Probably not blocked today.** No klein LoRA has ever been loaded (`explore.py`'s LoRA path is SDXL's), so "does not fit" was never measured. ComfyUI patches a LoRA into the weights at load, so it costs a file of a few hundred MB, not a resident model; references already fit (3b: subject + head; 4a: up to three photos + head; pool flat). The CPU encoder is the fallback if it does spill. | The real blockers are the unread LoRA licences (nothing runs without a `models.manifest` line), distilled models taking LoRAs less well (test, do not assume), and our own style LoRA needing training. |

**What a second card still buys** once the encoder can leave the card:

- **Training beside serving.** Our style LoRA on Base 4B (roadmap item 9)
  fills a 16 GB card for hours; one card trains while the other serves
  donations or exploration. The strongest case.
- **A judge on the second card.** A ~7B vision-language model (int4/int8,
  ~5–9 GB) asking "same dog? four legs? collar right?" in place of CLIP
  similarity, which reads styled images low. Scoring candidate N while
  card 1 paints N+1 makes best-of-8 cost about what best-of-3–4 does now.
- **Detection in the art job.** SAM 3 (0.9 B), OWLv2 and SAM 2 resident
  on the GPU instead of a CPU pass (`subject-detection.md`, SAM 3).
- **One bigger-model experiment.** Qwen-Image-Edit (Apache-2.0, does what
  Kontext does) at fp8 is ~20 GB plus its encoder, ~28 of 32 GB split by
  layer across both cards — only with that custom node, and the setup
  most likely to meet an Arc + WSL trap. One run against klein, not a
  direction.
- Not worth moving: listing assessment and donor updates stay on the
  Claude API (ADR-0021 prices the corpus at ~$29); an animated
  adoption-day card (Wan 2.2 TI2V-5B, Apache-2.0, ~16 GB) is new scope
  for `doc/DIRECTION.md` before it is a model question.

Costs: the Arc traps double — a driver pool per card while the guard
watches one, the black-flicker engine resets, and `comfy:smoke` proving
both cards — and the PSU must carry a second 225 W card. So the buy waits
on ADR-0004's trigger (worker live, a clean week, jobs queueing), and the
CPU-encoder batch runs first on the card we have.

## What decides

Logan's picks, as always, and the three questions in the first table. A
model wins a place in ADR-0004 only if it is shippable, fits the card with
its identity tooling, and Logan prefers its output on the crew; the
exploration plan's judge gives the defect count per batch as a second
number. FLUX dev can win the comparison and still only ever be the
yardstick.
