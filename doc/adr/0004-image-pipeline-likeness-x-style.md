# ADR-0004: Keepsake art = style LoRA × identity conditioning; generate on donation only

> Amended by ADR-0006: art generates only from photos we hold rights to
> (verified shelters). Unverified-shelter cards show the framed real photo;
> AI art unlocks at verification. Self-amended 2026-08-02: weights licensing,
> photo disclosure, self-hosting (below).

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

## Amendment (2026-08-02): weights licensing, photo disclosure, and what self-hosting actually buys

Prompted by the ADR-0006 amendment of the same date. Identity conditioning
means each card is computed **from one identified copyrighted photograph** —
so the keepsake is a derivative work of that photo, and the pipeline sits on
two gates this ADR never named.

### 1. Model weights must be commercially licensed — verify at pick time

The Decision names Flux Kontext. The FLUX.1 family is **license-split**:
`[dev]` weights are non-commercial, `[schnell]` is Apache-2.0, and commercial
use otherwise runs through the pro/API tier or a BFL commercial licence.
Taking no cut of donations does **not** make our use non-commercial in a
licence's sense — the art is a feature of a service that moves money.

**Rule: no model enters the production path until its weights licence has
been read and recorded** — name, version, licence, date checked, and whether
it permits commercial use and derivative outputs. Record it beside the
provider config, not in someone's memory; licences change per release and a
model swap is otherwise a silent licence change. Open-weight licences with
*use restrictions* (OpenRAIL-M style) are acceptable — nothing we do is on
their restricted list — but they still need reading.

Corollary: the provider interface must not be the only seam. **The model
identifier is part of the decision**, so a swap behind the interface is a
decision, not a config tweak.

### 2. The photo leaves our infrastructure — say so in the consent

Sending a shelter's photo to a hosted inference provider is a **disclosure**
to a third party, distinct from the permission to make art at all. The
digify grant (ADR-0006 Decision 5) must say the photo is processed by
third-party AI services, and the shelter should confirm they hold or can
license the photo — shelter photos routinely come from volunteers, fosters
and adopters with no written assignment, so an enthusiastic yes may be
consent the grantor does not hold. Their answer is the grant's `basis`.

Provider terms are part of this: prefer providers that do not train on
submitted inputs, and record that check the way ADR-0009 records DeepSeek's.

### 3. Self-hosting: the case is real, but it is two cases — keep them apart

Raised 2026-08-02. Self-hosted open weights (SD/SDXL-class) look like an
answer to both gates above. Only partly, and the halves have different
answers:

- **The licence problem is solved by model choice, not by hosting.** An
  Apache-2.0 or OpenRAIL-M model is equally clean running on Replicate. Cost
  nothing to fix, so fix it now (§1) rather than via an infra migration.
- **The disclosure problem is solved by where inference runs** — and only by
  hardware we control. Serverless GPU (Modal/RunPod/fal) is still a third
  party, just a differently-worded one; the meaningful variable is the
  contractual retention/training clause, not the billing model.
- **Cost points the other way at v1 volume.** The Decision's own economics —
  generate only on donation — mean tens of images a month. Per-call
  inference is far cheaper there than any always-on GPU, and an always-on
  GPU breaks the ~$22/mo single-droplet shape of ADR-0001/ADR-0007. Style
  LoRA training (roadmap item 9) is a one-off rental either way.

**Decision: do not self-host now.** Constrain model choice per §1, disclose
per §2, keep the provider interface. Self-hosting is what we reach for when
volume or a provider's data terms — not licence anxiety — make it the
cheaper answer.

### Consequences
- Model selection gains a licence-verification step and a recorded result.
- The digify consent email carries a third-party-processing disclosure and a
  photo-rights confirmation; drafting it is owed with roadmap item 5.
- Self-hosting stays deferred, now for stated reasons rather than by default.

### Revisit triggers (added)
- A candidate model's licence bars commercial use or output ownership —
  disqualifying, however good it looks.
- A provider's terms permit training on submitted inputs, or change to.
- Shelter photos ever include non-public material — the calculus that makes
  third-party inference comfortable assumes public listing photos.
