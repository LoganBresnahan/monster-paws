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
  unanswerable on this card.
- **The Fun ControlNet does not fit either**: the 2.9 GB patch on the fp8
  transformer spilled the pool to 4.4 GB. The one lever left is the fp4
  encoder (3.2 GB, in the same repackage); it goes on the avenues list.
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

## Avenues (Logan, 2026-10-11)

"Just because we find something that works doesn't mean I don't want to
try other ways of going about it. It's best that we go down many avenues
to figure out the Monster Paws image style." So a result closes nothing
by itself; each avenue below runs until it has a read, and the ADR
amendment names the winner among tried things, not the first thing that
worked.

- klein, reference only (batch 3a/3b) — the front runner.
- klein with two references, subject and head (batch 3b).
- klein with a reference-control LoRA for pose (`xocialize/refcontrol-FLUX.2-klein-4B-pose-lora`; canny and depth exist for the 9B) — licence to read; the klein way of locking a pose.
- klein with a style LoRA (community ones exist for the 4B; our own on Base 4B is the item-9 path).
- klein in BFL's own calibrated fp8 (`black-forest-labs/FLUX.2-klein-4b-fp8`) against our on-the-fly cast.
- Z-Image unaided, 8 vs 16 steps — ran (batch 3c): no difference; bf16 does not fit this card. Next lever: coat wording ("solid tan", "smooth grey").
- Z-Image with its Fun ControlNet from the outline — did not fit at fp8 beside the 5 GB encoder (batch 3c); retry with the fp4 encoder (3.2 GB).
- Z-Image Omni's reference images (`TextEncodeZImageOmni`), once its image encoder is located.
- SDXL as the known-good fallback; SD 3.5 Large fp8 with its tooling when a token for the gated download is set up.
- FLUX.1 dev as the yardstick (Experiment A), after the VM memory re-test.

## What decides

Logan's picks, as always, and the three questions in the first table. A
model wins a place in ADR-0004 only if it is shippable, fits the card with
its identity tooling, and Logan prefers its output on the crew; the
exploration plan's judge gives the defect count per batch as a second
number. FLUX dev can win the comparison and still only ever be the
yardstick.
