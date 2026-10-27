# 0004: Deploy `c45e085` — link previews, the profiles in the footer, the outreach schema

Status: run
Planned: 2026-10-27 · Run: 2026-10-27 21:16 – 21:27 UTC
Why: ADR-0030 (every page sends a card; the launch post waits on it), ADR-0032
as amended (the four profiles in the footer, "Donations coming soon!"),
ADR-0029 phases 1–6 (`outreach_events`, `shelter_nonprofits.everyorg_claim`
and `claim_checked_at`, `shelter_contacts`; the outreach CLI runs from dev and
nothing on the droplet reads these yet), ADR-0022 as amended 2026-10-27,
ADR-0031 (docs and a dev script); roadmap: Launch (3b), Shelter consent (5)
Commit deployed: `c45e085` (15 commits on `a2610f5`, oplog 0003; CI run 40585352995: verify, images, sourcemaps green)

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
**Prerequisites.** Tree clean at `c45e085`; ship bar: vitest 409/409 twice,
typecheck clean. Pushed `c45e085` to `topdog` 21:16 UTC (16 commits on
`a2610f5` counting this entry, which followed in its own push so the image
tag matches the planned sha); CI run 40585352995. Rehearsal: the 2026-10-26
dump restored into `monsterpaws_rehearsal` (112,123 animals, 12 migrations),
`drizzle-kit migrate` applied `0012`–`0014` — 15 rows, `outreach_events` and
`shelter_contacts` present, `shelter_nonprofits` with both columns, the
animals count unchanged — then dropped. 21:15 UTC, clear of the crons; the
card idle (lora's batches down), nobody else on `:3200` or `monsterpaws_e2e`.
CI green 21:20 UTC (verify's first run with the Mailpit service passed).
e2e 34/34 against `ghcr.io/loganbresnahan/monster-paws-app:c45e085…` on
`:3200`, the previews spec and the footer assertions among them.

**1.** Running: `IMAGE_TAG=a2610f5…`, checkout `a2610f5`, app and worker up
7 h, caddy 20 h; health 200 with `a2610f5`, `lastCompletePollAt` 08:27:06 UTC.

**2.** One session: `git pull --ff-only` to `c45e085`, `IMAGE_TAG` set, both
images pulled; `config --images` resolves both to `c45e085…`; nothing
restarted. The droplet keeps `a2610f5`, `34d36ff` and `c58d87f` images beside
the new pair.

**3.** `drizzle-kit migrate` through the worker image (`--no-deps`):
15 rows in `drizzle.__drizzle_migrations`, `outreach_events` and
`shelter_contacts` present, `shelter_nonprofits` with `everyorg_claim` and
`claim_checked_at`; health still 200 on `a2610f5`.

**4.** 21:24:01 UTC `up -d app worker`: both on `c45e085…` in 10 s, caddy
untouched; the worker logged `ingest.poll registered (0 7 * * *)`; health 200
with `c45e085`, the poll still fresh.

**5.** 200 for `/`, `/animals`, `/animals/63205`, `/claim`, `/demo`,
`/demo/ducky`, `/robots.txt`. The home page carries `og:title`,
`og:description`, `og:site_name`, `og:locale`, `og:type`, `og:image` with
type, width 1216 and height 832, and the `twitter:*` set; the animal page its
own title ("Darlene — Monster Paws") and our own sentence as the description,
never the listing's. The card image is served at
`/opengraph-image.jpg?opengraph-image.<hash>.jpg` (Next's file convention),
200 `image/jpeg`, 181,465 bytes, 1216×832 — the plan's bare `/opengraph-image`
path was my guess and 404s; `/opengraph-image.jpg` without the query also
answers 200. No `og:url`. The four profile hrefs and "Donations coming soon!"
render. Nothing differed from the plan otherwise. 21:27 UTC.

## Follow-ups
- Logan: LinkedIn Post Inspector on the home page and an animal page before
  the launch post; the X card by pasting the link in a draft.
- The deploy skill's smoke should fetch the `og:image` URL the page carries,
  not a guessed path (this entry's step 5).
- `npm` inside the worker image prints an update notice on every
  `drizzle-kit migrate`; cosmetic.
