# ADR-0004: Keepsake art = style LoRA × identity conditioning; generate on donation only

> Amended by ADR-0006: art generates only from photos we hold rights to
> (verified shelters). Unverified-shelter cards show the framed real photo;
> AI art unlocks at verification. Self-amended 2026-08-02: weights licensing,
> photo disclosure, self-hosting (below). Self-amended 2026-10-05: inference
> runs on a GPU in Logan's home, ComfyUI is the workbench, art arrives when
> it is ready; same-day addendum: the home worker is isolated under its own
> Windows account and packaged as CI-built containers (below).

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
   if XPU inside WSL fights us. "ComfyUI at a URL" is one provider behind
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
10. **Its own WSL distro, on the second M.2.** The drive's Linux dual boot is
    retired (production that only runs while Logan is booted out of Windows
    is production that is off) and the whole disk is the prod user's: the
    distro's disk image, the models volume, its swap. The distro mounts no
    Windows drive and has interop off. WSL VMs are per user, so the dev and
    prod distros never meet. Memory caps, each in its owner's WSL config:
    prod 24 GB (ComfyUI stages models through RAM; offloaded text encoders
    make FLUX-class inference fit the A770), dev 16 GB, the rest of the
    64 GB to Windows.
11. **Worker and headless ComfyUI are CI-built containers** (ADR-0007 as
    amended 2026-10-05), run by a plain docker engine inside the distro under
    systemd — never Docker Desktop, which needs an interactive login. Custom
    nodes are pinned in the image; models are a volume, downloaded at first
    start and verified against the committed hash list, never baked in. The
    PyTorch wheel is a build argument — `xpu` for the Arc, `cuda` for
    everything else — and the rest of the image is identical, which is what
    makes decision 8's escape hatch real: Replicate's cog and RunPod take the
    CUDA variant of an image CI already builds. Inside WSL the container
    reaches the Arc through the host's GPU device and driver libraries.
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
created yet), the second deploy target in the CI diagram, and a provisioning
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
- The unattended WSL distro proves unreliable (a job waits because the
  distro was not running, not because the box was asleep) — that is the
  dedicated box's cue, prices or not.
