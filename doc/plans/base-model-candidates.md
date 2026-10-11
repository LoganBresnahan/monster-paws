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

## The list

| model | params | licence (read 2026-10-10) | ship? | on the Arc | identity + pose tooling | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **SDXL 1.0 base** (running) | 2.6 B UNet | CreativeML OpenRAIL++-M | yes | fits with adapter + ControlNet + LoRA, 18 s | richest: IP-Adapter Plus (ours), xinsir ControlNets, thousands of LoRAs | the baseline; anatomy is its weakness |
| SDXL fine-tunes: Juggernaut XL v9, DreamShaper XL | 2.6 B | CreativeML OpenRAIL-M / OpenRAIL++ | yes | identical to base | identical to base — every SDXL adapter and ControlNet works | cheapest "better": same graph, swap the checkpoint; better prompt adherence and anatomy than base; worth one batch |
| **SD 3.5 Medium** | 2.5 B MMDiT | Stability AI Community (free under US$1 M annual revenue; gated download) | yes, with the revenue clause recorded | fits comfortably, est. 15–25 s | official ControlNets (canny, depth, blur), InstantX IP-Adapter; no style-LoRA ecosystem to speak of | the step that costs nothing: better anatomy and text understanding than SDXL, same card budget; **first candidate to run** |
| SD 3.5 Large | 8 B | Stability AI Community | yes, same clause | fp8 ~8 GB on card or fp16 in RAM; est. 40–90 s | as Medium | Medium first; Large only if Medium's anatomy is not enough |
| **FLUX.1 [dev]** | 12 B | FLUX.1-dev Non-Commercial | **no** — experiment only, never serves a donor | fp16 23.8 GB **in RAM** (needs the VM cap at 48 GB); fp8 ~12 GB on card with offload; GGUF Q4 ~7 GB on card; est. 1–3 min / 40–60 s / 30–45 s | XLabs and InstantX IP-Adapters, InstantX ControlNet union (licences to read); Kontext is the editing variant | the quality reference: tells us how far SDXL is from the state of the art; the licence makes it a yardstick, not a venue |
| FLUX.1 [schnell] | 12 B, 4-step distilled | Apache-2.0 | yes | as dev | adapters built for dev mostly work, less well | the only FLUX we could ship; distilled models take LoRAs and adapters worse — test, do not assume |
| Chroma | 8.9 B, from schnell | Apache-2.0 | yes | fp8 ~9 GB; est. 40–60 s | FLUX-family tooling, partially | the community's "shippable FLUX"; worth a run after schnell |
| FLUX.2 [dev] | 32 B | FLUX Non-Commercial | no | Q4 ~18 GB — over the card; in RAM only | young | out of reach on this card and this licence; note and move on |
| FLUX.1 Kontext [dev] | 12 B editing model | FLUX.1-dev Non-Commercial | no | as FLUX dev | none needed — it edits the photo itself | the likeness breakthrough we cannot ship; one experiment to measure the gap we are closing with adapters |
| **Z-Image-Turbo** | 6 B, 8-step distilled | Apache-2.0 | yes | fp16 ~12 GB; est. 10–20 s | ControlNet exists; IP-Adapter: to check | new (late 2025), strong, fast, permissive; the most interesting unknown on the list |
| Qwen-Image | 20 B | Apache-2.0 | yes | Q4 ~11 GB on card, slow; fp16 in RAM impossible under 48 GB | ControlNet (InstantX); IP-Adapter: none known | the open editing-model family; Qwen-Image-Edit does what Kontext does under a licence we can ship, at a size this card struggles with |
| HiDream-I1 | 17 B | MIT | yes | Q4 ~10 GB, slow; needs Llama-3.1 text encoder (Llama licence) | thin | permissive but heavy; the encoder's licence travels with it |
| Lumina-Image 2.0 | 2.6 B | Apache-2.0 | yes | fits easily | thin | light and permissive; little tooling |
| Kolors | SDXL-class UNet | Apache-2.0 | yes | fits | IP-Adapter-Plus (Kolors), ControlNets | an SDXL-shaped model with a stronger text encoder (ChatGLM); interesting if SDXL fine-tunes are not enough |
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

## What decides

Logan's picks, as always, and the three questions in the first table. A
model wins a place in ADR-0004 only if it is shippable, fits the card with
its identity tooling, and Logan prefers its output on the crew; the
exploration plan's judge gives the defect count per batch as a second
number. FLUX dev can win the comparison and still only ever be the
yardstick.
