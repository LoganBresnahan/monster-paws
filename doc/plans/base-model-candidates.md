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

### The set, collected (Claude, 2026-10-27; ADR-0031)

How the photos were found, so the next collection follows the same path:
the Commons API's `categorymembers` over five categories — *Quality images
of dogs* (141 files), *Featured pictures of dogs* (16), and the first 400
each of *Standing dogs*, *Sitting dogs* and *Lying dogs*, all 120 of
*Walking dogs* — with `imageinfo` on every file, kept only when the licence
is on ADR-0031's allowlist, `Restrictions` is empty, the file is JPEG or
PNG and its shorter side is at least 800 px: 1152 of 1477. A stratified
sample of 419 (every quality and featured image, 70 from each posture
category) was looked at as 320 px thumbnails on contact sheets, by eye,
against decision 4: one dog, no identifiable person, the dog large enough
for the grown crops, and no costume, cone, muzzle, statue, mural or
painting. 205 passed. Head-only portraits were passed over on purpose —
the LoRA learns the underside, and a portrait has none — so most of the
quality images were left behind.

The sets, fetched through `npm run explore:fetch` and recorded in
`comfyui/explore/commons-photos.tsv`:

| Set | Photos | Chosen how | Licences |
| --- | --- | --- | --- |
| `lora-train` | 109 | every standing and walking dog passed (the standing side view is the rarest pose and the one the groin shows in), then 30 quality images, 16 sitting, 16 lying | 51 CC BY-SA 4.0, 21 CC BY-SA 3.0, 20 CC0, 6 CC BY 2.0, the rest CC BY and public domain |
| `lora-holdout` | 12 | three drawn from each of those four groups before the training set was fixed, then two swapped out whose dog is also in the training set (the Berlin labradoodle, the red-and-white basenji — a series by one photographer puts one dog in several categories; those two rows moved to `lora-train` with a note) for an Irish setter and a weimaraner standing; never painted for training, the test set for the trained LoRA | 7 CC BY-SA 4.0, 3 CC0, 2 others |

Twelve training rows carry the note *handler's legs in frame, no face*:
show-ring stacks from *Standing dogs*, where a handler's legs or a hand on
the lead stay in the frame. Read as not an identifiable person under
decision 4 — Logan may strike them. The other 84 passed photos are not
fetched: the sample is in the scratchpad only, and the categories above
give it back if the set needs more. 534 MB on disk.

Found while fetching: a Commons credit can carry line breaks and tabs (one
`Artist` field is a paragraph asking not to upload edited copies), which
split a TSV row; the tool now collapses whitespace in every text cell, the
row was refetched, and `verify` reads 187 of 187. The author column is the
credit as Commons gives it, paragraph included, per ADR-0031's
consequence that it is never shortened by us.

Next: paint `lora-train` with klein-v1 under the guard, in chunks, after
`/gpu-health`; then the anatomy label sheet for Logan from those paintings
and batches 9b–12h, for the bake-off's ground truth.

### Batches 13a–13d — the LoRA set painted as production paints, first read (Claude, 2026-10-27; Logan's picks decide)

Every one of the 121 dogs painted with klein-v1's recipe (BFL's fp8
klein, the grown subject and head from `comfyui/explore/detect-lora.json`,
the words written from the photos with no sex named, landscape, the fixed
three-quarter pose, two seeds), nothing experimental: these are the
paintings the hand step cleans and the LoRA learns from. The detector found
no head in 46 of the 121 (small dogs in wide street photos, the show stacks
seen from the side), so the set ran as four specs: 13a standing with a
head (39 dogs, 78 images), 13b sitting and lying with a head (36, 72), 13c
standing without (32, 64), 13d sitting and lying without (14, 28) — 242
paintings, no guard kill, the pool flat at 1.4–1.6 GB, 10.5 s an image with
two references and 9.0 s with one. Sheets: `var/explore/batch13{a,b,c,d}/index.html`.

- **The recipe holds on strangers.** Breed, coat, collars and harnesses
  carry from one photo as they did from the crew's two; the lying photos
  paint as sitting dogs without a trace of the lying pose; the street dogs
  of one Philippine series come out as distinct dogs where the photos are
  distinct and as near-twins where the same dog was photographed twice
  (13a 066–069). Holdout and training dogs are told apart by `set` in the
  spec, never by the painting.
- **The anatomy is there to clean**: a sheath or testicles are drawn on
  most standing males (13a 000/001, 012/013, 016/017, 034–037, 058–061,
  070/071, 076/077; 13c 000/001, 006/007, 018, 042–047) and on many
  sitting ones (13b 040/041, 046/047; 13d 018/019, 026/027) — the
  "before" the LoRA has to learn away from, as batch 9b's rule says, so
  these go to the label sheet unsorted, Claude's reading in the pre-filled
  column.
- **Two seeds are near-duplicates** on this recipe: seed 11 and 222 differ
  in the wash and the tail more than in the dog. One seed per dog would
  have done; the second is a spare for the hand step when the first's
  groin is unworkable.
- **Subject-only reference (13c/13d) loses little**: without the head crop
  the face is read from the body crop and holds, the poodle and the
  bichon included. A no-head animal must run the `reference` graph:
  `reference2` with `heads` null falls back to a `dethead` crop that does
  not exist and every run fails validation (13c's first chunk, guard exit
  6, fixed by the spec). Batch 8g knew this.
- **A Commons title with no ASCII letters** (Cyrillic) fetched as
  `lora-train/.jpg`; an empty stem made an empty listing key and 13c's
  first two runs could not find their crops. `commons_fetch.py` now names
  such a file `commons-<sha1 prefix>.jpg`; the file and its rows are
  renamed with a note. The tool's two by-hand predecessors never met one.
- **Two Commons JPEGs from one camera carry an EXIF block Pillow cannot
  parse** (the Himalayan sheepdog pair); `detect.py` and `explore.py` now
  read such a file as it lies instead of crashing the run.

Yours to overrule; nothing of these goes to the hand step until the label
sheet is marked. Next: the anatomy label sheet (the bake-off's ground
truth) from these 242 plus batches 9b–12h; then the hand step on the
training paintings Logan marks.

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
   [correction 2026-11-03: Qwen2.5-VL-3B is under the Qwen Research
   License, research and evaluation only — "If you are commercially using
   the Materials, you shall request a license from us" — so it is out;
   Qwen3-VL-2B and -4B are Apache-2.0, read on their model cards]
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

### The label sheet, built (Claude, 2026-10-27; Logan's marks decide)

`var/explore/checker/labels-01.jpg` … `labels-16.jpg`: 128 paintings, eight
a sheet, each as the full painting beside a groin crop (a fixed window,
the lower middle of the canvas, x 0.28–0.72 and y 0.42–0.86 — where a
three-quarter sitting or standing dog's groin sits; the hand step's polygon
does not exist for most of these). The rows are
`var/explore/anatomy-labels.tsv` (batch, id, label, who, date, file),
Claude's reading pre-filled with `who` = claude, Logan overwriting label,
who and date on every row he reads. The composition, from the table above:

| Batch | Rows | Claude's pre-fill | From |
| --- | --- | --- | --- |
| 9b | 24 | all 10 clean of the 96, 14 anatomy drawn at random (seed 31) | `batch9b/marks/labels.json` |
| 10a | 24 | 19 anatomy, 5 of them `unsure` where the labels named doubt | `batch10a/groin/labels.json` |
| 12c | 12 | the first read per animal, pose and strength; Ducky anatomy | the read above |
| 12d | 24 | clean (0 of 24 regrew) | the read above |
| 12g | 36 | clean; Ducky sitting and Beetle sitting `unsure` (a shape may still read); Beetle's site card 12g-029 "perfect, nothing wrong with it" (Logan, 2026-10-28) | the read above |
| 12h | 8 | the inked Duckys: standing clean, sitting `unsure` | the read above |

36 anatomy, 71 clean, 21 unsure before Logan — fewer anatomy than the ~60
the design hoped for, because 12d–12h are repaints. If the checkers tie on
these, batches 13a–13d (242 paintings, mostly with anatomy) give a second
sheet at the same cost; they are not on this one so the ground truth stays
what Logan has already judged. The `p0`/`p1` pose of 12c's and 12d's files
is read from batch 12g's spec (the same crew paintings in the same order);
if 12c numbered them otherwise, those eight pre-fills swap, which Logan's
marks correct either way.

### The bake-off dropped (Logan, 2026-10-28)

No checker bake-off and no Claude API script: Logan picks the LoRA set's
paintings for likeness (`var/explore/index-all/index.html`, every Commons
photo beside its paintings, a keep box on each), and Claude marks genitals
by eye on the ones he keeps, by batch 9b's rule; the hand step cleans every
one marked; Logan approves the cleaned set before anything is trained. So
`@anthropic-ai/sdk` and `anthropic/api-key` are not needed here, and the
crew's anatomy marks on the label sheet stop being ground truth for a
checker. The trade, said once: a painting Claude reads as clean that is not
reaches Logan's final look uncleaned — that look is the backstop. Beetle
stays out of training and joins Plum and Ducky in the before-and-after
test, whose before is batches 14a–14b (ADR-0004 as amended 2026-10-28).

### Logan's keeps (2026-10-28)

`var/explore/index-all/choices-2026-10-28.txt`: 131 of the 242 kept for
likeness. 116 are training dogs (73 of the 109; both seeds kept for 43 of
them; 44 standing, 12 sitting, 17 lying) and 15 are holdout dogs (9 of the
12), which stay out of training and stand as the holdout's before. 36
training dogs have no keep. The file's crew anatomy marks are not used:
Logan wants to talk them through first. Batch 10a is off our look (klein
Base, Logan 2026-10-28, as its first read found) and has no part in the
set or the test; the befores are 9b and 11b, klein-v1. Next: Claude marks
genitals by eye on the 116, then the hand step.

### Batch 14a — the LoRA test's before, first read (Claude, 2026-10-28; Logan's eye decides)

`comfyui/explore/batch14a.json`: Plum, Ducky and Beetle as production
paints them (klein-v1, both photos, grown subject and grown head, the
listing words, stand34 and sit34, landscape), eight seeds (11b's four and
11c's four), nothing erased; 48 of 48 under the guard, ~16 s a painting
with three references, no kill, the production poll beside it untouched.

- **Plum and Ducky are the before as wanted**: on the look, and male
  anatomy drawn on most of them — a sheath or testicle under the belly
  standing, a pink scrotum between the legs sitting, on Ducky (female) as
  on Plum. That rate is what the LoRA has to bring down.
- **Beetle is not usable**: "female tan bloodhound with a black saddle"
  painted a riding saddle or a harness vest on all 16 — 11b's finding
  again ("black saddle" is tack; Logan then picked the `nocolour` Beetles,
  "female bloodhound", 11b-009 and 11b-012). Claude ran the words without
  raising it. Batch 14b painted her 16 again as "female bloodhound"
  (Logan): no tack on any, her black saddle read from the photos as coat,
  and the same anatomy as the others, a bulge standing and pink between
  the legs sitting.
- **The before is 14a's Plum and Ducky and 14b's Beetle**, 48 paintings
  (ADR-0004 as amended 2026-10-28); the after is the same specs with the
  LoRA added.

### The crew's anatomy marks retired (Logan, 2026-10-28)

Logan changed three of the 128 pre-filled crew marks (9b-012, 017 and
024, Plum sitting: Claude's `clean`, his `anatomy` — a soft pink rounded
patch between the hind legs with no outline) and read no further: "I
stopped when I realized we were using outdated sets that shouldn't be part
of this test." So the other 125 are Claude's alone, never checked, and the
sheet is retired: 10a is off the look, 9b is not the before, 12c–12h are
display. What carries forward is the miss: on the 116 training keeps any
pink or rounded shape between or under the hind legs is `anatomy`, outline
or not (a false alarm costs one repaint, a miss trains anatomy in), and
Logan checks Claude's `clean` calls.

### Claude's marks on the 116 training keeps (2026-10-28; Logan checks the clean calls)

Read by eye at 800 px, by the broad rule above, into
`var/explore/index-all/lora-marks-2026-10-28.tsv` (batch, id, seed, dog,
pose, label, strength, note, file):

- **89 anatomy** (64 clear: a sheath or testicle under a standing dog's
  belly, a pink scrotum between a sitting dog's legs; 25 faint: a pink
  wash or pale shape at the groin with no form) and **27 clean**.
- **The clean ones are the coats that hide the groin**: black or dark
  dogs (Bernese, Bohemian and Himalayan sheepdogs, a black and white
  Aussie puppy), long or shaggy coats (bichons, cavapoos, Dandie Dinmonts,
  Newfoundlands, a cairn) and white fluff (spitz). Nearly every
  short-coated dog has anatomy, standing or sitting, whatever its sex —
  klein draws it by default, as on the crew.
- So the hand step has most of the set to clean, not a few (80 after
  Logan's check, about 7 in 10). A clean set built only from the clean ones
  would teach dark and fluffy coats, so the cleaned ones are the set.
- Logan's check is `var/explore/index-all/marks-check.html`: the 27 clean
  calls (tick a miss) and the 25 faint ones (tick any really clean, which
  saves a repaint).
- **Logan's check (2026-10-28, `marks-check-2026-10-28.txt`, folded into
  the TSV's `logan` column)**: one miss among the 27 clean, the long-haired
  chihuahua 13b-008 ("I would consider faint anatomy"), and 10 of the 25
  faint really clean (13b-001, 003, 028, 034; 13c-020, 021, 058, 059;
  13a-033, 073 — the pink shading on a golden's inner leg or a white dog's
  flank is coat, not anatomy). The set to clean is **80** (64 clear, 16
  faint) and 36 are clean. So the broad rule misses little (1 in 27, where
  the narrow one missed 3 in 10) and over-calls a pink wash on pale coats.

### Batch 15a — the hand step's pilot on the LoRA set, first read (Claude, 2026-10-28; Logan's eye decides)

`comfyui/explore/batch15a.json`: 10 of the 80 marked keeps (13d-018,
13b-055, 13b-041 sitting; 13c-040, 13a-058, 13a-066, 13c-019, 13c-004,
13a-013 standing; the faint chihuahua 13b-008), 12g's winning recipe
unchanged — a polygon traced by eye on gridded crops, LaMa, klein Base on
the unlined fill at 0.85 with the anatomy words as its negative, seeds 1
and 2. Holes 0.04–0.8% of the painting; 20 of 20 under the guard, ~85 s a
repaint, no kill. Sheets: `var/explore/batch15a/lines/` (the holes) and
`var/explore/batch15a/compare/` (original, LaMa, both seeds, both whole).

- **The standing sheaths are clean on both seeds**: white, tan and
  black-and-white street dogs, the azawakh, the galgo — the belly line
  runs on into the far leg, which keeps its shading. The boxer's large
  lobe is gone; a faint pale crescent stays where its lower edge met the
  belly.
- **The faint chihuahua** is clean: the spot is gone in the fluff.
- **Sitting dogs with a ball or ring on a pink belly** (the cattle dog, the
  heavy tan dog): the shape is gone and the pink between the legs stays
  as skin. By the broad rule that pink alone was not the mark; Logan's to
  judge whether it still reads.
- **Weakest: the thin tan dog sitting (13b-041)**, whose whole pink wedge
  was the sac: LaMa filled it with a dark hairy texture the repaint keeps,
  a rounded patch with the sac's silhouette — 12g's Beetle-sitting
  failure again. A wedge-shaped sac wants a different fill (its
  surroundings are thigh and ground, not belly), or the painting is left
  out of the set.
- The two seeds barely differ; the repaint mostly smooths LaMa's fill.
- Tracing took about two minutes a painting from two gridded crops (a
  wide one to find it, a close one to place the points), no second pass.

### Batch 15a — Logan's read (2026-10-28), and 15b, the boxer's line inked

"The pink is fine. Most look really great." Two faults, both ones Ducky
had in 12g: the thin tan dog sitting (13b-041) "its stomach came out a bit
blurry", and the boxer standing (13a-013) "needs an arch line drawn to
separate the belly from blending in with the leg".

15b (`comfyui/groinink.py`, no GPU; `var/explore/batch15b/inked/`): the
boxer's arch inked along the top of the far leg, from the painter's belly
line to the near thigh, on both seeds at both widths — it reads as the
painter's. The tan dog's lower edge inked the same way barely shows against
the dark patch and does not touch the fault: the blur is LaMa's hairy fill
of the whole wedge, which the repaint at 0.85 keeps. The next try for a
wedge-shaped sac is a repaint at full strength inside the hole (denoise
1.0, so klein paints the belly fresh instead of smoothing the fill), on the
card once it is free; failing that, those paintings leave the set. So the
full run carries a per-painting ink step for standing dogs whose belly
meets a dark far leg.

Logan's pick: the boxer at seed 2, the thin line (15b-017 w0.0018,
`var/explore/batch15b/picks.txt`); "maybe try again with poblacion". 15c
(`comfyui/explore/batch15c.json`): the tan dog's whole mauve wedge erased
out through its own outlines and the ground shadow (1.1% of the painting,
against 15a's 0.8% inset from them), so LaMa fills from the cream belly
and thigh round it — the fill now reads as a pale belly with a soft shadow
where it meets the ground, the hairy mauve gone; the thigh's inner edge
went with the hole and may want inking after. Its repaint (0.85 and 1.0,
two seeds, 4 runs) waits for the card. The 15c erase rewrote this
painting's files in ComfyUI's input/sheath/, so 15a's hole for it is now
15c's.

15c ran (4 of 4, ~85 s each; `var/explore/batch15c/compare/`): on all four
the sac and the hairy mauve are gone, the belly between foreleg and thigh
is pale and smooth, and a dark shadow stays where it meets the ground
behind the rear paw. 0.85 and 1.0 barely differ — the fill, not the
strength, was the fault. The thigh's inner edge is soft where the hole
took it, so the near thigh reads a little less separate from the belly;
an inked line there is the next step if Logan wants it. Logan's eye
decides.

Logan: "I actually think the 15a is better" — the first pilot's repaint,
the wedge erased inset from its outlines, blur and all, over 15c's
pale belly with the thigh's edge gone. So the full run keeps 15a's way for
wedges too: the outlines stay. (15a's files for this painting in
input/sheath/ were rewritten by 15c; its two repaints are untouched.) His pick: 15a-004, seed 1
(`var/explore/batch15a/picks.txt`).

### Batch 16a — the hand step on the rest of the 80, first read (Claude, 2026-10-28; Logan's eye decides)

63 paintings of 44 dogs (`comfyui/explore/batch16a.json`): 15a's recipe at
one seed — the anatomy erased inside its outlines, LaMa's fill repainted by
klein Base at 0.85 with "genitals" negative. Seven of the 70 left after the
pilot showed pink or fur with no shape and were not erased (13d-020,
13b-039, 13b-019, 13d-004, 13d-005, 13a-039, 13a-026); Logan judges those
as they are. 63 of 63 ran, ~85 s each, no kill.

The erase was run twice. On the first, about 20 holes, mostly standing
sheaths, lay inside the shape's own outline, and LaMa drew the shape back
from the outline left round the hole. Those holes were grown 1.6× and
erased again before the repaint: **a hole must take the shape's outline
with it**, or LaMa redraws it.

Before and after, cropped round the hole, with the whole repaint below:
`var/explore/batch16a/compare/`.

- **Clean, 46.** The shape and its outline gone, the belly and leg lines
  the painter's — the rest of the 63.
- **Still shows, 6** — a second, wider erase:
  13a-016 (the retriever's crescent, outline and all), 13a-034 (the
  brindle tosa's white tip), 13a-035 (the same dog's pink shape with its
  dark end), 13b-005 (a faint ring under the young mixed-breed dog),
  13b-017 (the viroinval beagle's round bump at the ground), 13b-040
  (the poblacion dog's sac). 13b-007's dot, a worry after the erase, is
  gone in the repaint.
- **Faint, 11** — a soft shape or mark left where the anatomy was, mine
  to call broadly: 13a-018, 13a-029 (the kelpie's white tuft, which may
  be fur), 13a-036, 13a-040, 13a-050 (a tan streak under the Boston
  terrier), 13b-006, 13c-001 (a hooked line), 13c-007, 13c-013, 13c-041
  (a dark red mark), 13c-056 (a white patch). Logan's eye decides which of
  these go to the second erase.

Not yet done: the arch line where a standing belly meets a dark far leg
(groinink, after Logan's read).

Logan approves the set on one page, a close-up and the whole painting per
card with a tick for "acceptable, no genitalia": the pilot's picks (both
seeds of the eight he did not pick between), the 63, and the 7 left as
painted — 88 pictures (`var/explore/index-all/clean-check.html`).

### The cleaned set — Logan's read (2026-10-29)

Logan ticked 49 of the 88 pictures on `clean-check.html` as "acceptable, no
genitalia" (`var/explore/index-all/clean-check-2026-10-29.txt`): 41 of the
80 paintings.

- **The pilot, all 10**, both seeds of each of the eight he had not picked
  between; seed 1 goes in.
- **16a, 27 of 63.** Of Claude's six "still shows", none; of the eleven
  "faint", two (13a-018, 13a-036); of the 46 "clean", 25. **Claude's clean
  call missed 21 of 46.** Read again at full size, what those 21 share is a
  form, not an outline: on a sitting or lying dog, a pink or mauve wedge
  between the hind legs that bulges, with the fur strokes converging on it
  (13b-000, 13b-007, 13b-010, 13b-011, 13d-007, 13d-016); on a standing
  dog, the far leg's top rounded and lilac under the belly line, where the
  sheath was (13a-030, 13a-042, 13a-043, 13a-072), or a small nub left on
  the belly (13a-041). Claude's eye at thumbnail size is not a check on
  this; Logan's is.
- **Left as painted, 4 of 7.** 13d-020, 13a-039 and 13a-026 fail.

The approved set is 77 paintings of 56 dogs — the 36 Logan passed clean on
2026-10-28 and these 41 — 47 standing, 17 lying, 13 sitting, listed with
their files in `var/explore/index-all/training-set-2026-10-29.tsv`. The 39
that failed are out unless a second pass cleans them.

### Batch 16b — a second pass on the 39 (Claude, 2026-10-29; Logan's eye decides)

Logan, asked whether 77 is enough: "I don't mind you trying another pass
at the 39 if more would be helpful." It is: tens of paintings are enough
for a LoRA, but the 39 are the hard cases, where the painter draws
anatomy most strongly, and they thin out the poses the LoRA most needs
(sitting 13 of 19 kept, lying 17 of 28).

`comfyui/explore/batch16b.json`: the original paintings, with the hole
taken out to the form Logan read — on a sitting or lying dog, the whole
wedge between the hind legs, out through its outlines to the foreleg,
thigh and ground; on a standing dog, the far leg's top under the belly,
with the shape. The polygons were traced on gridded crops and grown 1.1×
(sitting, lying) or 1.25× (standing). klein Base repaints LaMa's fill at
1.0, so it paints the belly fresh instead of keeping the fill's shading
(15c: 0.85 and 1.0 barely differed when the hole was wide), at two seeds
for Logan to pick between: 78 runs. On the erase sheets
(`var/explore/batch16b/lines/`), the shape and the wedge's shading are
gone on all 39 except one: a small nub by 13b-023's right paw survives
the second polygon.

Ran 78 of 78 under the guard (2026-10-29, about two hours, no kill, the
pool 1.6–1.8 GB between chunks). Not pre-read: Claude's clean calls
missed 21 of 46 in 16a, so the read is Logan's alone, on one page with
both seeds of each painting (`var/explore/index-all/clean-check-2.html`,
78 cards; seed 1 is used where both pass).

### Batch 16b — Logan's read (2026-10-29)

"I've only selected images that don't have genitalia and looked
anatomically correct. A lot of the sitting photos blended too much into
the ground. As far as genitals go, this pass was much better." His ticks
are `var/explore/index-all/clean-check-2-2026-10-29.txt`: 38 of 78
cards, 20 of the 39 paintings.

- **Standing, 16 of 22**: the far leg's top erased with the shape works.
  Both seeds pass on 14; 13a-064 and 13c-007 on seed 2 only.
- **Sitting and lying, 4 of 17** (13b-006, 13b-010, 13b-035, 13b-040):
  the anatomy is gone, but with the hole out to the ground, a repaint at
  1.0 loses where the haunch, the hind paw and the ground part, so the
  dog melts into its shadow. The wide hole is right for the genitals and
  wrong for the anatomy around them; a hole on a sitting dog should stop
  short of the ground line.
- **The set**: 97 paintings of 68 dogs — 63 standing, 19 lying, 15
  sitting — in `var/explore/index-all/training-set-2026-10-29b.tsv`
  (the 77 plus these 20, seed 1 where both pass;
  `training-set-2026-10-29.tsv` stays as the record of the 77). 19 of the
  80 marked paintings stay out, 13 of them sitting or lying.

### Training — the pairs and the job (Claude, 2026-10-29)

As ADR-0004 as amended 2026-10-22 decides it (decisions 2 and 3); nothing
here is new policy, only how it runs.

- **The pairs**: `npm run explore:pairs -- index-all/training-set-2026-10-29b.tsv
  anatomy-2026-10-29` (`comfyui/pairs.py`, CPU) wrote 97 pairs to
  `var/explore/pairs/anatomy-2026-10-29/`. Each is the approved painting
  (pixels only: ComfyUI's PNGs carry the whole workflow as text), captioned
  with the trigger word `mpclean` and the prompt the original was painted
  from, beside the references that painting read — the grown subject crop
  on all 97, the grown head on the 66 painted with `reference2` — scaled
  exactly as klein-v1's ImageScale nodes scale them. A repaint keeps its
  original's references: the LoRA learns from what production hands
  klein-v1. The build stops on any photo that is not a `lora-train`
  Commons file in `commons-photos.tsv`, so no shelter or crew photo, and
  no held-out dog, can enter. `pairs.tsv` traces each pair to its run and
  Commons file.
- **Progress samples**: four `lora-holdout` dogs, two sitting and two
  standing (teckel-39, gonzaja-yellow3, pies-nierasowy-20201003-1644-4305,
  rusty-11y9m-irish-setter), painted by klein Base in the trainer every
  250 steps. They show training's course only; the ship bar (decision 5)
  is read at home on the distilled klein-v1, on Plum, Ducky and Beetle and
  on unseen Commons dogs.
- **The job**: `comfyui/rental/anatomy-lora.yaml` — klein Base 4B in bf16,
  LoRA rank 16, lr 1e-4, AdamW 8-bit, batch 1, 2,000 steps (about 20
  passes over the 97), a checkpoint every 250, at the painting's own
  1216×832. Weights from `comfyui/models-training.manifest` only (klein
  Base 4B, the FLUX.2 VAE we already run, Qwen3-4B), the trainer offline.
  `scripts/gpu-rental.sh up train`, then `train
  var/explore/pairs/anatomy-2026-10-29 var/explore/lora/`, then `down`
  (`doc/infra.md`, GPU rental).
- **Cost** (estimated, not yet measured): ~20 minutes of build and fetch,
  then 2,000 steps with two references at about 1 MP — perhaps 1–2 hours
  on an L40S ($1.57/h, $2–4 in all), under an hour on the H200 ($4.47/h,
  about $5), the only size that could be created on 2026-10-23. Logan
  confirms before the droplet is made.

### Training run 1 — anatomy-2026-10-29 (2026-10-29)

Logan: "pass is unlocked lets give it a go."

- **Where**: one H200 in atl1. The L40S, both Ada cards and the
  RTX 4000 again listed no region, so they could not be created. The
  droplet ran from 18:51 to 19:50 UTC, about $4.40, and was deleted by the
  same command that trained, whatever the outcome; `status` read nothing
  up afterwards.
- **How it ran**: ~20 minutes of build and fetch, all 12 weights matching
  the manifest. Then 2,000 steps in 41 minutes (1.2 s a step), plus four
  progress samples every 250 steps (53 s a set). No error, no retry.
- **What came home**: `var/explore/lora/anatomy-2026-10-29/` — 8 checkpoints
  (250 to 1750 and the final 2000, 45 MB each), the 36 progress samples,
  ai-toolkit's config and `pairs.tsv`. The loss is noise, as BFL's guide
  warns, so it says nothing either way.
- **Claude's look at the samples** (Base, the four holdout dogs, step 0
  without the LoRA through step 2000): the look holds at every checkpoint
  — the same watercolor, ink line and pastel wash — and each dog stays
  itself; the sighthound's coat and wash run a little paler after step
  250. Whether the anatomy is gone is Logan's read, not mine (16a: my clean
  calls missed 21 of 46), on `var/explore/lora/samples.html`.
- **Next**: the ship bar's test at home (decision 5): klein-v1 with the
  LoRA at checkpoints 1000, 1500 and 2000 and strengths 0.6, 0.8 and 1.0,
  on Plum, Ducky and Beetle at 14a–14b's seeds and on the holdout dogs.
  First the LoRA needs its `models.manifest` line: decision 2 gives it an
  `r2:` source, which `models.py` cannot fetch yet.

### Training run 1 — Logan's read of the samples (2026-10-29)

His ticks ("clean and like the dog", one sample per dog per checkpoint)
are `var/explore/lora/samples-2026-10-29.txt`, 15 of 36:

```
dog              0   250   500   750  1000  1250  1500  1750  2000
teckel (sit)    yes   yes   yes    .     .    yes    .     .    yes
gonzaja (stand)  .     .     .     .     .     .     .     .    yes
pies (sit)      yes    .     .    yes   yes   yes    .    yes   yes
rusty (stand)    .     .    yes    .     .     .    yes    .    yes
per step         2     1     2     1     1     2     1     1     4
```

- **Step 2000, the last checkpoint, is the only one all four pass.**
- Without the LoRA (step 0) the two sitting dogs already pass, since the
  pose hides the groin, and both standing dogs fail. With it, both
  standing dogs pass at 2000: the case the LoRA is for.
- In between it is noisy, one sample a cell, and a sitting dog that
  passed at step 0 fails at some checkpoints, so a pass there is not yet
  an effect. Four dogs, one seed: a lead, not a verdict.
- So the home test (decision 5) reads 2000 first; 1500 and 1000 are
  still run, as the ship bar names them. A longer run is the next
  question only if 2000 passes on the distilled klein-v1.

### Batch 17a — the first after (Claude, 2026-10-29; Logan's eye decides)

- **The checkpoints come home through their own manifest.**
  `comfyui/models-candidates.manifest` lists the three test checkpoints
  with 0011's hashes and licence `ours` (ADR-0031, Context 3 and decision
  5), and `models.py` fetched them from `monsterpaws-models` into the home
  store, the R2 env from `pass` in that one command. They are not in
  `models.manifest`: nothing about ComfyUI's start, or production's, depends
  on an experiment or on R2 keys. `explore.py` refuses a LoRA with no line
  in either file (`licensed_lora`). The one chosen moves to `models.manifest`
  by the ADR-0004 amendment decision 5 asks for, and the others leave.
- **On klein**, `explore.py` loads a LoRA with `LoraLoaderModelOnly` on the
  model alone (a `loras` and `lora_strengths` axis for the klein families),
  and the prompt begins with the trigger word the captions began with
  (`mpclean, …`). ComfyUI logged no unmatched LoRA key, so ai-toolkit's
  ComfyUI-prefixed keys load as they are. The before's 64 run ids are
  unchanged.
- **`comfyui/explore/batch17a.json`**: 14a's Plum and Ducky and 14b's Beetle
  exactly, with step 2000 at 1.0 — 48 paintings, 48 done, no kill, 17 s
  each warm, as the before. Not pre-read, because my clean calls missed 21
  of 46 in 16a. Logan's page:
  `var/explore/index-all/before-after-17a.html`, each after beside its
  before, two ticks each ("no genitalia", "still looks like the dog").

### Batches 17b–17c — the other checkpoints and strengths (Claude, 2026-10-29; Logan's eye decides)

- **The rest of the ship bar's grid** (decision 5 of 2026-10-22), run
  before Logan read 17a at his word: the same 48 befores at the same seeds,
  checkpoints 1000 and 1500 at strengths 0.6, 0.8 and 1.0
  (`comfyui/explore/batch17b.json`, 288 paintings) and step 2000 at 0.6 and
  0.8 (`batch17c.json`, 96). With 17a that is nine afters per before, 432
  in all, every one painted, no kill, 19.6 s each warm; 21:01 – 23:55 UTC
  with the guard's restarts.
- Not pre-read, as 17a. Logan's page:
  `var/explore/index-all/lora-grid-17.html` — each before on the left, its
  nine afters beside it (checkpoint down, strength across), one
  "acceptable" tick each (no genitalia, and still the dog no worse than
  the before), the list copied out as `17 <dog> <pose> s<seed> step<N>
  w<strength>`. It holds 17a's afters too, so 17a's two-tick page is
  needed only if he wants the two questions apart.
- **The page shows the paintings themselves** (rebuilt 2026-10-30). Its
  first build showed JPEG copies, the afters cut to 360 px wide and the
  before to 560, so on Logan's screen the afters were stretched more and
  looked blurrier than the before. Now every picture is the 1216×832 PNG,
  before and after alike, and the ticks carry over (same keys).
- **Measured, not judged (2026-10-30), after Logan saw the afters as
  lower resolution.** Every painting, before and after, is 1216×832, and
  the trainer trained at that size (its log: one bucket, 1216×832, 97
  files). What drops is fine detail: the variance of the Laplacian over
  the whole painting is 216.7 on the 48 befores and 111–173 on every
  after group (1000: 158–162; 1500: 111–136; 2000: 151–173), lower at
  higher strength except 1000 at 0.6 against 1.0 (all three alike). The
  set did not teach it: the 97 targets measure 227 (40 originals 267, the
  repaints 190–210). The trainer's own samples on Base fell less (165 at
  step 0, 131 at 2000; four JPEGs a step, noisy). Unproven: the LoRA
  learned on Base and runs on the distilled klein-v1, which softens more
  under a weight change it was not distilled with. How far an after moves
  from its before (mean absolute difference at 1/16 size, the layout and
  the body rather than texture) climbs with both checkpoint and strength,
  from 7.3 (1000 at 0.6) to 10.8 (2000 at 1.0), Beetle most (9.2–14.3) and
  Ducky least (5.7–7.6). Whether a move is a fix or a lost likeness is
  Logan's tick.

### Batch 17 — Logan's first thoughts, before his list (2026-10-30)

- "I can tell that sitting photos often show genital-like areas, usually
  as small nipple bumps or sheath bump."
- "At first I was thinking 1500 strength 1 would work but the Beetle
  photos really help dissipate that opinion. She really starts to lose
  likeness with 1500."
- "1000 isn't bad but much more likely to show genitals."
- Beside the measurements (Claude): Beetle moves furthest from her before
  at every setting, and 1000 the least of the three checkpoints. Sitting
  is the thinner half of the set, 34 of the 97 pairs against 63 standing,
  because the sitting repaints blended into the ground and only 4 of 17
  passed the second pass (16b).

### Batch 17d — checkpoint 1250 (Claude, 2026-10-30; Logan's eye decides)

- Logan asked for checkpoint 1250 in the grid after his first thoughts:
  between 1000 (more anatomy left) and 1500 (Beetle losing likeness).
  Checkpoints 1250 and 1750 went to `monsterpaws-models` by oplog 0014
  (1750 at his word, so painting it later needs no entry), each read back
  through `models.py`, and their lines joined
  `comfyui/models-candidates.manifest`; only 1250 is painted.
- **`comfyui/explore/batch17d.json`**: 17a's spec exactly, with 1250 at
  strengths 0.6, 0.8 and 1.0 — 144 paintings. On Logan's page it is a
  fourth row between 1000 and 1500; the ticks he already made keep their
  keys.
- 144 of 144 painted, no kill, 19.7 s each warm (15:32 – 16:42 UTC). The
  page now holds 576 afters, each the full-size PNG, none missing.

### Batch 17 — Logan's read of the grid (2026-10-30)

His list, saved as `var/explore/index-all/lora-grid-17-picks-2026-10-30.txt`:
78 of the 576 afters acceptable (no genitalia, and still the dog no worse
than the before). Per setting, of 48 (16 per dog, 24 per pose):

| Step @ strength | All | Plum | Ducky | Beetle | Standing | Sitting |
| --- | --- | --- | --- | --- | --- | --- |
| 1000 @ 0.6 | 7 | 3 | 2 | 2 | 6 | 1 |
| 1000 @ 0.8 | 6 | 3 | 2 | 1 | 6 | 0 |
| 1000 @ 1.0 | 9 | 3 | 4 | 2 | 8 | 1 |
| 1250 @ 0.6 | 4 | 3 | 1 | 0 | 4 | 0 |
| 1250 @ 0.8 | 4 | 2 | 2 | 0 | 3 | 1 |
| 1250 @ 1.0 | 8 | 3 | 5 | 0 | 6 | 2 |
| 1500 @ 0.6 | 6 | 3 | 3 | 0 | 6 | 0 |
| 1500 @ 0.8 | 7 | 4 | 2 | 1 | 6 | 1 |
| **1500 @ 1.0** | **13** | 6 | 6 | 1 | 11 | 2 |
| 2000 @ 0.6 | 4 | 2 | 2 | 0 | 3 | 1 |
| 2000 @ 0.8 | 4 | 4 | 0 | 0 | 2 | 2 |
| 2000 @ 1.0 | 6 | 6 | 0 | 0 | 3 | 3 |

- **Sitting fails at every setting**: 14 of 288 sitting afters against 64
  of 288 standing. No checkpoint or strength moves it, so the dials do not
  fix it; the sitting half of the set (34 of 97 pairs, the repaints that
  blended into the ground) is where to look.
- **Strength 1.0 is the best strength at every checkpoint** (36 ticks
  against 21 at 0.6 and 21 at 0.8).
- **Beetle** passes 7 of 192, two at most per setting, and those at 1000
  and 1500 only: his first thought that she loses likeness with more
  training, in numbers.
- **Best setting, 1500 at 1.0**: 13 of 48, three in four still failing.
  Not shippable as it stands; the ticks join anatomy and likeness in one
  box, so they cannot say which of the two failed, and the 48 befores
  have not been ticked on the same question.
- 25 of the 48 befores get no acceptable after at any setting.
- **The baseline, asked 2026-10-30**: `var/explore/index-all/befores-17.html`,
  the 48 befores at full size with one "no genitalia" tick each. An after
  passed on no genitalia and a likeness no worse than its before, and a
  before is never worse than itself, so its "acceptable" is no genitalia
  alone; his 14a–14b picks already hold the befores' likeness.
- **The baseline, Logan's read (2026-10-30)**: 1 of the 48 befores has no
  genitalia (Plum standing s404; `var/explore/index-all/befores-17-picks-2026-10-30.txt`),
  0 of 24 sitting. So every setting beats no LoRA, even with likeness asked
  of the afters too: 4 to 13 of 48 against 1, and at 1500 at 1.0 standing
  goes from 1 of 24 to 11 and sitting from 0 to 2. The LoRA works where the
  set is strong and barely moves sitting, where it is thin. Decision 5's
  bar, nearly none on any dog and zero male anatomy on a female, is far
  off: 35 of 48 still fail at the best setting.

### Run 2's sitting half — painted clean, never erased (Claude, 2026-10-30; Logan's eye decides)

- **Logan chose to paint more and keep only what klein-v1 paints clean on
  its own** (2026-10-30), over another erasing pass. The hand step passed
  4 of 17 sitting paintings in 16b and leans on Claude's traces, which
  missed 21 of 46 in 16a; a painting kept as painted also keeps its
  brushwork (the set's 40 originals measure 267 on the Laplacian, the
  repaints 190–210).
- **The yield to expect**: by Logan's 2026-10-28 marks, 10 of the 100
  sitting paintings in 13b and 13d came out clean as painted. Of the 42
  lora-train dogs painted sitting, he kept a painting of 29 (25 are in the
  set; 4 failed cleaning); their 58 paintings gave all 10 clean, about 1 in
  6. The 13 dogs with no keep are left out.
- **`comfyui/explore/batch18a.json`** (19 dogs, 13b's recipe with the grown
  head) and **`batch18b.json`** (10 dogs, 13d's, subject only): those 29
  dogs at six new seeds (4096, 8128, 17, 404, 1729, 6174), klein-v1
  exactly — 174 paintings, about 30 clean if the rate holds. New Commons
  sitting dogs only if it falls short.
- Logan's page: `var/explore/index-all/sitting-18.html`, each dog's Commons
  photo beside its six, one "keep" tick each (a good painting of the dog
  with nothing genital-like). Kept paintings join the set as more pairs of
  the same dogs; then a second training run, read at strength 1.0 only on
  a few checkpoints around 1500.
- **Batches 18a–18b ran** 2026-10-30, 20:41–21:40 UTC: 114/114 and 60/60,
  no kill, the pool back at 1.7 GB after each. Warm paintings took 11.2 s
  (18a) and 9.0 s (18b), the median. The page is built: 29 dogs, 174
  paintings at full size (1216×832), each dog's photo, 0 missing; checked
  headless, with no horizontal scroll at desktop or phone width.
- **Logan, looking through it (2026-10-31): short-coated dogs rarely come
  out clean; long hair hides the belly and short hair leaves it bare.** So
  the clean sitting paintings the set lacks are of short-coated dogs, and
  he asked for a run of those alone, about ten paintings each.
- **`batch19a.json`** (13 dogs, 13b's recipe with the grown head) and
  **`batch19b.json`** (6 dogs, 13d's, subject only): the short- and
  smooth-coated dogs among the 42 lora-train dogs painted sitting in
  13b–13d, coat read by Claude from the Commons photos, whether Logan kept
  one of their paintings before or not — six of the 19 had no keep, which
  fits his read. Left out as not short: the long, shaggy and double coats
  (labradoodles, tollers, spitz, golden, Bernese, cavalier, long-haired
  chihuahua, maltipoo, the keeshond-husky puppy, the fluffy white and tan
  `pies-nierasowy`), the medium ones (the
  three German shepherds, the white shepherd pup, the husky mix, the
  Bosnian street dog, the Gaggenau dog) and the black dog with a white
  chest (`2`, `3`). Ten new seeds (7, 99, 256, 777, 1001, 2718, 3141,
  5040, 7919, 9973), klein-v1 exactly: 190 paintings. Logan's page:
  `var/explore/index-all/sitting-19.html`, the same as 18's.
- **Batches 19a–19b ran** 2026-10-31, 15:01–16:00 UTC: 130/130 and 60/60,
  no kill, the pool back at 1.7 GB. Warm paintings took 10.5 s (19a) and
  9.0 s (19b), the median. The page is built: 19 dogs, 190 paintings at
  full size, 0 missing; checked headless, with no horizontal scroll at
  desktop or phone width.
- **Logan, after a quick look at 19 (2026-10-31): painting clean will not
  work for the short-coated dogs; back to the hand step** ("the flow where
  you look and we erase"), on those dogs only. As in 15a–16b: Logan picks
  the paintings worth cleaning, anatomy aside, on
  `var/explore/index-all/erase-19.html` (up to three a dog); Claude traces
  the anatomy on each pick, it is erased and repainted, and Logan reads the
  result on one page. What 15a–16b taught carries in: the hole takes the
  shape's outline with it, or LaMa draws the shape back (16a); on a sitting
  dog it takes the whole wedge between the hind legs but stops short of the
  ground line, or the dog melts into its shadow (16b, 4 of 17); Claude's
  clean calls are no check (21 of 46 missed in 16a), so nothing is pre-read
  as clean.
- **Logan's picks to erase (2026-11-01,
  `var/explore/index-all/erase-19-picks-2026-11-01.txt`)**: 115 of the 190,
  of 17 dogs — none of the doberman or the Paris French bulldog, two to ten
  of the rest (the chihuahua and the Bagan dog all ten).
- **`comfyui/explore/batch20a.json`**: those 115, 16b's recipe with the
  sitting lesson in it. Claude traced each wedge by eye on gridded close
  crops (the dog's lower body found from its ink against the paper, two
  crops a sheet) and checked every trace drawn back on its crop: the pink
  or mauve wedge between the hind legs with the shape in it, out through
  its outlines to the foreleg and the thigh, but stopping short of the
  ground line and of the hind paw. Seven paintings carry a second, smaller
  hole where a second shape sits on the other side of the foreleg. Grown
  1.1 as in 16b, LaMa's fill repainted by klein Base at 1.0 with the
  anatomy words as its negative, one seed (the picks already give two to
  ten paintings a dog): 115 runs.
- **The erase** (`npm run explore:groinlines -- batch20a`, CPU): holes
  0.4–1.8% of the painting, larger than 16b's because the wedge here is
  the whole lower belly between the forelegs on a dog painted from the
  front. Every erase sheet (`var/explore/batch20a/lines/`) read before the
  card: the shape gone on 114, and on the chihuahua 19b-014 LaMa drew back
  a second lobe below the hole, where the wedge met the haunch — that trace
  was extended to take it and the painting erased again, clean.
- **The repaint ran** 2026-11-01, 15:58–18:57 UTC under the guard:
  115/115, no kill, the pool back at 1.7 GB. Warm repaints took 84.1 s,
  the median (114–117 s for the first after each restart). Logan's page,
  `var/explore/index-all/check-20.html`: 17 dogs, 115 cards, each with a
  close-up of the hole's box at the painting's own resolution beside the
  whole repaint at full size, one "acceptable, no genitalia" tick each, 0
  missing; checked headless, with the tick surviving a reload and no
  horizontal scroll at desktop or phone width. Not pre-read by Claude.

### Batch 20a — Logan's read (2026-11-01)

His ticks are `var/explore/index-all/check-20-acceptable-2026-11-01.txt`:
44 of the 115 acceptable, with no genitalia. Per dog: the Italian
wheat-field dog 7 of 9; the beaglier and Bimba 5 of 8; the Litochoro dog
4 of 8, the Australian cattle dog 4 of 9, Daphne 4 of 6 and Princess 4 of
7; Botox 2 of 7, the lakeside dog 2 of 5 and the young mixed-breed 2 of 9;
the Bagan dog and the chihuahua 1 of 10 each, the Baliuag dog 1 of 4, the
Mérida dog 1 of 2 and the brindle French bulldog 1 of 5; the blue cattle
dog (6) and the Viroinval beagle (2) none. The hand step with the hole
stopping short of the ground passed 38% of these sitting paintings,
against 4 of 17 in 16b.

- **The set**: 141 paintings of 74 dogs, 63 standing and 78 painted
  sitting (run 1's 34 and these 44), in
  `var/explore/index-all/training-set-2026-11-01.tsv` (run 1's 97 rows
  unchanged, then the 44, each under its original's tag with the 20a
  repaint as its file). The wheat-field dog brings 7, the most of any dog.
- **The pairs**: `npm run explore:pairs --
  index-all/training-set-2026-11-01.tsv anatomy-2026-11-01` wrote 141
  pairs (96 with a head: 19b's six dogs were painted with `reference`) and
  the same four holdout samples as run 1. `comfyui/pairs.py` now names the
  batches a set row may come from (13a–13d, 18a–18b, 19a–19b) and takes
  20a as a repaint. Run 1's 97 pairs come out byte for byte as they did on
  2026-10-29, and the first 97 rows of `pairs.tsv` match.

### Batches 18a–18b — Logan's keeps (2026-11-01)

His keeps from `sitting-18.html`, the sitting paintings as painted, never
erased: `var/explore/index-all/sitting-18-keeps-2026-11-01.txt`, 27 of
the 174, of 18 of the 29 dogs — the chihuahua in the sun 4 of 6; the
Bernese in the grass and the Indian spitz 3; Fiona the golden retriever and
the Järvi toller 2; one each of dogs 2 and 3, the white shepherd pup, the
Litochoro dog, the Bucharest dog, Daphne, the panoramio dog on grass, the
Gaggenau dog, the keeshond-husky pup, the maltipoo, the Polish mixed-breed
(pies-nierasowy-20201225), Princess and the Bosnian dog. The other
eleven have none: ten of the short-coated dogs that 19 and 20a took on,
and Viljo.

- **The set**: 168 paintings of 75 dogs, 63 standing and 105 painted
  sitting, in `var/explore/index-all/training-set-2026-11-01b.tsv`: the
  141 above unchanged, then these 27 as painted (`training-set-2026-11-01.tsv`
  stays as the record of the 141).
- **The pairs**: `anatomy-2026-11-01b`, 168 pairs (115 with a head), the
  same four holdout samples; the 141 come out byte for byte as in
  `anatomy-2026-11-01`, and the first 141 rows of `pairs.tsv` match.
- **Standing's share (Logan asked, 2026-11-01, whether to even it out with
  standing paintings)**: the standing pairs are run 1's 63 unchanged, but
  at run 1's 2,000 steps each would be seen about 12 times instead of 21,
  because the steps are now spread over 168. Run 1's standing gain came
  with exposure (6–8 of 24 at 1000 steps, 11 at 1500, at 1.0), so the same
  job would likely train standing less than run 1 did. Claude's
  recommendation: no new standing paintings before run 2, so its read
  answers one question (does a full sitting half move sitting?), but a
  longer job, about 3,000 steps with a checkpoint every 250, so standing
  reaches run 1's best exposure (1500 × 63/97 pairs ≈ 2,600 steps here) and
  2000 is still there to compare with run 1. Rough cost at run 1's rate:
  about $7. If standing still stalls near half after run 2, more standing
  paintings are run 3's lever. Logan: "go with 3000 steps" (2026-11-01).

### Training run 2 — anatomy-2026-11-01b (2026-11-01)

Logan: "go with 3000 steps, pass is unlocked."

- **The job**: run 1's (`comfyui/rental/anatomy-lora.yaml`) with `steps:
  3000`, on the pairs `anatomy-2026-11-01b` (168: run 1's 97, the 44 20a
  repaints, the 27 18a–18b keeps). Checkpoints every 250 as before, so
  2000 is there to compare with run 1.
- **Where**: one H200 in atl1 again, 22:17–23:42 UTC, up 1.41 h, about
  $6.30, deleted by the same command that trained; `status` read nothing
  up afterwards. ~10 minutes of build and fetch, then 3,000 steps (the bar
  read 1:01:53, 1.24 s a step), the trainer finding all 168 targets at
  1216×832. No error, no retry. The control panel graphed no GPU while
  `nvidia-smi` on the box read 100% at 644 W, which is why `up` now asks
  for the monitoring agent (infra.md, GPU rental).
- **What came home**: `var/explore/lora/anatomy-2026-11-01b/` — 12
  checkpoints (250 to 2750 and the final 3000, 45 MB each), the 52
  progress samples (the same four holdout dogs, step 0 to 3000), the
  config and the set's `pairs.tsv`, now kept inside the run's own folder
  (`gpu-rental.sh train` wrote it to the shared `lora/` folder, where run
  2's would have replaced run 1's; run 1's copy moved into
  `anatomy-2026-10-29/`).
- **Logan's page**: `var/explore/lora/samples-2.html`, the 52 samples at
  full size by dog, each beside its photo, one "clean and like the dog"
  tick each, as run 1's; checked headless (all 52 at 1216×832, the tick
  survives a reload, no horizontal scroll at desktop or phone width). Not
  pre-read by Claude.
- **Next**: the home test on Plum, Ducky and Beetle (decision 5), as
  17a–17d did for run 1, at the checkpoints Logan's read of the samples
  points to. Each needs its R2 upload and `models-candidates.manifest`
  line first (oplogs 0011 and 0014's shape).

### Training run 2 — Logan's read of the samples (2026-11-02)

His ticks ("clean and like the dog", one sample per dog per checkpoint)
are `var/explore/lora/samples-2-2026-11-02.txt`, 30 of 52:

```
dog              0   250   500   750  1000  1250  1500  1750  2000  2250  2500  2750  3000
teckel (sit)    yes   yes    .     .   yes   yes   yes    .     .     .    yes   yes    .
gonzaja (stand)  .    yes   yes   yes    .     .     .    yes    .     .     .     .    yes
pies (sit)      yes   yes   yes    .   yes    .    yes    .    yes    .    yes   yes   yes
rusty (stand)   yes   yes   yes   yes   yes    .     .     .    yes    .    yes   yes   yes
per step         3     4     3     2     3     1     2     1     2     0     3     3     3
```

- **No checkpoint stands out.** Step 250 is the only one all four pass.
  2000, the one all four passed in run 1, passes two (pies, rusty), and
  2250 none. Of the four in the home test, 1500 passes two (the sitting
  pair), 2000 two, 2500 and 3000 three each.
- **The standing gonzaja**, which fails without the LoRA in both runs,
  passes at five checkpoints (250, 500, 750, 1750, 3000), against one
  (2000) in run 1.
- **The step-0 samples are run 1's files, byte for byte** (the same Base,
  prompt, references and seed 42, no LoRA yet). Three got the same tick
  both times; rusty's failed on 2026-10-29 and passes now. Run 1's page
  showed the samples as 420-pixel-wide thumbnails and this one at the full
  1216×832, which may be the difference. Either way a single tick per cell
  moves with the reading as well as with the checkpoint, so the 52 are a
  lead, and the home grid (batch 21a: 48 befores at four checkpoints)
  decides.

### Batch 21a — run 2 at home (Claude, 2026-11-02; Logan's eye decides)

- **The checkpoints**: 1500, 2000, 2500 and the final 3000, sent to
  `monsterpaws-models` by oplog 0015 and read back there with their
  hashes, then listed in `comfyui/models-candidates.manifest` (licence
  `ours`, ADR-0031) and fetched into the home store with the R2 env from
  `pass`, as 17a's were. `explore.py` names them `anatomy2-<step>` beside
  run 1's `anatomy-<step>`.
- **`comfyui/explore/batch21a.json`**: 17a–17d's 48 befores exactly (14a's
  Plum and Ducky, 14b's Beetle, the same prompts and seeds), each painted
  at the four checkpoints at strength 1.0, the strength run 1's grid read
  best (1500 at 1.0, 13 of 48). Painted before Logan read
  `samples-2.html`, at his word ("test the new training lora?" — "yes"),
  so the samples and the home test can be read together. 192 paintings,
  192 done, no kill, 16.5 s each warm (63 s the first, cold); 00:02–01:22
  UTC with the guard's restarts, the pool between 1.6 and 2.1 GB at each
  chunk's end and 1.8 GB idle after.
- Not pre-read. Logan's page: `var/explore/index-all/lora-grid-21.html` —
  each before on the left, its four afters beside it (1500 and 2000, then
  2500 and 3000), every picture the 1216×832 painting itself, one
  "acceptable" tick each (no genitalia, and still the dog no worse than
  the before — run 1's question), the list copied out as `21 <dog> <pose>
  s<seed> step<N>`. Checked headless: 48 befores and 192 afters at
  1216×832, 192 distinct keys, a tick and its untick both survive a
  reload, no horizontal scroll at desktop or phone width.
- **What decides**: the count against run 1's best (1500 at 1.0: 13 of
  48, 11 of 24 standing and 2 of 24 sitting), the sitting rows above all,
  since the sitting half is what run 2 rebuilt.

### Batch 21a — Logan's read of the grid (2026-11-02)

His list, saved as `var/explore/index-all/lora-grid-21-picks-2026-11-02.txt`:
67 of the 192 afters acceptable (no genitalia, and still the dog no worse
than the before), against 36 of run 1's 192 at strength 1.0. Per
checkpoint, of 48 (16 per dog, 24 per pose), with run 1 at the same
strength where it had the checkpoint:

| Step @ 1.0 | All | Plum | Ducky | Beetle | Standing | Sitting | Run 1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1500 | 14 | 9 | 5 | 0 | 5 | 9 | 13 (11 standing, 2 sitting) |
| 2000 | 15 | 8 | 6 | 1 | 11 | 4 | 6 (3, 3) |
| 2500 | 16 | 6 | 4 | 6 | 7 | 9 | — |
| **3000** | **22** | 7 | 7 | 8 | 15 | 7 | — |

- **Best setting, 3000 at 1.0**: 22 of 48, against run 1's best of 13
  (1500 at 1.0), standing 11 → 15 and sitting 2 → 7. Against the befores'
  1 of 48 with no genitalia, more than half still fail, so no checkpoint
  ships yet (decision 5's bar).
- **Sitting moved**: 29 of 96 sitting afters across the four checkpoints,
  against 8 of 96 in run 1 at 1.0 — the 71 sitting paintings added to the
  set did what they were for. Ducky and Beetle sitting stay weakest: 7 and
  4 of 32, and half of each one's eight sitting befores get no acceptable
  after at any checkpoint.
- **Standing came back with the steps**, as the exposure count said (the
  standing-share bullet under Batches 18a–18b): 5 at 1500, where each
  pair has been seen 1500/168 times against run 1's 1500/97, and 15 at
  3000, past the ~2,600 steps that match run 1's 1500.
- **Beetle turned around**: 0, 1, 6 and 8 from 1500 to 3000 (12 of 64),
  where run 1 gave her 3 of 64 at 1.0 and lost her with more training.
  Her count and standing's are still rising at the last checkpoint.
- **39 of the 48 befores get at least one acceptable after** (run 1: 23),
  every one of Plum's 16 among them; the 9 without are Ducky's and
  Beetle's sitting, and one Beetle standing.
- As before, one tick joins anatomy and likeness, so a fail does not say
  which of the two failed.

### Batch 22a — run 2 above strength 1.0 (Claude, 2026-11-02; Logan's eye decides)

- **Why**: run 1's grid rose with strength up to the 1.0 it stopped at
  (36 ticks at 1.0 against 21 at 0.6 and 21 at 0.8), so whether more of
  the LoRA still helps is free to ask at home before a longer run 3 is paid
  for (Logan: "commit and run the strength test", 2026-11-02).
- **`comfyui/explore/batch22a.json`**: batch 21a exactly, with checkpoint
  3000 only (the best of 21a, 22 of 48) at strengths 1.25 and 1.5. 96
  paintings, 96 done, no kill, 19.5 s each warm (63 s the first, cold);
  01:52–02:36 UTC with the guard's restarts, the pool at 1.8 GB at every
  chunk's end and idle after.
- Not pre-read. Logan's page: `var/explore/index-all/lora-grid-22.html` —
  each before and its three afters at 3000 in a 2×2 (before, 1.0; 1.25,
  1.5), every picture the 1216×832 painting itself, one "acceptable" tick
  on each after, the list copied out as `22 <dog> <pose> s<seed> w<strength>`.
  The 1.0 afters are 21a's own paintings, asked again so the three
  strengths are read side by side in one sitting. Checked headless: 48
  befores and 144 afters at 1216×832, 144 distinct keys, a tick and its
  untick both survive a reload, no horizontal scroll at desktop or phone
  width.

### Off the LoRA — Logan's decision (2026-11-02)

Logan, after reading 21a and before reading 22a: "I think i should make
an executive decision and move away from using a lora. reason being, I
think the loss of likeness and increase in softness of the paintings is
not worth it. they just look really good being painted from the model."

- **The record agrees on the cost**: run 1's afters measured 20–50% less
  fine detail than their befores, and drifted further from them with both
  step and strength, Beetle most (17a–17d, measured 2026-10-30); the best
  of run 2 still fails 26 of 48.
- **His three ways to keep genitals out without a LoRA**:
  1. Paint every dog lying down, in a "down" (on its belly, never on its
     side).
  2. Another pose, or something in the picture, that hides them.
  3. Find the area and erase or repaint it, as the tripod step does for a
     leg.
- **What the record already says about each**:
  1. No lying prompt has run on klein-v1. The prompt's pose wins over the
     photo's: 13b and 13d painted lying Commons photos as sitting dogs
     "without a trace of the lying pose", so a down prompt should paint
     down dogs from standing photos. Logan named lying-down poses as a way
     for the crew on 2026-10-23 (The cleanup — Logan's read). A tripod is
     painted standing (ADR-0004 as amended 2026-10-15, decision 2), so
     tripods need their own answer.
  2. Sitting in three-quarter view does not hide them on klein-v1: none
     of the 24 sitting befores was free of genitalia (Logan's baseline,
     2026-10-30).
  3. Repair after painting is kept out of the donation path (ADR-0004 as
     amended 2026-10-22, reading decision 4 of 2026-10-15). The hand step
     needed a trace placed by hand and still passed 41 of 80, 20 of 39 and
     44 of 115; every automatic finder tried missed (RTMPose's hull is the
     thigh, 12e; joining the lines, 12f; Claude's traces missed 21 of 46,
     16a).
- The checkpoints, their `models-candidates.manifest` lines and the
  bucket's nine objects stay as they are until Logan says otherwise; the
  ADR-0004 amendment that drops the LoRA comes with the way that replaces
  it.

### Batch 23a — the pose test (Claude, 2026-11-02; Logan's eye decides)

- **Logan: "run the test"** — Logan's first two ways, as prompts on klein-v1
  exactly as production paints (no LoRA, no step after the painting).
- **Three new prompts in `comfyui/explore.py`**: `storybook_down34` (lying
  on its belly in three-quarter view, front paws out in front, hind legs
  tucked under), `storybook_sphinx` (chest and belly flat on the ground,
  front legs straight out, hind legs folded beneath) and `storybook_bust`
  (a head-and-shoulders portrait from the chest up), each spelled out so
  klein does not lay the dog on its side.
- **`comfyui/explore/batch23a.json`**: 14a's Plum and Ducky and 14b's
  Beetle with everything else as 14a–14b (both photos' grown subject and
  the grown head, the listing words, landscape, the same eight seeds), the
  three prompts in place of standing and sitting. 72 paintings, 72 done,
  no kill, 16.5 s each warm; 02:54–03:24 UTC, the pool 1.8–1.9 GB at each
  chunk's end and 1.8 GB idle after.
- Not pre-read. Logan's page: `var/explore/index-all/pose-grid-23.html` —
  per dog and seed a 2×2 of the standing before and the three new
  paintings, each the 1216×832 painting itself, one "acceptable" tick on
  each new one (no genitalia, still the dog no worse than the before, and
  a pose for a keepsake: a dog on its side fails), the list copied out as
  `23 <dog> s<seed> <down34|sphinx|bust>`. Checked headless: 24 befores and
  72 afters at 1216×832, 72 distinct keys, a tick and its untick both
  survive a reload, no horizontal scroll at desktop or phone width.

### Batch 23a — Logan's read (2026-11-02)

In words, no tick list: "sphinx looked terrible. 3/4 was better but pretty
much only beetle was acceptable like that. plum and ducky still had
strange genitals or weird feet. and sometimes on the 3/4 the dogs would
have three back legs or two bottoms."

- **The portraits pass** (Logan, asked after): "the portraits were mostly
  fine. just one bad one for beetle that gave her extremely wide
  shoulders. hmmmm for v1 we might have to do portait. otherwise the
  incorrect genitals really hurt us and i can't think of anything else
  that makes sense, besides putting pants on the dog."
- **The sphinx is out**, and the three-quarter down works only for Beetle;
  on Plum and Ducky it keeps the genitals or breaks the feet, and klein
  sometimes builds the down from too many parts (three hind legs, two
  rumps).
- **His question: with no pose in the prompt, does klein paint standing
  and sitting?** The record says it takes the pose from the references
  instead (3b: "the reference fixes the composition", couch and grass
  included; 3b–4a: Ducky's couch photo, lying toward the camera, painted
  a foreshortened, stubby Ducky, and a standing photo as the second
  reference stood her up in profile). A pose in the prompt beats the
  reference's (4a), which is why production names one, three-quarter
  (4b), on a landscape canvas (9b). With no pose word, a listing's photos
  would choose it: mostly standing or sitting, since that is how shelter
  dogs are photographed, but a lying photo paints a lying dog.

### Batch 24a — pants, tall grass and the portrait (for fun; Logan, 2026-11-02)

- Logan: "just for fun, i want 3 kings of paintings of ducky, plum, and
  beetle. 1 with pants on, 1 in tall grass, and 1 portrait." Two new
  prompts in `comfyui/explore.py`: `storybook_pants34` (standing in
  three-quarter view in snug knitted dog pants over the hips, belly and
  hind legs) and `storybook_grass34` (standing in tall meadow grass and
  wildflowers up to the chest), beside 23a's `storybook_bust`.
- **`comfyui/explore/batch24a.json`**: 23a's recipe at three seeds it did
  not use (7, 99, 1234), so the portraits are new ones. 27 paintings, 27
  done, no kill, 16.5 s each warm; 04:00–04:12 UTC, the pool 1.6–1.8 GB.
- Not pre-read. Logan's page: `var/explore/index-all/fun-24.html` — per
  dog a row of each kind, every picture the 1216×832 painting itself, an
  optional tick each. Checked headless (27 at 1216×832, a tick and its
  untick survive a reload, no horizontal scroll at either width).

### Correct anatomy on a male is fine — Logan's decision (2026-11-02)

Logan: "correct anatomy on males is fine. just no male sheaths on
females." And: "so for males i don't care if the sheath shows or not."
Decision 4 of ADR-0004 as amended 2026-10-15 said none is
wanted on any keepsake; its first half (never male anatomy on a female)
stands and its second is withdrawn, by the ADR-0004 amendment that records
the way chosen. Logan's idea to try with it: "if male, standing, if female
sitting and maybe say with nipples" — batch 25a. Teats already pass batch
9b's rule, and Logan saw sitting paintings show "small nipple bumps or
sheath bump" (batch 17), so a female's own anatomy named may steer klein
from the one to the other. If it works, Logan's thought: "maybe we ship
both a full body and portrait per animal" (open, with the ADR-0004
amendment).

### Batch 25a — a female sitting, her nipples named (Claude, 2026-11-02; Logan's eye decides)

- **Two new prompts in `comfyui/explore.py`**: `storybook_sit34_nipples`
  ("a female dog with small nipples along her belly") and
  `storybook_sit34_teats` ("her belly showing the two rows of small
  nipples a female dog has"), each otherwise production's sitting prompt.
- **`comfyui/explore/batch25a.json`**: 14a's Ducky and 14b's Beetle as
  production paints them (klein-v1, both photos' grown subject and the
  grown head, the listing words, landscape, the same eight seeds, no
  LoRA), the two wordings in place of standing and sitting. 32 paintings,
  32 done, no kill, 16.5 s each warm; 04:13–04:27 UTC, the pool at 1.6 GB.
- Not pre-read. Logan's page: `var/explore/index-all/female-25.html` — per
  dog and seed the 14a–14b sitting before and the two new paintings, each
  the 1216×832 painting itself with one "acceptable" tick on the new rule
  (no sheath or other male parts on her, nipples fine, and still her no
  worse than the before). The before is ticked too, since the old
  baseline (none of 24 sitting clean) counted teats as a fail. The list
  copies out as `25 <dog> s<seed> <before|nipples|teats>`. Checked
  headless: 48 at 1216×832, 48 distinct keys, a tick and its untick
  survive a reload, no horizontal scroll at either width.

### Batch 25a — Logan's read (2026-11-02)

Logan: "very interesting test but neither will work." Naming her nipples,
in either wording, does not make a sitting female safe: the prompt alone
cannot keep a full body for a female inside decision 4, so a full body
and a portrait per animal ("if this works") is out for females. Where that
leaves the ways (Claude's read, Logan's to overrule):

- **The portrait for every animal (Claude's recommendation for v1).** It
  passed on all three dogs in 23a and 24a (one Beetle too broad in the
  shoulders), it needs nothing from the listing's sex, and the donor's
  four candidates stay one kind for the judge. Before it ships: the
  portrait on the twelve Commons dogs held out of the LoRA set (four
  seeds, 48 paintings), so the pass is not only the three dogs it was
  found on; the likeness harness on it, since a change to a generation
  prompt runs the harness before ship; and the ADR-0004 amendment.
- **A full body as well, for males only.** Correct anatomy on a male is
  fine, so two full bodies and two portraits for a male stay inside the
  rule. It rests on the listing's sex being right: a female listed as
  male would be painted standing, and klein paints male anatomy on a
  female (one of Beetle's 14b likeness picks has a sheath she lacks).
  Whether klein's male anatomy is correct is unmeasured: in 23a's downs
  Plum, the male of the three, and Ducky had "strange genitals or weird
  feet".

### One more brainstorm — Logan's picks and a new rule (2026-11-02)

Logan: "lets have one more quick brain storming session on how to get this
to work reliably. lora had okay results but the image quality degrades.
text prompts are often ignored. laying down in 3/4 pose wasn't terrible
but sometimes the animal had two rearends and the foot under the stomach
looked unatural." Claude's six: (1) the pose as a picture, a third
reference; (2) the LoRA on the first of the four steps only; (3) something
real over the hips (a high-sided dog bed, a basket, a blanket); (4) a
camera angle, seen from a little above, looking up; (5) paint more and
keep the clean ones, through a trained anatomy check, with the portrait
filling any gap; (6) a real negative prompt. Claude offered (6) as
untried, and it was not: klein Base with the anatomy negative (batch 10a,
anatomy in 19 of 24 against 22, 135 s a painting, off the look) and NAG
(batches 12a–12b, no setting removed anything) are both out.

Logan: "i want to try 1. with the gray silhouette, 4. the looking up
angle. and i just though of another. so males can do any pose, females
should only sit or laydown. How about we try and add a sign infront of
their genital area with the animals name on it?"

- **The rule**: a male in any pose, a female sitting or lying down. It
  rests on the listing's sex; Claude's proposal, Logan's to overrule: a
  listing with no sex is painted as a female.
- **The sign, Claude's read**: the most keepsake-like of the ways, since
  the name makes the card the donor's own. The risk is the lettering: a
  misspelled name on a keepsake is worse than no sign. Either klein
  letters it and a spelling check turns away a miss, or the sign is
  painted blank and the name lettered on after, which is an after-paint
  step that ADR-0004 as amended 2026-10-22 keeps out of the donation path:
  a name is not a repair, but the amendment would have to say so. Its
  place is asked in words, which klein may ignore as it does the anatomy
  words, and a sign stood on the ground in front, not held, keeps paws out
  of it. Parked: on adoption day the evolution card's sign could change.

### Batches 26a–26c — the silhouette, the angle and the sign (Claude, 2026-11-02; Logan's eye decides)

- **The silhouette**: Bronco's down (Commons, lora-holdout,
  `Bronco-laying-down-LR.jpg`): three-quarter, front paws out, hind legs
  tucked, the groin out of sight. Cut by the detector's own SAM mask of it
  (`var/explore/detect-lora/masks/`), the ear's speckled gaps closed,
  filled flat grey on the pale ground; no tail, since the mask stopped
  short of it. Two files in `var/comfyui/input/poses/`: `bronco-down.png`
  at its own aspect for a reference, `bronco-down-canvas.png` on the
  1216×832 canvas (80% of the width, on a ground line at 88% of the
  height) for a starting image.
- **`comfyui/explore.py`**: a `POSES` table and a `poses` axis on
  reference2 — a pose read as a further reference after the head, so the
  words can name it, or the canvas copy as the starting latent at a
  denoise. The trap: at four steps a denoise above 0.8 starts from pure
  noise all the same (KSampler keeps the last 4 of int(4 / denoise)
  steps), so 0.8 skips one step of five and 0.65 two of six. The sign's
  prompt takes the animal's name.
- **The batches**, each 14a's Ducky and 14b's Beetle (the females) as
  production paints them at the same eight seeds, no LoRA:
  - 26a: the silhouette as a fourth reference, the prompt naming it
    (`storybook_down34_silhouette`), 16 paintings.
  - 26b: the silhouette as the starting image at 0.8 and 0.65, the down
    without its tucked hind legs (`storybook_down34_paws`), 32.
  - 26c: sitting seen from a little above, looking up
    (`storybook_lookup`), and sitting behind a small wooden sign
    hand-lettered with her name (`storybook_sign`), 32.
- **The run**: 80 of 80, no kill, 15:58–16:33 UTC; 24.0 s a painting
  warm with the fourth reference (26a), 16.5 s otherwise; the pool
  1.7–1.9 GB. Every sign prompt carries the dog's own name.
- Not pre-read. Logan's page: `var/explore/index-all/female-26.html` —
  per dog and seed the down's row (23a's before, the silhouette as a
  reference, painted over at 0.8 and at 0.65) and the sit's (14a–14b's
  before, looking up, the sign), each the 1216×832 painting itself with
  an "acceptable" tick (no sheath or other male parts on her, one body
  with natural legs and feet, and still her, no worse than the before),
  the befores ticked too, and on a sign a second tick for her name spelled
  right. The list copies out as `26 <dog> s<seed> <tag>`, the names as
  `… sign name-right`. Checked headless: 112 paintings (80 new, 32
  befores) at 1216×832, 128 distinct keys, a tick and its untick survive
  a reload, no horizontal scroll at either width.

### Batches 26a–26c — Logan's first word (2026-11-02)

Logan: "you know what we are getting somewhere with the sign. i think its
the way to go BUT I'm thinking it might be acceptable for the user to get
paintings with and without the sign so incase they are unhappy with the
genitals they have the sign version which most of the time seems to cover
the genitals sometimes not but not terrible. i'm almost thinking two
images with a sign and two without." Open, with Claude's read (Logan's to
overrule):

- **For a male, two and two holds as it is**: correct anatomy on a male
  is fine, so both halves are within the rule.
- **For a female, a plain full body would break decision 4's first half**,
  which Logan kept ("just no male sheaths on females"): the donor keeps
  all four (ADR-0004 as amended 2026-10-14), so a sheath on two of them is
  painted on her and handed over, not avoided by choice. A female's two
  without a sign could be portraits instead, safe in 23a and 24a: two
  with her name on a sign, two head and shoulders.
- **The sign's own misses** ("sometimes not") still put male anatomy on a
  female when they happen; how often, per dog, is in Logan's ticks on
  `female-26.html`, and that rate decides whether the sign needs idea
  5's anatomy check behind it; the name ticks say the same of a spelling
  check.

### The four a donor gets — Logan's decision (2026-11-02)

Logan: "Ah okay so for both males and females we send two portraits and
two full body with the signs. males can be in any pose and females we hope
are sitting. lets run a test of this and see what we get with the crew."

- **Every animal's four**: two head-and-shoulders portraits and two full
  bodies behind or beside a wooden sign with the animal's name; a male in
  any pose, a female sitting. No full body goes out without the sign.
- It settles the two-and-two question above: a female's two without a
  sign are portraits, so decision 4's first half (never male anatomy on a
  female) holds but for the sign's own misses, whose rate the ticks give.
- The ADR-0004 amendment records it once the crew's sets pass, with the
  LoRA dropped, the male rule and what a tripod gets.

### Batches 27a–27b — the crew's sets (Claude, 2026-11-02; Logan's eye decides)

- **27a**: Ducky and Beetle, a portrait (`storybook_bust`) and a sitting
  full body behind a sign with her name (`storybook_sign`, 26c's) at each
  of eight seeds no batch had used (23, 314, 777, 1001, 2718, 5050, 8080,
  9999), klein-v1 as production paints, no LoRA. 32 paintings.
- **27b**: Plum at the same seeds, a portrait, standing beside a sign with
  his name (`storybook_sign_stand`, new: beside, since nothing on a male
  needs hiding), and sitting behind one as the females do. The sitting one
  asks whether one recipe serves both: with no sex branch, a female
  listed as male is still covered. 24 paintings.
- **The run**: 56 of 56, no kill, 17:29–17:52 UTC, 16.5 s a painting
  warm, the pool 1.7–1.8 GB; every sign prompt carries the dog's own name.
- Not pre-read. Logan's page: `var/explore/index-all/sets-27.html` — per
  dog two sets of eight (after Logan's eight-a-donation decision below),
  each row one seed's portrait beside its sign, Plum's with his four
  sitting behind the sign below; each painting the 1216×832 painting
  itself with an "acceptable" tick (the dog's rule, one body with natural
  legs and feet, still the dog), each sign a "name spelled right" tick,
  each set an "I'd be happy sending this set of eight" tick (Plum's twice,
  standing and sitting). Copies out as
  `27 <dog> s<seed> <portrait|sign|sign-stand>`, `… name-right` and
  `27 <dog> set<n> good[-sitting]`. Checked headless: 56 at 1216×832, 96
  distinct keys, a tick and its untick survive a reload, no horizontal
  scroll at either width. A reload within milliseconds of a tick can
  miss it (Chromium writes a file page's storage a moment late); the
  check waits half a second, as a person always does. The layout screenshot
  happened to show one sign lettered "Betle" (Beetle, seed 1001): the
  spelling risk is real; how often is in Logan's name ticks.

### Four and four? — Logan's thought (2026-11-02)

Logan: "i'm thinking 4 and 4 so 8 total per donation. how much time am i
adding and do you think its okay?" Open; Claude's numbers and read:

- **Time**: 16.5 s a painting warm on the A770, so four more add about
  66 s: some 2 min 15 s of painting a set, plus the model's load when the
  card is cold (the first painting of a batch took 45–65 s today). One
  card paints about 218 an hour: some 27 donations an hour at eight, 54
  at four.
- **Storage**: a painting is 1.34 MB (27a's mean), so 5.4 MB more a
  donation in R2; pennies, as the four-candidate amendment found.
- **The cost that counts**: the donor keeps every candidate (ADR-0004 as
  amended 2026-10-14), so each sign's miss or misspelled name is in the
  set. At a per-sign rate p, the share of sets holding at least one is
  1 − (1 − p)^4 against 1 − (1 − p)^2: at p = 10%, 34% against 19%.
  Logan's ticks on `sets-27.html` give p, per dog.
- **Four of a kind look alike**: four seeds of one prompt are near
  repeats. If eight, Claude would vary them (a background, a season) so
  each is its own picture.
- **The judge needs kinds of four**: auto-QC v0 (`doc/plans/the-look-exploration.md`)
  rejects the candidate whose mean cosine to the other three sits far
  below, which assumes four paintings of one prompt. Across kinds a
  portrait always looks the odd one out, and within a kind of two it
  cannot tell which is odd; four of each gives it its comparison back.
  It judges likeness and outliers only, never anatomy or the name.
- Eight changes the set of four (ADR-0004 as amended 2026-10-14, decision
  1), so it goes in the coming amendment.

Logan: "okay so 4 and 4 and 4 seeds. so 1 portrait and 1 body use 1
seed." **Decided: eight a donation** — four seeds, each painting one
head-and-shoulders portrait and one full body with the name's sign; the
four of a kind differ by seed, so the judge compares within each kind.
Still to come: the sign's miss and misspelling rates, from Logan's ticks.
27a–27b already hold two such sets per dog (seeds 23, 314, 777, 1001 and
2718, 5050, 8080, 9999); `sets-27.html` shows them so.

### Batches 27a–27b — Logan's read (2026-11-02)

Logan's ticks, saved as `var/explore/index-all/sets-27-picks-2026-11-02.txt`
("acceptable": the dog's rule, one body with natural legs and feet, still
the dog):

| | portrait | sign, sitting behind | sign, standing beside | name spelled right |
| --- | --- | --- | --- | --- |
| Plum (male) | 8 of 8 | 5 of 8 | 2 of 8 | 16 of 16 |
| Ducky | 8 of 8 | 2 of 8 | — | 8 of 8 |
| Beetle | 6 of 8 (not s314, s8080) | 2 of 8 | — | 7 of 8 |

- **The portrait holds**: 22 of 24.
- **The sign's full body does not yet**: a female's 4 of 16, so a set of
  four signs would hold three she should not get, on average. Which part
  of the rule failed each one the tick does not say.
- **Plum sits better than he stands**: 5 of 8 behind the sign against 2
  of 8 beside it, so one recipe (sitting behind the sign) serves the male
  too, and needs no sex from the listing.
- **The name is right 31 times in 32**; the miss is Beetle s1001's
  "Betle", whose painting is otherwise acceptable.
- **The same seeds pass on every dog**: both females' acceptable signs
  are s23 and s1001, and Plum's sitting five include both. By chance two
  of eight would match exactly one time in 28. The seed's noise sets the
  layout before the dog's references shape it, so a seed that puts the
  sign where it covers may do so for any dog — to be tried on dogs these
  seeds have never painted.
- **No set ticked** as good to send.

What failed the females' signs, Logan: "either a small sheath or just odd
looking genitals in general and sometimes messed up feet." And on the
seeds: "yeah lets see if the seeds hold. so if they do do we just need to
find more seeds that 'hold'". Claude's answer: yes — four that hold, one
for each pair in a set of eight, found by painting the sign at many new
seeds on a few dogs, keeping those that pass on every dog, and confirming
them on dogs they never painted. The trap: a seed holds only while the
recipe is unchanged (the canvas, the model, the steps, the sampler, the
prompt's words, the photos' crops); any change to it re-opens the search.
ComfyUI draws its starting noise on the CPU, so a seed paints the same on
any card, but no other painter (the Replicate escape hatch) would
reproduce it. The cost: every animal's sign paintings share four layouts.

### Batch 28a — do the seeds hold on new dogs? (Claude, 2026-11-02; Logan's eye decides)

- **`comfyui/explore/batch28a.json`**: the ten lora-holdout Commons dogs
  whose head the detector found (batches 13a–13b; the other two have
  none), klein-v1 as production paints — the one photo's grown subject and
  the grown head, the listing words, landscape, no LoRA — at seeds 23, 314,
  777 and 1001, each a portrait and a sitting full body behind the sign:
  a set of eight per dog, 80 paintings. 23 and 1001 held on the crew; 314
  and 777, which failed there, are the control, so a pass at 23 and 1001
  means the seed and not easier dogs.
- Each dog's sign carries a given name (`name` in the spec, which the
  prompt now prefers to the animal's key): Gonzaja, Rusty and Pepe from
  their files, then Otto, Daisy, Coco, Emily, Bianca, Sunny and Bronco.
  Their sex is unknown, so the strict rule applies to all: nothing
  showing, sheath or otherwise.
- **The run**: 80 of 80, no kill, 18:22–18:44 UTC, 10.5 s a painting warm
  (one photo, so two references), the pool 1.7–1.8 GB.
- Not pre-read, and blind: Logan's page `var/explore/index-all/seeds-28.html`
  never says which seeds held on the crew. Per dog its Commons photo,
  then four rows, one per seed, a portrait beside its sign, each the
  1216×832 painting itself with an "acceptable" tick (no genitals showing
  at all, natural legs and feet, still the dog in the photo) and on a sign
  a "spelled right" tick. Copies out as `28 <name> s<seed> <portrait|sign>`
  and `… name-right`. Checked headless: 80 at 1216×832, the ten photos
  load, 120 distinct keys, a tick and its untick survive a reload, no
  horizontal scroll at either width.

### Batch 28a — Logan's read (2026-11-02)

Logan's ticks, saved as `var/explore/index-all/seeds-28-picks-2026-11-02.txt`:

| seed | sign, the ten new dogs | with the crew's three sitting | portrait | name right |
| --- | --- | --- | --- | --- |
| 23 | 8 of 10 | 11 of 13 | 8 of 10 | 8 of 10 |
| 1001 | 6 of 10 | 9 of 13 | 8 of 10 | 6 of 10 |
| 314 (control) | 4 of 10 | 5 of 13 | 9 of 10 | 8 of 10 |
| 777 (control) | 4 of 10 | 4 of 13 | 8 of 10 | 6 of 10 |

- **The seed matters**: 14 of 20 signs at 23 and 1001 against 8 of 20 at
  the control seeds, on dogs neither had painted. Seed 23 holds best, 11
  of 13 dogs in all; 1001 is weaker on new dogs than on the crew.
- **The dog matters too**: Rusty, Emily and Sunny pass at every seed;
  Pepe, Bianca and Bronco only at 23; Gonzaja only at 1001, Coco only at
  777. A search learns most from the dogs that fail somewhere.
- **Even seed 23 misses** about one dog in seven, so four seeds as good
  as it would still leave a set of eight about half a miss on average.
- **Portraits**: 33 of 40, Coco 2 of 4; 55 of 64 with the crew's.
- **Names**: 28 of 40 right. Daisy's and Emily's were misspelled at all
  four seeds (Logan: "they were misspelled"); Gonzaja, Otto, Coco and
  Sunny missed one each; Rusty, Pepe, Bianca and Bronco none. A name klein
  cannot spell it misspells at every seed, so a fresh seed is no cure;
  59 of 72 with the crew's. The ways: a spelling check that drops a
  misspelled sign (and the set falls back to portraits), or the sign
  painted blank and the name lettered on after in our own type — an
  after-paint step ADR-0004 as amended 2026-10-22 keeps out of the
  donation path, so the amendment would have to allow a name.

### Batches 29a–29b — the seed search (Claude, 2026-11-02; Logan's eye decides)

Logan: "yes" to the search. The sitting full body behind the sign alone
(`storybook_sign`), at sixteen seeds no batch had used (101, 333, 500, 888,
1111, 1500, 2024, 3000, 3333, 4444, 5555, 6000, 7777, 8888, 9001, 12321),
on the six dogs that failed at some seed in batches 27–28: Ducky and
Beetle (29a, two photos each) and Pepe, Bianca, Bronco and Gonzaja (29b,
one photo each). klein-v1 as production paints, no LoRA; 96 paintings.
A seed that passes on most of the six goes on to dogs it has never
painted, since among sixteen some will pass on six by luck.

- **The run**: 96 of 96, no kill, 19:03–19:34 UTC (16.5 s a painting warm
  with two photos, 10.5 s with one), the pool 1.7–1.8 GB.
- Not pre-read. Logan's page: `var/explore/index-all/seed-search-29.html`
  — per dog its sixteen signs (the Commons dogs with their photo, the
  crew's without), each the 1216×832 painting itself with one
  "acceptable" tick; the name is not asked. Copies out as
  `29 <name> s<seed>`. Checked headless: 96 at 1216×832, 96 distinct keys,
  a tick and its untick survive a reload, no horizontal scroll at either
  width.

### Batches 29a–29b — Logan's read (2026-11-02)

Logan's ticks, saved as `var/explore/index-all/seed-search-29-picks-2026-11-02.txt`:
47 of 96. Per seed, of the six dogs (Ducky, Beetle, Pepe, Bianca, Bronco,
Gonzaja):

| seeds | dogs passed |
| --- | --- |
| 1111 | 6 of 6 |
| 101, 333, 3000, 5555 | 5 of 6 |
| 888, 4444 | 4 of 6 |
| 500, 3333, 12321 | 3 of 6 |
| 1500 | 2 of 6 |
| 7777, 8888 | 1 of 6 |
| 2024, 6000, 9001 | 0 of 6 |

- **Seeds spread wide**, from all six to none, on the same six dogs: the
  seed is most of the difference. 1111 is the first to pass everywhere;
  101, 333, 3000 and 5555 miss one dog each, a different one apart from
  3000 and 5555 (both Bronco).
- **Ducky and Beetle pass at 8 and 9 of 16**, against 2 of 8 each in
  batch 27: the crew's females are not hopeless, their seeds were.
- Among sixteen, some pass by luck, so 1111, 101, 333, 3000 and 5555 go
  to dogs they never painted, on the recipe that ships (the blank sign,
  lettered), if batch 30 shows the blank sign keeps a seed's layout.

### The name, lettered by us — Logan's decision (2026-11-02)

Logan: "lets letter the name ourselves." The sign is painted blank and the
name is set on it after, in our own type: always spelled right, any length
or alphabet. It is an after-paint step, which ADR-0004 as amended
2026-10-22 keeps out of the donation path, so the coming amendment allows
this one: a name lettered on a board the painter left blank, never a
repair of what it painted.

### Batches 30a–30b and `comfyui/signname.py` — the blank sign, lettered (Claude, 2026-11-02; Logan's eye decides)

- **`storybook_sign_blank`**: the sign prompt with "a small blank wooden
  sign … the sign's board plain and smooth with nothing written on it" in
  place of the name. At seeds 23 and 1001 on the thirteen dogs those seeds
  painted with the name (30a: Plum, Ducky, Beetle; 30b: the ten held-out
  Commons dogs), 26 paintings. Two questions: does klein leave the board
  blank, and does each seed keep its layout when the words change from a
  name to blank (a seed holds only while the recipe is unchanged, so the
  search's seeds carry over only if it does).
- **`comfyui/signname.py`** (CPU, the explore container): OWLv2 finds the
  sign, SAM 2.1 outlines it, the board is the outline's longest run of
  rows at least 75% of its widest, its corners the board's extreme
  points; the name is set flat in Caveat Bold (SIL OFL 1.1, in
  `var/fonts/caveat/` for the prototype, sha256 `0bdb6b66…57988`),
  warped onto the corners inset 10% and 16%, and multiplied into the wood
  in dark brown so the grain shows through. A font the donation path uses
  needs its licence recorded beside its hash first, as a model does.
- **The run**: 26 of 26, no kill, 19:59–20:14 UTC, the pool 1.8–1.9 GB.
  `signname.py` found a board on all 26 (OWLv2's sign score 0.20–0.56)
  and lettered each; its sheets (`var/explore/batch30{a,b}/signname/boards.jpg`)
  show every board painted blank and its outline on the board.
- **The layout partly holds**: the sign's box at each dog and seed,
  blank against named, overlaps by IoU 0.35–0.72 (median 0.56), and the
  blank board is larger (median 15% of the canvas against 12%), at seed
  23 a little to the right. Whether the search's ranking carries over is
  for the confirmation to show, on the blank sign.
- Not pre-read. Logan's page: `var/explore/index-all/lettered-30.html` —
  per dog and seed, klein's own lettering (batches 27–28, dashed, not
  ticked) beside the blank sign lettered by us, which carries an
  "acceptable" tick and a "the lettering looks good" tick. Copies out as
  `30 <name> s<seed> ok|lettering`. Checked headless: 52 at 1216×832, 52
  distinct keys, a tick and its untick survive a reload, no horizontal
  scroll at either width.

### The lettering, carved — Logan's word and the styles (2026-11-02)

Logan on `lettered-30.html`: "the type looks too printed. it doesn't look
like it belongs. though the size and spacing and spelling and all that is
perfect. maybe if we could somehow give the lettering that carved in depth
look. lets fix the lettering style first."

- **`signname.py` now cuts the name in**: a V-groove whose depth is each
  pixel's distance from the stroke's edge (smoothed by a third of the
  stroke's half-width, or the distance's whole-pixel steps show as rings
  on the walls), lit from the top left, so the upper-left wall falls in
  shadow and the lower-right one catches the light, over a floor of the
  board's own wood darkened; the stroke's edge wobbles a little, broad and
  seeded by the name, so it reads as cut by hand. Size, spacing and place
  are unchanged. The board's corners are kept in `boards.json`, so a new
  style reruns without finding the board again.
- **Three strengths** (`--style`): `carved`; `painted`, the groove
  filled brown as a painted sign's is; `deep`, a darker floor and stronger
  walls. The flat first try stays as `ink`.
- Logan's page: `var/explore/index-all/lettering-style-30.html` — eight
  boards (Plum, Ducky, Beetle, Gonzaja, Daisy, Emily, Bronco, Otto), each
  in the three styles, the painting at full size with its board beneath at
  the painting's own pixels; a "looks like it belongs" tick on each.
  Checked headless: 24 paintings and 24 boards at 1216 wide, a tick and its
  untick survive a reload, no horizontal scroll at either width.
- **Logan's pick: `carved`**, 8 of 8; `painted` and `deep` none (saved as
  `var/explore/index-all/lettering-style-30-picks-2026-11-02.txt`).
  `carved` is `signname.py`'s default.

### Batches 31a–31b — the seeds confirmed on the recipe that ships (Claude, 2026-11-02; Logan's eye decides)

- The search's winners — 1111, 101, 333, 3000, 5555 — and seed 23 as the
  reference, on the recipe that ships: the sign painted blank
  (`storybook_sign_blank`) and the name carved in by `signname.py`.
- On fourteen dogs these search seeds never painted: Plum (31a), the six
  held-out Commons dogs the search left out (Rusty, Otto, Daisy, Coco,
  Emily, Sunny) and seven lora-train Commons dogs no seed test used,
  named for their signs Shadow, Biscuit, Clementine, Luna, Bailey, Max
  and Duke (31b). 84 paintings, klein-v1 as production paints, no LoRA.
- The four seeds that ship are the ones that pass most widely here; a
  seed that passed six of six by luck in the search falls back now.
- **The run**: 84 of 84, no kill, 20:52–21:20 UTC, the pool 1.8–1.9 GB.
  `signname.py` found a board on all 84 and carved each name; four were
  found at a low score (0.11–0.19: Sunny at seed 5555, Clementine twice,
  Duke once), their outlines still on the board in the sheet
  (`var/explore/batch31b/signname/boards.jpg`).
- Not pre-read, and blind: Logan's page
  `var/explore/index-all/seeds-confirm-31.html` never says which seeds the
  search chose. Per dog its Commons photo (Plum's is never shown), then
  its six carved signs, each the 1216×832 painting with an "acceptable"
  tick and a "the name sits right on the sign" tick. Copies out as
  `31 <name> s<seed> ok|name`. Checked headless: 84 at 1216×832, the
  thirteen photos load, 168 distinct keys, a tick and its untick survive a
  reload, no horizontal scroll at either width.
- **The strict rule for every dog, males included** (Logan asked; Claude's
  answer): one recipe paints every animal, so a seed is judged on whether
  its sign covers whatever is there; a seed that covers a male covers a
  female, and the Commons dogs' sex is unknown. In a donor's set a male's
  correct anatomy past the sign is still fine.

### Batches 31a–31b — Logan's read (2026-11-02)

Logan's ticks, saved as `var/explore/index-all/seeds-confirm-31-picks-2026-11-02.txt`:
42 of 84 acceptable, the name sitting right on 81 of 84.

| seed | the search (6 dogs, the name painted) | here (14 new dogs, blank and carved) |
| --- | --- | --- |
| 3000 | 5 | 10 |
| 1111 | 6 | 9 |
| 333 | 5 | 7 |
| 23 | 11 of 13 (batches 27–28) | 6 |
| 101 | 5 | 5 |
| 5555 | 5 | 5 |

- **The seeds fell back toward half**, as a search's luck does, and the
  blank prompt moved the layouts (seed 23 fell furthest). 3000 and 1111
  held best, about two dogs in three.
- **The best four** (23, 333, 1111, 3000): 32 of 56 sign paintings, every
  dog at least one good sign, 11 of 14 at least two. A set's four signs
  would hold about 1.7 that fail on average: seeds take the sign from
  about 40% to about 60%, not to never.
- **Some dogs are hard at every seed**: Coco and Duke 1 of 6, Clementine
  and Luna 2; Emily 6 of 6. Logan: "i was also judging by likeness. coco
  and the doberman tend to do poorly on likeness. coco just looks weird
  and the doberman in the photo has floppy ears but klein really like to
  give it pointed ears or a mix of both." So their misses are likeness,
  not the sign. The breed word carries the breed's look over the photo's:
  "doberman pinscher" paints the cropped, pointed ears most Dobermans are
  pictured with, though this one's hang (a listing-words finding for
  roadmap item 4). The next page ticks cover and likeness apart.
- **The name**: 81 of 84 sit right. The three that do not (Rusty and
  Bailey at 333, Luna at 3000) are boards of another build — a post rising
  above the board, a raised frame — asked of Logan.
- **What next, Claude's read**: in three-quarter view the hind leg and
  belly reach past the sign's edge, so its cover is the seed's luck. A
  dog sitting square behind a sign wider than it, facing the viewer,
  would be covered by geometry; the front-on sit that showed the
  underside (batch 9a) is what such a sign hides. Then idea 5's check,
  for which Logan's ticks on some 250 sign paintings (batches 27–31) are
  now the labels.

### Batches 32a–32b — facing the viewer behind a wider sign (Claude, 2026-11-02; Logan's eye decides)

Logan: "yeah do the front facing test." `storybook_sign_front`: the dog
sitting square behind a blank sign wider than it, facing the viewer, the
sign hiding everything below its chest. The fourteen dogs of batch 31
(32a Plum, 32b the thirteen Commons dogs) at batch 31's best four seeds
(23, 333, 1111, 3000), so each painting has a three-quarter twin; 56
paintings, klein-v1 as production paints, no LoRA, the name carved by
`signname.py`. The page ticks three things apart: covered (nothing
showing, natural legs and feet), still the dog, and the name sitting
right.

- **The run**: 56 of 56, no kill, 21:50–22:10 UTC, the pool 1.8–1.9 GB.
  `signname.py` lettered 55; Shadow at seed 1111 scored 0.09 for a sign
  and was left unlettered (shown so on the page, still ticked for cover
  and likeness). Many boards scored low (0.09–0.19).
- **What the sheet shows** (`var/explore/batch32b/signname/boards.jpg`;
  where the board is, not what it covers): most boards came out far wider
  and taller than in three-quarter view, the dog peeking over it, often
  only its head and paws showing. In several (the white Maltese, the black
  dog, the black-and-white one) klein put the board behind the dog as a
  backdrop, the dog sitting in front of it; there `signname.py` outlines
  the backdrop and the name may land across the dog. A board behind the
  dog would need finding and turning away before it is lettered.
- Not pre-read. Logan's page: `var/explore/index-all/front-32.html` — per
  dog its Commons photo (Plum's never), then four rows, each batch 31's
  three-quarter sign at that seed (dashed, not ticked) beside the
  front-facing one with three ticks: "covered", "still looks like the
  dog", "the name sits right on the sign". Copies out as
  `32 <name> s<seed> covered|likeness|name`. Checked headless: 112 at
  1216×832 (56 new, 56 twins), 168 distinct keys, a tick and its untick
  survive a reload, no horizontal scroll at either width.

### Batches 32a–32b — Logan's read (2026-11-02)

Logan: "no this wont work at all. if the sign is in front its way too big
and for others it behind or sort of merged with the dog." Facing the
viewer is out; the sign's full body stays three-quarter, at about 60% by
seed (batch 31). Claude's read of the ways left, Logan's to choose:

- **The portrait for v1**: 22 of 24 on the crew, 33 of 40 on new dogs,
  and nothing to hide; variety from the setting rather than the pose.
- **The portrait with the name**: head and shoulders above a small blank
  board, the name carved in by `signname.py` — the name kept, the body
  not shown. Untested.
- **The three-quarter sign behind a check**: paint more, keep only those
  a trained check passes, the portrait filling any gap; Logan's ticks on
  some 250 sign paintings (batches 27–31) are its first labels, though
  they mix cover with likeness. Days of work, and it gates a donor's set,
  which ADR-0004 as amended 2026-10-14 does not allow yet.

### Batches 33a–33b — the portrait with the name (Claude, 2026-11-02; Logan's eye decides)

Logan: "yeah run the name board portrait test. i really wanted to get the
full body to work but then i forgot about horses and pigs and all that" —
a full body would need its cover worked out species by species (a
horse's sheath, a pig's), where a portrait needs none. Two wordings:
`storybook_bust_board`, a small blank board along the bottom of the
picture in front of the chest, and `storybook_bust_necksign`, a small
blank board hung on a cord around the neck; the name carved in by
`signname.py`. The crew's three (33a) and batch 31b's thirteen Commons
dogs (33b) at batch 31's four seeds (23, 333, 1111, 3000), klein-v1 as
production paints, no LoRA; 128 paintings.

- **The run**: 128 of 128, no kill, 22:32–23:16 UTC, the pool 1.9–2.0 GB
  (it had crept from 1.6 over the day; the runbook acts above 4 at idle).
  `signname.py` found a board on 102: every one of the 26 it missed is a
  neck sign, which OWLv2 scores under its 0.1 floor with the two board
  queries. So a third query ("a small wooden sign hanging from a dog's
  neck"), and a rerun now looks again wherever no board was found rather
  than reusing the miss; both wait on the donate deploy's hold (below).
- **The lettering, after the hold** (CPU, from 23:47 UTC), three fixes
  to `signname.py`, each found on these batches:
  - "a small wooden sign hanging from a dog's neck" boxed the cord and
    collar, not the board under them; "a blank rectangular wooden tag"
    scores the board itself (0.47–0.79 on six missed). Never name the neck.
  - A board too small to carry a name (under 40 × 14 px inset) crashed the
    type-fitting; it is now no board.
  - The neck query also boxed a dog's head in batch 34 — Beetle's name
    carved on her forehead (seed 333, caught on the page check) — and a
    rerun reused that board. A sign's box must now centre below 45% of the
    picture's height, and every board of 33 and 34 was found afresh.
- **All 192 lettered and marked** (128 of 33, 64 of 34); every lettered
  painting checked on a contact sheet: each name on its board or tag.
- Not pre-read. Logan's pages:
  - `var/explore/index-all/name-portraits-33.html` — per dog (the crew's
    three, then thirteen Commons dogs with their photo) and seed, the
    board portrait beside the neck-sign portrait, each with "acceptable"
    and "the name sits right"; copies out as
    `33 <name> s<seed> board|necksign ok|name`. Checked headless: 128 at
    1216×832, 256 distinct keys, a tick and its untick survive a reload,
    no horizontal scroll at either width.
  - `var/explore/index-all/dense-34.html` — batch 33's board portrait
    (dashed, ticked on its own page) beside the dense prompt's, which
    carries the same two ticks; copies out as
    `34 <name> s<seed> dense ok|name`. Checked the same way: 128 pictures
    (64 new), 128 keys.

### Outside advice, checked against the record (2026-11-02)

Logan asked Claude's read of four tips from another assistant:

- **"Enable the native prompt upsampler (flux-3-image-klein-pup)"**: no
  such node is in the ComfyUI we run (6b747c04); its only FLUX.2 nodes are
  `EmptyFlux2LatentImage` and `Flux2Scheduler`, and its one prompt
  enhancer is for LTX video. Ours are already full sentences, and the
  record says the words lose to the references and the prior (batch 9b:
  anatomy in 86 of 96 whatever the wording; batch 12a: the attention is
  almost all references). A long, dense prompt is a cheap arm to try.
- **"Say where the camera cuts off"**: that is the head-and-shoulders
  portrait, 22 of 24 and 33 of 40 (batches 27–28).
- **"Native bounding boxes in klein"**: none in our ComfyUI; as described
  (the animal in the top 60%, floor below) it is the portrait again.
- **"Mask and repaint the anatomy with klein's edit"**: the hand step of
  October (trace, LaMa, klein Base, ink after), 41 of 80, 20 of 39 and 44
  of 115, a mask per painting, and kept out of the donation path
  (ADR-0004 as amended 2026-10-22); and klein takes 16.5 s a painting
  here, not under a second.

Then Logan's two sources (read 2026-11-02):

- **BFL's `flux2` docs, `docs/flux2_with_prompt_upsampling.md`**: an
  optional step, named for FLUX.2 [dev] only, through OpenRouter or a
  local Mistral-Small-3.2-24B; it "can significantly improve results" on
  reasoning-heavy prompts and "may not provide significant benefits" on
  simple ones. No word of klein, nor of a warning against running without.
- **The FLUX.2-klein-4B demo Space, commit `989c44e` ("Add prompt
  upsampling", 2025-11-25)**: upsampling on by default, through a hosted
  VLM (`baidu/ERNIE-4.5-VL-424B-A47B-Base-PT` on Hugging Face's inference
  API), the input images sent along as base64. Two system prompts: one
  makes a text-only prompt more descriptive while keeping its subject and
  intent, the other turns an image request into one 50–80-word instruction.
- **What it means here, Claude's read**: sending a listing photo to a
  hosted model is out (ADR-0004: the photo never leaves the machine), and a
  hosted text model would be a new service and its own ADR. But our prompt
  is a fixed template around the listing's words, so it can be upsampled
  once, offline, by hand to the text-only prompt's rules, and painted as an
  arm beside the short one — a cheap test. The record says words move
  anatomy little (batches 9b, 12a); what a denser prompt might move is
  composition and detail. A local model that reads the photo (ear set,
  coat) and adds what it sees to the words could fix a breed word's pull
  (the Doberman's ears) — a new model with its own licence line and ADR,
  parked for roadmap item 4.

### Batches 34a–34b — the portrait's prompt upsampled (Claude, 2026-11-02; Logan's eye decides)

Logan: "yes" to the upsampled arm. `storybook_bust_board_dense`: batch
33's board portrait written out once, by hand, to the klein demo's
text-only rules — the framing spelled out (the head and the top of the
chest in the upper two thirds, the picture's edge across the chest,
nothing below), the board described (smooth, honey-coloured, rounded,
nothing on it), the look described (translucent washes, paper texture,
fine brown outlines, cream, peach and sage, a plain pale ground). No
hosted model and no photo sent anywhere. Batch 33's sixteen dogs at its
four seeds, so each has a short-prompt twin; 64 paintings, the name
carved after.

- **The run**: 64 of 64, no kill, 23:21–23:44 UTC, the pool 1.8–2.0 GB.
  Then the card idle for the donate deploy (the moderator's hold, from
  23:44: no card work until released, no CPU work until its `e2e:prod`
  ends); its lettering and both pages wait on that.

### The mark on every keepsake — Logan (2026-11-02)

Logan noticed the tests carry no `monsterpaws.org` mark: "is that normal
or should it be in the pipeline?", then "its 'monsterpaws.org <year>'" and
"the production images of the crew on the homepage have the watermark
correctly applied". The mark is ADR-0022's open question of 2026-10-26:
the crew's portraits carry `monsterpaws.org · 2026` bottom right, the year
it was painted, and whether a donor's keepsake carries it too was left to
settle before the first. **Settled by Logan: "yes to the gift paintings,
they get the watermark"** — every donor's keepsake carries the mark as the
crew's do; for the ADR-0022 amendment (Claude first said it was nowhere in
the record: the search missed the middle dot).

- **`signname.py` marks every lettered painting** as the crew's are,
  measured from `public/brand/crew/*-painting.jpg` (1216×832): Geist
  Regular (the site's face; the copy in next's `@vercel/og`, in
  `var/fonts/geist/` for the prototype, sha256 `bde046dd…71d76`; its
  licence read upstream 2026-11-03, SIL OFL 1.1, recorded in
  `comfyui/mark.py`), 214 px of ink wide, 31
  px from the right, its foot 30 px from the bottom, multiplied to about
  (175, 169, 162) on the paper. The year is the year it is painted
  (`--year` to set it).
- Batches 33 and 34 are the first lettered with it.

### The name in the painting? — Logan's doubt, and the names we hold (2026-11-03)

Logan, before ticking batch 33 or 34: "I don't think the signs will work
either. not all of the name data is clean that we get from rescue groups.
some names are entire sentences … what if we display their name to the left
or right of their portrait or at the bottom? or maybe it should be left off
all together?"

The dev corpus, read 2026-11-03 (`animals.name`, 116,463 animals): median 6
characters, 90th percentile 14, 99th 37, longest 50; 9,694 (8%) are over
15 and 2,048 (2%) over 30. The long ones mix real names with listing notes,
often in one field: "Meowrvelous Mrs. Maisel", "Dark Knight Batman -
Located in WI", "Hopper - (Courtesy Post) - Adopt Me!", "RUBY - HOUSTON TX-
PENDING", "Rupert: Not at shelter (Donna)", "Qupid Ferguson Bonded To
Donner". No rule cuts the note and keeps the name: a dash or a bracket
starts a note in one and belongs to the name in another.

Read against it (Claude's; Logan decides):

- **A painted name is frozen; the record's is not.** A shelter drops
  "PENDING" or "IN FOSTER" when it stops being true, and an adopter often
  renames the animal: the adoption-day evolution would show the old name
  carved in. A caption reads the current record.
- **The card already captions the name** under the painting
  (`src/app/demo/parts.tsx`, the demo's keepsake), so a name in the
  painting says it twice.
- **Beside or below the portrait, inside the image,** ends the board's
  detector misses (three fixes in batch 33) but not the dirty name, which
  is still in the file for good.
- **The board's first job is gone:** it was there to hide a female's belly,
  and the chest-up portrait needs no cover for any species (22 of 24 and
  33 of 40, batches 27–28).

Claude's recommendation: no name in the painting. A plain chest-up portrait
with the crew's mark, and the name as type in the card's caption, read from
the current record. If a downloaded or shared picture should carry the name,
draw it from the record when that picture is made, never paint it.

Then Logan, on sharing (2026-11-03): "from a users profile for instance i
plan on making share links to socials. would a caption go with it? just the
painting? my long term thought was that we would be able to decorate the
painting afterwards with frames, such as 'happy birthday, a donation has
been made in your name' or someting like that."

Read against the record (Claude's; Logan decides):

- **A caption on our page never travels.** A shared link carries one
  picture (`og:image`) and a title and description as text, which some
  platforms show and some barely do; a post to Instagram carries only the
  image file. Whatever must travel has to be in the picture or the title.
- **So there are three layers, and only the first is painted.** The
  painting: plain, the crew's mark, the donor's keepsake for good. The share
  card: composed by our code when it is shared, at the platform's shape
  (1.91:1 for a link, 4:5 or 1:1 for a post, 9:16 for a story), the
  painting plus the name and a line, read from the record at that moment.
  The frame: the share card's template, seasonal (DIRECTION.md's
  extensions), the adoption day's, or a gift's.
- **Frames are the strongest reason to keep the name out of the painting.**
  A frame carries the name in its own type, so a painted name would say it
  twice, and a stale one would contradict it.
- **The dirty name, fixed by the donor, by deleting only.** The share card
  shows the record's name as words to keep or drop ("Hopper", "(Courtesy
  Post)", "Adopt Me!"), with a guess ticked; the donor confirms, and the
  choice is kept on their keepsake. Dropping words cannot put text on a
  card under our domain that the shelter never wrote.
- **A gift's frame is new scope.** Its words must state only what the
  record holds (the donation, to which shelter, in whose name), and the
  recipient's name is the first text a donor types onto a card; who the
  recipient is and how they receive it wants its own ADR.
- **ADR-0030 opens here.** Its trigger "the donor's keepsake ships" is
  met, with the mark settled; it rejected a generated image "until a page
  needs its own words in the image", which a share card does. Logan also
  rejected paper added round the painting for the site's card (ADR-0030,
  the 1200×630 alternative); a frame is paper that carries the name and the
  occasion, so its look goes to his eye on a review page.

### Batches 35a–35b — the plain portrait, short and long (Claude, 2026-11-03; Logan's eye decides)

The name out of the painting (above), so the portrait with nothing added:
the short prompt (`storybook_bust`, batches 24a–28a) against batch 34's
hand-upsampled one with its board sentence taken out
(`storybook_bust_dense`, checked in code to be that prompt less the one
sentence). Logan, on the two prompts: "yeah okay"; on the seeds: "can we
add some more unknown seeds for variaety?"

- klein-v1 as production paints, no LoRA, on batch 33's sixteen: the crew's
  three (35a, 48) and the thirteen Commons dogs (35b, 208). Eight seeds:
  batches 33–34's four (23, 333, 1111, 3000) and four no batch had used
  (47, 610, 2468, 7321). 256 paintings, both prompts painted fresh in one
  run so each pair differs only by the prompt.
- **The mark moves out of the lettering:** `comfyui/mark.py` stamps
  `monsterpaws.org · <year>` on every painting of a batch into
  `explore/<batch>/marked/`, the same function `signname.py` now imports,
  since the mark stays on every gift painting with or without a name.
- **The page is blind:** each pair left and right in a random order, each
  painting linked under a random name in `var/explore/batch35-blind/`
  (the key beside it), ticks "acceptable" and "the better of the two" (one
  per pair, or neither): `var/explore/index-all/portraits-35.html`.
- **Run 2026-11-03, 15:40–17:00 UTC:** all 256 painted, no kill, the pool
  at 1.8 GB throughout; all 256 marked, the marks checked on a sheet of
  corners against batch 33's. The page checked headless: 256 paintings at
  1216×832, 13 photos, 512 ticks with unique keys kept over a reload, one
  "better" per pair, no file name naming a prompt, no sideways scroll;
  the short prompt fell on the left in 64 of the 128 pairs. Claude has not
  read the paintings.

### Batches 35a–35b — Logan's read (2026-11-03)

Logan's ticks on the blind page, saved as
`var/explore/index-all/portraits-35-picks-2026-11-03.txt` (decoded through
`var/explore/batch35-blind/key.json`; the acceptable runs as each batch's
`picks.txt`). Max and Duke carry no tick of either kind, and that is the
read: "basically the german shepards colors were wrong and the dobermans
ears were wrong". The counts below are over the other thirteen (Plum to
Luna); Bailey is with Max and Duke.

- **The short prompt wins, blind:** acceptable 95 of 104 against the long
  one's 44; the better of the two in 91 pairs, the long in 7, neither in 6.
  The crew alone: 21 of 24 against 10. Biscuit is the one dog the long
  prompt suits (7 of 8 against 6, better 3 times). **The hand-upsampled
  prompt is out.**
- **The short portrait passes at nearly any seed:** 333 and 1111 13 of 13;
  23, 3000, 47, 2468 and 7321 12 of 13; 610 9 of 13. Three of the four
  seeds no batch had used pass as well as the four searched for, so for
  the portrait the seed is not where it fails.
- **It fails by the dog:** Bailey (tricolour beagle) 1 of 8 short, 3 of 8
  long, no better one in five pairs; Max (German shepherd) and Duke
  (Doberman) none of 16, the shepherd's colours wrong and the Doberman's
  ears (Logan). Duke was also 1 of 6 in batch 31b, and the ears are
  Logan's standing complaint (batch 31). The words were not wrong: Claude
  read the two Commons photos, and "black and tan" is the coat of both;
  but the shepherd is mostly red-tan under a black saddle and mask, its
  head down licking snow (a foreshortened head crop), and the Doberman's
  ears are natural and hang, where the breed is mostly pictured cropped
  and pricked. klein paints the breed from its own idea of it rather than
  from the references, and no seed fixes that (roadmap item 4's local
  photo-reading idea: words from the photo, "floppy ears", in place of
  the breed's).
- **A line under the animal:** "many of the painting included a line at
  the bottom of the animal which didn't disrupt its look but seemed
  unnecessary" (Logan): an ink stroke where the chest stops, as if the
  bust stood on a ground line. Not counted per painting.
- **The likeness score does not see it** (`npm run explore:score`, the
  picks as full run ids in each batch's `picks.txt`): the two prompts
  score alike (mean 0.581 short, 0.584 long) where Logan took the short
  95 to 44; within one dog and prompt an acceptable painting outscores an
  unacceptable one in 151 of 253 pairs (60%); and Max (0.50) and Duke
  (0.58) sit among the rest, Bailey (0.65) near the top. A wrong coat or
  wrong ears is not what CLIP's cosine to the photo measures, so the
  silent judge (ADR-0004 as amended 2026-10-14) would not have flagged
  them.
- A better one ticked on a pair with neither acceptable once (Plum s610,
  short).

### Batches 36a–36c — the line under the chest, and words for two breeds (Claude, 2026-11-03; Logan's eye decides)

Logan: "both", to the two tests proposed after batch 35's read.

- **The line (36a–36b, 112):** the short portrait with one phrase for its
  lower edge, "the chest fading softly into the bare paper"
  (`storybook_bust_soft`), on the crew and the eleven Commons dogs other
  than Max and Duke, at batch 35's eight seeds. The soft edge is named and
  the line is not, since klein tends to draw what a prompt names. Batch
  35's short paintings are the before.
- **The words (36c, 32):** Max and Duke with what their photos show,
  written by Claude from the two Commons photos, once after the breed's
  name and once without it (the name may be what calls up klein's idea of
  the breed), with the short prompt at the eight seeds. Max: "red-tan
  german shepherd with black fur across its back and a black muzzle" /
  "large red-tan dog with black fur across its back, a black muzzle and
  tall pointed ears" (first written with "a black saddle on its back",
  changed before 36c ran: klein paints "saddle" as tack, batch 11b);
  Duke: "black and tan doberman pinscher with natural soft floppy ears
  that hang down" / "sleek black dog with tan markings on its muzzle,
  eyebrows and chest, and soft floppy ears that hang down".
  Batch 35's listing-word paintings are the before. If words fix them,
  roadmap item 4's local photo-reading idea is worth building; this
  tests the words, not a reader.
- **One blind page, two parts:** `var/explore/index-all/portraits-36.html`,
  the key in `var/explore/batch36-blind/`. Part 1, pairs: "acceptable", "a
  line under the chest", "the better of the two". Part 2, threes:
  "acceptable", "the best of the three".
- **A tick for klein's signature on every painting**, at Logan's ask:
  "a box to check if i see a fake signature. something there are
  scribbles that are basically a fake signature that klein is painting"
  (ADR-0004 as amended 2026-10-15 left `comfyui/signature.py`'s removal to
  roadmap item 4; the ticks give its rate on the portrait, and a measure
  for the detector). "Acceptable" is judged on the animal alone, the line
  and the signature on their own ticks (Logan asked; as he read batch 35).
- **Run 2026-11-03, 20:42–21:33 UTC:** 144 of 144 painted, no kill, the
  pool 1.8–2.0 GB; all marked, the marks checked on a sheet of corners.
  The page checked headless: 272 paintings at 1216×832 (112 pairs, 16
  threes), 13 photos, 768 ticks with unique keys kept over a reload, one
  better per pair or three, no file name naming a prompt, no sideways
  scroll. Claude has not read the paintings.

### Batch 37a — the cats as portraits, and the crew's pick for the site (Claude, 2026-11-03; Logan picks)

Logan, to the moderator, 2026-11-03: "we are going to do portraits because
we can't guarantee a clean body. so the crew photos need updated." The
site's crew section (`src/ui/crew.ts`, `PAINTING` 1216×832) shows five,
and Marty and Stacey had never been painted as portraits.

- **37a, 32:** Marty and Stacey, klein-v1 as production paints, the short
  portrait and its soft lower edge (batch 36a's, Logan's read pending) at
  batch 35's eight seeds. Marty's words are batch 11b's closest ("male
  flame point Siamese cat, cream with orange ears, face and tail, and blue
  eyes": his photos alone lose the points), Stacey's her listing words
  ("female brown tabby cat").
- **The pick:** `var/explore/index-all/crew-portraits-37.html`, one tick
  per animal among its sixteen (the dogs from 35a and 36a, the cats from
  37a), in a random order under neutral names (`var/explore/crew-37-pick/`,
  the key beside them). Each picked file goes to the moderator as its path
  under `var/explore/<batch>/marked/`, the mark in its pixels; the UI chat
  writes `public/brand/crew/`, never this stream.
- **Run 2026-11-03, 21:34–21:50 UTC:** 32 of 32, no kill, the pool 1.9 GB;
  all marked. The page holds 80, sixteen each: batch 35a's long prompt is
  left out, having lost blind (the first build took all 104, caught by its
  count). Checked headless: one tick per animal, kept over a reload, no
  file name naming a prompt or batch, no sideways scroll.
- **Rebuilt after batch 36's read** with the short portrait only, eight
  each, 40 (the soft edge lost too), so the site shows what a donor gets;
  a new tick store, so no earlier tick lands on another painting.
- **Plum's eight replaced by batch 38a's sixteen** (both collar endings),
  his old slots dropped from the key so no tick moves to a new painting;
  48 on the page, checked headless again.

### Four portraits a donation, and the amendment — Logan's word (2026-11-03)

Asked three things together: the ADR-0004 amendment as drafted (every
keepsake a chest-up portrait, the LoRA dropped, the tripod's standing rule
withdrawn, never male anatomy on a female); CLAUDE.md's pipeline line from
"a tripod painted standing" to "every keepsake a head-and-shoulders
portrait"; and, with his two sayings side by side ("i'm thinking 4 and 4
so 8 total per donation", 2026-11-02, while bodies were in; "4 paintings
come in a cycle automatically", 2026-11-03, to the moderator), whether a
donation gets four portraits. Logan: "yeah that all sounds right to me".

- ADR-0004 as amended 2026-11-03, decisions 1–5, with four portraits a
  donation as decision 5; CLAUDE.md's line and `doc/flows.md`'s painter
  box follow it. Uncommitted until Logan's word to commit.
- Still open: whether the name is painted, and which four seeds the worker
  uses (any of batch 35's but 610 passed 12 or 13 of 13).

### Batches 36a–36c — Logan's read (2026-11-03)

Logan's ticks on the blind page, saved as
`var/explore/index-all/portraits-36-picks-2026-11-03.txt` and decoded
through `var/explore/batch36-blind/key.json`. With them: "so the plum
paintings are a bit incomplete and could be said for other dogs with
collars. they tend to blend in with the body rather than show clearly all
around the neck."

- **The soft lower edge is out:** over the thirteen ticked in batch 35
  (Plum to Luna) the short portrait is acceptable 82 of 104 and the soft
  76, and the better in 68 pairs against 23 (neither 13). Only Rusty,
  Daisy and Coco took the soft more often.
- **No line was ticked**, on either prompt, in 224 paintings, the 112 of
  batch 35's short among them, where Logan had seen "many". Asked, Logan:
  "there were no lines". The line is not a finding against the short
  portrait.
- **Collars:** Plum fell from 6 of 8 (batch 35) to 0 of 8 on the same
  short paintings, for a collar painted half into the fur rather than
  round the neck; Logan says the same of other collared dogs. Batch 35's
  short paintings ticked again: 96 of 112 the same, 16 changed, 15 of
  them to not acceptable, six of those Plum's.
- **Words from the photo fix the breed:** Max, acceptable with his
  listing words 0 of 8 (batches 35 and 36), with the breed and what the
  photo shows 7 of 8, without the breed 6 of 8; Duke 0, 8 and 8. The best
  of the three: the breed with the traits 6 times for each, the traits
  alone 2, the listing words never. So the breed's name is kept and what
  the photo shows is added. Claude wrote these words from the photos by
  eye; a local model reading the photo (roadmap item 4) would have to
  write as well, and is now worth building.
- **Signatures:** 5 of 272 ticked (Plum s23, Shadow s3000, Sunny s23 on
  the soft prompt; Max s610 twice), about 2%.

### Batches 38a–38b — the collar (Claude, 2026-11-03; Logan's eye decides)

Logan, asked whether a keepsake shows the collar at all: "yeah one of the
two i guess we can run a test. half of plum with one description and half
with the other. this effects other dogs as well not just plum."

- **Two endings to the listing words**, the short portrait at batch 35's
  eight seeds: the neck described bare, the collar never named (`bare`:
  "with a bare neck and nothing around it"), or the collar asked for
  whole (`worn`: "wearing its collar, the whole collar painted clearly all
  the way around its neck"); a harness is worded as a harness, the chest
  with the neck.
- **38a, 16:** Plum alone, first, since the site's crew section has no
  Plum yet (his collar per Logan; Claude never views the crew's photos).
- **38b, 80:** the five of the thirteen Commons dogs whose photos show
  something at the neck, read by Claude from the Commons photos: Rusty,
  Otto and Biscuit a collar, Coco and Bailey a harness. Bailey's red
  harness may be why he fails at nearly every seed (1 of 8 in 35, 0 in
  36). Ducky and Beetle are left out until Logan says whether they wear
  one.
- Batch 35's short paintings are the before. If `bare` passes, it is the
  only ending production can use without a reader that knows whether a
  dog wears a collar; `worn` needs that reader (roadmap item 4).
- **Collarless — Logan, shown 38a's Plum:** "no i want to collarless,
  give me a new batch for plum please". So **38c, 16:** Plum at eight
  seeds no batch had used (88, 1357, 4242, 5150, 6060, 8642, 9119,
  31337), with `bare` and `nocollar` (the collar named and refused: "with
  no collar, his bare neck showing only fur"). 38b was stopped at 22:42
  UTC before it painted anything (by PID; the guard down, the run
  container removed) and rewritten collarless before it ran again:
  `bare` and `nocollar`, a harness dog's "with no harness or collar,
  its bare neck and chest showing only fur". The crew page's Plum is
  his collarless 24 (38a's `bare` and 38c), under new slot names.
- **Plum's forty (2026-11-04, Logan: "is our crew ready to pick? which
  file?"):** his collarless short portraits (38a `bare`, 38c) and the
  shoulder test's two framings (38d), under new slot names; 72 on the
  page, checked headless.
- **Run 2026-11-03:** 38a 22:33–22:39, 38c 22:45–22:50, 38b 22:53–23:21
  UTC, 112 of 112, no kill, the pool 1.8–1.9 GB; all marked. The collar
  page, blind: `var/explore/index-all/portraits-38.html`, the five dogs'
  threes (batch 35's listing words, `bare`, `nocollar`), ticks
  "acceptable", "a collar or harness painted", "a painted signature"
  and "the best of the three"; Plum is judged on the crew page. Checked
  headless: 120 at 1216×832, 5 photos, 480 ticks kept over a reload, no
  file name naming a wording, no sideways scroll.

### Batch 38d — the shoulders (Claude, 2026-11-03; Logan's eye decides)

Logan, while picking the crew: "one issue we have sometimes is that the
shoulders often look too wide. its very evident on plum. He almost looks
like a puppy head on a human body."

- **The words ask for it:** "a head-and-shoulders portrait" is how a
  person's bust is described, so it may carry a human bust's broad
  shoulders onto a dog, worst on a puppy's narrow chest.
- **38d, 16:** two framings without the phrase, Plum collarless (`bare`)
  at 38c's eight seeds, whose `bare` paintings are the before: "a close
  portrait of its head and neck" (`storybook_head`: no shoulders named,
  less body to paint) and "in three-quarter view, a portrait from the
  chest up" (`storybook_bust34`: a dog turned a little shows a narrow
  chest). Queued behind 38b. If one fixes Plum, it is tried on every dog
  before the production prompt changes, since a prompt change moves the
  layouts the seeds give.
- **Every dog, at once:** Logan, "so same goes for all dogs btw.
  sometimes the shoulders are just too wide." So **38e (16) and 38f
  (104):** the same two framings on the other fifteen dogs at batch 35's
  four strongest seeds (23, 333, 1111, 3000), each with its best words so
  far (`best`: the listing's, or for Max and Duke 36c's breed with the
  photo's traits); batch 35's short paintings (36c's for Max and Duke)
  are the before. One page for the shoulders, Plum's 38d included, with a
  tick "shoulders too wide" on every painting beside "acceptable", "a
  painted signature" and "the best of the three".
- **Run 2026-11-03/04:** 38d 23:21–23:30, 38e 23:31–23:41, 38f 23:42–00:22
  UTC. 38f's last chunk was killed by the guard at about 00:20 on the
  host-free floor, not the pool: Windows free 10.1 GB against the 10 GB
  floor, the shared pool 1.9 GB. Duke's eight runs (096–103) failed on
  the refused connection, 96 of 104 painted. Windows free at idle had
  fallen from 29.9 GB (15:37) to 15.4 GB with no ComfyUI up, held by
  something the cache drop cannot return; the eight wait for the card
  hold's release.
- **The page, blind:** `var/explore/index-all/shoulders-38.html`, threes of
  the portrait Logan read (Plum's 38c `bare`; batch 35's short; 36c's for
  Max and Duke), `storybook_head` and `storybook_bust34`; ticks
  "acceptable", "shoulders too wide", "a painted signature", "the best
  of the three". Checked headless: 196 at 1216×832 (Duke's eight shown as
  not painted), 13 photos, 784 ticks kept over a reload, no file name
  naming a framing, no sideways scroll.
- **Duke's eight repainted** 00:32–00:35 UTC after the hold's release (23.0
  GB free after the drop, 13.8 at the load's low), 104 of 104; the page
  rebuilt on the same key, 204 paintings, none missing.
- **What a load needs:** after the guard's cache drop each start had 22–30
  GB of Windows free, and a chunk's klein load took 6–11 GB of it (37a
  28.4 → 17.2); the killed chunk started at 20.6. So the handler skips a
  job under 22 GB after the drop (`LOAD_FREE_GB`, `src/worker/art.ts`)
  rather than start a set the guard would kill.

### A local photo reader — the candidates (Claude, 2026-11-03; Logan decides)

Logan: "what model with vision can we run on the card as part of the
process?" After batch 36c, words read from the photo are what fixed Max
and Duke; the reader would write them, on the machine, so the photo never
leaves (ADR-0004 as amended 2026-08-02).

- **Qwen3-VL-2B-Instruct and -4B-Instruct** (Apache-2.0, model cards read
  2026-11-03). `monster-paws-comfyui:dev` already carries transformers
  5.20.2 with `qwen3_vl` and torch 2.14.1+xpu, so no new dependency: a
  `models.manifest` line each (licence and hash) and a script. About 4.5
  GB (2B) and 9 GB (4B) in bf16. The 2B may be quick enough on the CPU,
  as the detector runs (ADR-0026), which keeps it off the Arc's traps;
  the 4B on the card runs as its own process under the guard, before
  ComfyUI paints, never beside it.
- **Moondream2** (Apache-2.0, about 2B, captions and questions; its
  successor Moondream 3 is a preview) as the cheap end.
- **Out:** Qwen2.5-VL-3B (research licence, above); anything hosted
  (BFL's and the klein demo's upsamplers, batch 34).
- **The test, proposed:** each reader asked one structured question per
  photo (coat colours and where they fall, markings, ear shape and
  carriage, eye colour, anything worn), its words checked against those
  Claude wrote by eye for Max and Duke and against Logan's read; then the
  winner's words painted blind against the listing's on every dog. A
  reader in the donation path is a new stage and a new model: an ADR-0004
  amendment and the art flow in `doc/flows.md`, the listing-words plan's
  reviewed table beside it or in its place.
- **When:** Logan, "after i've chosen the crew paintings and probably a
  deploy i will have us do tests wiht the models you suggested".

### The painting job for the Meta demo — holes found (Claude, 2026-11-03; not a go)

Logan, to the moderator: "for the meta demo we have to have the pipeline
working locally on my card", due 2026-11-04 15:00 CT (21:00 UTC). The
moderator's proposal: the dev database, a staging test card, a crew pet,
a real email; this stream's part the `art.generate` handler. Checked
against the code, before any build:

- **Storage:** infra.md lists the R2 media write pair as "not created
  yet", and public access is off on every bucket, so the email cannot
  link to R2. Either the key is made, or the four are kept on the box and
  attached.
- **The animal:** the crew live in `src/ui/crew.ts`, not `animals`; the
  crew's consent record covers the home section only (ADR-0030), so a
  keepsake from a crew photo needs Logan's line in
  `doc/consent/0001-the-crew.md`.
- **Crops and words:** the worker has no photo-to-crops path (the
  detector is Python on the CPU, ADR-0026); the crew's crops exist from
  batch 11, and their words are hand words, the listing-words table
  unbuilt.
- **The card:** one driver at a time, and nothing paints in the nightly
  quiet window (06:45 UTC until the night's log says `== exit`).
- **The decision:** `art.generate` in the dev distro departs from ADR-0004
  as amended 2026-10-05 (the dedicated Windows account), a dated note
  under ADR-0028; ADR-0022's mark amendment and Geist's licence record
  are still to write; klein's signature (about 2%) has no removal step.
- **The smallest build:** a TypeScript handler running
  `comfyui/run_workflow.py` four times (it fills the committed klein-v1
  workflow by node id), then `mark.py`, then storing and four `art`
  facts: about 3–4 hours after this stream's commit lands on topdog.
  Freeze the prompt, framing and seeds by 15:00 UTC on 11-04 at the
  latest.
- **Storage reversed (the moderator, from Logan: "no lets build the share
  page that opens form the email"):** after the mark, four JPEGs
  re-encoded from pixels with no metadata and `share/<token>/manifest.json`
  (the pet's name and kind, nothing of the donor) go to `monsterpaws-media`,
  a production write under an oplog entry; the local files stay for the
  email. Holes sent back: public access is off on every bucket (a public
  hostname for media, or an app route with a media read key, is a step of
  its own); the share token must be its own random value, never the
  /thanks or claim token, and the keepsake has no token column yet;
  ADR-0022 as amended 2026-11-02 rests on "there are no public
  paintings", which a share page ends; the media write pair is not
  made. `aws4fetch` (already used by `src/core/ingest/vault.ts`) signs
  the upload, so no new dependency; each upload proved by reading it back
  and comparing hashes.
- **The moderator's answers (2026-11-03):** served through an app route,
  media staying private (ADR-0035 Q2); the share token in donate's
  migration 0017; the takedown in ADR-0036 (the UI chat), crew only for
  the demo; the key and this stream's publishing under oplog 0026, which
  this stream owns; publishing runs the UI chat's `npm run share --
  publish`, never a write of the handler's own. The order: this stream's
  commit on Logan's word, landed on topdog, then realigned onto topdog
  (`git rebase --onto topdog HEAD` on his "realign"; there is no `demo`
  branch, Logan: "we can just put it on topdog"), the handler built
  there with an art-only worker mode (`npm run worker` registers
  `ingest.poll` whenever the RescueGroups key is set).
- **Crew photos at 1050×1400 are not enough for every head:** measured
  from `boxes-detected.json`'s fractions (no photo viewed), four of the
  ten grown heads fall to 130–300 px where klein reads about 768 (Marty's
  PXL 133×122, Stacey's IMG_3110 171×187, Beetle's IMG_2931 236×296), so
  the demo paints from the originals in `var/crew/`, whose crops batch 11
  cut at full size.
- **Live detection instead of the crop table:** about 6 s a photo warm on
  the CPU (ADR-0026), the cold load unmeasured (30–60 s guessed); the
  detect → grow → cut chain is joined by hand today, so live use is a
  glue script of 1.5–2 h. Not built until Logan answers the moderator on
  Meta's models (SAM 2.1 is Meta's, Apache-2.0, run locally).
- **The share page's contract (the UI chat's, fixed):** `share/<token>/`
  holds `1.jpg`–`4.jpg` at 1216×832, pixels only, and `manifest.json`
  exactly `{"name":…,"kind":…}`, written last, since its presence makes
  the page exist; the token is the keepsake's `share_token` (donate's
  migration 0017), never one the handler mints.
- **Live detection is in** (Logan: "we will use saml 3.1 but first lets
  just develop on sam 2.1 we will swap it near the end"): the handler
  first, then the detect → grow → cut glue on OWLv2 and SAM 2.1, the
  pipeline chosen by `DETECT_PIPELINES`; the `sam3` client and every Meta
  API call on `meta` (ADR-0028 §1). Found: no `meta/` entry in `pass`, so
  no Model API key yet. The client is about 3–4 h (one Responses call
  per photo and phrase, the `<0f>` grammar, the API's masks, the raw
  responses cached; floors by eye on the crew, the blind-set measurement
  not run), Python in `detect.py` only and needing no card, so it could
  be built in parallel; its latest start about 13:00 UTC. A photo sent to
  Meta: pixels only (the crew's phone photos carry GPS), refused in code
  unless it is in the crew table, named in the crew's consent record
  (ADR-0004 as amended 2026-08-02 §2), and Meta's terms on retention
  read before the first call.
- **Oplog 0026's check after the first real publish** (the UI chat):
  `curl` `/share/<token>` and its `painting.jpg` on the live site with a
  bot user agent, since the e2e image run does not cover those routes.
  Run 2026-11-04 04:23 UTC once oplog 0025 had the route live: page and
  `og:image` 200 to two bots, each `/share/<token>/<n>/painting.jpg` byte for
  byte the published JPEG; 0026 frozen as run.
- **Donate's contract** is on topdog as `fa00bd9`
  (`doc/plans/demo-chain-contract.md`; `FACT`, `artKey`, `artFilePath`,
  `ART_QUEUE_OPTIONS` in `src/core/keepsake.ts`); the art-only worker mode
  is this stream's. Logan put the Meta key in `pass` as `meta/api-key`.
- **The seam for the `sam3` client** (a separate chat on `meta`): stage 1
  of `comfyui/detect.py`, `sam3(photos) -> {photo: {"species": [{box,
  species, colour_prompt, other}], "heads": [{box, score}]}}`, boxes in the
  image's pixels, the colour and other-species scores matched at IoU 0.5
  as `grounding_dino` does; registered in `main()` with its own
  `FLOOR["sam3"]`, `pools()` unchanged; SAM 2.1 outlines its boxes
  tonight. `DETECT_PIPELINES=sam3` is the whole swap, and the key comes
  from `MODEL_API_KEY` filled by `pass` at run time.

### The art.generate handler, built for the demo (Claude, 2026-11-04)

On Logan's "commit and realign" (this stream's work landed on topdog as
`5b678a3`) and the moderator's go, on donate's contract (`fa00bd9`):

- **`src/worker/art.ts`:** `generateArt` reads only the keepsake's facts,
  exits at once on any art fact, skips the nightly poll's window (06:45
  UTC until the night's log says `== exit`, capped at 10:00) and a busy
  card, paints four, stores each as a pixels-only JPEG at
  `artFilePath(artKey(id, n))`, and writes the four art facts in one
  transaction on the photo fact's basis, or none. A held listing photo is
  refused until its path is built. `guardPainter` writes the run's spec to
  `var/explore/keepsake-<id>/spec.json` (`explore.py` reads it there when
  no committed spec has the name), paints through `comfyui/guard.sh batch`,
  and marks with `comfyui/mark.py`.
- **`comfyui/keepsake-crew.json`:** each pet's originals and the words of
  the batch Logan read (Plum 38c's collarless `bare`, Ducky and Beetle
  35a's, Marty and Stacey 37a's), its detector words, and the prompt and
  four seeds still to freeze (now batch 35's short portrait at 23, 333,
  1111, 3000).
- **Live detection (`ART_DETECT=live`):** `comfyui/live_crops.py` runs
  `detect.py`, `crops.py` and `explore.cut` (prep's per-photo cut, moved
  out unchanged) for one keepsake, under the run's own name, so batch 11's
  crops are never what a live run paints from; `DETECT_PIPELINES` picks the
  detector.
- **`WORKER_MODE=art`** registers `art.generate` alone (the crew sweep
  still with `ART_SWEEP=on`); the droplet's compose never sets it, a test
  holds that. ADR-0028 as amended 2026-11-04 records the dev distro;
  `doc/flows.md`'s art flow marks each stage built or planned.
- **Tests:** `tests/art.test.ts`, twelve, the painter faked; the first real
  run waits on the card's release after oplog 0023.
- **The first real run, 2026-11-04 00:45–00:52 UTC** (the moderator's go, the
  box quieted): a rehearsal gift to Beetle (`npm run demo -- gift beetle
  hello@monsterpaws.org`) in `monsterpaws_demo`; the worker (`WORKER_MODE=art
  ART_SWEEP=on`, `ART_STORE_DIR=/home/oof/monsterpaws/var/keepsakes`) swept it
  into keepsake 1 at its first tick and painted it: 48.1 s cold, then 16.5 s
  three times, 22.3 GB free after the drop, 16.7 GB at the low, no kill;
  four marked JPEGs at 1216×832 with no EXIF or ICC, and four art facts on
  the crew basis, about 4 min 48 s from job to files (a minute of it the
  guard's second start, which only confirms "0 to go"). Found: the art
  facts took the job's start as `snapshotted_at`; they now take the write's
  time, keepsake 1's rows left as written. Claude has not looked at the four.
- **Live detection proven on the CPU, 2026-11-04 01:00 UTC:**
  `comfyui/live_crops.py` on Beetle's two originals (run `live-beetle-test`,
  OWLv2 and SAM 2.1) in 32 s with the container's start and the models'
  load, both photos cut with a head; every box (subject, grown subject,
  head, grown head) at IoU 1.0 with batch 11's in `boxes-detected.json`.
  So a live run paints from the same crops as the table. `detect.py` reads
  a `held:` photo beside its run, for a listing's photo fetched at paint
  time.
- **The ship bar, 2026-11-04 01:54 UTC at load 1.6:** typecheck clean,
  vitest 610 of 610 twice, `tests/ingest-pg-lifecycle.test.ts` included:
  its two failures at 5b678a3's commit were the box's load.
- **The guard's last start trimmed:** `comfyui/guard.sh batch` now ends after a
  chunk that painted every run left with none failed, instead of starting a
  fresh ComfyUI only to read "0 to go" (about a minute and a model load on
  every keepsake and every batch's end); a failure still goes round again,
  and the no-progress stop is unchanged. **Its first form was wrong** (the
  verifier, 2026-11-04, by `explore.run_batch` dry and `guard.sh` with
  docker, npm and the Windows calls stubbed): it read "N to go" as what was
  left, but `explore.py` prints it after `--limit`, so it is the chunk,
  and a batch bigger than its chunk stopped after one chunk with exit 0
  (12 at chunk 4 painted 4; 104 at chunk 8 painted 8). The keepsake run is
  4 at chunk 4 and was unaffected, and no batch ran under it (the guard
  changed at 01:02 UTC, the last run ended 00:51). Fixed: what is left is
  "N runs in spec" less "D done"; simulated on the verifier's cases,
  every batch paints in full with one start fewer.
- **Never to Meta: `Plum/downloadfile.jpg`** (Logan's ruling, through the
  `sam3` chat; every other crew photo asked about approved). It is one of
  Plum's two in `comfyui/keepsake-crew.json`, so with `DETECT_PIPELINES=sam3`
  a Plum keepsake is refused before any call by `detect.py`'s
  `SAM3_APPROVED` and the job fails visibly; it is never worked around.
  Plum paints on the local detector or with a different second photo.
  The glue's refs are `crew:<Name>/<file>` with the pet's capitalised
  folder, the only form the allow-list takes.
  Later (2026-11-04, the `sam3` chat): on Logan's word, cleaned copies of
  Plum's five photos and one of Stacey's are what `meta`'s `sam3` client
  sends (`var/explore/crew-clean/`), mapped from the same `crew:` refs, so
  a crew run under `sam3` covers all five pets with the crew table's new
  pair for Plum; the crops still come from the originals on the box, and
  `downloadfile.jpg` stays off for good.
- **Owed after the realign onto donate's widened contract (`f29142f`):** a
  listing's photos arrive in the job (`{ keepsakeId, photos }`, never a
  fact, ADR-0022 as amended 2026-10-27), fetched at paint time and deleted
  when the set is done, always through live detection, one or two photos;
  the new `shelter` fact; a production worker only calls `work`, its pools
  capped. And publishing, crew and real gifts alike, through the UI chat's
  `npm run share -- publish` (Logan: "yes real paintings on the share page
  is what we want"; "yes we can run the worker on this dev setup").
- **Built after the realign (2026-11-04, on `ce4d076`):** the job is
  `{ keepsakeId, photos? }`. A listing's photos, two at most, are fetched
  beside the run, cut by live detection with no colour (`detect.py`'s colour
  vote now abstains for a colour it has no set for, the colour ask falls back
  to the species), painted from the photos an animal was found in, a head
  first, and deleted with the detector's overlays and the crops when the try
  ends, painted or not. Its words are its sex and kind as published
  (`listingWords`: "female pit bull terrier mix"), the art facts on its
  grant's basis. `live_crops.py` writes `cut.json` and leaves out, by name,
  a photo with no animal chosen (sam3 can return none); with no head
  anywhere it stops. A crew pet's live run that loses either photo stops.
  With `SHARE_PUBLISH=on`, `sharePublisher` runs the share tool's own
  publish after the facts; a failure keeps the art, is reported by its code
  (a token in a message is the page), and is never retried, so it is a hand
  rerun of `npm run share -- publish`. Checked on the CPU: a Commons photo
  as a held one, no colour, cut with its head in 13 s. Tests: twenty.
- **Logan's OK on keepsake 1, and no freeze (2026-11-04):** "ok for beetle,
  we don't need a freeze time we will work till its right". Beetle's four
  from the first real run are approved for oplog 0026's first publish; the
  prompt, framing and seeds stay open until he is happy with them.
- **The verifier's review of `ac90f6f` and `8cc3c7e`, fixed (2026-11-04):**
  a run folder named for the keepsake's token (`runName`), since ids start
  at 1 in every database and the demo's keepsake 1 would have shared
  production's; the art store bound to one database by a `.database`
  marker (`bindArtStore`, at boot and before a paint); a run's paintings
  only this spec's (`paintedFor`: animal, prompt and words, not a seed
  alone); a crew pet only on the crew's basis, its pet looked up by own
  key, the latest photo fact; the files and facts written under a
  per-keepsake advisory lock (three at once write one set); art mode's
  pg-boss with no migrations, upkeep or cron and its pools capped at 2,
  except the dev box's one-process chain (`ART_SWEEP=on`); failures
  logged with their message; `explore.py`'s "done" this spec's runs only,
  so the guard's arithmetic holds after a spec changes; ADR-0028's note
  reconciled with real gifts. Deferred, in `doc/issues.md`: a failed
  publish is never retried. Tests: twenty-five.
- **The detector, set by the handler (2026-11-04, the `sam3` chat's trap):**
  with `DETECT_PIPELINES=sam3` in a worker's environment a listing's run would
  stop on `SAM3_APPROVED` and fail a real gift. On topdog the handler passes
  `DETECT_PIPELINES=owlv2` to the container for every run, never the worker's
  own; the crew's `sam3` choice lives on `meta` (ADR-0028 §1), as a patch for
  the `sam3` chat (`scratch/art-detector-meta.patch`), first committed here as
  `9067220` and taken back out at the moderator's word.
- **The verifier's second review (2026-11-04):** listing words take "Male" and
  "Female" in any case and the species when the kind doesn't name it, as a
  whole word ("female tuxedo cat", "male domestic short hair cat"): a
  prompt change for listings, so the listing rehearsal is its harness run.
  The photo fetch takes only `ART_PHOTO_HOSTS` (default
  `cdn.rescuegroups.org`), https, no redirect, a 25 MB cap, and names a
  photo by its number, never its URL. `forget` resolves `COMFYUI_DATA` as
  compose does; `crops.py` no longer dies on no heads. A failing `forget`
  fails the job on purpose. The production art worker is a host process
  (it drives docker and the guard), agreed with donate: its own store
  (`var/keepsakes-production`, bound by its marker), `SHARE_PUBLISH=on`,
  `ART_SWEEP` and `ART_CREW_DETECTOR` unset, started after 0028 makes the
  queue, restarted by this stream after 0029's grant. Its database name
  wants a hosts line (WSL rewrites `/etc/hosts` unless `generateHosts =
  false`) or a `DB_SSL_SERVERNAME`, donate's choice. Tests: thirty-one.
- **A real gift on the day: what Logan sees (2026-11-04).** A gift paints in
  about four to five minutes when the card is free and Windows has 22 GB
  after the guard's cache drop. Otherwise the job is skipped, never failed:
  in the nightly window (06:45 UTC to the poll's `== exit`), while a guard
  batch or ComfyUI runs, or under 22 GB (Logan's own apps count: at 03:17
  UTC Firefox held 7.8 GB and Windows had 21.7 GB free of 63.7). The sweep
  sends it again in the next hour's slot, so each skip can cost up to an
  hour. What shows it: donate's Sentry error "paid paintings waiting past
  30 minutes", once an hour; and the art worker's own Sentry warning "art
  skipped: <reason>", at most hourly, the nightly window left out. Its
  log has every outcome. What to do: close a heavy app, or wait; the next
  slot paints. The worker also reports pg-boss errors at most once per ten
  minutes with the count held back, so a dropped tunnel can't flood the
  error service. The demo's store bound to `monsterpaws_demo` 03:27 UTC.
  The listing rehearsal skipped twice at 21.5 GB (03:16 UTC) and waits for
  the moderator after oplog 0025.
- **The listing rehearsal, 2026-11-04 03:30–03:40 UTC** (Logan's apps closed,
  28.5 GB free), through the real `generateArt` and `guardPainter` on
  `monsterpaws_lora_test`, its own store, two Wikimedia Commons originals as
  a listing's photos (`ART_PHOTO_HOSTS=upload.wikimedia.org` for this run
  only), the three-quarter view, no publish. **Two photos, a dog** ("male
  mixed breed dog", one photo twice): painted in 223 s, four JPEGs and four
  art facts on the listing's grant, its photos, overlays and crops deleted.
  **One photo, a cat** ("female domestic long hair cat"): stopped in 23 s,
  OWLv2 choosing the cat (margin 0.25) as the whole frame and no head inside
  it, so `live_crops.py` found nothing to paint from; its photo and crops
  deleted too. A shelter's close-up would fail a real gift the same way. So
  a photo with an animal and no head now paints with its subject standing
  in for the head (`live_crops.py`), and a stopped detection carries
  `live_crops`' own last line into the error (`lastRunLine`). The cat runs
  again, with the likeness harness against its Commons photo and Logan's
  eye, before the fallback is recorded in ADR-0004.
- **The cat again, 03:45–03:48 UTC** (Logan: "okay lets rerun whenever we are
  ready"; 26 GB free): painted in 182 s, its subject standing in for its
  head. **Likeness** against the Commons originals (`likeness.py`'s encoder,
  the job's crops being deleted): the cat 0.646, 0.637, 0.637, 0.639, mean
  0.640; the dog 0.576, 0.612, 0.595, 0.622, mean 0.601; 38e–38f's
  three-quarter mean was 0.584. Both sets beside their photos for Logan's
  eye: `var/explore/index-all/listing-rehearsal.html`. Found: my ship bar's
  vitest had truncated `monsterpaws_lora_test`, so the cat took id 2 again
  and its JPEGs overwrote the dog's in the rehearsal store; the marker
  stops two databases sharing a store, but a database whose ids restart (a
  test one) meets its own old files. Production's ids never restart.
- **Why a detection stopped, widened (the `sam3` chat):** `lastRunLine` falls
  back to the log's last line that isn't a progress bar or docker's chatter
  (Python's own message when a script died, `sam3: MODEL_API_KEY is not set`
  on `meta`), reads only this attempt's part of the appended log, and carries
  200 characters at most, since a detector's error can quote a remote reply.
- **Logan's eye on the rehearsal:** "these look great". The head fallback
  and the listing words are recorded in ADR-0004 as amended 2026-11-03's
  later note, with these runs as the evidence.
- **The rehearsal before Spencer's go-live, 2026-11-04 15:53–15:57 UTC**
  (oplog 0029's prerequisite; the moderator: the job hadn't run since
  `f3e140e` changed `run()`, the crops and the head rule). The same real
  `generateArt` and `guardPainter` at `a081344`, the same database and store,
  two Commons originals of one dog as a listing's photos,
  `Viljo-koirarannalla-16` and `-19` ("nova scotia duck tolling retriever
  dog"). The first try **skipped in 14 s on memory, Windows free 20.2 GB
  after the cache drop**, under `LOAD_FREE_GB`, which a real gift would hit
  the same way; the VM held 6 GB, so the shortfall was on Windows. The retry
  a minute later **painted in 209 s**: photo 1 left out ("the animal fills
  32% of it, under a close-up's 40%"), photo 2 a close-up whose subject stood
  in for the head, the spec `one: ["2.jpg"]`, four marked, four JPEGs and
  four art facts, the photos and crops deleted.

### The crew for the site — Logan's picks (2026-11-04)

Saved as `var/explore/index-all/crew-portraits-37-picks-2026-11-04.txt`,
decoded through `var/explore/crew-37-pick/key.json`. Logan: "remember we
don't want meta data on them": each picked file holds only `IHDR`, `IDAT`
and `IEND`, 1216×832, the mark in its pixels.

| Pet | Painting | Made by |
| --- | --- | --- |
| Plum | batch 38d, 015 | klein-v1, as painted: three-quarter view (`storybook_bust34`), collarless words, seed 31337 |
| Ducky | batch 35a, 023 | klein-v1, as painted: the short portrait, seed 7321 |
| Beetle | batch 35a, 039 | klein-v1, as painted: the short portrait, seed 7321 |
| Marty | batch 37a, 004 | klein-v1, as painted: the short portrait, batch 11b's reworded colour, seed 47 |
| Stacey | batch 37a, 020 | klein-v1, as painted: the short portrait, seed 47 |

Logan on Plum's: "are the new framings for plum the ones with a slight
head turn? those definitely look good. I wonder if that should be the
framing for all the photos moving forward or if we should keep a
variety?" Open, with the shoulder page's ticks (`shoulders-38.html`).

**Plum's pick withdrawn, and batch 38g (2026-11-04).** The `sam3` chat found
that `Plum/downloadfile.jpg` is Plum's actual shelter listing photo
(`doc/plans/the-look-exploration.md`), a source no painting may have; it is
the second of Plum's two in `comfyui/keepsake-crew.json`, in batches 38a,
38c and 38d, and so in the 38d 015 Logan picked for the site. Logan,
relayed: "i guess we need to get rid of the download photo and regenerate
the plum photos". **38g, 32:** his first original
(`PXL_20250423_185424061.PORTRAIT`) with either `PXL_20250422_224209397`
(facing the camera, Ducky's face in a corner) or `PXL_20250422_224206531`
(three-quarter head) as the second, both collared so the collarless
`bare` words, in the short portrait and the three-quarter framing, at
38c's eight seeds; the spec is checked to name no `downloadfile.jpg`.
Logan picks Plum again from it; the crew table then takes the photo pair
he picks. `var/crew/Plum/downloadfile.jpg` stays where it is unless he
says, and the older specs stay as history.

**38g, run 2026-11-04 02:48–03:01 UTC:** 32 of 32, two ComfyUI starts at
chunk 16 (the guard's fix, first real batch), 22.9 GB free after the drop,
no kill; all marked; on the crew page in place of the withdrawn 40, none from
`downloadfile.jpg`. **Caution (the `sam3` chat):** two of the four sources,
`PXL_20250423_185424061.PORTRAIT` and `PXL_20250422_224206531`, show a
personal detail; their crops, overlays and sheets stay off anything public or
committed, and the painting Logan picks is looked at full size for a painted
tag or detail before its path goes to the site.

**Logan's new Plum pick: batch 38g, 011** (saved as
`crew-portraits-37-picks-2026-11-04b.txt`): the three-quarter view, collarless,
seed 5150, from `PXL_20250423_185424061.PORTRAIT` and
`PXL_20250422_224209397`. Claude looked at it at full size and sees no collar,
tag or personal detail, and asked Logan to look too; the file holds only `IHDR`,
`IDAT` and `IEND`. The crew table now paints Plum from that pair, and a test
holds that no pet's photos include `downloadfile.jpg`.

### Batches 38d–38f — Logan's read of the shoulders (2026-11-04)

Logan's ticks saved as `var/explore/index-all/shoulders-38-picks-2026-11-04.txt`,
decoded through `var/explore/shoulders38-blind/key.json`; with them: "the
beagle just didn't have great likeness probably an outliar to be fixed when
we have a vision model".

| Framing | Acceptable of 68 | Shoulders too wide | Best of three |
| --- | --- | --- | --- |
| `storybook_bust` (the portrait he read) | 45 | 9 | 10 |
| `storybook_head` (close head and neck) | 47 | 7 | 11 |
| `storybook_bust34` (three-quarter view) | 57 | 0 | 42 |

- **The three-quarter view wins on every count**, and never had shoulders
  too wide. Without Plum, whose eight seeds weigh double: best in 36 of the
  15 dogs' 60 threes, against 10 and 10. Plum's wide shoulders (7 of 8 on
  the portrait) are gone in three-quarter (0), and it was his best 6 times.
- **It holds across the seeds:** 13, 13, 11 and 13 of 15 acceptable at 23,
  333, 1111 and 3000.
- **Bailey** (the beagle) is acceptable once in twelve whatever the framing:
  a likeness outlier for the photo reader, not the framing (Logan).
- Plum's threes here were painted from `downloadfile.jpg` (38c, 38d), since
  withdrawn as a source; they still read the framing.
- **Decided: the three-quarter view for every keepsake** (Logan: "yes to
  three quarter"). `comfyui/keepsake-crew.json`'s prompt is
  `storybook_bust34`, real gifts' too, at the same four seeds; ADR-0004 as
  amended 2026-11-03 gains its "Later (2026-11-04)" note. The likeness
  harness agrees: a mean 0.584 on 38e–38f, against 0.572 for the close
  head and 0.581 for batch 35's portrait on the same dogs.

### Batch 39a — the close-ups (Claude, 2026-11-04; Logan's eye decides)

The 40% rule's look (ADR-0004 as amended 2026-11-03, later 2026-11-04): a
headless photo's subject stands in for its head only when the detector's
subject fills 40% of the frame, and the number is provisional until Logan
has seen where a stand-in stops being a painting of the dog. Five Commons
dogs whose head the detector didn't choose, each painted as a one-photo
listing with its subject standing in, **the rule lifted for this batch
alone** (`live_crops.CLOSE_UP = 0` in a one-off `python -c`, the code
unchanged): `3625Pongpong-Bail-Santo-Tomas-La-Union-67` (5% of the frame,
the detector's subject the dog's rear half), `Akiki3-1-of-1` (27%),
`Dog-Friend-2595637875` (38%, just under), `Viljo-koirarannalla-19` (41%,
just over), `Aht-blue2` (75%). Detected as a listing is, no colour; the
shares and the missing heads were the same as October's. Words as a
listing's kind and species, no sex; `storybook_bust34` at the crew table's
four seeds, exactly as `listingSpec` builds them. Spec
`comfyui/explore/batch39a.json`; 20 of 20 painted under the guard
(14:56–15:04 UTC), marked as the handler marks.

| Dog | Share | Likeness, mean of 4 |
| --- | --- | --- |
| Pongpong | 5% | 0.388 |
| Akiki3 | 27% | 0.612 |
| Dog-Friend | 38% | 0.530 |
| Viljo-19 | 41% | 0.552 |
| Aht-blue2 | 75% | 0.621 |

- **Only Pongpong scores apart**, by 0.14 or more, but the harness compares
  the painting with the whole photo, which for Pongpong is mostly road and
  tricycle, and it can't tell a rear half from a head. Claude hasn't looked
  at the paintings. Logan's ticks decide, and they are yours to overrule.
- The page: `var/explore/index-all/close-ups-39.html`, blind (the dogs as
  A–E in a random order, no shares shown; the key in
  `var/explore/closeups39-blind/key.json`). Per painting "a painting of this
  dog" or "the wrong part of the dog", and per dog "I'd send these four to
  a donor".

### Batch 39a — Logan's read of the close-ups (2026-11-04)

Logan's ticks saved as `var/explore/index-all/close-ups-39-picks-2026-11-04.txt`,
decoded through `var/explore/closeups39-blind/key.json`; with them: "i think
it did really well but the ears were just wrong for most dogs so i had a hard
time deciding if i would choose them to send. maybe this is more of a visual
model problem".

| Dog | Share | A painting of this dog | The wrong part | Would send the four |
| --- | --- | --- | --- | --- |
| Pongpong (A) | 5% | 0 of 4 | 4 of 4 | no |
| Akiki3 (B) | 27% | 0 of 4 | 0 of 4 | no |
| Dog-Friend (D) | 38% | 0 of 4 | 0 of 4 | no |
| Viljo-19 (C) | 41% | 4 of 4 | 0 of 4 | yes |
| Aht-blue2 (E) | 75% | 1 of 4 | 0 of 4 | yes |

- **The line holds on this look:** the far-off dog is the wrong part every
  time; the two sets he would send are the two above 40%, and none below.
- **Akiki3 and Dog-Friend were left unticked both ways:** not the wrong
  part, and not a painting of that dog either. His words name the ears, which
  were wrong for most dogs on both sides of the line, so what failed between
  27% and 40% reads as likeness, not the crop; whether the stand-in costs the
  ears (its "head" reference is the whole dog) is not yet separated from the
  words klein is given.
- Five dogs, one photo each: what it shows is the line's direction, not
  where between 5% and 41% the line belongs.

### The photo reader, tried — batch 40a (Claude, 2026-11-04; Logan's eye decides)

Logan, to the moderator: "one thing before this deploy. i'm thinking we test with
vision models to fix likeness before we deploy. i feel we have the time". The plan
above, run: `comfyui/read.py` asks each photo one structured question in the
explore container on the CPU: the coat and where its colours fall (fur only,
never what it wears), the fur length, and the ears, chosen from six shapes
rather than given examples, "how this dog's own ears look in this photo, not
how its breed's usually do". Its answer becomes "with <coat>, <length> fur and
<ears> ears" after the listing's words. Commons photos only (batch 38f's 13
dogs); the weights in `models-candidates.manifest`, read offline.

| Reader | Seconds a photo | Duke's ears | Ears that read wrong by eye |
| --- | --- | --- | --- |
| Qwen3-VL-2B, first question | 26–39 | tall upright pointed | Duke, Daisy |
| Qwen3-VL-2B, question above | 33–45 | tall upright pointed | Duke, Bailey |
| **Qwen3-VL-4B, question above** | 56–78 | **folded-over** | Bailey |

- **The 4B is the one painted.** It reads Duke's natural ears as folded, which
  the 2B never did, and Coco's and Emily's long fur, which the 2B called
  short. On the first question the 2B also put Coco's red harness into her
  coat. Max's upright ears and black back all three read right. Bailey the
  beagle's long ears the 4B calls "short floppy".
- **These are Claude's reads of the photos at contact-sheet size,** and
  several (Coco seen from behind, Sunny, Luna) can't be called at that size.
  The paintings are what decide.
- Its words are long and literal, as a listing's would be: Sunny's carry "wet
  fur, muddy paws", Coco's "slightly tousled by wind". Nothing was cleaned up,
  because a shipped reader wouldn't be either.
- **Memory** (doc/infra.md, Home GPU): the 4B holds about 9.7 GB, its weights as
  file-backed pages, so `docker stats` shows under 1 GB. Run before a job, it
  took Windows free from 28.4 to 20.3 GB, and the job's drop then brought it
  back to 33 GB before the paint.
- Batch 40a: the 13 dogs at `storybook_bust34` and the crew table's four seeds,
  `listing` (batch 38f's words) against `reader` (those plus the 4B's), 104
  paintings, for Logan's blind look on `var/explore/index-all/reader-40.html`.
  Painted 17:00–17:33 UTC, 104 of 104, with no kill; donate's 0032 roll at
  17:06–17:09 left the chunk it crossed exactly as fast as the one before.
- **Likeness** (`likeness.py`, which can't see ears or coat): the reader's words
  a mean 0.596 against the listing's 0.586, ahead on 9 of the 13 dogs; most
  for Rusty (+0.066) and Otto (+0.047), least for Bailey (−0.028), Sunny
  (−0.025) and Coco (−0.017). Yours to overrule: the ears are the question.
- **Logan's first look at 40a, before his ticks:** "is the vision model causing
  us to paint the whole body? that would be a problem … maybe if we told it to
  focus on the animals head only", then "i think describing the chest is a
  mistake. often a clothing item was rendered when there is none for, a white
  patched chest for instance". The prompts bear him out: the reader's words
  put "brown sides … muddy paws", "covering entire body including tail" and
  "spots on belly" inside "a portrait from the chest up", because the question
  asked where the colours fall "on its body".
- **Batch 40b: the reader asked about the head, face and ears only**, never the
  neck, chest, body, legs, paws or tail, in at most 10 words. The 4B again,
  13 photos in 14 min. Duke's ears are still "folded-over". Max's slipped to
  "upright with folded tips", where both earlier runs said pointed. Otto ran
  past his choice ("long hanging with soft, drooping edges"), so `phrase()`
  now takes the choice an answer starts with. Only the reader arm is
  repainted, 52 paintings, paired on `var/explore/index-all/reader-40b.html`
  with 40a's listing paintings.
- **40b's likeness:** a mean 0.586, level with the listing's 0.586, ahead on 7
  of 13. 40a's whole-body words scored higher (0.596) because the harness
  compares the painting with the whole photo, so it rewards the whole body
  Logan named a problem. Here the score is no guide, only his eye.

### Batch 40b — Logan's read of the photo reader (2026-11-04)

Logan's ticks saved as `var/explore/index-all/reader-40b-picks-2026-11-04.txt`,
decoded through `var/explore/reader40b-blind/key.json`: 40a's listing paintings
against 40b's head-only reader paintings, 52 a side.

| Of 52 a side | Listing's words | + the reader's (head only) |
| --- | --- | --- |
| A likeness of this dog | 35 | 45 |
| The ears are right | 38 | 47 |
| The better of the two | 24 | 23 |

- **The reader raises the floor:** the gain is where the listing's words fail.
  Luna went from 0 to 4 likenesses and from 0 to 4 right ears, Duke from 0 to
  4 likenesses, Coco from 2 to 4 likenesses and from 1 to 4 right ears, and
  the reader's was the better painting all twelve times.
- **It costs on Bailey** (3 likenesses to 1). Where both arms were already
  likenesses (Shadow, Otto, Daisy, Emily, Clementine), Logan mostly preferred
  the listing's painting, so "better" comes out even. Max is a likeness in
  neither arm, with his ears right in both.
- The likeness harness had them level (0.586 each); his ticks don't.


### The reader's first run inside the real job (2026-11-04, 21:59–22:07 UTC)

Oplog 0029's rehearsal: from `~/monsterpaws-art-ab34160`, a fresh export of topdog's
tip by the restart list's recipe, through the real `generateArt` as the worker calls
it, on `monsterpaws_lora_test` and the rehearsal store, with Logan's apps as they
were and two Commons originals (`ART_PHOTO_HOSTS=upload.wikimedia.org` for this run).

- **A dog, its head found:** painted in 272 s, the reader 56.1 s of it. klein
  received "male mixed breed dog with brown and black on head, ears, and face,
  medium fur and folded-over ears". The log says only "read".
- **A cat, the species gate, a close-up standing in:** painted in 187 s from "female
  domestic long hair cat", no warning. So the reader costs a dog about 85 s.
- **Memory:** 19.2 GB free before the first drop, 28.9 GB 54 s later; 19.7 GB for one
  sample during each klein load, then 22 GB and up.
- **The words:** a search of everything the dog's run left behind and its log finds
  them in no file. It leaves `cut.json`, `detect.json` (the listing's words only),
  `marked/` and `thumbs/`.
- **Not exercised:** a real 600 s hang and the fallback on a real failure, both tested
  with fakes; publish, off for this rehearsal; a real shelter's photo. Claude looked at
  the 8 paintings at contact-sheet size for gross failures only.

### Batches 40c–40d — the ear wording, and Logan's read (2026-11-04)

After 40b Logan noted Max's colour was worse than our own words and Duke's ears
"did become floppy just not as floppy as they should be".

- **40c, never painted:** 40b's question plus each colour by its exact shade and
  one new ear choice, "soft drop", the only choice with an explanation. It took
  10 of 13 dogs, Max's upright ears among them.
- **40d:** the shade wording, three ear shapes (standing up, folded at the tip,
  hanging down) and the ears' length asked on its own. Logan's ticks are saved
  as `var/explore/index-all/reader-40d-picks-2026-11-04.txt`, decoded through
  `var/explore/reader40d-blind/key.json`.

| Of 52 a side | Listing's words | 40b's reader | 40d's reader |
| --- | --- | --- | --- |
| A likeness of this dog | 35 | 45 | 38 |
| The ears are right | 38 on 40b's page, 41 on 40d's | 47 | 44 |
| Better than the listing's, head to head | | 23 to 24 | 28 to 17 |

- **His marks are steady, so these gaps aren't noise:** the same 52 listing
  paintings, reshuffled on the two pages, got the same 35 likeness ticks, and
  all 38 ear ticks from 40b's page again, plus 3 more on 40d's.
- **All of 40d's lost likenesses are two dogs:** Sunny 4 to 0 and Duke 4 to 0, with
  Max 0 to 1. Sunny's ears went from "upright with folded tips", right 4 of 4,
  to "upright pointed", right 0 of 4. Duke's went from a folded pair to a pointed
  ear with a hanging flap beside it, which Logan read as "unatural looking like
  two ears".
- **Two things Claude said were wrong.** That the six ear labels were "close to a
  toss" and three shapes the "real fix": the six got more ears right (47 to 44).
  And that Max's 40d paintings would come out wrong because the reader read his
  ears as hanging: Logan ticked his ears right 4 of 4.
- **Why Duke got two pairs is not settled.** Claude called the prompt naming the
  ears twice "the cause", but 12 of 40b's 13 prompts do too, Duke's among them,
  and his 40b paintings have one pair. What differs is the phrase, "folded-over"
  against "soft ears that hang down beside the cheeks", set against the breed's
  pointed ears. Naming the ears once is untested, and the same risk stands under
  40b's wording on a breed or seed these 52 didn't show.
- **Why 40d wins head to head is not settled either.** The shade wording is the
  obvious difference from 40b, and untested alone.
- **Decided: 40b's wording ships** (Logan: "ship 40b"). `comfyui/read.py` holds its
  exact question, and all 13 of its prompts' words rebuild exactly from the saved
  answers. Next, after the go-live, needing only a worker restart: the shade wording
  alone, then Duke's ears and Max's colour.
- **Found while checking the words stay in the prompt:** each of ComfyUI's output
  PNGs embeds its prompt in its metadata, so `forget` now removes the run's output
  folder too. The marked paintings carry none. Removing `runs.jsonl` also stops a
  retry with different words accepting an earlier attempt's paintings, since
  `paintedFor` matches the axis name "listing", not the words.

### Batches 14a–14b — Logan's picks (2026-10-28)

"I might be picky but I know what these dogs look like." His likeness
picks of the before, saved as `var/explore/batch14a/picks.txt` and
`var/explore/batch14b/picks.txt`:

- **Plum 10 of 16**: standing s11, s222, s4096, s17, s6174 (14a-000, 001,
  002, 004, 007); sitting s11, s222, s4096, s404, s6174 (008, 009, 010,
  013, 015).
- **Ducky 8 of 16**: standing s11, s4096, s404, s6174 (14a-016, 018, 021,
  023; 016 added by Logan after the first list);
  sitting s222, s4096, s8128, s1729 (025, 026, 027, 030).
- **Beetle 2 of 16**: standing s11 (14b-000) and sitting s222 (009).
  Logan first listed five (with sitting s17, s404 and s1729), then: "I
  really only think two look like Beetle."
- **Likeness only, anatomy not judged**: a pick may carry anatomy (one
  of Beetle's has a sheath she lacks, Logan noticed). The before is meant
  to have it; anatomy is counted on all 48 as its own tally.
- What they are for (Claude's proposal, Logan's to overrule): the ship
  bar's "likeness no worse" (ADR-0004 decision 5), counted per dog. The
  after is picked the same way, at the same seeds, without knowing which
  painting is which, and keeps at least this many per dog: Plum 10, Ducky 8, Beetle 2.

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
