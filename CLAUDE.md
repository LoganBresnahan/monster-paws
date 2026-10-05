# Monster Paws

Verified animal-shelter sponsorship: donors pick a real shelter animal, donate
(100% to the shelter via Every.org), and collect the animal's story — signed
care-event attestations, AI keepsake card art, an adoption-day "evolution."
Sponsorship with provenance, never "buy a slice of a dog."
**Mission: inspire joy** — the tiebreaker for every product decision.

**`doc/DIRECTION.md` is the source of truth for product intent** — the
collector loop, the aggregator growth model, money rails, bright lines, and
non-goals. Read it before product-level decisions; keep it updated when scope
changes. `doc/PLAN.md` is the superseded pre-pivot plan, kept for reference
only — do not build from it.

## Stack

- **Full-stack Next.js monolith, TypeScript end to end** — one Node process
  for SSR pages + API routes; a second worker process (same repo/types) for
  pg-boss jobs, the listings pollers, and image generation.
- **Postgres is the platform**: relational tables, append-only event log, raw
  API payloads (JSONB), full-text search, pgvector embeddings, and the job
  queue (pg-boss). No Redis, no separate vector DB below ~10M vectors.
- **Drizzle** ORM. **Cloudflare R2** for all images + the attestation
  flat-file mirror (DB stores keys only). **Every.org API** for donations —
  we never process payments or take a cut.
- Infra: DigitalOcean droplet (Docker Compose: Caddy / app / worker) + DO
  Managed Postgres (PITR) + Cloudflare free CDN. ~$22/mo. Serverless hosts
  are disqualified — the poller/queue need an always-on process.
- Image pipeline: style LoRA × per-image identity conditioning (IP-Adapter
  class), developed in ComfyUI and run on a GPU in Logan's home — the same
  pg-boss worker, registered for `art.generate` only, beside a headless
  ComfyUI, both CI-built containers in a WSL distro under a dedicated
  Windows account with scoped credentials, behind a provider interface with
  Replicate as the escape hatch (ADR-0004 as amended 2026-10-05, ADR-0007 as
  amended). Development never happens on that account. Generate **only on donation**, never per listing; art arrives
  when it is ready, never "instantly". CLIP-similarity auto-QC picks best of
  3–4.
- Client state: **Zustand** (Logan's preference, proven on Carton-Fit) for
  interactive client islands (dashboard queue, donation-flow UI) — server
  data lives in Server Components, not client stores. Next.js caveat: no
  module-level stores for per-user state (module scope is cross-request on
  the server) — instantiate via a context provider. Dependency ADR lands
  with the first store.

## Non-negotiable domain rules

- **Append-only data.** Raw payloads and event-log rows are never UPDATEd or
  DELETEd — corrections are new rows. The corpus is the asset.
- **Embeddings are derived data**: every vector row carries `embedding_model`;
  the column is rebuildable from raw corpus, never backed up as sacred.
- **Trust hierarchy** for animal facts: shelter API (verified) >
  consented first-party scrape > aggregator APIs; conflicts resolve by tier,
  then recency; every fact stores source + fetched_at. Tiers are named and
  ordered (ADR-0006 as amended) — persist the tier name, never its rank.
- **Bright lines** (see DIRECTION.md): no rarity tiers on animals, nothing
  tradeable ever, no dark-pattern pressure, no programmatic ads, generated
  donor text never claims care that isn't attested.
- **The donor feed is a projection, never the ledger** (ADR-0020). Nothing
  donor-facing reads `event_log`; `animal_story` is derived, rebuildable, and
  written only by its projector, with the evidence tier persisted by name. An
  absence from a feed is never an outcome.

## Infra ops

`doc/infra.md` is the runbook: CLI roster (doctl / wrangler / CF API /
rclone / gh), provisioning commands, recurring ops, and the ASCII deployment
diagrams. Change the deployment shape → update the diagrams in the same
commit.

## Conventions

- Documentation lives in `doc/`. `doc/roadmap.md` tracks build order
  (frontier = first unchecked item); check items off as they ship. Dogfood
  findings go in `doc/issues.md` (ADR-0019) — never left in chat — and are ALSO
  pinned to the roadmap or a plan as a carry-in when they block a slice or
  change what we build next; entries are deleted when fixed, never ticked.
- **Process and data flows are ASCII diagrams in `doc/flows.md`** (ADR-0012),
  one per flow, each citing its ADR, every box naming a real symbol or table,
  unbuilt stages marked `(planned, …)`. Change a flow's shape — a stage, a
  boundary, an external call — and update its diagram in the same commit,
  exactly as `doc/infra.md` does for the deployment shape. ADRs link to
  flows.md; they don't embed diagrams. Not every ADR has a flow; draw only
  what has stages and boundaries.
- **Production operations go in `doc/oplog/`** (ADR-0023): one numbered
  entry per operation, written and committed as `planned` *before* touching
  production, filled in while running, then frozen — a correction is a new
  entry. `/deploy` writes one every time. Same public-repo rules as
  `doc/infra.md`: `$IP`, `$(pass show …)`, redacted output.
- **Every decision gets an ADR** in `doc/adr/NNNN-slug.md` (Nygard style:
  Context / Decision / Consequences / Alternatives / Revisit triggers). New
  dependency, changed contract or algorithm, pattern adopted or rejected —
  that's a decision. Implementation detail is not. Supersede rather than
  rewrite. Build plans derived from ADRs live in `doc/plans/`.
- **`ADR-NNNN` is the link between `doc/` and everything else.** Write it in
  that exact form — never "per the ingestion ADR" — in code comments, commit
  subjects, test names, and plan docs. It only works as a grep target if it's
  uniform. That makes both directions one command: `grep -rn "ADR-0009" src/`
  finds the code a decision governs; `git log --grep 'ADR-0009'` finds the
  commits that shipped it. Don't maintain SHA lists inside ADRs — a SHA is
  fine as *provenance* (a thing that happened once: a superseding decision, an
  incident, a workflow run), never as an *index* that must stay current.
- **Comments state what the code can't show, and cite the decision.** A
  comment earns its place only if it carries one of: an **invariant** and its
  `(ADR-NNNN)`; the **trap** (what silently breaks if this changes); a
  **sanctioned exception** where code appears to violate a house rule but is
  allowed (e.g. the `last_seen` touch on an append-only table); or **fixture
  provenance** (who hand-checked this expected output, when, from which
  snapshot — an unattributed golden fixture is unfalsifiable). Write
  invariants as prohibitions ("never UPDATE — corrections are new rows"), not
  labels; they survive being read out of context in a diff or grep hit. Put
  them at the point of temptation, not in a file header — readers, human and
  agent alike, arrive mid-file. Keep to one sentence plus the citation: the
  ADR is the source of truth, and a comment that restates its reasoning
  becomes a second copy that drifts. No narration of what the next line does,
  no change-log prose ("now also handles X"), no restating the type, no
  section banners, no bare `TODO` — deferred work is a roadmap carry-in.
  `src/db/schema.ts` is the reference example.
- Test pyramid: **vitest** for units (entity resolution, attestation
  sign/verify, trust-hierarchy merge, eval scorers), **Playwright** e2e for
  the donor and shelter flows, **dogfooding** after every deploy — real
  browsing, a real test donation, a real confirm click. Golden fixtures
  (sample listing payloads with hand-checked canonical outputs) are shared by
  unit and e2e suites.
- The two eval harnesses are product code, not scaffolding: text faithfulness
  (donor updates vs. attestations) and image likeness (CLIP score vs. real
  photos). Changes to generation prompts/models must run the harness before
  ship.

## Skills & workflows

- `/orient` — session-start bearing: commits + roadmap + docs reconciled
  against memory. Read-only.
- `/shipshape` — pre-commit verification: tests green twice, docs current,
  conventions hold.
- `/deploy` — ship bar → build → e2e against the production build → roll onto
  the droplet with rollback kept → smoke prod → dogfood handoff.
- `adr-plan` workflow (`.claude/workflows/adr-plan.js`) — decompose an
  accepted ADR into an effort-ranked, dependency-ordered build checklist
  before implementing it.
- **Visual review** — UI is looked at together in a headed browser driven
  through the Playwright MCP server: the window opens on Logan's Windows
  desktop via WSLg, so both of us see the same page and either can drive.
  Setup, once per machine (local scope, never committed): write
  `~/.config/playwright-mcp/monsterpaws.json` as
  `{"browser":{"browserName":"chromium","launchOptions":{"args":["--ozone-platform=wayland"]}}}`,
  then `claude mcp add playwright -- npx -y @playwright/mcp@0.0.83 --config ~/.config/playwright-mcp/monsterpaws.json`
  and `npx -y -p @playwright/mcp@0.0.83 playwright install chromium`. The
  Wayland flag is load-bearing: as an X11 window under WSLg, Chromium shows no
  hand cursor and opens on a display Windows never shows. Emoji
  that render as empty boxes are a missing WSL font, not an app bug: unpack
  Ubuntu's `fonts-noto-color-emoji` into `~/.local/share/fonts` (`apt download`
  + `dpkg -x`, no sudo), run `fc-cache`, and restart the browser. Screenshots
  land in `.playwright-mcp/` (gitignored). Findings go to `doc/issues.md`
  (ADR-0019), never left in chat; a fix worth guaranteeing gets an e2e spec.
  The desktop app's built-in browser is not an option — it cannot open a
  folder that lives in WSL.

## Commands

- `npm run up` — cold start in the safe order: `db:up` → `env:dev` →
  `db:migrate` → poll+dump in the background if the corpus is older than the
  visibility window → `dev`. Run this after any time away
- `npm run dev` — Next.js dev server (port 3000)
- `npm test` — vitest units in `tests/` (run twice for the ship bar). Creates
  and migrates `monsterpaws_test` itself (ADR-0017); it never touches the dev
  database, and it FAILS rather than skips when Postgres is unreachable —
  `SKIP_DB_TESTS=1` runs only the unit suites
- `npm run typecheck` — tsc, no emit
- `npm run e2e` — builds, then Playwright seeds `monsterpaws_e2e` through the
  real pipeline and runs `e2e/` against the standalone production server on
  :3100 (ADR-0017 as amended); `npm run e2e:prod` reuses the specs against an
  already-running server via `PW_BASE_URL`, which must read that same
  database — a canary fails the run if it doesn't
- `npm run build` / `npm start` — production build / serve
- `npm run env:dev` — scaffold `.env` from the example and fill the secrets
  kept in `pass` (idempotent; never overwrites a set value)
- `npm run worker` — the pg-boss worker process (needs `DATABASE_URL`)
- `npm run ingest -- poll [--max-pages N]` / `npm run ingest -- replay <source>`
  — one-shot ingest through all five stages, or stages 2–4 over the corpus;
  `--max-daily-disappearance R` raises the stage-5 gate for one run a person
  has checked (ADR-0014 as amended)
- `npm run db:up` — local Postgres via `docker-compose.dev.yml`
  (pgvector/pg16 image — same extensions as production)
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations
- `npm run db:dump` — gzipped `pg_dump` of the dev database to `var/dumps/`;
  run it after a full poll, because that corpus is currently the only copy
  (ADR-0017)
- Env: `npm run env:dev` (or copy `.env.example` → `.env` by hand); keys are
  commented with the roadmap item that needs them. Next.js reads `.env`
  itself and the tsx scripts load it via `--env-file-if-exists`, so nothing
  needs exporting into the shell.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
