# 0004: Deploy `c45e085` — link previews, the profiles in the footer, the outreach schema

Status: planned
Planned: 2026-10-27 · Run: —
Why: ADR-0030 (every page sends a card; the launch post waits on it), ADR-0032
as amended (the four profiles in the footer, "Donations coming soon!"),
ADR-0029 phases 1–6 (`outreach_events`, `shelter_nonprofits.everyorg_claim`
and `claim_checked_at`, `shelter_contacts`; the outreach CLI runs from dev and
nothing on the droplet reads these yet), ADR-0022 as amended 2026-10-27,
ADR-0031 (docs and a dev script); roadmap: Launch (3b), Shelter consent (5)
Commit deployed: `c45e085` (15 commits on `a2610f5`, oplog 0003)

What changes on the droplet: the app and worker images (Open Graph and Twitter
card tags from the root layout, the `/opengraph-image` route, the footer's four
profile links and new tagline, the `SHELTER_EXCLUSIONS` list inside
`visibleAnimals`, empty today); three additive migrations, `0012`–`0014` (two
new tables, two columns with defaults, no row touched); no `.env` change (the
Every.org key and the Gmail pair are dev-only), no compose, Caddy or DNS
change. First push with CI's `verify` running a Mailpit service (phase 1).
Cloudflare does not cache HTML here, and the image route is new, so no purge.

## Prerequisites
- [ ] Working tree clean at `c45e085`; ship bar on it: vitest twice, typecheck.
- [ ] Pushed; CI green on `c45e085`: `verify`, `images`, `sourcemaps`.
- [ ] e2e against the published app image (`npm run e2e:prod` on
      `ghcr.io/loganbresnahan/monster-paws-app:c45e085…`) — the first run of
      `e2e/previews.spec.ts` and the footer assertions on the production image.
- [ ] Migrations `0012`–`0014` rehearsed: `drizzle-kit migrate` on a scratch
      database restored from the 2026-10-26 dump (`var/dumps/`), then dropped.
- [ ] `pass` unlocked (the DO token, for the droplet's address).
- [ ] Not within an hour of 07:00 or 08:30 UTC.
- [ ] The dev box free: no batch on the card, nobody on `:3100`/`:3200` or
      `monsterpaws_e2e`.

## Steps

### 1. Record what is running — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && grep ^IMAGE_TAG .env && git log --oneline -1 &&
      docker exec monsterpaws-worker-1 sh -c "echo SELECT count\(\*\) FROM drizzle.__drizzle_migrations" >/dev/null; true'
    curl -fsS https://monsterpaws.org/api/health
Verify: `IMAGE_TAG=a2610f5…`, checkout `a2610f5`; health 200 with that sha and
a fresh `lastCompletePollAt`.
Rollback: n/a — this is the record.

### 2. Pull the release, one SSH session; nothing restarts
    ssh root@$IP 'cd monsterpaws && git pull --ff-only &&
      sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<sha>/" .env &&
      docker compose -f docker-compose.prod.yml pull app worker &&
      docker compose -f docker-compose.prod.yml config --images'
Verify: checkout `c45e085`; both images resolve to `<sha>` and are pulled;
app and worker still running `a2610f5`.
Rollback: `IMAGE_TAG` back to `a2610f5…`, `git checkout a2610f5` — nothing is
running from the new images yet.

### 3. Migrate, while the old images serve
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml \
      run --rm worker npx drizzle-kit migrate'
The three are additive, so the running `a2610f5` code is unaffected: it never
reads the new tables or columns.
Verify: "migrations applied successfully"; 15 rows in
`drizzle.__drizzle_migrations`; `outreach_events` and `shelter_contacts` exist,
`shelter_nonprofits` has `everyorg_claim` and `claim_checked_at`; health still
200 on `a2610f5`.
Rollback: forward only — nothing depends on undoing them and the old image runs
with them in place. (The undo, if ever wanted, is the three statements'
inverses in a new entry.)

### 4. Switch
    ssh root@$IP 'cd monsterpaws && docker compose -f docker-compose.prod.yml up -d app worker &&
      sleep 8 && docker compose -f docker-compose.prod.yml logs --tail 20 worker'
    curl -fsS https://monsterpaws.org/api/health
Verify: app and worker run `<sha>`; the worker logs `ingest.poll registered`;
health 200 with `c45e085…`, `lastCompletePollAt` under 27 h; caddy untouched.
Rollback: `IMAGE_TAG` back to `a2610f5…`, `up -d app worker`.

### 5. Smoke
    for p in / /animals /claim /demo /demo/ducky /opengraph-image; do curl -s -o /dev/null -w "$p %{http_code} %{content_type}\n" https://monsterpaws.org$p; done
    curl -s https://monsterpaws.org/ | grep -o '<meta property="og:[a-z:]*" content="[^"]*"' | head
    curl -s https://monsterpaws.org/ | grep -o 'href="https://[^"]*\(linkedin\|x\.com\|bsky\|youtube\)[^"]*"'
Verify: 200 for every page and an animal page; `/opengraph-image` is
`image/jpeg`; the home page carries `og:title`, `og:description`,
`og:site_name`, `og:image` (absolute, under monsterpaws.org) and the animal
page the same with its own title; the four profile hrefs render; no `og:url`.
Rollback: step 4's.

### 6. Dogfood handoff (Logan)
LinkedIn Post Inspector on `https://monsterpaws.org` and on one animal page
(the Beetle card, the page's own title); the footer on a phone; an animal
page cold; the X card on `https://monsterpaws.org` by pasting it in a draft.

## Run
(filled on the day)

## Follow-ups
(filled on the day)
