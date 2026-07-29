# ADR-0001: Full-stack Next.js monolith, TypeScript end to end

## Context
Frontend is React/TS (SSR required — donors arrive via shared links; SEO and
link unfurls are the acquisition surface). Backend candidates: Rails, Phoenix,
Node. Solo developer, cost-conscious, résumé value matters (largest hiring
market), LLM/eval tooling needed later.

## Decision
One full-stack Next.js app: SSR pages + API routes in a single Node process,
plus a worker process (same repo, same types) for jobs and pollers. TypeScript
everywhere. Public pages use ISR; the shelter dashboard is client-heavy; JSON
API routes serve future non-React clients (Expo app).

## Consequences
- One deploy, one small host, shared types DB→UI; no API-boundary drift.
- Node is the ceiling for CPU-bound work — fine; heavy work (image gen) is
  external APIs, and web traffic is CDN/ISR-cached.
- Future mobile (Expo) reuses the API routes; SPA-style dashboards live
  inside the same app.

## Alternatives
- **Phoenix**: best runtime concurrency, but irrelevant at our load; LiveView
  (its real prize) is forgone by choosing React; niche hiring; weak LLM SDKs.
- **Rails**: fastest CRUD, but awkward as a JSON API behind separate React
  SSR; second language splits the stack.
- Both mean two services, two deploys, type duplication.

## Revisit triggers
- Sustained uncached load beyond a few hundred req/s per instance.
- A CPU-bound domain workload appears that can't be externalized.
