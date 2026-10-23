# ADR-0004: Keepsake art = style LoRA × identity conditioning; generate on donation only

> Amended by ADR-0006: art generates only from photos we hold rights to
> (verified shelters). Unverified-shelter cards show the framed real photo;
> AI art unlocks at verification. Self-amended 2026-08-02: weights licensing,
> photo disclosure, self-hosting (below). Self-amended 2026-10-05: inference
> runs on a GPU in Logan's home, ComfyUI is the workbench, art arrives when
> it is ready; same-day addendum: the home worker is isolated under its own
> Windows account and packaged as CI-built containers (below).
> Self-amended 2026-10-14: the donor keeps all four candidates, the judge
> runs silent; and the look is FLUX.2 klein 4B reading the photo, the
> prompt holding the style (workflow klein-v1). Self-amended 2026-10-15:
> klein is the only painter, a tripod stands, the canvas is landscape, no
> male anatomy on a female. Self-amended 2026-10-22: the anatomy LoRA —
> a cleaned set, an edit LoRA on klein Base 4B, trained on a per-job
> DigitalOcean GPU.
> Self-amended 2026-10-23: the crew's cleaned paintings may appear on the
> home section (below).

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

## Amendment (2026-10-05): inference runs on hardware we control, ComfyUI is the workbench, art arrives when it is ready

The 2026-08-02 amendment said "do not self-host now" and gave cost as the
deciding reason: an always-on rented GPU breaks the ~$22/mo single-droplet
shape. That weighed self-hosting as *renting*. On 2026-10-05 Logan raised a
venue it never considered: a GPU already in the house — an Intel Arc A770
(16 GB) in his main machine, with display moved to the 12th-gen iGPU so the
card sits idle for Monster Paws. That flips the cost column, and §3 of that
amendment already says it is the only venue that closes the disclosure gate:
the photo never leaves hardware we control. Discussed and decided 2026-10-05.

### Decisions

1. **ComfyUI is the workbench, and the workflow is product code.** The look
   is developed in ComfyUI, locally. The API-format workflow JSON, the model
   files' hashes and the licence record (§1 above) are committed together;
   changing any one of them is a change to this decision, not a config
   tweak. Custom-node sprawl is the trap: nodes are pinned, and a node that
   needs CUDA-only kernels is not used.
2. **Inference runs on a GPU in Logan's home.** The first GPU is the A770 in
   the main rig. A headless ComfyUI serves its API on localhost and the Node
   worker reaches it over HTTP; both are containers in a dedicated WSL
   distro (addendum, below), with ComfyUI native on Windows as the fallback
   if XPU inside WSL fights us — it did not: verified from a container the
   same day (`doc/infra.md`, Home GPU). "ComfyUI at a URL" is one provider behind
   this ADR's provider interface, exactly as Replicate is — the worker never
   knows which GPU answered.
3. **Dispatch is the queue we already have.** The home box runs the same
   pg-boss worker process, registered for the `art.generate` queue and
   nothing else, and the droplet's worker never registers `art.generate` —
   a job consumed on a box with no GPU would fail 3/3 and report. The home
   worker reaches Managed Postgres through an SSH tunnel to the droplet,
   which is already a trusted source; results upload straight to the R2
   media bucket with a write-only key. **Outbound only toward the internet:
   nothing in the house listens past the machine** — the local-only SSH port
   the deploy uses (addendum) is not exposure in this sense. Email, webhooks
   and a bespoke pull API were considered and rejected — a queue has retries, acknowledgement and a dead-letter path,
   and this one already exists.
4. **Art arrives when it is ready; "instant" is withdrawn.** The box may be
   asleep, rebooting, or in use; the job waits in the queue. The card is
   already a two-stage reveal (ADR-0006 decision 5): the framed real photo at
   donation, the art when it lands, announced by its own message. A
   Replicate fallback after N hours is **not** the default: it reintroduces
   the third-party disclosure into the consent email (§2). Adopting one is
   an amendment, and the consent copy changes with it.
5. **Training is rented; the style set contains no shelter photo.** An SDXL
   LoRA trains on the A770. FLUX-class LoRA training on 16 GB Arc is bleeding
   edge, so the handful of final runs rent an H100 hour (Replicate's trainer
   or similar) and the `.safetensors` comes home. The style set is our own
   reference art — commissioned, generated, or the founders' pets with
   consent on file — never a shelter photo, so renting the training hour
   discloses nothing. Identity conditioning happens per image at inference,
   at home.
6. **Clean-licence models first, and Replicate's licence does not travel.**
   SDXL + IP-Adapter (OpenRAIL-M) is the first path — smoothest on XPU,
   trains locally. Qwen-Image-Edit (Apache-2.0) is the identity-conditioning
   candidate to evaluate quantized to 16 GB. FLUX.1 [dev] at home needs
   Black Forest Labs' paid, metered commercial licence; Replicate's
   agreement with BFL covers Replicate only. §1's rule stands: the licence is
   read and recorded before a model touches a donor's card.
7. **VRAM is the constraint, not compute, and the floor is 16 GB.** The
   B570 (10 GB) and B580 (12 GB) carry less than the card already owned and
   are not upgrades. Multiple cards buy parallel jobs, worth nothing at
   tens of images a month — diffusion does not split one image across GPUs.
   A dedicated box is decided only after the A770 has proven the look and
   the sleep, sharing or secrets problems (below) have actually bitten; the
   purchase then is the cheapest card at 16 GB or more, and a 24 GB NVIDIA
   card is the one that also removes the rented training step.
8. **Replicate stays behind the interface as the documented escape hatch**
   for when volume, availability or Logan's time makes it the cheaper
   answer. Moving production inference back there is an amendment, because
   of §2.

### Financials (hand-estimated 2026-10-05; verify before a purchase)

| | Replicate | DO GPU droplet | Home A770 |
| --- | --- | --- | --- |
| Up front | $0 | $0 | $0 (owned) |
| Per keepsake, 4 candidates | ~$0.12–0.16 | — | ≈ power |
| Monthly at 50 / 500 donations | ~$7 / ~$70 | ≥ ~$555 always-on | ~$3–5 power, 24/7 idle |
| Developing the look (dozens of trains, ~2,000 test images) | ~$100–300 | included | $0, and seconds per iteration |
| Photo leaves our control | yes | yes | no |

On inference alone Replicate wins for years at v1 volume. The home GPU pays
on the development spend and on the disclosure gate, which has no price.

Market note, 2026-10-05: a GDDR shortage has pushed every card up 40–150 %
since June — a used 3090 sells near $1,000 and asks $1,200–1,550, a 5060 Ti
16 GB is $790 against a $429 MSRP, and the next NVIDIA generation has slipped.
Nothing is bought into that; the owned A770 plus rented training hours is the
whole hardware plan until prices normalize (revisit trigger below). Old
datacenter cards are not a loophole: PyTorch's current CUDA builds no longer
target Maxwell, Pascal or Volta, so the P40, P100 and V100 are dead platforms,
and 24 GB Turing cards lack the BF16 that FLUX-class training wants.

### Addendum (2026-10-05, same day): the home worker is isolated, packaged, and deployed like the droplet

Raised after the venue decision: the main rig is also Logan's daily machine,
and nothing Monster Paws may read his files, nor he its secrets except on
purpose. Full passthrough of the A770 to a VM is not available while Windows
stays the host — client Hyper-V has no Discrete Device Assignment, GPU
paravirtualization is sharing through the host driver, and bare-metal Linux
with VFIO turns the gaming PC into a server with Alchemist's reset bug on
top. The isolation that matters is at the OS and credential layers:

9. **A dedicated standard Windows account runs production.** Everything for
   the pipeline is installed under a `monsterpaws` user and started at boot
   by Task Scheduler, logged in or not. ComfyUI custom nodes are arbitrary
   code from GitHub running as whoever launches ComfyUI; under a
   low-privilege account a bad node is contained. **Development never
   happens on that account** — it stays on Logan's own, with `pass`, the
   repo and the ComfyUI GUI for style work.
10. **Dedicated distros on the second M.2, and nothing else there.** The
    drive's Linux dual boot is retired (production that only runs while Logan
    is booted out of Windows is production that is off). The M.2 holds two
    distros and only them: `monsterpaws-dev` under Logan's account and
    `monsterpaws-prod` under the `monsterpaws` account, each with its own
    repo clone, docker engine and models. Logan's general Ubuntu and Docker
    Desktop stay on C: with his other projects (revised 2026-10-06 from "the
    general dev distro moves to the M.2": a dedicated dev distro has the same
    shape as prod — decision 11 — so the home-worker dogfood is not the first
    time that shape runs, and Docker Desktop's move, which needed a directory
    junction to complete, becomes unnecessary). The prod distro mounts no
    Windows drive and has interop off; the dev one keeps both. All distros
    under one Windows account share one WSL VM and one memory cap, so the
    caps are per account: Logan's VM 24 GB (general Ubuntu and
    `monsterpaws-dev` together), prod's VM 24 GB (ComfyUI stages models
    through RAM; offloaded text encoders make FLUX-class inference fit the
    A770), 16 GB left for Windows when everything is awake.
11. **Worker and headless ComfyUI are CI-built containers** (ADR-0007 as
    amended 2026-10-05), run by a plain docker engine inside the distro under
    systemd — never Docker Desktop, which needs an interactive login. The
    dev distro runs the same engine, so Docker Desktop is out of the Monster
    Paws path entirely and `scripts/bootstrap-distro.sh` builds dev and prod
    from one list (verified 2026-10-06: the Arc smoke test passes from the
    engine inside `monsterpaws-dev`). Custom
    nodes are pinned in the image; models are a volume, downloaded at first
    start and verified against the committed hash list, never baked in. The
    PyTorch wheel is a build argument — `xpu` for the Arc, `cuda` for
    everything else — and the rest of the image is identical, which is what
    makes decision 8's escape hatch real: Replicate's cog and RunPod take the
    CUDA variant of an image CI already builds. Inside WSL the container
    reaches the Arc through the host's GPU device and driver libraries.
    **Models are two stores filled from one manifest, never a shared folder**
    (refined 2026-10-05): `comfyui/` commits a manifest — file, source,
    sha256, licence, date checked — which is §1's licence record with the
    hash beside it. Dev's store is `var/comfyui/` inside `monsterpaws-dev`
    on the M.2 (native ext4) — never a Windows-formatted folder read through
    the 9p bridge, which is slow for multi-gigabyte loads from WSL and from
    Docker alike (corrected 2026-10-06); prod's is inside its own distro's
    disk on the same M.2, filled by a fetcher that downloads each manifest entry and
    verifies the hash, and the worker refuses to start on a mismatch. A
    shared live directory would reopen the dev/prod boundary (a dev-writable
    surface, read through the slow Windows filesystem bridge), and a raw
    partition cannot be attached to two WSL VMs at once. Weights we make
    ourselves — the style LoRA — flow dev → R2 → prod exactly as code flows
    dev → GHCR → prod: a dev-side script uploads the file under a models
    prefix and records its hash in the manifest; prod reads it with a
    read-only credential of its own. Two copies cost well under 200 GB of
    the 512 and buy provisioning that never copies from Logan's account.
12. **Credentials are scoped so a leak cannot hurt, and handed over one way.**
    The prod side holds only its runtime set, in an `.env` it alone can
    read: a Postgres role limited to pg-boss's tables and `keepsake_fact`
    inserts; an R2 token that can only write the media bucket; a tunnel key
    whose `authorized_keys` line on the droplet is restricted to forwarding
    the one Postgres port. `pass` on the dev account holds all of them, as
    it holds the droplet's. The hand-off is the deploy skill over an SSH
    server the prod distro runs on a localhost port — the home box is a
    second deploy target beside the droplet, pulling the same way. At
    runtime the prod side talks to Postgres through the tunnel and to R2,
    and nothing else.
13. **One GPU, one ComfyUI at a time.** Two processes do not share 16 GB.
    While the GUI is open for style work, prod jobs wait, which the product
    already tolerates (decision 4). A workflow is promoted by committing its
    JSON and model hashes, never by copying files between accounts.

Consequences added: `doc/infra.md` gains the home worker's secrets rows (not
created yet, now six: a read-only R2 credential for the models prefix joins
the five), the second deploy target in the CI diagram, and a provisioning
step; the deploy skill gains the home target when the box is provisioned, not
before. The unattended WSL distro — kept alive by the worker process, started
by Task Scheduler — is the one fragile joint and the first thing to dogfood.

### Consequences
- The ADR-0001 single-droplet shape is unchanged: nothing at home is in the
  request path, and the droplet still runs the poller and every other job.
- `doc/infra.md`'s deployment diagram gains the home box (planned until
  built), and provisioning the home worker — a restricted database role,
  the tunnel's SSH key, the R2 media key on a daily driver — is an infra
  step and an oplog entry (ADR-0023) when it happens. `doc/flows.md` gains
  the keepsake art flow.
- The worker process gains a queue filter so one binary serves both roles.
- Secrets hygiene is weaker than a dedicated box: the tunnel key and the R2
  worker key live on a machine Logan also browses and games on. Accepted for
  now; it is one of the triggers for a dedicated box.
- Windows sleep becomes art latency. Accepted; DIRECTION stops promising
  "instant".
- The consent email (item 5) can narrow its disclosure: the photo is
  processed on hardware we control. Keep the photo-rights confirmation.
- The "Monster Paws look" owes a style brief and reference set before any
  training (roadmap item 9); the "Meet the crew" note on the roadmap is its
  first instalment.

### Alternatives
- **Rented DO GPU, always on.** Rejected: 25× the whole infra budget for
  tens of images a month.
- **Rented GPU spun up per job.** Rejected: a Replicate rebuilt by hand, with
  cold starts and ops, and still a third party.
- **Email or webhook as the signal.** Rejected: not a queue — no retry, no
  ack, no dead letter — and the queue already exists.
- **Expose ComfyUI inbound through a tunnel.** Rejected: the house never
  listens; the worker pulls.
- **Buy a Battlemage rig now.** Deferred: less VRAM than the owned card, and
  nothing has bitten yet.

### Revisit triggers (added)
- **Fired 2026-10-10 — the auto-QC metric.** Cosine between CLIP ViT-H
  embeddings of a candidate and the photo ranks photocopies first and
  stylised images last, and is near a coin flip against Logan's picks
  among candidates of one workflow (`doc/plans/the-look-exploration.md`,
  Step 2). "CLIP similarity picks best of 3–4" stands only in a
  style-invariant form — a styled reference, candidate consensus, or a
  shape-first embedding — chosen by rank against the labelled picks. The
  amendment lands with that choice.
- Jobs wait more than 48 h because the box is down, more than once.
- Donations outpace what the A770 generates in its idle hours.
- Logan's other work needs the card at the same time — two ComfyUI
  processes do not share 16 GB.
- BFL's self-hosted licence price, once read, makes FLUX uneconomic at home
  — stay on SDXL or Qwen-Image rather than move the venue.
- The only model that nails likeness has no clean self-hosted licence —
  then that model runs on Replicate, and the consent copy carries the
  disclosure again.
- GPU prices normalize after the 2026 memory shortage — reopen the dedicated
  box question with a 24 GB, BF16-capable card as the bar.
- **A second card in the board's x4 slot (asked 2026-10-12, deferred).**
  Reopen when the art worker is live and production's claim on the A770
  blocks Logan's exploration, when jobs queue past what "arrives when it
  is ready" absorbs, and not before a week with no watchdog dumps on the
  headless A770 (`doc/issues.md`, Ops — the black flickers). The bar is a
  second 16 GB card (another A770), since klein's set takes 13.2–14.4 GB;
  a 6 GB card (A380) holds only what already runs on the CPU. Check the
  PSU for a second 225 W card; the x4 link slows only the model load.
- The unattended WSL distro proves unreliable (a job waits because the
  distro was not running, not because the box was asleep) — that is the
  dedicated box's cue, prices or not.
- A compute-runtime, Level Zero loader or torch-xpu release changes what the
  Arc does under WSL2 — the 2026-10-07 shakedown found a runtime a year
  older than the Windows driver returning garbage copies without an error,
  a 1 GiB single-allocation ceiling, and ~100 file descriptors leaked per
  image (`doc/infra.md`, Home GPU). The four are pinned together in
  `comfyui/Dockerfile` and re-checked monthly (infra.md, Recurring ops); a
  release that stops the leak retires the `nofile` ulimit, and one that
  breaks the smoke is not adopted.

## Amendment (2026-10-14): the donor keeps all four; the judge runs silent

### Context
The decision above serves the best of 3–4 candidates by CLIP similarity.
That metric failed (revisit trigger fired 2026-10-10), and its successor,
auto-QC v0 (`doc/plans/the-look-exploration.md`), rejects outliers but
leaves the choice among clean candidates to taste: batch 5b's picks ranked
1, 3, 21 and 23 of 24 on the scorer. Klein gets colour and identity right
often enough that four draws usually hold a good one, and which one is
best is a matter of taste. The roadmap carried the donor's choice as an
open idea since 2026-10-12.

### Decision
1. **Every keepsake set is four candidates, and the donor keeps all four**
   (Logan, 2026-10-14), as a precaution while the judge is unproven. Each
   is its own `art` fact on the keepsake (ADR-0022), on the art's basis.
2. **The donor picks the one that fronts the card**, and can change it.
   A pick is a new row, never an UPDATE (ADR-0022 §3). Until the donor
   picks, the card fronts the first candidate in generation order, never
   the judge's pick.
3. **The judge runs on every set and is never shown.** Its scores and
   choice are stored with the judge's version, as derived data. The
   donors' picks become the labelled set it is re-checked against. The
   judge is not a gate yet: nothing is withheld or regenerated on its
   word.
4. **One set per keepsake, never a re-roll.** A paid or waited-for redraw
   is the gacha loop DIRECTION.md's third bright line forbids.

### Consequences
- "Serve the best, flag low scorers for regeneration" is suspended, not
  deleted. It returns as the judge's gate through the trigger below.
- A malformed candidate (a misplaced eye, a stray leg) can reach a donor
  inside a set of four. Accepted for now: the donor chooses the face, and
  the defect stays as visible as the good ones. Donor reports go to
  `doc/issues.md` (ADR-0019).
- R2 holds four images per keepsake instead of one. This costs pennies at
  this volume.
- Item 9's judge work continues unchanged. Its labelled set now grows from
  real donors, not only from Logan's picks.
- DIRECTION.md's auto-QC item, CLAUDE.md's stack line and the keepsake art
  flow in `doc/flows.md` say so.

### Alternatives
- **The judge picks one (the decision above).** Deferred: the judge hasn't
  yet matched Logan's taste among clean candidates.
- **The donor chooses one, and the other three are discarded.** Rejected:
  it throws away generated art the donor has seen, and any later regret
  becomes a re-roll request.
- **The judge's pick as the preselected face.** Rejected for now: it would
  put the judge's taste in front of donors before it has earned that.

### Revisit triggers
- The judge's choice matches donors' face picks well enough on real sets
  (rank agreement measured against the labelled set) — then it becomes the
  gate, and the default face, by a further amendment.
- Donors report defective paintings in their sets more than once — then
  outlier rejection gates the set before the judge's taste does.

## Amendment (2026-10-14): the look — FLUX.2 klein 4B reads the photo, the prompt holds the style

### Context
The 2026-10-05 amendment made the workflow product code and put SDXL +
IP-Adapter first. The look exploration (roadmap item 3c,
`doc/plans/the-look-exploration.md`) and the base-model bake-off
(`doc/plans/base-model-candidates.md`) ran from 2026-10-08 to 2026-10-14.
FLUX.2 [klein] 4B, reading the listing's photo as a reference, beat SDXL
in Logan's picks from its first batch (3a/3b). Batches 4–7 refined it,
and batch 6a showed it holds across twelve species. Logan, 2026-10-14:
the art style is found "for the moment".

### Decision
1. **The painter is FLUX.2 [klein] 4B in Black Forest Labs' own fp8**
   (`flux-2-klein-4b-fp8.safetensors`, Apache-2.0, read 2026-10-14), with
   the Qwen3-4B text encoder in fp8 and the FLUX.2 VAE: 4 steps, euler,
   simple, cfg 1. BFL's file over our on-the-fly cast of the bf16 file:
   batch 7a gave the same pictures, a little crisper, at the same speed
   and memory (Logan, 2026-10-14). The bf16 weights are not run on the
   A770.
2. **Identity comes from the photo, read as a reference, with no
   adapter.** The subject crop (the detector's box grown by its own
   outline, ADR-0026) is read at its own aspect as the first
   `ReferenceLatent`, and the head crop (the detector's head grown the
   same way, also at its own aspect) as the second.
3. **The style lives in the prompt, not in a LoRA.** The storybook
   watercolour prompt, a fixed three-quarter pose (sitting or standing,
   never the photo's), and the listing's words through a reviewed table
   (`doc/plans/listing-words.md`). That replaces the original decision's
   "style LoRA × identity conditioning". A LoRA becomes optional
   (Revisit triggers).
4. **SDXL + IP-Adapter + outline is the fallback, not the first path**
   (it replaces decision 6 of 2026-10-05). It stays in
   `comfyui/models.manifest` with its licences, because it is the only
   path with a trained style LoRA ecosystem.
5. **The workflow is committed as `comfyui/workflows/klein-v1.api.json`**
   (decision 1 of 2026-10-05), beside the manifest lines it names. A
   donor's set is four candidates of it (the amendment above), differing
   by seed.

### Consequences
- Roadmap item 9 ("Style LoRA") is no longer on the path to a first
  keepsake. It becomes "own the look": a klein LoRA on the non-distilled
  Base 4B, trained when a trigger below fires. Decision 5 of 2026-10-05
  (training rented, no shelter photo in the set) still governs it.
- About 11 s an image on the A770, so ~45 s for a set of four plus the
  model load. Item 4's throughput sweep re-measures it.
- Known limits carried as roadmap carry-ins, none blocking: markings and
  patterns that the words do not carry (harlequin patches, an ear patch);
  missing legs (batches 8a–8d: the painter always draws four, and a
  removal step after it is in testing); a detector head on the wrong part
  of the animal (ADR-0026).
- Words come only from a source the art may use. RescueGroups' facts do
  not reach production art until ADR-0006 says they may (roadmap item 10
  carry-in).

### Alternatives
- **SDXL + IP-Adapter + LoRA (the 2026-10-05 first path).** Kept as the
  fallback: identity carried, but the anatomy was weaker, and Logan
  preferred every klein batch (2026-10-11).
- **Z-Image-Turbo.** Clean drawings, but it has no reference path we can
  run, so identity is zero.
- **Chroma.** Slow (102–147 s) and spills the card.
- **FLUX.1 [dev], Kontext, klein 9B, FLUX.2 [dev].** Non-commercial
  licences: yardsticks only, never a donor's card.
- **Qwen-Image-Edit.** Apache-2.0 and an editing model, but ~20 GB in fp8:
  over the card (`base-model-candidates.md`, a second card).
- **bf16 klein.** Fits only with the text encoder on the CPU, which has not
  been run. Batch 7a suggests it would change small details, not quality.

### Revisit triggers
- The prompt cannot hold the look across a new species or a shelter's
  photos (a style drift Logan sees in a batch): train the klein LoRA
  (item 9).
- A look of our own that a copied prompt cannot reproduce becomes worth
  its training hour.
- BFL ships a klein update, or a shippable model with a reference path
  beats klein in Logan's picks.
- A trait the painter cannot carry from words or photo — a missing leg
  (batches 8a–8d) — gets a step after it, not a different painter: LaMa
  object removal inside SAM's outline of the leg works on all six test
  paintings. Adopting that step is a further amendment. The pose LoRA is
  ruled out: it reads human skeletons only.

## Amendment (2026-10-15): klein only, no fallback painter; a tripod stands

### Context
The 2026-10-14 amendment kept SDXL + IP-Adapter + outline as the fallback
(decision 4) and left the pose open between sitting and standing
(decision 3). Batches 9a–9d (`doc/plans/base-model-candidates.md`) ran the
look as production would on Plum and Ducky: klein draws male genitals on
nearly every dog, females included (86 of 96 in batch 9b), and no wording
keeps them out. Removing them after painting blurred the area (LaMa) or
grew them back (klein), and Logan rejected it. Tripods were already known
to need the same kind of after-step (batches 8a–8h). Logan, 2026-10-15:
"lets forgo the sdxl fallback … basically just keep trying on klein till
it works"; "we really cant be drawing male parts on a female"; and on the
pose, standing only where the listing says three-legged ("a rule that if
we get the 'tripod' and related keywords to do standing only").

### Decision
1. **klein is the only painter.** Decision 4 of 2026-10-14 is withdrawn:
   no SDXL fallback. What klein draws wrong is fixed in klein — words,
   references, steps after it, or a LoRA trained on it — never by
   switching painters.
2. **A three-legged animal is painted standing**, three-quarter; every
   other keepsake keeps decision 3's three-quarter sitting or standing.
   Standing is where a tripod's legs can be counted and the missing one
   taken out (batches 8f–8g: four legs found on 15 of 30 standing, 1 of
   30 sitting). Whether a listing is three-legged comes from the
   visible-traits keyword list over its text ("tripod", "three-legged",
   "amputee" and the like; `doc/plans/listing-words.md`, proposed);
   reading that fact from prose is decided with the list, before it is
   built.
3. **The canvas is landscape (1216×832) whatever the photo's box**; the
   references keep their own aspect. A portrait canvas sat Plum front-on
   (batch 9a); landscape gave every pose three-quarter (batch 9b).
4. **Male anatomy is never painted on a female, and none is wanted on any
   keepsake.** This is a correctness requirement on the painter, not a
   style choice. It fires the LoRA trigger below, for anatomy rather
   than style.

### Consequences
- The SDXL path leaves the code: its manifest lines (SDXL base, the
  IP-Adapter and its LoRAs, the canny ControlNet), the IP-Adapter custom
  node in `comfyui/Dockerfile`, the harness's SDXL graphs and
  `comfyui/workflows/sdxl-ipadapter-v0.api.json`. The CLIP ViT-H encoder
  stays: `comfyui/likeness.py` scores with it. Roadmap item 4 carries the
  strip.
- Until the LoRA, a set can carry a painting with genitals; nothing
  donor-facing is generated before item 4 ships, and the first donor's
  set waits on this.
- A painted signature is taken out after painting by
  `comfyui/signature.py` (LaMa on the paper outside the dog's outline);
  adopting it into the worker is part of item 4.
- Roadmap item 9 (the klein LoRA on Base 4B, rented) moves to the front
  of the art work. Its training plan comes as a further amendment before
  anything is rented: the set (clean undersides; tripods by the leg, from
  legs.py's repairs Logan approves; never a shelter photo), and the check
  that a Base-trained LoRA carries to the distilled 4-step klein with
  likeness intact.

### Alternatives
- **SDXL + IP-Adapter as the fallback (2026-10-14).** Withdrawn: a second
  painter to keep current with no batch that preferred it, and its
  parameters were never tuned against klein's.
- **Remove the genitals after painting** (batch 9c: OWLv2 placed, LaMa
  filled; batch 9d: klein repainting the fill). Rejected by Logan: the
  fill blurs the area, and klein grows them back.
- **Words or a pose that hide the groin** (batch 9b: "hidden from view",
  the tail round the paws, front three-quarter). Rejected: no change.
- **Every keepsake standing** (this amendment's first form, the same
  day). Withdrawn by Logan: the pose rule is needed only where it
  carries a fact, the tripod.

### Revisit triggers
- The LoRA cannot be made to keep klein's likeness, or does not carry to
  the distilled model: then a different base, decided by its own
  amendment, not a revived fallback.
- A species whose natural keepsake pose is not standing (a bird, a
  snake): the pose rule is per species, by amendment.

## Amendment (2026-10-22): the anatomy LoRA — a cleaned set, trained on a rented DigitalOcean GPU

### Context
The 2026-10-15 amendment made "no male anatomy on a female, none on any
keepsake" a correctness requirement (decision 4) and asked for the LoRA's
training plan before anything is rented. Logan set its scope 2026-10-22:
**no genitals on any dog**, not females only, and **genitals only**; a
tripod LoRA, if ever needed, is its own.

BFL's training guide and docs (read 2026-10-22) say to train on klein
**Base** 4B (Apache-2.0) and run the LoRA on the distilled 4-step klein,
where it "usually gives even better results". A 4B run fits 24 GB and
takes about an hour on an RTX 4090. ai-toolkit (MIT) trains klein,
including **edit LoRAs** from reference→target pairs, which is how our
painter works. The cost is in the set: ~100 paintings in our look with
clean undersides, many dogs, both sexes, sitting and standing. The
distilled painter makes about one in ten, almost all in poses that hide
the groin; Ducky came out clean in 9b only in two-dog paintings.

Batch 10a asked whether Base could paint the set itself, since it runs
real CFG and reads a negative prompt (`doc/plans/base-model-candidates.md`):
anatomy in **19 of 24** with "genitals, testicles, scrotum, penis, sheath"
in the negative, against 22 of 24 on the distilled painter, at 135 s a
painting against 16.5 s; and the look drifts toward an anatomical study.

### Decision
1. **The set is our own paintings, cleaned by an editor, approved by
   Logan.** The distilled klein paints as production does (klein-v1:
   references, landscape canvas, both poses); Qwen-Image-Edit 2511
   (Apache-2.0) takes the genitals out of each with one fixed
   instruction, and only a cleanup Logan approves enters the set. It
   never runs in the donation path: decision 4 of 2026-10-15 still
   forbids repair after painting there. The cleanup's quality is
   unproven, so it is tested first on batch 9b's 22 production-prompt
   paintings that show anatomy, Logan judging; if it smears or regrows
   like LaMa and klein did, it is out (Alternatives).
2. **An edit LoRA on klein Base 4B, run on the distilled 4-step klein.**
   Pairs are production's references (the two grown subject crops and
   the grown head) in, the approved cleaned painting out, captioned with
   the production prompt and a made-up trigger word. ai-toolkit, lr
   about 1e-4, checkpoints every 250 steps chosen by their samples, not
   the loss. The trained `.safetensors` comes home and gets an `r2:`
   line in `models.manifest`, its licence "ours".
3. **Training rents a DigitalOcean GPU Droplet per job, destroyed when
   the job ends.** One GPU (L40S, 48 GB, $1.57/h, or RTX 4000 Ada,
   20 GB, $0.76/h; per-second billing), driven by `doctl` with the token
   we already hold, running our own ComfyUI image built for CUDA
   (`TORCH=cu128`) for the cleanups and ai-toolkit for training. This
   refines decision 5 of 2026-10-05 ("rent an H100 hour, Replicate's
   trainer or similar"): one vendor already in `doc/infra.md`, no new
   account holding our pictures. The 2026-10-05 alternative "rented GPU
   spun up per job" was rejected for inference and stays rejected
   there; this is training and dataset work only, dev only, never
   production.
4. **What goes up: Wikimedia Commons dogs and the crew, never a shelter
   photo**, each Commons photo in `comfyui/explore/commons-photos.tsv`
   with its licence (decision 5 of 2026-10-05). Plum and Ducky stay out
   of training, so batch 9b's seeds are a clean before and after;
   ~60–100 more Commons dogs are collected for the set and a held-out
   few for the test.
5. **It ships only if all four hold**, on Plum and Ducky at 9b's seeds
   and on unseen Commons dogs, across checkpoints 1000, 1500 and 2000
   at strengths 0.6, 0.8 and 1.0: zero male anatomy on a female; nearly
   none on any dog, by Logan's labels; likeness no worse than klein-v1
   on the scorer; and Logan's eye says the look held. Then it joins
   klein-v1 by a further amendment naming the checkpoint and strength.

### Consequences
- New models, each with its `models.manifest` line before it runs:
  BFL's fp8 klein Base 4B (added 2026-10-22, batch 10a; it stays for
  the training comparison), and Qwen-Image-Edit 2511 in Comfy-Org's
  repackage. New tool: ai-toolkit (MIT), pinned by commit on the
  rented box.
- `doc/infra.md` gains a GPU-rental section: the limit (one GPU,
  requested 2026-10-22), the script that creates the droplet, runs one
  job, brings the results home and destroys it, and the trap that a
  powered-off droplet still bills.
- Cost: about $1.60 for the cleanup test, about the same per hundred
  cleanups and per training run; ten runs is about $20.
- Logan labels and approves by eye: the cleanups, then each test batch.
  A contact sheet of groin crops per batch is the tool (batch 10a's
  `groin/` sheets).
- `explore.py` keeps the `kleinbase` family and the `negatives` axis
  (batch 10a); Base runs at home only to compare against the LoRA.

### Alternatives
- **klein Base paints the set** (batch 10a). Rejected: 19 of 24 still
  drawn, about five clean an hour against twenty from filtering, and
  off our look.
- **Filter the distilled painter's output**, ~1,000 overnight, keeping
  the clean tenth. Fallback if the cleanup fails: certain to work, but
  the clean ones are poses that hide the groin, and the standing side
  views the LoRA most needs are missing.
- **Clean by hand in Krita** (Logan or an illustrator, 40–80 paintings).
  Last resort: the best pairs, at real time or money.
- **A hosted editor or trainer (fal, Replicate).** fal's Qwen edit is
  about $0.03 an image, but its klein edit trainer bills about $35 a
  run with our three references; Replicate has no klein trainer, and
  neither rents a bare GPU. A second vendor for no saving.
- **RunPod or Vast.ai.** A community RTX 4090 at about $0.34/h is the
  cheapest run, by a dollar or two; a new vendor holding our pictures
  for that is not worth it.
- **Commercial editors (Gemini, GPT-image)** for the cleanup. Rejected:
  their terms restrict training on their output.
- **Train on the A770.** Base fits 12 GB, but the trainers expect CUDA
  and the card's driver traps (`doc/infra.md`, Home GPU) are not worth
  fifty cents an hour.

### Revisit triggers
- The cleanup test fails Logan's eye: the set comes from filtering, or
  by hand, by amendment.
- The LoRA does not carry to the distilled klein, or costs likeness: the
  2026-10-15 trigger (a different base, by its own amendment).
- The look drifts toward the cleaned set's: the cleanups are re-read
  against klein-v1 before more are made.
- DigitalOcean's GPU price, limit or availability blocks a run: RunPod
  becomes the venue by amendment.

## Amendment (2026-10-23): the crew's cleaned paintings on the home section

The 2026-10-22 amendment confines Qwen-Image-Edit's cleanups to the LoRA's
training set. Logan, 2026-10-23: the crew's art goes on the site now, for
the Chicago shelters reading the consent email, so it cannot wait for the
LoRA. **A crew painting cleaned by Qwen-Image-Edit and approved by Logan,
one by one, may appear on the home section**, captioned as our own pets'
portraits. It is never a donor's card, and nothing in the donation path
repairs a painting after it is painted (decision 4 of 2026-10-15 holds).
When the LoRA lands, the crew is repainted by the production chain and
these are replaced. If the cleanup smears or regrows anatomy as LaMa and
klein did, the home section shows the photos alone.

**Outcome, the same day: none approved.** The first rented run
(`doc/plans/base-model-candidates.md`, "The Qwen-Image-Edit cleanup, first
run") removed the anatomy but repainted every painting's brushwork into
smooth airbrush; pasted back into a groin box only, the patch still read as
blur against the watercolour (Logan: "the blur looks way too unnatural
mixed with the art style"). Qwen-Image-Edit stays out of the home section,
and its output is not a training pair as it stands. Next, in order:
Normalized Attention Guidance on klein-v1, so the painter itself reads a
negative; then klein Base repainting a LaMa'd groin box with the negative
(the plan records both). The rental builds with `TORCH=cu130`, not
decision 3's `cu128`: PyTorch publishes torch 2.14.1 for CUDA 13.0 only
(`doc/infra.md`, GPU rental).

