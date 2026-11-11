# Issues

Known defects and rough edges, mostly found by dogfooding (ADR-0019). This is
the **inbox**, not the plan: `doc/roadmap.md` says what we are building and
`doc/plans/` says how, and a finding graduates out of here the moment it earns
a checklist item, an ADR, or a carry-in pinned to the work that will hit it.

Newest first within each section. Delete an entry when it is fixed — the commit
is the record, and a file of ticked boxes stops being read.

## Data quality

- **The EIN matcher ranks a government shelter against unrelated bodies that
  share its generic words.** Preparing `illinois-2` (2026-10-30), McLean County
  Animal Control Center's first candidate was the Islamic Center of McLean
  County (0.68), and Kane County Animal Control's were Friends-of charities of
  other counties' animal control (Christian, Sangamon, DuPage) — "County",
  "Animal", "Control" and "Center" count as much as the one word that tells two
  bodies apart. Nothing wrong was written: every such list came back WEAK and
  Logan answered `n`, and the six government shelters are held out of the send
  with `--skip`. The cost is reading time. Fixes wait until after the wave
  (roadmap, Shelter consent carry-in): weight rare words, and a line in
  `prepare` naming a likely government shelter by its name before its domain,
  since listed sites are often years old (Kane's `kanecountypets.com`). Never a
  hard filter on NTEE D: 4 of the 35 confirmed matches file under T20, W30,
  P20 or P99 (ADR-0029).

- **Some listings are not animals; some animals have names that are not
  names.** Four of the top six rows of the browse sort are administrative
  records, and the two problems must not share a fix — see **ADR-0021** for the
  measurements and the decision (an LLM verdict as derived data, gating browse
  only, default-show, eval-gated, deferred past phase 4). The interim shipped
  2026-09-04 with the browse page: six hand-checked listings in
  `BROWSE_EXCLUSIONS`, keyed by `(source, external_id)` and applied beside the
  visibility predicate, so their detail pages still resolve. That covers the
  head of one sort and nothing else — the rest of the corpus is unmeasured, so
  this stays open until item 7b. Found 2026-09-04. Newest-first browse (ADR-0015
  as amended 2026-10-05) shows more of the second kind: brand-new listings named
  with a shelter ID ("A435266", "A433767") lead the default page. Seen
  2026-10-05.
- **A thin tail of descriptions is the shelter's whole adoption manual** —
  deposit amounts, adoption-fair schedules, size-and-age glossaries. Re-measured
  2026-09-04 after whitespace tidying (ADR-0018 as amended), which fixed most of
  what the original 4,010px screenshot showed (that quote is now 1,173px): the
  median description renders at ~278px and p90 at ~684px, but 752 of 45,131
  (1.7%) run past 4,000 characters, the longest at 4,771px (animal 46364).
  Excerpting was considered and rejected — the text stays whole and unlinkified
  (ADR-0015 as amended) — so what is left is a readability question for a very
  small tail, not a safety one. Found 2026-09-04.

## UI

- **`/animals/[id]`'s `revalidate = 3600` does nothing.** The route has no
  `generateStaticParams`, so the build lists it as `ƒ`, and production answers
  `private, no-cache, no-store` with no cache header from Next: every view
  renders and reads Postgres. ADR-0015's hour (as amended 2026-10-01) and that
  page's comments describe a cache that isn't there. Keep it per request and
  correct the words, or make it a real cache, which would let an animal lead
  `/animals` for up to an hour with no button (ADR-0015 as amended 2026-11-04).
  Found 2026-11-04.

- **The production server logs "The destination stream closed early"** when a
  page is closed mid-response: three times in one e2e run (2026-10-26, 20/20
  green) and once in dev on `/animals`. It is the browser hanging up on a
  streamed render, not a failure, but it reads like one in the logs and would
  reach Better Stack in production. Decide whether to filter it there or quiet
  it at the source before the launch's error reporting goes live. Found
  2026-10-26.

## Ops

- **The Cloudflare login has no MFA, according to Cloudflare's Security Insights.** Scanned 2026-10-31, so it may be out of date.
  That login controls the DNS, the media and backup buckets and the tunnels, so whoever got into it could redirect the whole site,
  webhooks included. Logan's to turn on. The social accounts have had 2FA from day one (ADR-0032); this one should match.

- **The zone's minimum TLS is 1.0 and no host sends HSTS.** The main site really does answer over TLS 1.0 and 1.1, though the Insights
  scan only flagged `staging-hooks`. Oplog 0033 is written and waits on Logan's go: minimum TLS 1.2 and a one-day HSTS, with no
  subdomains. Low risk; the one thing only a real delivery can prove is that Every.org's client still lands.

- **`media.monsterpaws.org` answers over plain HTTP, and Always Use HTTPS stays off for the zone until renewals are understood.** The
  main site and `www` already redirect at Caddy, and the media files are public, so the stakes here are low. The zone-wide switch is
  the risk: Caddy may renew the origin's certificate over HTTP through Cloudflare, Cloudflare's docs don't say what the switch does to
  that path, and community reports conflict (searched 2026-11-05). A failure would be silent until the certificate ran out, and then
  Full (strict) would take down the site and the webhook together. The cert's expiry and how Caddy renews it haven't been read. Either
  read that first, or scope a rule to the media host alone. HSTS (oplog 0033) already covers browsers that have seen `media` over HTTPS,
  if step 3 shows the header there.

- **Cloudflare doesn't cache `/_next/image`, and the droplet's image cache should empty on every deploy.** Read from outside on
  2026-11-04: the crew images answer `cf-cache-status: DYNAMIC` with `x-nextjs-cache: HIT` (about 0.17 s for 57 KB) and
  `max-age=14400`, so Next and browsers cache them, but each new visitor's requests still reach the droplet, up to 23 on the home
  page. `docker-compose.prod.yml` gives the app no volume for `.next/cache`, so after a deploy the first visitors should wait for
  re-encoding (not measured). Animal photos on `/animals` come from RescueGroups' CDN and aren't affected. Fine at today's traffic;
  it matters in a spike, most if we deploy during one. A Cloudflare cache rule would fix it, but Next picks the format from the
  browser's `Accept` header and the free plan may not keep a copy per format, so test that before turning it on. Low priority.

- **The main site has no `/sitemap.xml`.** It answers 404: `src/app/robots.ts` exists and there's no sitemap route. Cloudflare
  counted 22 requests for that path in the 24 hours to 2026-11-04, 11 of them on the media host, and how many were real crawlers
  isn't known. Search engines can only find animal pages through links until there is one. It must list public pages only, never a
  `/share/` or `/thanks` token. Low priority.

- **Real donations depend on this one box staying up, and nothing says when the worker dies.** The art worker and its tunnel are
  plain processes on the home box: a reboot, a freeze or Windows signing out stops them, and they don't come back by themselves
  (`doc/infra.md`, "After a restart of this box", never yet run end to end). A paid donation then waits, and the only alert is
  "waiting past 30 minutes". The nightly poll also needs Logan signed in. Who keeps it up after the hackathon is Logan's call
  (oplog 0029's follow-ups). Found 2026-11-04.

- **The memory wait has only had fake readings.** Below 22 GB a job holds its slot for up to 30 minutes and paints when memory
  returns (`MEMORY_WAIT_MS`, `src/worker/art.ts`). Real jobs have only gone through the path where free was enough, and no real
  SIGTERM has landed during a wait. One run with memory held low would prove it, and takes the card. Found 2026-11-04.

- **The photo reader's coat rule refuses a semicolon, so a good answer loses its
  words.** `read.py`'s `COAT` allows letters, spaces, commas, apostrophes and hyphens,
  and the 4B sometimes writes "Light tan on head, face, and ears; white under chin"
  (the hamster in batch 41a's read, 1 of 20; none of 40b's 13). It fails safe: the
  listing's words alone, and a Sentry warning "the photo reader gave no words". The
  fix is one character plus a worker restart, for after the go-live, with the species
  gate's change. Found 2026-11-04.

- **`crops` and `paint` in the painting job have no time limit, where the reader
  now does.** A hung `live_crops.py` or guard batch would hold the art worker's
  one slot, and every later job would skip as busy until someone kills it, with
  the listing's photos left on disk. `job.signal` could end any attempt at the
  hour. Not new with the reader, and left for after the go-live. Pin `transformers`
  at the next `comfy:build` too, since the reader's question was judged on 5.20.2.
  Found by `verify` reading `d7f90c8`, 2026-11-04.

- **A painted keepsake whose publish failed is never published again.**
  `art.generate` publishes through the share tool after writing the four
  art facts (`sharePublisher`, `src/worker/art.ts`); a failure keeps the art
  and raises "art painted but not published" in Sentry, but the sweep only
  sends a job for a keepsake with no art, so nothing tries again. On
  production the droplet mails from the published copy (the demo chain's
  contract), so a gift whose publish failed gets no email until someone
  runs `npm run share -- publish <keepsake-id>` by hand. A fix wants a
  record of what was published, which the share tool doesn't keep: a
  sweep for painted keepsakes with no published copy, or the email sweep
  asking for one. Found while building the publish step, 2026-11-04.

- **Worktrees' test runs truncate each other, because `.env`'s `TEST_DATABASE_URL`
  has no effect.** `npm test` is bare `vitest run`, which doesn't load `.env`, so
  `tests/support/db.ts` falls back to `monsterpaws_test` in every worktree, whatever
  its `.env` names. On 2026-11-02, from about 20:07 to 20:16 UTC, the donate stream's
  runs truncated that database while outreach had a run going at about 20:14. Donate's
  gate test failed now and then with a duplicate key on `animal_identities`, which is
  how it was found. Only test databases are touched, so nothing real is lost, but a
  failure or a pass during an overlap proves nothing. Until it's fixed, a worktree sets
  the variable on the command itself, `monsterpaws_<stream>_test`, and only the main
  checkout uses the default. The likely fix is `vitest.config.ts` reading that one key
  from `.env`, never the whole file, which would bring `DATABASE_URL` and the secrets
  into the suites, and an amendment to ADR-0017. Found by the donate stream.

- **A gift arriving while the droplet is down, or lost with its disk, goes unrecorded.** Caddy's hold and the spool
  cover a deploy and a database failover (ADR-0027 as amended 2026-11-03, live since oplog 0023). A spool file still dies with the droplet's disk, a delivery while the droplet is down reaches nothing, and
  Every.org didn't retry the one failed delivery we saw (oplog 0018). ADR-0035's return signal and daily check partly
  cover a painting, not the money record. `createPool` still sets no connection timeout, so a vanished database host can
  hold pool slots until TCP gives up, and all ten slots exhausted is untested. Found by the donate stream, from payload
  ids jumping from 2 to 35, which was DigitalOcean's failover of 2026-11-03 and not lost gifts: all three sequences moved
  by the same 33.

- **Nobody has read whether a painting sent after a gift affects Every.org's tax receipt.** Both of Logan's
  production receipts say "No goods or services are provided to you in exchange for your gift. Therefore, the full amount
  you paid qualifies as a charitable contribution for US tax purposes." We send a painting after the gift, and no doc or
  page covers how the two fit. A question for Every.org or a lawyer, not one to answer here, and it is in the email to
  support@every.org. It bears on whether the painting is promised (ADR-0035, open question 7). Found 2026-11-03, while
  Logan and the moderator discussed that line.
  Logan, to the moderator, 2026-11-04: "i think we just need to audit our words to never say something like 'exchange' etc. everything has
  to be uh whats the word...kinda like 'try' of 'our own volition'. basically we need to audit our words everywhere". The moderator reads
  that as opening anyway with careful wording, and has asked him to confirm. So every donor-facing sentence goes through one table for
  him to approve, and that audit is a requirement for oplog 0029's image. This doesn't answer the question above: no lawyer or
  Every.org has read it, and whether the email to support@every.org has gone out is his to say.

- **Only the newest of two paid gifts can have its address fixed.** `/thanks` shows one gift, so
  a donor with two in one browser can't reach the older one's address from there. They write to
  hello@. Found by the 2026-11-02 review.

- **A stuck keepsake alerts every hour for ever.** `sweepKeepsakes`'s `stalled` count stays up for a gift nobody can paint, such as
  a listing with no photo left, and nothing marks it as dealt with, so the alert can't be cleared. Found by the verifier reading
  the sweep, 2026-11-04.

- **A delivery with an enormous amount is re-decided forever.** `MONEY` (`webhook.ts`) allows unlimited comma groups, so
  `amount: "1,000,000,000,000"` overflows `numeric(12,2)` and the row comes back `decision_failed` every minute, reported hourly,
  with no end. It takes the path secret, so only Every.org or someone holding it can send one. Found by the verifier reading
  oplog 0023, 2026-11-04.

- **The webhook sweep's two repeating alerts share one clock.** `failure` and `staleFiles` both use `lastRepeatAlert`
  (`startWebhookSweep`, `src/worker/index.ts`), so either can hold the other back for up to an hour. Found by the verifier
  reading oplog 0023, 2026-11-04.

- **Nothing limits how fast intents can be minted.** `startSponsorship` writes a row with an
  address per POST, and rows last 30 days. Found by the 2026-11-02 review; Cloudflare's rules were
  not read for it, and as documented they can't be the whole answer: `doc/infra.md` opens 443 to
  everyone and records no Authenticated Origin Pulls, so a direct hit on the droplet skips them
  (the live firewall not read). ADR-0035's limits don't close this, since the form still creates
  rows. Matters once a real Sponsor button is open.
  Logan, 2026-11-04: "yes accept it for day one". Nothing paints or mails without a payment, so a flood
  costs rows and holds typed addresses for up to 30 days; watch the count when Spencer opens, and add a
  limit if it spikes.

- **Bytes are corrupted between home and the droplet, and the bridge's SSH
  connection drops on them.** Twice in four days: oplog 0012's rerun
  (2026-10-30 14:21:15 UTC, page 104) and the nightly of 2026-11-02
  (07:09:39 UTC, page 204). Each time `ssh` exited 255 with the proxy healthy
  to the end. The droplet's sshd logged `message authentication code
  incorrect` both times (oplog 0016): a packet from home failed SSH's
  integrity check, so bytes changed on the way in a way TCP's checksum let
  through, and sshd ends the connection on that by design. Not a reset, not
  a timeout. Roughly two in 3 GB sent. The droplet shows no NIC error in 94
  days. At home, Windows logged no network event at either drop, and memory
  without ECC would log nothing. Candidates: the home box's memory, WSL2's
  virtual network, the router, the ISP. The retry absorbs a drop at about 15
  minutes each (ADR-0033 as amended 2026-10-30), but three in one night fail
  it. Accepted (Logan, 2026-11-02: "i'm okay with some failures because we
  recover"): nothing is hunted unless a night fails on three drops, and then
  0016's follow-up tells WSL's path from the rest. Found by the moderator
  session 2026-11-02.
  The nightly of 2026-11-08 dropped twice more: `ssh` exited 255 at 07:09:44
  and 07:27:52 UTC, with the proxy healthy to the end both times. The
  droplet's sshd log wasn't read for these. Its third attempt failed on a
  RescueGroups 500 instead (the next entry), so the night falls short of
  three drops. Oplog 0034's rerun that afternoon dropped twice more, at
  17:09:45 (page ~522) and 17:15:13 UTC (page ~8), and completed on its
  third attempt. That makes six drops since 2026-10-30, four of them on
  2026-11-08.
  A lead, not a cause: three of the six fell at hh:09:39–45 UTC (11-02
  07:09:39, 11-08 07:09:44 and 17:09:45), on runs that started at different
  times. At 17:09:22 UTC, 23 s before that last drop, Windows started three
  maintenance tasks together: `\Microsoft\Windows\DiskCleanup\SilentCleanup`,
  `\Microsoft\Windows\MemoryDiagnostic\ProcessMemoryDiagnosticEvents` and
  Visual Studio's `BackgroundDownload`. Task Scheduler's history is off, so
  what ran before the 07:09 drops can't be read. Turning that history on (an
  admin step on Logan's account) would let the next drop be matched against
  it. 0016's follow-up stays the test that settles where the bytes change.

- **One bad page still costs a whole attempt, and the log cannot say why.**
  The nightly now retries the whole run, and the proxy no longer cuts a
  page's tail (ADR-0033 as amended 2026-10-30, after oplog 0012). Inside the
  worker, though, `fetchPage` in `src/core/ingest/rescuegroups.ts` still
  never retries, so one bad page costs a new 27-minute attempt rather than
  seconds. And the CLI prints only `err.message`, so the night of 2026-10-30
  logged the single word `terminated`. Neither fix is built (read 2026-11-04
  at `0989a18`). When it is, a page whose fetch or body read fails is fetched
  again (the same page, never a skipped one, ADR-0014), and the CLI prints
  `err.cause` as well. Not on the eve of a night's poll.
  The nightly of 2026-11-08 failed on this. After two SSH drops, its third
  and last attempt reached page 616, where RescueGroups answered `500
  Internal Server Error` after 60 s. That ended the run at 07:55:30 UTC with
  `/api/health` stale and Better Stack's monitor 4995794 down. A retry of
  that one page would likely have finished the night.
  Smaller: each failed attempt pings `/fail`, so a night that completes on
  a retry opens a Better Stack incident and closes it, as 2026-11-02 did
  (read in oplog 0016). Pinging only on the
  last attempt needs a second verb in the key's forced command. Found by
  the moderator session 2026-10-30.

- **The follow-up wave cannot be built from the CLI.** The guard allows one
  follow-up seven or more days after the first message (ADR-0029 §5) and
  `tests/outreach-send.test.ts` proves it, but `send --wave <name>` builds its
  list through `selectWave`, which drops every shelter already written to —
  right for a first wave, and exactly the set a follow-up wants. Needed before
  day seven of `chicagoland-1`: a `--follow-up-to <wave>` flag that selects the
  shelters sent to in that wave with no `replied`, `granted`, `opted_out` or
  `bounced` row, and renders the ask with `inReplyTo` set to each first
  message's id so it threads. Found 2026-10-27 writing Logan's runbook.

- **`npm install` under npm 11.19.0 rewrites `package-lock.json` by 66 lines**,
  adding the nested optional wasm packages under
  `node_modules/@tailwindcss/oxide-wasm32-wasi` (`@emnapi/core`,
  `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`,
  `@tybys/wasm-util`, `tslib`). The lock on topdog at da83275 predates today's
  work and CI's `npm ci` is green without them, so this is a newer npm than the
  one that wrote the lock, not a dependency change. The trap: after any
  `npm install` the lock shows a 66-line diff that must not ride along in an
  unrelated commit — stage by path, and commit the lock alone and on purpose
  if it is ever meant to move. Found by the moderator session 2026-10-27 while
  checking the outreach rebase.

- **The WSL VM froze three times on 2026-10-10 (Windows stayed up), each
  time while the explore container loaded the ViT-H encoder into CPU
  memory for the likeness scorer.** No Windows event, no kernel message,
  nothing written. The GPU batches never did this: their big allocations
  live on the card. Suspect: `autoMemoryReclaim=gradual` stalling the VM
  under a sudden multi-GB allocation. Changed in `.wslconfig` 2026-10-10
  (backup beside it): `autoMemoryReclaim=disabled`, and `memory=32GB` as
  sized in infra.md. The scorer does not run again until the first test
  after the shutdown: load the encoder without ComfyUI's loader, 12 GB
  container limit, four threads, VM memory watched from a second shell.

## Compliance

- **`/claim` promises a deletion nothing does.** `src/app/claim/page.tsx:68` says "We remove the pages and delete
  what we derived from your listings", but ADR-0029 §5's opt-out is a `SHELTER_EXCLUSIONS` entry that only hides
  the animals, and no ADR or runbook says what gets deleted. `purgeDisplay` takes a whole source, not one shelter,
  so it isn't that deletion as it stands. It's live. Either the deletion gets built or the sentence changes, and
  that is Logan's call. Found 2026-11-04 by the verify chat.

- **An older version of a crew photo stays in this repo's history.** A detail in it was blurred from the live
  files in `ec81e6c`, and removing the old version means rewriting history, which is Logan's call. Logan: "yeah
  i'll deal with the image later", which we read as this. The source photo also reached Meta's Model API.
  Logan, 2026-11-04: "Its fine all the personal info is just mine for all photos". Found 2026-11-04.

- **1,404 animals (2.2%) render their organization's name with no link home** —
  the source publishes no usable URL for them, and we never assemble one
  (ADR-0015 as amended). Under the terms' link-back promise this is the honest
  floor rather than a defect, but it is worth watching: if the share grows, the
  org's email or phone may have to stand in. Found 2026-09-04.
