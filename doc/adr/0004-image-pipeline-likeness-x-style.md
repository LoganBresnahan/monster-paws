# ADR-0004: Keepsake art = style LoRA × identity conditioning; generate on donation only

## Context
The collector loop needs card art that is (a) unmistakably one set — the
"Monster Paws look" — and (b) recognizably *that specific animal*: a donor knows
the dog's face, so likeness failure is a broken product moment. Aggregator
scale lists hundreds of thousands of animals.

## Decision
Two composed conditioning signals: a **style LoRA** fine-tuned once on the
card aesthetic, plus **per-image identity conditioning** from the animal's
real shelter photos (IP-Adapter / image-conditioned models like Flux
Kontext). Never per-animal fine-tuning. Runs on Replicate behind a provider
interface. **Generate only on donation** — never per listing. Auto-QC:
generate 3–4 candidates, score against real photos with CLIP-style
similarity, serve the best, flag low scorers for regeneration. Two art
moments: instant card on donate; "gotcha day" card at adoption. 3D
(Meshy/Tripo) is parked as a future style behind the same interface.

## Consequences
- Cost scales with donations (revenue-adjacent), not listings. Pennies/image.
- The CLIP-QC loop is an automated eval harness for a generative pipeline —
  the second chapter of the project's eval story.
- Likeness quality is bounded by shelter photo quality; low-QC-score cards
  need a regenerate/fallback path.

## Alternatives
- Pre-generate per listing: rejected — real money for zero value at scale.
- DreamBooth per animal: rejected — economically absurd.
- Self-hosted GPU (old plan phase 2): deferred until volume justifies it;
  the provider interface keeps the door open.

## Revisit triggers
- Volume where Replicate unit cost exceeds a spot GPU + ops time.
- Identity-conditioned models good enough in 3D to unpark it.
