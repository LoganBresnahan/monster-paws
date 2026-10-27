# Base-model candidates for the keepsake look (ADR-0004 as amended 2026-10-05)

Status: written 2026-10-10 from the look exploration's correctness step 3
(`the-look-exploration.md`), when SDXL base was what ran. The look is now
klein-v1 (ADR-0004 as amended 2026-10-14) and klein is the only painter
(as amended 2026-10-15); the anatomy LoRA's plan is ADR-0004 as amended
2026-10-22. The candidate table below is the record of how klein was
chosen, not a list of live options. Licences were read from each
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

## Batch 8a — a three-legged animal, first read (Claude, 2026-10-14; Logan's picks decide)

`comfyui/explore/batch8a.json`: batch 6a's recipe with BFL's weights on
three Commons tripods: the harlequin Great Dane and the holdout spaniel,
standing, and the white dog, lying down. (Which leg each lacks was misread
here and carried through 8d; see "The wrong leg" below.) Words on one axis: "three-legged …" as in 6a; "… with only
three legs"; and "… missing one front leg" (or back leg). Pose on the
other: the fixed three-quarter sit and stand; "in the same pose as in the
photo"; and an edit instruction, "Turn this photo into … Keep its body
exactly as it is in the photo". 72 images, 10.5–12 s, no guard stops.
Grids `var/explore/batch8a/grid-{great-dane,tripod-dog,white-dog}.jpg`
(rows words × seed, columns pose).

- **The words do nothing.** Within each pose column the three wordings
  paint near-identical dogs. The reference sets the picture; "only three
  legs" and "missing one front leg" never take a leg away.
- **The fixed poses paint four legs, 24 of 24**, as in 6a. A pose the
  model draws fresh comes from its prior, and the prior has four legs.
- **The photo's pose copies the silhouette, not the count.** The spaniel
  (edit and photo pose, every wording) stands as photographed and still
  has four legs. The Dane in profile shows three legs, but the third is a
  second front leg the photo does not have. It reads as any dog in
  profile, not as a tripod.
- **The photo's pose is not a keepsake pose anyway.** The white dog
  follows its photo into the grass, face down, and reads headless in
  four of eight.

So with klein 4B, neither the words nor the photo carries a missing leg.
Untried candidates, in order of promise:
1. **A second, editing pass:** paint as now, then give the painting back
   to klein as a reference with an instruction ("remove the dog's front
   left leg; it stands on three legs; change nothing else"). An editing
   model removes things it is told to more readily than a fresh painting
   leaves them out.
2. **The reference-control pose LoRA** (avenue above) with a pose drawn
   from the photo, once its licence is read.
3. **Inpainting** the leg away with a mask from the detector's outline on
   the painting.

Which leg is missing has to come from somewhere for 1 and 3: the listing's
text when it says so, else the photo.

## Batches 8b and 8c — taking the leg out of a finished painting, first read (Claude, 2026-10-14; Logan's picks decide)

The three candidates above, tried on six of 8a's standing paintings (the
Dane and the spaniel lose a front leg, the white dog a hind leg, as misread
in 8a; seed 7 in 8b, seeds 7 and 11 in 8c). The harness gained second-pass graphs:
`edit` and `inpaint` read an earlier batch's output in place
(`<file> [output]`). `comfyui/legmask.py` (`npm run explore:legmask --
<batch>`, CPU) asks SAM 2.1 for the leg inside a hand-drawn box, widens
it, and writes the mask and an erased copy of the painting.

- **The pose LoRA is out.** It is Apache-2.0, but it was trained on human
  COCO-18 skeletons only (dance, gymnastics) and needs one as its input.
  No such skeleton exists for a dog.
- **The editing pass fails (8b, 48 images).** "Remove the dog's front leg
  on the right of the picture" or "make this dog a tripod", whether
  repainted whole or from the painting at denoise 0.8, and with or without
  the photo as a second reference. The leg stays. At most it turns thin
  or gains a scar, or a stump appears halfway down a leg that still ends
  in a paw.
- **Inpainting a hand box with plain-background words nearly works
  (8b).** It is clean where the box held the whole leg (Dane, seed 11
  painting). Where a soft edge left a sliver of leg, the painter
  continued it as a translucent ghost leg. Inpainting with the removal
  instruction as its words paints the leg back.
- **Inpainting inside SAM's widened outline of the leg (8c, 36 images):**
  - The Dane loses the leg cleanly in three of four, and the fourth keeps
    a short dark stump.
  - The white dog loses it in about half, and the rest keep a faint ghost.
  - The spaniel never loses it: the leg comes out of feathered chest fur,
    and the painter carries the fur down into a new, paler leg.
  - Starting from the erased copy (denoise 0.7 or 0.5) is worse: the leg
    comes back, or a smudge is left.

So a diffusion painter removes a leg only where nothing around the mask
suggests one. Next, untried:
- **A dedicated object-removal model to take the leg out**, then klein at
  low denoise to restore the watercolour. LaMa (Apache-2.0, ~200 MB, CPU)
  fills from the surrounding texture and does not invent anatomy.
- **A mask that also takes in the leg's root**, the chest or haunch fur
  above it, so the painter redraws the body's outline whole rather than
  continuing a leg.

Even when it works, this is a chain of steps per tripod: which leg (the
listing's words or the photo), where it is in the painting, and the
removal. About 1% of listings name three legs (`listing-words.md`).

## Batch 8d — LaMa takes the leg out, first read (Claude, 2026-10-14; Logan's picks decide)

LaMa big-lama (Apache-2.0, a TorchScript port whose card names its
source; `inpaint/big-lama-torchscript.pt` in the manifest) runs on the
CPU in `comfyui/legmask.py`. It fills the same widened SAM mask from the
painting around it and writes `<stem>.lama.png`. `batch8d.json` then has
klein repaint only inside the mask, starting from LaMa's result at
denoise 0.3 and 0.5 with plain-background words. Six paintings, seeds 7
and 11, 24 images. LaMa takes a few seconds a painting on the CPU.

- **LaMa removes the leg on all six paintings**, the spaniel included.
  The Dane's seed-7 painting is a clean three-legged dog. On seed 11 a
  short dark stump is left below the shoulder, which reads as a healed
  amputation. The spaniel's chest feathering now hangs where the leg was,
  as a tripod's does. Both white dogs stand on three legs, with a faint
  smear where the hind leg was.
- **Klein at 0.3 keeps every removal** and evens the fill's texture a
  little; it adds little over LaMa alone.
- **Klein at 0.5 starts growing the leg back**: a paw on the spaniel's
  seed-11 painting, a grey leg on a white dog, a dark tassel on the Dane.

So the removal works: paint as now, mask the leg with SAM, remove it with
LaMa, then optionally klein at 0.3. Yours to overrule on the look of the
patched paintings. What is not built yet, in order:
1. **Finding the leg in the painting without a hand box:** OWLv2 asked
   for the dog's legs on the painting, then the front or hind one on the
   chosen side.
2. **Knowing which leg:** front or hind from the listing's words or the
   photo. Left or right is rarely written. Whether the painting may take
   the leg nearer the viewer when the listing does not say is Logan's
   call.
3. **The sitting pose**, untested: a sitting dog's hind legs fold under
   it, so a hind amputee may need nothing removed at all.

### The wrong leg (Logan, 2026-10-14)

Logan saw that some paintings lost the wrong leg. The masks did what the
spec asked; the spec was wrong. In 8a I read the amputations off
thumbnails and wrote them down unchecked, and 8b–8d took their leg boxes
from that line. Looked at full size:

- **The Dane lacks a hind leg, not a front one.** In profile its two front
  legs are staggered and only one hind leg stands under the haunch. Every
  Dane painting in 8b–8d removed a front leg.
- **The white dog probably lacks a front leg, not a hind one.** Lying on
  its side, two legs leave the haunch together and one leaves the
  shoulder. A front leg could be folded under the chest, so this one
  needs a second look. Every white-dog painting removed a hind leg.
- **The spaniel lacks a front leg**, as written; its paintings are right.

So two of three were wrong, which is the case for step 2 above: the
listing's words, or a check against the photo that a person confirms,
never a guess from a small picture. The removal finding stands either way,
since LaMa took out whichever leg it was given; a rerun with the right
boxes would show the Dane and the white dog as their real selves.

## Batch 8e — which leg is which, found automatically, first read (Claude, 2026-10-14; Logan's check decides)

Logan's idea: if the head and tail say which way the dog faces and the
legs can be counted, every leg can be named (left front, right hind), and
on a photo the empty place names the missing leg. `comfyui/legs.py`
(`npm run explore:legs -- batch8a`, CPU, no guard) tried it on the three
tripod photos and 8a's 18 standing paintings. Sheet:
`var/explore/batch8a/legs/legs.jpg`.

The rules: the head's side of the picture is the flank in view (head on
the right, the dog's right side faces us, whatever the three-quarter
angle); the two feet nearest the head end are the front pair; of a pair,
the foot lower in the picture is the near leg.

- **OWLv2 finds heads and tails, never single legs.** Asked for "a leg of
  a dog" or "a paw of a dog" it boxes the whole dog. The head was found
  on 17 of 18 paintings and the tail, when found, always agreed on the
  direction.
- **Counting columns undercounts.** In the three-quarter stand the far
  hind leg stands back, so its foot ends higher, and it is often drawn
  against a near leg: no row of the outline ever shows four separate legs
  (three of six spaniels).
- **Counting soles is better, with two traps.** A sole is a
  downward-facing edge of SAM's outline low on the dog. The belly and
  chest fringe make extra soles (kept out by asking for a leg, not the
  body, just above the sole), and a hock bent back makes a second sole
  above its own paw. No height rule tells a hock from a far foot (white
  dog 050's far foot sits 16% higher than the foot beside it; spaniel
  027's hock 9% above its paw). SAM's part at each sole does: a hock and
  its paw come back as the same leg.
- **Result: four legs found on 15 of 18 paintings.** The Danes 6 of 6,
  the white dogs 6 of 6 (one without a head, so unnamed), the spaniels
  3 of 6: feathered legs make SAM's parts unreliable, and each version
  of the rules failed a different spaniel. On the counted paintings the
  names follow the rules consistently; whether they are right is for
  Logan's eye.
- **On photos it fails, as feared: 0 of 3.** The Dane in profile shows
  its two front legs as one, the spaniel is small in a wide scene, and
  the white dog is lying down. A photo is not a source for which leg is
  missing; my own misreading of two of these three was the same failure.

So for paintings the naming works where the count holds; the count needs
to hold before any leg is removed, and a painting where it does not
would go to a person rather than to LaMa (proposed, Logan's call). Which leg the dog lacks comes from the
listing's words or a person, never the photo. The 18 paintings are also
the paintings the rules were tuned on: the next test is a fresh set
(new seeds, more breeds, the sitting pose) with the rules frozen.

## Batches 8f and 8g — more tripods, the leg rules frozen, first read (Claude, 2026-10-15; Logan's check decides)

Ten Commons tripods (`commons-photos.tsv`, set `tripods`; detector boxes
from `detect-tripods.json`): Lucca the Malinois and Lulu, whose
descriptions name the leg (left front; back-left); Miss Cleo, a
tortoiseshell cat with "only one hind leg"; Beth the French Bulldog,
Sheila, and four dogs from the 2026 San Francisco Three-Legged Dog
Picnic; and the orange cat from set 1. Where the words do not say which
leg, front or hind is Claude's read of the full-size photo, recorded in
the spec as `missing_from` (Logan's to check); two picnic dogs stayed
unclear and were counted only. klein-v1's recipe, sitting and standing,
seeds 7, 11 and 23: 48 paintings in 8f, 12 in 8g (Lucca and Lulu on the
subject alone, because the detector found neither head). No guard
stops. Every painting has four legs.

`legs.py` then ran end to end with its rules unchanged: count and name,
pick the leg the spec says is missing (the near one when only front or
hind is known), trace it, remove it with LaMa (`legmask.py --legs`),
count again (`legs.py --after`). Two changes came first, from batch 8a's
paintings with the corrected legs: OWLv2 is asked for the animal's own
kind (the cats had no "dog"), and the leg is traced in the dog's outline
rather than re-asked of SAM, which on a black leg with a white sock took
only the sock (Danes 011, 018, 019). With those, 8a passes the recount
on 11 of 14.

- **On fresh paintings the count holds half as often.** Four legs found
  on 15 of 30 standing paintings (8a, which the rules were tuned on: 15
  of 18), and on 1 of 30 sitting ones, where three is usually what shows.
  The orange cat sits even when asked to stand; Beth and the white picnic
  dog stand face-on, where the head says little about which way the dog
  faces.
- **Removal works when the leg is named.** Of the 12 paintings with four
  named legs and a known missing leg, 10 look right by eye. Lucca's left
  front is the far leg in both her paintings and comes away leaving a
  rounded stump at the elbow, as a real one does. Sheila 011 keeps a
  ragged stump at the hock; the black-and-tan dog a dark patch on the
  chest.
- **The recount passes 8 and wrongly rejects 2** (Sheila 009, Lulu 009:
  good removals, miscounted after). The other two it rejects are doubtful
  by eye (Beth 005, face-on; Miss Cleo 016). Nothing it passed looks
  wrong.
- **Per animal:** six of the eight with a known leg got at least one
  passing standing painting from three seeds; Lulu (a false rejection)
  and the orange cat (always sitting) got none.

So, end to end and automatic, about a quarter of standing paintings come
out three-legged and checked; the rest would go to a person. The count is
the weak step. Which leg comes from the words or a person, as 8e found.

## Batch 8h — the healed end drawn back, first read (Claude, 2026-10-15; Logan's picks decide)

Logan: after LaMa the leg "kind of just looks like it faded away"; the
painting could put back the animal's outline. LaMa fills the hole from
what surrounds it, so near the body fur fades into paper with no edge.

- **Drawing the line by hand does not work.** `legmask.py` first stroked
  the new silhouette in the dog's own ink: slivers of the leg's edge left
  outside the traced mask became black spikes, and once those were opened
  away the cut was a straight dash floating in LaMa's fur. A drawn line
  cannot give the edge the curve a stump needs.
- **klein redraws it in a small region.** `legmask.py` now writes
  `<stem>.stump.png`: the top of the hole within 6% of the painting's
  width below the cut, and a sliver of body. klein repaints only that,
  with words for a healed edge (`healed_edge`), on nine of the paintings
  legs.py had already treated on its own (8a, 8f, 8g), seed 7, at 0.45
  and 0.65, from LaMa's result or with the drawn line as a hint.
  `var/explore/batch8h/healed.jpg`.
- **0.65 gives a healed end with the painter's own outline on all nine,
  and no leg grows back in any of the 36.** Lucca's elbow, Lulu's and
  Sheila's thighs, Beth's hip and the Danes' haunches end rounded and
  outlined; at 0.45 some still fade. (In 8d klein regrew the leg at 0.5
  with the whole hole open: the region is what keeps it from growing.)
- **The drawn line adds nothing** as a hint; it can go.

So the chain is: name the leg (legs.py), trace it, LaMa removes it, klein
at 0.65 redraws the healed end inside the stump region, legs.py counts
again. Yours to overrule on the look.

## Batch 9a — a production set, first read (Claude, 2026-10-15; Logan's picks decide)

Logan asked for Plum and Ducky "as it would run in production", four each.
`comfyui/explore/batch9a.json`: a fresh detector pass over the two photos
each (`var/explore/batch9a/detect`; every box identical to
`boxes-detected.json`), the grown subject of both photos and the grown
head, BFL's fp8 klein (klein-v1), the listing's words, fresh seeds 2026
and 1015. The pose per set is not yet a rule, so each set is two sitting
and two standing. 16.5 s an image, the pool flat. The sets are
`var/explore/batch9a/set/{Plum,Ducky}-{1..4}.png` (1–2 sit, 3–4 stand).

- **Identity holds in all eight.** Plum's wrinkled grey face, his chest
  blaze and his chain with its tag; Ducky's tan coat with the white chest
  and her ears.
- **Both standing Duckys are painted male**, although the words say
  "female" (batch 4a found the painter guessing sex on a front-on
  underside). A three-quarter stand shows the groin side-on; the sitting
  pair hides it. *Corrected after batch 9b:* read up close, all eight
  show genitals, the sitting Duckys too; this first read was taken from
  the grid.
- **Plum's canvas is portrait** (`aspect: box` follows his first photo),
  and on it both sits come out front-on, not three-quarter. Plum-2 shows
  the underside and genitals, which batch 4b's landscape three-quarter
  sit kept out of frame.
- **A painted signature** sits in the corner of Plum-2 and Plum-4. This is
  the second time (batch 5b had one), and every Plum tag carries made-up
  lettering. With cfg 1 the negative prompt does nothing, so only the
  positive words can steer either one away.

So today's production recipe painted genitals in all eight (four of
them on a female; three of eight in this read before batch 9b's
close-ups) and a fake signature in two. That is within the
2026-10-14 amendment's "a malformed candidate can reach a donor", but
it is a different class from a stray leg. Candidate fixes, in order of
cost: words that keep the underside out ("tail down", "seen from the
side"); a landscape canvas whatever the photo's box; one pose per set;
the judge's outlier rule catching anatomy before the set ships. Yours
to overrule.

## Batch 9b — what words and canvas can keep out, first read (Claude, 2026-10-15)

Logan: "lets try some fixes and see what works … try our best to make it
accurate like we did with the tripods." `comfyui/explore/batch9b.json`:
batch 9a's recipe on a landscape canvas whatever the photo's box (a new
`aspect: landscape` in the harness; the references keep their own
aspect), six seeds, sitting and standing, four wordings: as now;
+ "unsigned: no signature, lettering or text anywhere"; + that and "a
family-friendly keepsake: the belly and groin stay hidden from view";
+ that and a pose that hides them (the tail wrapped round the front paws
sitting; front three-quarter, the near hind leg over the belly,
standing). 96 images, 16.5 s each. Labelled by eye on close crops of the
groin and the bottom corners (`var/explore/batch9b/marks/labels.json`,
`groin-*.jpg`, `corners-*.jpg`). The two seeds shared with 9a repaint
9a's Duckys pixel for pixel.

- **The landscape canvas fixes Plum's pose**: every sit is three-quarter,
  none front-on.
- **No wording keeps the genitals out.** 86 of 96 show them, Ducky in 46
  of 48 (the two without are the two-dog paintings, where the groin is
  out of view), Plum in 39 of 48. "Hidden from view", the wrapped tail
  and the front view change nothing; the painter's prior draws a male dog.
- **"Unsigned" does not stop the signature**: four, all Plum, all seed 42,
  three of them with the "unsigned" words.
- **The front three-quarter stand and the two-dog paintings**: seed 1015
  standing painted two Duckys side by side under two of the four
  wordings; the front stand is head-on, not three-quarter.

So the words cannot do it, and like the leg the mark has to be found and
taken out after painting. `comfyui/marks.py` (`npm run explore:marks --
<batch> [--fix]`) does that on the CPU:

- **Genitals: OWLv2's box placed by the head, then LaMa.** OWLv2 asked for
  the testicles or penis scores marked and clean paintings alike
  (0.017–0.28 against 0.018–0.12), so it is used only to place: the best
  small box below the head and clear of the chest and tag, above the
  paws (OWLv2 also takes dewclaws and the tail's tip for testicles), and
  any box beside it (Plum's drawn navel outscored his testicles below
  it). With 86 of 96 marked, the repair runs on every painting.
- **Signatures: ink on the paper, not OWLv2.** The signature is pale
  (0.65–0.75 grey on a 0.93 wash) and OWLv2 scores it near zero even
  enlarged; strokes darker than their neighbourhood, grey-brown, outside
  SAM's outline, joined into one word in the bottom-right corner find all
  six (9a and 9b) and nothing else in 104 — on the paintings the rule
  was tuned on.
- **Where it works**: standing, the box sits on the genitals and LaMa
  leaves plain belly and an unbroken leg line on nearly every Ducky and
  most Plums (`var/explore/batch9b/marks/lama-*.jpg`, before and after).
  Sitting, the three-quarter pose shows a wide pink underside with a
  navel, a sheath and testicles, and the box often covers one of them:
  about two in three come out clean. The front stand misses most.

So the chain is: paint standing, landscape canvas; marks.py places the
box; LaMa takes it out; the signature goes the same way. Batch 9c checks
the frozen rules on paintings they were not tuned on.

## Batches 9c and 9d — the fresh check, and klein after LaMa (Claude, 2026-10-15)

`comfyui/explore/batch9c.json`: the production recipe standing only,
landscape canvas, six new seeds, on Plum, Ducky and two of batch 6a's
Commons mammals (the goat, the pigs); labelled by eye
(`var/explore/batch9c/marks/labels.json`) before marks.py ran, its rules
frozen.

- **Genitals on all twelve dogs** (Ducky again painted male) and four of
  six pigs; none on the goats. **One signature** (Plum, seed 77).
- **marks.py places the box on all twelve dogs** and finds the signature
  (525 px of ink); one false signature, grass in a goat's corner (139 px).
- **The first fix left five of six Plums marked**: the box sits on the
  tip, and grown by a third LaMa rebuilt his longer sheath from the rest.
  Grown by its own size (`GROW_ANATOMY`), **all twelve dogs come out
  clean**, the pig OWLv2 found too. Where the mask crosses the inner
  thigh the leg's line fades a little (Plum 000 and 004).
- **The limits**: OWLv2 misses most pig sheaths (one of four), and on the
  goats it boxes the knee callus, which LaMa then erases — the rules are
  tuned on dogs.

`comfyui/explore/batch9d.json`: klein repaints the belly mask over
LaMa's result (`smooth_belly`, mask `belly`, from `unmarked`) at 0.35
and 0.5, as batch 8h drew a healed end back. **It grows the genitals
back** (Ducky 006–008 and 010, Plum 001 and 002, the pig, at one
strength or both: `var/explore/batch9d/healed.jpg`). The painter's prior
is the problem being removed, so no repaint of that region: LaMa's
result is the painting.

So the production chain for a dog is: paint standing on a landscape
canvas; marks.py places the genitals and any signature; LaMa takes them
out, with no repaint. A set of four, made that way:
`var/explore/batch9c/set/{Plum,Ducky}-{1..4}.png`, before and after in
`{Plum,Ducky}-before-after.jpg`. Ducky-4 (seed 21) has pricked ears, not
hers. Yours to overrule.

### Batch 9c — Logan's read (2026-10-15)

Standing only: "standing makes the most sense" — then narrowed the same
day to tripods only: "a rule that if we get the 'tripod' and related
keywords to do standing only" (ADR-0004 as amended 2026-10-15). The removal is not good
enough: "the genital removals looked pretty bad, basically just blurs
the area." And the requirement: "we really cant be drawing male parts on
a female." So LaMa's fill is not the answer, and painting male anatomy on
a female is a correctness failure, not a style one.

Then (Logan, 2026-10-15): "any special genital work we did should not
stay because its not good." The genital search and fill (marks.py), the
belly repaint hook, and the wordings batch 9b tried are removed, and
with them the specs of batches 9b and 9d; the findings above stay as
the record. What stays: the landscape canvas (`aspect: landscape`), and
the signature finder, now `comfyui/signature.py` (`npm run
explore:signature -- <batch> [--fix]`), which is unrelated and worked.
The fix for the anatomy is the painter itself: a klein LoRA trained on
a rented GPU (roadmap item 9).

## The anatomy LoRA — its training set (discussion, 2026-10-22)

Scope (Logan, 2026-10-22): **no genitals on any dog**, not females only —
a storybook keepsake, one rule to train and test; and **genitals only** in
this LoRA, a tripod one being its own if ever needed.

What the guides say (BFL's training docs and their Hugging Face guide,
read 2026-10-22): train on klein **Base** 4B (Apache-2.0) and run the
LoRA on the distilled 4-step klein, where it "usually gives even better
results"; a 4B run fits 24 GB and takes under an hour on a rented RTX
4090 (about $0.50); Ostris's ai-toolkit trains klein, including **edit
LoRAs** from reference→target pairs (`control_path` beside
`folder_path`, paired by file stem), which is how our painter works;
50–200 pairs, a made-up trigger word in every caption, lr ~1e-4,
checkpoints every 250 steps, chosen by samples, not loss (edit LoRAs
peak around 1000–1750). The A770 could hold a 12 GB run, but the
trainer expects CUDA and the card's traps are not worth 50 cents.

The GPU is the cheap part; the hard part is **~100 paintings in our look
with clean undersides**, many dogs, both sexes, sitting and standing —
which the painter makes about one time in ten (batch 9b), mostly where
the pose hides the groin. Three sources, tried in this order:

1. **klein Base paints them.** The distilled model zeroes the negative;
   Base runs real CFG, so "genitals, testicles, scrotum, penis, sheath"
   in the negative can work. Too slow for a donation (28+ steps × 2),
   fine for a dataset, and the LoRA carries the result into the 4-step
   painter. The catch: Base's look may differ from ours, and a LoRA
   trained on Base's paintings would pull ours toward it, so Logan's eye
   reads both the undersides and the look. Batch 10a.
2. **Filter the distilled painter's output**: ~1,000 overnight under the
   guard (16.5 s each), Logan labels groin crops on a contact sheet,
   keep the ~100 clean; certain to work, biased toward hiding poses, and
   two-dog paintings are thrown out.
3. **Clean them by hand** in Krita (Logan or an illustrator), 40–80
   paintings: not the automatic repair Logan rejected, but real time or
   money. Last resort.

Either way the pairs are photo crops in, approved painting out, captioned
with the production prompt plus the trigger; Wikimedia Commons dogs and
the crew only, never a shelter photo (22 Commons photos on hand; ~60–100
more dogs to collect, each in `commons-photos.tsv` with its licence).
Plum and Ducky stay out of training, so batch 9b's seeds are a clean
before/after; unseen Commons dogs are the second test. The ship bar:
zero male anatomy on a female, nearly none on any dog, likeness no worse
on the scorer, and Logan's eye says the look held; checkpoints 1000,
1500 and 2000 at strengths 0.6, 0.8 and 1.0. The training plan is an
ADR-0004 amendment before any rent.

### Batch 10a — klein Base with the anatomy negative (2026-10-22)

`comfyui/explore/batch10a.json`: batch 9b's production half held still —
Plum and Ducky, the grown subject of two photos plus the grown head, the
listing's words, the landscape canvas, both storybook poses, 9b's six
seeds — with the painter swapped for BFL's fp8 klein Base
(`kleinbase` in `explore.py`: 28 steps, CFG 4, euler/simple; settings
from community guides, 20–50 steps and CFG 3.5–5, nothing from BFL for
ComfyUI) and the `anatomy` negative. 24 paintings. The baseline is 9b's
same 24 on the distilled painter: **anatomy in 22 of 24**.

### Batch 10a — first read (Claude, 2026-10-22; Logan's eye decides the look)

135 s a painting warm (28 steps × 2 for CFG, against 16.5 s), the
driver pool flat at 1.1–1.5 GB, no guard kill. Labels by eye on close
groin crops (`var/explore/batch10a/groin/`, `labels.json` beside them),
9b's rule:

- **Anatomy in 19 of 24**, against 22 of 24 on the distilled painter. The
  five clean: Plum sitting s11, Plum standing s7 and s99, Ducky standing
  s99 and s1015. Every sitting Ducky has a pink scrotum, and Plum sitting
  s99 has two testicles drawn outright. The negative moves it a little,
  not enough: about one clean painting in five at 135 s is ~5 an hour,
  where the distilled painter's one in ten at 16.5 s is ~20 an hour.
- **The look drifts**: tighter linework, a more muscular, more anatomical
  body (Ducky standing s2026 reads as a study, not a storybook). Likeness
  median 0.697 (0.636–0.769), in line with klein's earlier reads.

So source 1 is out as the generator: slower per clean painting than
filtering the distilled one, and off our look.

## Batch 11a — the whole crew as production paints it, first read (Claude, 2026-10-23; Logan's picks decide)

Logan: "a fresh production-like run for the entire crew. No experimental
variables this time." `comfyui/explore/batch11a.json`: klein-v1 exactly
(the detector's grown crops of two photos and the grown head, the listing's
words, the landscape canvas), sitting and standing three-quarter, four
fresh seeds — two sets of four per animal; 40 paintings at 16.5 s, the pool
flat at 1.6 GB, no guard kill. Beetle, Stacey and Marty are new: two photos
each chosen by Claude, boxes from a detector pass with the rules unchanged
(`comfyui/explore/detect-crew2.json`, `var/explore/batch11a/detect/`).
Grid: `var/explore/batch11a/grid-animal-x-prompt-seed.jpg`.

- **Plum, Ducky, Stacey hold**: the grey puppy, the tan pit with the white
  chest, the brown tabby's stripes, in every seed.
- **Beetle is painted as a black-and-tan coonhound**: a black saddle over
  most of the body and short ears, where Beetle is mostly red-tan with
  long, low ears and a loose face. The words "black and tan bloodhound"
  likely pull the coat darker than the photos; her photos show the colour
  that matters. A finding for the words table (`doc/plans/listing-words.md`),
  not something to fix in this run.
- **Marty loses his points**: a cream cat, green eyes, faint orange
  striping, where Marty has a flame point's orange face and ears and blue
  eyes. "Flame point" did not carry through. Same finding.
- **Stacey's desk photo was cut at her shoulders** by the detector (a
  partial box, the known limit in `doc/plans/subject-detection.md`); her
  paintings came out right anyway from the close-up.
- **Signatures**: none past `signature.py`'s threshold; the most ink is
  Marty 034 (74 px), below it.
- **Anatomy**: not yet labelled. The dogs' undersides are what the rented
  Qwen-Image-Edit cleanup takes next (ADR-0004 as amended 2026-10-23).

Yours to overrule; your picks go to `var/explore/batch11a/picks.txt` and
the approved ones to the cleanup.

## Batches 11b and 11c — Beetle's and Marty's words; more of the rest, first read (Claude, 2026-10-23; Logan's picks decide)

Logan: "for beetle and marty lets try to increase the likeness … either
change the color wording or leave it out." `comfyui/explore/batch11b.json`:
batch 11a's spec and seeds, Beetle and Marty only, one axis — the colour
reworded to what the photos show (`recolour`) or left out (`nocolour`);
11a's paintings are the `listing` row. `batch11c.json`: Plum, Ducky and
Stacey on 11a's spec, four new seeds. 56 paintings, pool flat, no kill.
Grids: `var/explore/batch11b/grid-words-vs-11a.jpg` (listing / recolour /
nocolour per animal, same seed per column) and
`var/explore/batch11c/grid-animal-x-prompt-seed.jpg`.

- **Beetle: leaving the colour out is closest.** "female bloodhound" gives
  a red-tan dog with the black over her back and long ears, as in her
  photos; "black and tan" (11a) made her mostly black.
- **"Black saddle" is painted as tack**: all eight `recolour` Beetles wear
  a harness or a riding saddle. A coat word that is also an object is a
  trap for the words table.
- **Marty: the reworded colour is closest.** "cream with orange ears,
  face and tail, and blue eyes" gives the blue eyes and the warm ears and
  tail tip; with the colour left out he goes back to a cream tabby with
  green eyes, as in 11a. His photos alone do not carry the points.
- **So no single rule**: a colour word the photos show better is better
  left out (Beetle), and a pattern the photos underplay needs spelling out
  (Marty). Finding for `doc/plans/listing-words.md`: a listing's colour
  value is rendered per value by the reviewed table — "Black and Tan" on a
  hound may be better left to the photos, "Flame Point" expanded into body,
  points and eyes, and no coat word that names an object.
- **11c holds** as 11a did: the grey puppy, the tan pit, the tabby.
- **Signatures past the threshold**: 11b Marty 026 (`recolour`, sitting,
  seed 4096) and 11c Plum 005 (standing, seed 404).

Yours to overrule.

### Batches 11a–11c — Logan's picks (2026-10-23)

Two per animal, saved as `picks.txt` in each batch: Plum 11a-005 (standing,
seed 222) and 11c-001 (sitting, 404); Ducky 11a-011 (sitting, 8128) and
11a-012 (standing, 11); Beetle 11b-009 (sitting, 222) and 11b-012
(standing, 11), both `nocolour`; Stacey 11a-029 (standing, 222) and 11c-019
(sitting, 6174); Marty 11b-019 (sitting, 8128) and 11b-020 (standing, 11),
both `recolour`. Logan: "the beetle and marty images did much better …
some of the beetle photos literally put a black saddle on her like a
horse." All six dogs show anatomy and go to the rented Qwen-Image-Edit
cleanup (ADR-0004 as amended 2026-10-23); the cats show none and go to
the home section as painted.

## The Qwen-Image-Edit cleanup, first run (Claude, 2026-10-23; Logan judges)

The first rented run (`scripts/gpu-rental.sh`, an H200, about an hour,
about $4.50; `doc/infra.md`, GPU rental): `qwen-edit-v1` in bf16, 40 steps,
seed 0, about 34 s an image, over the six picked crew dogs (batches
11a–11c) and batch 9b's 24 production-prompt paintings. Results in
`var/rental/` with before/after sheets beside them.

- **The anatomy comes out** on almost all of them: the sheath, testicles
  and pink underside become belly fur. First wording: 5 of 6 crew clean
  (Beetle standing kept a bump); stricter wording: 6 of 6.
- **But Qwen repaints the whole painting**: the loose watercolour
  brushwork flattens into smooth airbrushed shading, coats go darker and
  more even, the paper wash pales — on every one of the 30. The stricter
  wording ("change nothing else … the loose watercolor brushwork, the paper
  texture …") keeps the background wash; the coat is still restyled.
- **So a cleaned painting is never used whole.** Pasting the change back
  automatically (the largest region of difference) picked the wrong region
  on 4 of 6, because the restyling is larger than the removal. Pasting
  back only inside a groin box placed by eye
  (`var/rental/crew-dogs-boxes.json`), colour-matched to the fur around it
  and feathered, keeps the original painting everywhere else:
  `var/rental/crew-dogs-pasteback/`, zoomed in `crew-dogs-pasteback-zoom.jpg`.
  The patch is smoother than the brushwork around it; Ducky standing shows
  a faint seam where Qwen moved the leg's outline.
- **For the LoRA's set this changes the plan**: training pairs must be the
  pasted-back paintings, not Qwen's output, or the LoRA learns the
  airbrush; and the box has to come from somewhere other than an eye per
  painting at 100 — the groin box `marks.py` placed in batch 9b (removed
  2026-10-15, its findings above) is the candidate.

### The cleanup — Logan's read (2026-10-23)

None approved: "this isn't going to work. the blur looks way too unatural
mixed with the art style." And on the set: a LoRA trained on paintings
that are clean only because the pose hides the groin learns the pose, not
a clean standing dog — so filtering and lying-down poses can serve the
crew, never the training set. Next, Logan's choice: **NAG** (Normalized
Attention Guidance) on klein-v1, so the distilled painter reads a negative
at all; then **klein Base repainting the groin box** with the negative,
after LaMa has taken the shape out, so the fill is klein's own brushwork.

## Batches 12a and 12b — NAG on klein-v1, first read (Claude, 2026-10-23)

Logan: "lets try NAG". ComfyUI's built-in `NAGuidance` (in the pinned
ComfyUI, GPL-3.0, no new dependency) patches the attention output of
FLUX.2's double and single blocks; `explore.py` gained a `nags` axis, and
its negative ("genitals, testicles, scrotum, penis, sheath") carries the
same three references as the positive, or the two never batch and NAG
does nothing. Batch 12a: Plum and Ducky on batch 11a's recipe and seeds
(11a is the control), NAG `default` (5 / 0.5 / 1.5) and `strong`
(10 / 0.5 / 2.5); batch 12b: two seeds at `hard` (20 / 0.8 / 5) and `max`
(40 / 1.0 / 10). 31.6 s a painting, about twice klein-v1, pool flat.
Grids: `var/explore/batch12a/grid-nag-vs-11a.jpg` (and `-undersides`),
`var/explore/batch12b/grid-nag-push.jpg`.

- **No setting removes anything**: the anatomy is on all 48, Ducky's
  included, and even `max` repaints each seed nearly as the control did
  (a collar, a fold). NAG is acting — the paintings do move — but it has
  almost nothing to push against.
- **The likely reason**: NAG steers by the difference between the image's
  attention under the prompt and under the negative, and with three
  reference images in both, that attention is almost all references; the
  words carry little either way. It is the same finding as batch 9b's
  wordings (86 of 96 regardless of words), from the other side: in this
  painter the anatomy comes from the references and the prior, not the
  text.
- **So NAG is out for klein-v1 as it paints.** Not tried: NAG with a
  negative that carries no references (it cannot batch, so the built-in
  node skips it).

This points idea 3 at a repaint **without references**: klein Base
repainting only a LaMa'd groin box reads the surrounding painting and the
words, and nothing else, so its negative has the leverage the references
take away here.

## Batch 12c — klein Base repaints the groin with no references, first read (Claude, 2026-10-23; Logan's eye decides)

Idea 3, as batch 12b's read pointed it: `comfyui/groinmask.py` fills each
crew dog's groin ellipse (`var/rental/crew-dogs-boxes.json`) with LaMa,
then klein Base (CFG 4, 28 steps) repaints only the ellipse from the
LaMa'd painting — the painting's own production words, the anatomy words
as a real negative, no reference photos — and the repaint is composited
onto the original through a feathered mask (`explore.py`'s `groin` pass).
Two strengths, one seed; about 50 s a repaint. Zoomed:
`var/explore/batch12c/zoom.jpg` (original, LaMa, d0.6, d0.85).

- **The brushwork matches.** Unlike Qwen's airbrush, the fill is
  watercolour in klein's own hand, and the feathered edge does not show.
- **Clean and natural**: Plum standing at 0.85, Plum sitting at 0.6 and
  0.85, Beetle standing at 0.85, Beetle sitting at 0.6 (a little muddy).
- **Regrown**: both Duckys at both strengths (a pink mound and a sheath
  where LaMa had left smooth fur), Beetle sitting at 0.85 (testicles, and
  a stray paw), Beetle standing at 0.6, Plum standing at 0.6. The negative
  helps without references, but klein's prior still finds the groin from
  the surrounding body — female words or not.
- **So it is a lottery with good odds, not a fix**: about half the repaints
  are clean, and a clean one looks painted, not repaired. Several seeds per
  painting and a pick by eye would give every crew dog one; for the LoRA's
  set the same lottery needs a check that does not need an eye per image.

Logan's read (2026-10-23): one acceptable, Beetle standing at 0.85
(12c-011, `picks.txt`); every other repaint either regrew or reads wrong.

## Batch 12d — the repaint reads the LaMa'd painting as a reference, first read (Claude, 2026-10-23; Logan's eye decides)

Batch 12c plus one change: the LaMa'd painting is chained onto the words as
a reference latent (`explore.py`'s `groin` pass, source `lamaref`), so
klein Base reads the smooth fill un-noised at every step instead of only
starting from it. 12c's 0.85 and seed 1, full strength 1.0, a second seed:
24 repaints, about 84 s each. Zoomed beside 12c:
`var/explore/batch12d/zoom.jpg`.

- **No regrowth: 0 of 24**, against 11 of 12 in 12c. The reference that
  carried the anatomy past every negative in 12a–12b now carries its
  absence. Ducky comes out clean for the first time, both poses, all four.
- **Plum standing and sitting and Ducky standing read as painted**:
  watercolour belly in klein's own hand, no seam.
- **Ducky sitting**: clean, with a small fold drawn near the hind foot and
  the white chest reshaped inside the ellipse.
- **Beetle copies LaMa's smudge**: a dark grey-green blur sitting, a pale
  patch standing — where LaMa's fill is poor (black, tan and shadow
  together), the reference passes it on, at 1.0 as at 0.85.
- **So the repaint is now as good as the fill under it.** The next lever
  is the fill — a better LaMa input (a tighter mask from keypoints, idea B,
  leaves less to fill), or a fill from the dog's own coat beside the hole —
  not the painter.

Logan's read (2026-10-23): none of the 24 passes. Next, his choice: idea B,
a mask from animal keypoints, so less is filled and repainted.

## Batch 12e — animal keypoints for the groin mask, first read (Claude, 2026-10-23)

Idea B. Animal keypoint models, by licence: DeepLabCut's
SuperAnimal-Quadruped (39 points, a "belly bottom" among them) is academic
and non-commercial only, so out; **RTMPose-m Animal** (OpenMMLab, Apache-2.0,
trained on AP-10K, CC-BY-4.0) gives 17 points — eyes, nose, neck, tail root,
each leg's shoulder or hip, elbow or knee, paw — and runs on the CPU from
its LiteRT export (`models.manifest`, `detect/rtmpose-animal-ap10k/`; run
outside the image with `ai-edge-litert` until it earns a place).
Hugging Face's ViTPose+ port kept only the human head, so it cannot name a
dog's joints. Overlays: `var/explore/batch12e/keypoints.jpg`.

- **Standing, it reads the watercolour dogs well**: every joint where it
  belongs on Plum, Ducky and Beetle, the hips and knees around the sheath.
- **Sitting front-on, it is confused**: the hips spread, and the tail root
  lands between the hind legs — on the groin, for the wrong reason.
- **The hull of hips and knees is the hind thigh, not the groin**
  (`kpmask-vs-ellipse.jpg`): standing three-quarter, the sheath sits on the
  belly line just in front of the hind leg, so the hull masked the leg and
  missed most of it; sitting, the hull is two to three times the ellipse.
  The geometry the keypoints support is the point where the belly
  underline (SAM's outline) meets the front of the hind thigh, and between
  the knees below the hips for a front view — not built.

Logan (2026-10-23), on why none of 12d passes: "all of the groins are
blurry; the real problem is that the lines which define the animal are not
put back." LaMa erases the painter's ink with the anatomy, and neither
repaint draws it back — colour with no line reads as blur. Next: find the
ink around the hole, continue each line that runs into it across to where
it leaves (lines that begin and end inside are the anatomy and stay
erased), redraw the belly's silhouette edge from SAM's outline, draw them
onto the LaMa fill in the painter's own ink, then repaint with the
reference — the tripod chain of batches 8e–8h (`legmask.py`'s outline and
band) aimed at the groin. Keypoint masks wait: for these six the hand
ellipses are as tight, and the mask is not what failed.

## Batch 12f — the lines put back before the repaint, line sheets only (Claude, 2026-10-23; nothing painted)

Sheets in `var/explore/batch12f/lines/`; the code was replaced by 12g's
hand-placed `comfyui/groinlines.py` and not kept. Two automatic ways, both
read before any repaint, and neither is fit to paint from:

- **Continuing the ink.** Strokes darker than their neighbourhood that
  touch the rim, joined end to end across the hole. The watercolour's wash
  edges read as strokes (8–13 ends per hole where the painter has two or
  three lines), so the pairing joins unrelated ones: long diagonals across
  Beetle's belly, an X on Beetle standing, curves from Plum's belly down
  into the legs.
- **Continuing the silhouette only** (Logan's pick to try): SAM's dog is
  known outside the hole and interpolated across it. It cannot know where a
  leg runs through the hole, so standing it punches paper lenses between
  belly and thigh (Ducky, Plum) instead of the belly line; sitting it
  carves an arch of paper out of the shadow under the body (Plum, Beetle,
  Ducky), where the painter has no paper at all.

Why the tripods worked and this does not: there SAM outlined the leg
itself, so the new edge was the dog's own outline with one short cut
across the leg's top, and nothing inside the hole had to be guessed. Here
SAM cannot outline the anatomy, the ellipse also erases belly and thigh
that must come back, and their shape inside the hole is unknown. Next:
the two or three lines each of the six needs, placed by hand on a grid as
the ellipses were, checked by Logan, then 12d's repaint from them — the
test of whether lines back make the repaint read as painted, before any
more automation.

## Batch 12g — the anatomy alone traced out, its lines put back by eye, first read (Claude, 2026-10-23; Logan's eye decides)

Logan's idea: erase only the anatomy, not an ellipse round it.
`comfyui/groinlines.py` takes a polygon traced round the anatomy on a 0.01
grid (or SAM 2.1's answer to points placed on it and off it), widens it
0.004 of the width, fills it with LaMa, draws the painter's lines the hole
cut back through hand-placed points, and 12d's repaint (klein Base, the
anatomy words as its negative, the fill as reference and start) paints it;
the result goes back onto the original through the hole feathered. The
hole is 0.3–1% of the painting, against 2–4% for 12d's ellipses. 36
paintings (lined at 0.6 and 0.85, the unlined fill at 0.85 as the control,
seeds 1 and 2), about 85 s each. Sheets: `var/explore/batch12g/lines/`
(the holes and lines, read before painting) and
`var/explore/batch12g/compare/` (original, 12d, the fill unpainted, the
three repaints, per seed).

- **The tight hole is what fixed it, more than the lines.** With the
  painter's outline left standing round a small hole, LaMa's fill alone
  already reads as painted on four of six, and no 12g repaint is blurry.
- **Plum standing, Beetle standing, Plum sitting: clean on every variant.**
  The belly line runs on into the thigh; Plum sitting keeps the pale
  underbelly and its outline with the ring gone.
- **Ducky standing:** the anatomy is gone, but the drawn belly line is
  greyer and heavier than the painter's, and klein keeps it at 0.6 and 0.85
  alike; the unlined control reads the most natural. The ink colour wants
  the painter's brown and a lighter hand.
- **Ducky sitting:** SAM's answer was erased (the traced polygon left the
  sac's lower outline standing as a V); the thigh's front edge is drawn
  back. What is left is a mauve shadow between foreleg and thigh, smooth,
  where a reader may still see the sac's shape. Yours to judge.
- **Beetle sitting:** both testicles and the bulge's lower edge are gone,
  but the rounded pink belly between the thighs keeps the bulge's
  silhouette, and LaMa left a white patch at its lower right that the
  repaints keep. Weakest of the six.
- Lined against unlined barely differs once the hole is tight: on these
  six, only a line the hole fully cut (Ducky sitting's thigh) needs
  drawing back.

Placing a polygon and its lines took a few minutes a painting, two of
six needing a second pass after reading the sheet; that is the per-image
cost of the LoRA set's hand step.

## Batch 12g — Logan's picks (2026-10-26), and 12h, Ducky's lines inked after the repaint

Picks (`var/explore/batch12g/picks.txt`): Plum standing and Beetle both
ways on the unlined fill at 0.85, both seeds; Plum sitting on all six. None
of Ducky. Logan: on all three dogs many paintings keep "a leftover visible
brown trace line that looks out of place" — the line drawn before the
repaint, softened by klein into a wash — and on Ducky, where no line was
drawn, "a clear line wasn't drawn at all where it should have been":
sitting, her belly blends into the ground; the two unlined standing were
close but lack the line where the belly meets the far leg. So the unlined
fill wins, and a line the repaint still lacks is inked afterwards, where
nothing washes it.

12h (`comfyui/groinink.py`, no GPU): on Ducky's four unlined repaints, the
missing line placed by eye on a 0.01 grid over the repaint and inked crisp
— the darkest 3% of the pixels near its points (the painter's own line
colour), tapered at both ends, its opacity broken a little — at 0.0018 and
0.0026 of the width. Sitting, the belly's lower edge now stops above the
ground shadow; standing, the line runs from the near thigh to the painter's
belly line along the top of the far leg (the first placement arched above
that edge and was lowered). Sheets and full paintings:
`var/explore/batch12h/inked/`. Logan's eye decides.

## The checker bake-off — sorting the LoRA set's paintings before Logan looks (design, Claude, 2026-10-27; nothing run)

ADR-0004 as amended 2026-10-26 asks, before hundreds of Commons dogs are
pulled, for a checker that sorts generated paintings into clean and not,
chosen by a bake-off: a local vision-language model against the Claude API,
on paintings only, scored against Logan's verdicts from batches 12c–12h.
This is the design; the first result goes under "first read" below it.

**What the checker is for.** The set is ~100 approved paintings out of
several hundred painted, and the hand step costs minutes a painting. The
checker's job is one question per painting — *does it show male genitals
(a testicle, scrotum, sheath or penis drawn as a distinct shape; teats are
not), batch 9b's rule* — so Logan's sheet shows the clean candidates first
and the anatomy ones go straight to the hand step. It never decides what
enters the set: Logan's eye does, as always. So the number that matters is
**recall on anatomy** — a painting it calls clean that is not costs a
dirty pair in the set; a clean painting it flags only costs Logan a look.

**Ground truth, and its gap.** Logan's verdicts so far are *picks*, and a
pick mixes faults: 12c's eleven rejects "either regrew or read wrong";
12g's 24 non-picks include clean groins with a "leftover visible brown
trace line". A non-pick is therefore not an anatomy label. What exists:

| Paintings | Anatomy labels | By whom |
| --- | --- | --- |
| 9b, 24 (klein-v1, Plum and Ducky) | anatomy in 22 | Claude by eye, 9b's rule (`batch9b/marks/labels.json`) |
| 10a, 24 (klein Base, the negative) | anatomy in 19 | Claude by eye (`batch10a/groin/labels.json`, five doubtful named) |
| 12c, 12 repaints | 1 pick; the first read names regrown vs clean per painting | Logan's pick; Claude's read |
| 12d, 24 repaints | 0 picks; the read says no regrowth, blur | Logan; Claude |
| 12g, 36 repaints + 12h, 8 inked | 12 + 1 picks; reads name anatomy per dog | Logan; Claude |

So the first step is a label sheet, not a model: every one of those ~130
paintings as a groin crop and the full painting side by side, Logan
marking each `clean` / `anatomy` / `unsure` in
`var/explore/anatomy-labels.tsv` (batch, id, label, who, date), Claude's
labels pre-filled where they exist so he confirms rather than starts
blank. Roughly 60 with anatomy and 70 without — enough to separate
checkers, not enough for a percentage point.

**Candidates**, each on two views — the full painting, and a groin crop
(the lower third of the detector's subject box; the hand step's polygon
is not available for a new painting):

1. **The Claude API**: Claude Opus 5.5 (`claude-opus-5-5`) and Claude
   Haiku 5.5 (`claude-haiku-5-5`), the image as base64, one structured
   answer (`anatomy: yes | no | unsure`, one line of why), thinking left
   at its default. Cost is cents: a 1216×832 painting is ~1,300 input
   tokens, so ~130 paintings × 2 views × 2 models is a few dollars at
   most. **Paintings only, never a photo** (ADR-0031 decision 5; ADR-0004
   as amended 2026-08-02 §2 is about photos leaving us). A refusal
   (`stop_reason: refusal`) is a result to count, not an error to hide —
   the subject is exactly what a classifier might decline. The dependency
   is `@anthropic-ai/sdk`, already named as our first Claude dependency by
   ADR-0021 ("whichever lands first brings it"); the key goes into `pass`
   as `anthropic/api-key` and the `doc/infra.md` registry table, by Logan
   — the registry has none today. A tsx script under `scripts/`, run with
   `--env-file-if-exists` like the others.
2. **A local VLM on the Arc**, in the ComfyUI image under the guard,
   each with a `models.manifest` line (licence read) before it runs:
   Qwen3-VL-4B-Instruct or Qwen2.5-VL-3B-Instruct (Apache-2.0; the 7–8B
   fit the card only quantised and the explore container's 12 GB CPU cap
   not at all), and Moondream2 (Apache-2.0, ~2B, runs on the CPU in
   seconds) as the cheap end. Same question, same two views.
3. **A baseline that is already licensed and in the store**: OWLv2's
   zero-shot score for "dog testicles", "sheath", "penis" inside the
   subject box (ADR-0026's detector, `detect.py`), thresholded. If it
   matches the VLMs it wins by cost.

**Scoring.** Per candidate and view: the confusion matrix against Logan's
labels, recall on anatomy first, then how many clean paintings it flags;
seconds and cents per painting; refusals and unparseable answers counted
as `unsure`. On `unsure` the painting goes to Logan's sheet unsorted.
Written as a table under "first read", the sheets beside it under
`var/explore/checker/`.

**What decides.** Logan's eye, reading the table: the checker that misses
no anatomy painting on these ~130 with the fewest clean ones flagged. If
none reaches that, the best one *ranks* the sheet by its confidence and
Logan still looks at every painting, in that order — the bake-off then
buys ordering, not a filter, and the ADR-0004 amendment that names the
winner says so. A tie between a local model and the API goes to the local
one (nothing leaves the box, no key, no per-image cost).

**Order.** The label sheet and Logan's labels first (no model, no key);
the OWLv2 baseline (nothing new to license); the Claude side once the key
is in `pass`; the local VLMs last, since each is a manifest line and a
download. Nothing here paints: the card is used only for the local VLM
runs, under `guard.sh` as any batch.

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
