# ADR-0024: robots.txt is served by the app — search engines in, filtered browse and AI training out

## Context
Nothing answered `/robots.txt`, one of the most-requested paths on any site, so
every crawler got the app's 404. Search and link previews matter here: donors
arrive through shared links to animal pages, which is why those pages are
server-rendered (DIRECTION, ADR-0001). Two kinds of request do not help:

- **Filtered browse.** `/animals` takes `species`, `state` and an `after` cursor
  (ADR-0015 as amended 2026-09-03). Every species × state × cursor combination is
  a distinct URL showing animals already reachable unfiltered, and each is a
  per-request query on a 1 GB droplet.
- **AI-training crawlers.** An animal's description is the shelter's own text,
  displayed under RescueGroups' license or a shelter's grant (ADR-0006,
  ADR-0015). That license is for display; it does not extend to offering the text
  as training data.

## Decision
1. **The app serves it, as `src/app/robots.ts`** (a Next.js metadata route,
   statically generated at build). Not Caddy, and not Cloudflare's managed
   robots.txt: the file describes the app's routes, so it changes in the same
   commit as them, runs in dev and e2e, and needs no second config to deploy.
2. **Everyone may crawl everything except** `/api/` and browse views filtered by
   `species` or `state`. The unfiltered cursor (`?after=`) stays crawlable — until
   a sitemap exists, it is how a crawler reaches the detail pages.
3. **Named AI-training crawlers are disallowed site-wide**: GPTBot, ClaudeBot,
   CCBot, Google-Extended, Applebot-Extended, Bytespider, meta-externalagent.
   Link-preview fetchers and user-triggered assistants (a person asking an
   assistant to read a page) are never on the list. Sharing is how donors arrive.

## Consequences
- robots.txt is advisory: well-behaved crawlers honour it and others don't.
  Enforcement, if ever needed, is Cloudflare's AI-bot blocking at the edge, a
  dashboard setting that would be recorded in `doc/infra.md`.
- Google-Extended and Applebot-Extended are control tokens, not crawlers:
  disallowing them opts out of training without leaving Google or Apple search.
- New AI crawlers appear regularly; the list is a snapshot from 2026-10-01.

## Alternatives
- **Serve from Caddy** (the pattern where one proxy fronts many apps). Rejected:
  there is one app, and splitting its route policy across two configs means one
  of them drifts.
- **Cloudflare's managed robots.txt.** Rejected as the source of truth, because
  it is not in the repo. Still available as an edge layer on top.
- **Disallow all of `/animals?`.** Rejected for now: detail pages would be
  reachable only from browse page 1 until a sitemap exists.

## Revisit triggers
- A sitemap lands (ADR-0015 decision 2 already names one, built from
  `visibleAnimals`). Then disallow the cursor too, and add `sitemap:` here.
- A crawler's load shows up in the droplet's metrics. Then decide whether it is
  an edge block, not another robots.txt line.
- A shelter grant or a license term says something about training or indexing.
