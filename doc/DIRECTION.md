# Monster Paws — Direction

*Supersedes PLAN.md (kept for reference). The product framing here comes from the
501(c)(3) / verified-sponsorship conversation; only a few pieces of the old plan
survive. Tech stack is deliberately left open — it will be chosen fresh.*

---

## What this is now

**Verified sponsorship with provenance, not "buy a slice of a dog."**

Donors browse animals, choose one, and donate. The money goes to that animal's
shelter (the shelter may spend it on any animal — no earmarking pretense). In
return the donor gets, for **the remainder of that animal's stay**:

- **Provenance-backed updates** — care events backed by cryptographically
  signed attestations from the shelter (and ideally co-signed by the vet),
  delivered as a weekly-ish digest and ending in the payoff moment: *"Biscuit
  was adopted today. You were part of that."* The stay is a story with an
  ending; the adoption "graduation" is the most shareable, retention-driving
  moment the product has.
- **AI keepsake art** — one generated image immediately after donating (the
  thank-you dopamine hit and the viral share loop), and a second "gotcha day"
  portrait at adoption. Both live permanently in the donor's account.

The shelter's pitch-facing value is **donor retention**: donors who see what
they funded come back.

The word "blockchain" never appears in shelter- or donor-facing language. The
substrate is an implementation detail: attestations are signed claims
("Lakeshore Animal Shelter asserts Biscuit received a dental on 2026-03-14,
cost $340"), and only a **hash** of each claim gets anchored publicly — cheap,
private, verifiable even if the app dies.

### What died from the old plan

- NFTs as the product, "tokenizing" framing, minting flows, collection pages
- Thirdweb wallets, Base smart contract with donation escrow, Stripe relayer minting
- Monster Paws as a payments middleman

### What survives

- **AI art generation** (Replicate-hosted Stable Diffusion → maybe self-hosted
  later) — reframed as a **keepsake/thank-you artwork** for sponsors, not an NFT.
  The provider-interface/adapter pattern from the old plan is still the right shape.
- The general domain model (shelters, animals, sponsors, care events) — reshaped
  around attestations instead of tokens.

---

## Design principles

1. **Don't become a payments company — and never take a cut.**
   **100% of every donation goes to the shelter, always**, via
   **Every.org as the fiscal rails** — free, API-first, handles receipting
   and disbursement to any US 501(c)(3) shelter. No operations cut, ever:
   it's the cleanest trust story on a site about proving where money goes,
   and it defuses the aggregator consent problem (hard to be mad at someone
   sending you free money and keeping none). Operations are funded by an
   **optional donor tip at checkout** (the Every.org/GoFundMe pattern —
   default modest, easy to zero), with curated local sponsorship (vet
   clinics, pet stores — NPR-style underwriting) as a later option. **No
   programmatic ads** — the RPM math doesn't cover the bills and banner ads
   next to shelter dogs undercuts the trust the attestation layer exists to
   build. Form our own 501(c)(3) (formation, 990s, state
   charitable-solicitation registration) only if/when a legal entity is
   actually needed.
2. **Read-only sidecar; zero workflow change for shelters.** Shelters keep
   Shelterluv/PetPoint/ShelterBuddy as the source of *data entry*; our app is
   the source of *verification*. We poll their API, diff, and detect new care
   events. Shelters are volunteer-run: anything requiring daily action fails.
   Attestation must be a byproduct of work they already do. Shelters without a
   supported system get a manual "add care event" form — more friction, but no
   shelter is excluded, just tiered.
3. **One weekly click.** The shelter's entire ongoing effort: log into the
   dashboard, review the queue of detected care events, one "confirm all"
   click → the batch is signed and attestations publish. That click is also
   the natural donor-update cadence — updates flow when confirms happen, so
   donors get a weekly-ish digest without a separate scheduling decision.
4. **Vet co-signing is the trust upgrade.** A vet-signed medical event is far
   stronger than shelter self-reporting — it's the defense against manufactured
   or inflated care claims.
5. **No speculation surface.** Nothing is tradeable. Sponsorship, not ownership.

---

## The attestation model

- An attestation = "Party X asserts fact Y was true at time T," signed with X's
  key. Attributable and tamper-evident, same shape as a signed git commit.
- On-chain (or any public anchor): hash only. Off-chain: the claim payload.
- Verification works without trusting our database or our continued existence.

## Shelterluv integration facts (known constraints)

- Key-based auth, `X-Api-Key` header; endpoints include all-animals-by-status.
- Shelter admin generates the key themselves (Configuration → Integrations,
  after Shelterluv support enables it).
- Developer must request API spec access and be **approved by Shelterluv, with
  the shelter cc'd** → the very first real task is a conversation, not code.
- Data refreshes ~every 30 minutes, **no webhooks** — poll and diff.
- Precedent exists: Maddie's Pet Assistant, Finding Rover, Doobert, Shelter
  Animals Count all integrate this way.

---

## The pitch (to a local shelter)

> I'm a local software engineer with two rescue dogs. I'm building a free tool
> that shows donors exactly what their money paid for — the dental, the boarding
> week — and proves it. It reads from your Shelterluv account, so there's no new
> system and no data entry. All I'd need is one person clicking "confirm" once a
> week. If it doesn't work, you've lost twenty minutes total. Can I show you a
> demo?

Key moves: local and personal, free stated early, no new system, one click
quantified, explicit cheap exit, no "blockchain." The business case for them is
retention, not new donors.

---

## Product experience: the creature-collector loop

Cuddly proves the aggregation model but feels corporate — e-commerce checkout
with sad photos. Monster Paws restructures the same actions around **collection
psychology**:

- **Encounter** — browse real adoptable animals near you (the aggregator is
  the tall grass).
- **Catch** — sponsor one; the AI keepsake art generates and the animal's
  *card* joins your collection.
- **Bond** — attestation-backed updates are the card's story unfolding; the
  card accumulates its history.
- **Evolve** — adoption day: the card transforms into its "gotcha day"
  version. The evolution is a *real event in the world* — no game can offer
  that. Your collection becomes a shelf of happy endings you helped fund.

Extensions: milestone badges (first sponsorship, five adoptions witnessed,
"hard cases" badge for long-stay seniors), shareable trainer-card-style
profile, seasonal card frames. The share moment — "look who I just sponsored"
with a beautiful card — is the viral loop.

This promotes the **fine-tuned LoRA "Monster Paws look"** from afterthought to
core brand asset: a collector aesthetic requires every card to be
unmistakably from the same set.

**Three bright lines** (gamifying real animals is walking a ridge):

1. **No rarity tiers on animals.** Never rank living creatures by
   desirability. Rarity, if any, attaches to donor *actions* (badges,
   milestones). If anything, invert it: long-stay, senior, and special-needs
   animals get the most celebrated cards.
2. **Nothing tradeable, ever.** Cards are memories, not assets — this is what
   keeps "collect" from sliding back into "own a slice of a dog."
3. **No dark-pattern pressure.** No streaks, FOMO timers, or scarcity
   prompts. Collection joy, not gacha compulsion — a 501(c)(3) using casino
   mechanics on shelter dogs is a devastating headline.

Framing that keeps every design decision honest: **you're not collecting
dogs, you're collecting rescue stories** — every card is one you helped write
the ending of.

## Growth model: the aggregator flip

Don't wait for shelter partnerships to have supply. Seed the site with every
shelter's **public adoptable listings** via **RescueGroups.org** — the sole
viable aggregator (ADR-0006: Petfinder's API died 2025-12, Adopt-a-Pet is
partner-contract-only; RescueGroups is free, syndication-friendly, per-org
opt-in), and let
donors browse and give to *any* animal from day one: Every.org can route a
donation to essentially any US 501(c)(3) without that shelter having heard of
us. Donations work before partnerships exist.

The aggregator then becomes the **shelter acquisition funnel**. Outreach stops
being a cold pitch and becomes: *"Three of your supporters donated $75 through
Monster Paws this month and want verified updates on the animals they sponsored —
want to turn that on? Free, one click a week."* Verification is the upgrade
tier shelters claim (visible badge; attestation-backed update promise), and
donors asking their local shelter why it isn't verified is the flywheel.
Precedent: Cuddly proved shelter donation aggregation works — nobody has the
provenance layer. That layer is the differentiation; the aggregator is the
distribution.

Known risks, with mitigations:

1. **Listing-API terms** (RESOLVED — ADR-0006). RescueGroups conditions:
   candid API-key application describing the donation/keepsake model,
   Tracker pixel on pet detail pages, ≥weekly refresh, per-org/per-animal
   opt-outs honored, and on termination a purge of all derived data —
   hence source-tagged, set-deletable RescueGroups rows (the one exception
   to append-only). Petfinder's 2025 API shutdown is the standing case
   study: aggregators are expendable enrichment; shelter relationships are
   the foundation.
2. **Consent optics.** A shelter finding its animals on a donation site it
   never agreed to can read as exploitation. Mitigations: 100% of every
   donation goes to the shelter — Monster Paws never takes a cut (ops funded by
   optional donor tip); prominent "not affiliated — claim your shelter"
   framing (the Google Business / Yelp pattern); instant opt-out.
3. **Stale data.** Aggregated listings refresh on the source's schedule.
   Show "last updated" honestly; if a donated-to animal was already adopted,
   the money still went to the shelter — "she was adopted; your donation
   helps the next one."
4. **Tiered promise.** Only verified shelters deliver attestation-backed
   updates; copy on unverified animals must promise less ("your donation goes
   to Shelter X") without feeling like bait-and-switch.

If the aggregator is viable, the "demo" and product v1 collapse into the same
build.

### Data ingestion: tiered sources with a trust hierarchy

Two source tiers (ADR-0006): **Tier 1 — shelter-issued keys**
(Shelterluv, Petango/PetPoint), obtained through the shelter relationship
with art/data rights in our direct agreement; **Tier 2 — RescueGroups**,
the sole aggregator. Each source is an adapter writing raw payloads
append-only (RescueGroups rows source-tagged and set-deletable per its
ToS). An animal can appear in both tiers → a normalizer with **entity
resolution** (fuzzy match on shelter + name + breed + photo similarity)
produces one canonical animal record with per-field provenance.

Scraping for ground truth: **selective, not universal** — only for
verified/claimed or high-traffic shelters. The cheat: most shelter sites
embed **Shelterluv/PetPoint hosted listing widgets** with uniform markup, so
one scraper per *platform* (not per site) covers a big chunk of shelters and
sits closer to the source than aggregators. Respect robots.txt and rate
limits.

**Trust hierarchy** (conflicts resolved by tier, then recency; every fact
stored with source + fetched_at):
shelter's own system via API (verified partners) > platform-widget/site
scrape > aggregator APIs.

### The data corpus

The aggregator also answers where RAG data comes from: **organize and index
every pet and its data** — listings across sources, histories, statuses,
photos, bios, plus our own care events and attestations for verified
shelters. Collect and index first; figure out how to act on it (almost
certainly via AI) once the corpus exists. This is the same append-only,
never-overwrite discipline as the event log: the corpus is the asset even
before the use case is chosen.

## Image pipeline: likeness × style

The hard problem is **likeness, not style** — a beautiful card that doesn't
look like *that specific dog* is a broken product moment. Architecture: two
conditioning signals composed —

- **Style LoRA**, fine-tuned once on the card aesthetic (the "Monster Paws look"
  brand asset), and
- **Per-image identity conditioning** from the animal's actual shelter
  photos (IP-Adapter / image-conditioned models like Flux Kontext). Never
  per-animal fine-tuning (DreamBooth-per-dog is economically absurd).

Runs on **Replicate** behind the provider interface (they host LoRA training
and inference; pennies per image). Locked-in design consequences:

1. **Generate only on donation, never per listing.** At aggregator scale,
   pre-generating art for hundreds of thousands of animals is real money for
   zero value — and the card being created *for you* at sponsorship is the
   pack-opening moment.
   **Art-rights gate (ADR-0006):** generation uses only photos we hold
   rights to. Photo **consent** (one email of written permission) unlocks
   AI art — separate from, and cheaper than, **verification** (attestation
   signing). No-consent cards show the real photo in the Monster Paws
   frame; monster art unlocks at consent, and the card credits it:
   *"Permission to digify <pet> given by <shelter>."* The AI pipeline is
   built and run internally from day one, but **no generated art ships in
   production without consent on record**.
2. **Auto-QC via embedding check:** generate 3–4 candidates, score against
   real photos with CLIP-style similarity, serve the best, flag low scorers.
   This is a small automated eval harness for a generative pipeline — the
   eval story's second chapter alongside text faithfulness.

**3D (Meshy/Tripo image-to-3D) is parked, socket left open:** a rotating 3D
"gotcha day" card is a spectacular evolution upgrade later, but 3D likeness
fidelity is shaky and it's expensive polish pre-PMF. It slots in as another
style behind the provider interface when ready.

## The LLM surface (and the career layer)

There is no retrieval-heavy problem here yet — don't design for RAG
speculatively. The genuine LLM surface is **update generation**: turning a
confirmed care event plus the animal's history into the warm two-paragraph
update donors actually read. Around it, an **eval harness**: a faithfulness
suite guaranteeing generated text never claims care that isn't attested —
hallucinated medical claims are the catastrophic failure mode, which makes it
a *real* eval problem, not a toy one. Measure it, track it, write it up.

That harness is the portfolio piece closing a résumé gap (evals). If a real
RAG need emerges later (e.g., donor-facing "ask about Biscuit's history"),
take it then — it's a component, not a pillar.

---

## Sequencing

0. **ToS research (blocking).** Read Petfinder, RescueGroups.org, and
   Adopt-a-Pet API terms; pick the aggregation backbone.
1. **Demo weekend → v1 seed.** Pull real local shelters' public adoptable
   listings (via the chosen API) and render their actual animals in the
   sponsor-page UI with sample attestations and generated keepsake art. Real
   dogs convert ~10x better than mockups — and if aggregation is viable, this
   demo *is* the v1 supply side.
2. **Outreach.** The pitch above to one local shelter for the verified tier —
   warmed by any donations already flowing to them through the aggregator.
   Goal: a demo meeting and their willingness to request Shelterluv API access.
3. **Integration.** Shelterluv approval → poller → care-event diffing.
4. **Attestation pipeline.** Shelter keys, weekly batch-confirm flow, hash
   anchoring, public verification page.
5. **Donation flow.** Every.org integration; instant keepsake image on donate.
6. **Update generation + evals.** LLM-written donor updates with the
   faithfulness harness; adoption "graduation" moment.
7. **Vet co-signing** once one shelter is live and trusts the flow.

## Tech stack

Decisions made:

- **TypeScript end to end; full-stack Next.js monolith.** One Node process
  serves the server-rendered React frontend *and* hosts backend logic
  (Every.org calls, attestation signing, DB access) — one repo, shared types,
  one deploy. The poller and job workers run as plain Node processes alongside
  it, sharing code. Rails/Phoenix were considered and rejected: SSR React
  already requires a Node server, so a second backend language means two
  services, type drift, and double ops; Phoenix's concurrency edge is
  irrelevant at this load profile and its LiveView prize is forgone by
  choosing React; TS also has the strongest LLM/eval SDK ecosystem and the
  best résumé math.
- **Per-surface rendering:** public animal pages are server-rendered
  (SEO + link unfurls); the shelter dashboard can be as client-side as it
  wants; JSON API routes exist for non-React clients (the future Expo app).
- **Postgres + Drizzle (or Prisma).** Background jobs via a
  **Postgres-backed queue (pg-boss or Graphile Worker), not BullMQ** — kills
  the Redis line item; Postgres-as-queue is bulletproof at this scale.
- **Web-first, server-rendered React.** Donors arrive via shared links to
  animal pages (Facebook posts, texts) — SEO and link previews demand SSR.
  React over Svelte because it's the market's lingua franca (résumé value) and
  keeps the Expo door open.
- **Ship as a PWA** (manifest + web push for opted-in sponsors; iOS push works
  since 16.4 but requires add-to-home-screen).
- **Native app (React Native / Expo) is a milestone, not a starting point** —
  justified by stay-long update notifications, built when active sponsors make
  iOS push friction measurably costly. Expo Router + shared types make it a
  lane change, not a rewrite.
- **Donations via Every.org API** — no payment processing of our own in v1.
- **Append-only data collection from day one.** Raw Shelterluv payloads kept
  verbatim (JSONB, never overwritten) plus a proper event log of every care
  event, confirm, donation, and update sent — not just current-state tables.
  Storage is ~free at this volume, and this immutable history is the future
  RAG corpus; you can't retroactively collect data you overwrote. It also
  matches the attestation model — signed claims are already immutable events.
## Infrastructure (~$30/mo all-in)

- **Domain: monsterpaws.org** — registered at Cloudflare Registrar
  (2026-07-29). DNS, CDN, and R2 all live in the same Cloudflare account.

- **DigitalOcean droplet** (2vCPU/4GB, ~$12/mo) running Docker Compose:
  Caddy (auto-HTTPS reverse proxy), the Next.js app, and the worker process
  (pg-boss jobs, Shelterluv poller, image gen). Deploys via a small GitHub
  Action (SSH + `docker compose up -d --build`).
- **Cloudflare free tier in front:** CDN, DNS, TLS at edge, DDoS. Public
  animal pages are ISR-cached (listings change ~every 30 min — matches the
  poll interval), so most traffic never touches Node. A single small box
  behind a CDN serves millions of pageviews/month; uncached SSR alone is
  ~100–500 req/s on 2 vCPU. Bottlenecks will be Postgres and workers, not
  web traffic.
- **Not serverless:** Vercel and Cloudflare Workers/Pages both disqualified —
  the poller and job queue need an always-on process, and serverless pricing
  punishes exactly that workload. Cloudflare's role is CDN + R2 only.
- **DO Managed Postgres (~$15/mo)** — the one component not to self-manage:
  automated daily backups + point-in-time recovery for the irreplaceable
  append-only corpus. Holds everything: relational tables, event log, raw
  JSONB payloads, full-text search, and **pgvector embeddings**.
- **The RAG index is Postgres.** pgvector (HNSW) + built-in FTS = hybrid
  search (vector + keyword, fused) in the same transactional system as the
  source of truth — index and data can't drift, one backup covers both.
  Dedicated vector DBs (Pinecone/Qdrant/Weaviate) don't earn their bill
  below ~10M vectors; revisit only then. Discipline: **embeddings are
  derived data** — store `embedding_model` alongside each vector, treat the
  column as rebuildable from the raw corpus, re-embed via batch job when
  models improve. Sacred: raw payloads, event log, attestations. Disposable:
  everything derived.
- **Cloudflare R2 (~$1–5/mo):** all images (originals + generated card art) —
  zero egress fees, so a viral share spike costs nothing. DB stores keys
  only. Same bucket also holds the **attestation mirror**: signed attestation
  payloads as plain flat files, so claims stay verifiable even if our
  database or org ceases to exist.
- **Belt-and-suspenders:** weekly `pg_dump` to R2 in addition to DO's managed
  backups — one copy of the DB outside DO's ecosystem entirely.

Still to build within that stack:

- Key management + signing/verification (shelter keys, later vet keys)
- A poller (no webhooks from Shelterluv) and event diffing
- Image generation via a provider interface (Replicate first)
- An LLM update-generation pipeline with a faithfulness eval harness around it
