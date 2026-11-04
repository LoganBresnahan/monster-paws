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

- **One bad page still costs a whole attempt, and the log cannot say why.**
  The nightly now retries the whole run, and the proxy no longer cuts a
  page's tail (ADR-0033 as amended 2026-10-30, after oplog 0012). Inside the
  worker, though, `fetchPage` in `src/core/ingest/rescuegroups.ts` still
  never retries, so one bad page costs a new 27-minute attempt rather than
  seconds. And the CLI prints only `err.message`, so the night of 2026-10-30
  logged the single word `terminated`. Neither fix is built (read 2026-11-04
  at `0989a18`). When it is, a page whose fetch or body read fails is fetched
  again (the same page, never a skipped one, ADR-0014), and the CLI prints
  `err.cause` as well. Not on the eve of a night's poll: the whole-run retry
  has recovered every time so far.
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

- **The dev box freezes hard every few days, mostly within minutes of
  waking from S3 sleep — hardware or firmware, not the pipeline.** Twelve
  unexpected shutdowns in thirty days from 2026-09-14; nine within 1–14
  minutes of a firmware S3 resume, two under GPU batch load, one at idle
  40 minutes after a resume (2026-10-09, the one that prompted this). WHEA
  fatal firmware record at every boot since 10-03; no bugcheck file, no
  TDR. Facts and hardware in `doc/infra.md`, Home GPU. Logan's actions, in
  the order of cheapness: (1) stop using S3 — hibernate or stay on; the
  "never sleep" setting is not holding, resumes are logged nightly;
  (2) update the BIOS from 1805 (2024-10) to ASUS's current one for the
  TUF GAMING B760M-PLUS WIFI D4 and load Intel default power limits;
  (3) run XMP off (DDR4-3200 JEDEC) for a week, or MemTest86 overnight —
  2 × 32 GB at 3600 is the usual suspect for S3-resume WHEA freezes;
  (4) remove the third-party Virtual Display Driver if it is not needed.
  Re-read the System log after a week (`Get-WinEvent` for ids 6008 and
  WHEA-Logger 1). Found 2026-10-09. Status 2026-10-09 afternoon: S3 is
  off since this morning (Logan); the display glitches that followed are
  reproducible from Firefox (screens go black and white whenever it is
  used), on an idle box with 33 GB free — the Arc's Windows driver with
  Firefox's GPU compositing is the suspect for those, separate from the
  freezes. The BIOS flash was attempted before and did not take; ASUS
  boards of this family are flashed with EZ Flash 3 from the BIOS: FAT32
  stick, the .CAP renamed by the BIOSRenamer tool in the download, a USB
  2.0 port, and an intermediate version first when the jump from 1805 is
  refused. This board has no USB BIOS FlashBack (Logan). **2026-10-10: BIOS
  1836 (2026-04-15) is on**, flashed by Logan after another episode; the
  box feels snappier and the Intel overlay works again after a long time.
  Two more unexpected shutdowns before the flash — 10-09 19:20 (WHEA
  record) and 10-10 12:01 (no record) — make fourteen in a month. The new
  symptom in between: black flicker, program windows going white, which
  looks like the display driver resetting, though Windows logged no
  timeout-recovery (4101) event for it. Windows' "Memory Compression"
  process held 16 GB on an idle box before the flash and 0 after. The
  flash also reset the memory to JEDEC 3200 MT/s (it was 3600 under XMP),
  which is action (3) by accident — leave XMP off until a week has passed
  clean, so the test means something. Smoke after the flash: exact, no
  leak, 72–76 TFLOPS warm (the first run reads 30 cold). All four actions
  are now in effect except the memtest; the clean week is the open item.
  2026-10-10 16:42: BIOS optimized defaults loaded by Logan (XMP and the
  ASUS performance preset both off); memory now at the sticks' base JEDEC
  2666 MT/s, virtualisation on, smoke exact with no leak. The clean week
  counts from here. **2026-10-11: S3 is still on** — the Balanced plan
  sleeps after 30 minutes on AC, and the box slept 00:22–09:14 last night,
  woken by the Realtek NIC; it survived that resume (the first since the
  flash and JEDEC). Action (4) is withdrawn: the Virtual Display Driver
  (MTT VDD) is Logan's remote-streaming display, and
  `C:\VirtualDisplayDriver\vdd_settings.xml` pins it to the UHD 770, so it
  never touches the Arc. One WHEA
  *corrected* AER error 2026-10-10 17:54 on root port 0:1.0 — the CPU's
  x16 slot, the Arc's — and Windows PCIe link-state power management is
  at Moderate on AC. A physical HDMI dummy plug on the Arc was considered
  and is not recommended: it changes nothing at S3 (the card loses power either
  way) and VDD already gives Windows a display; the free test of the
  "card's power state" theory is link-state power management Off.
  Checked 2026-10-11: standby idle 0x708 = 30 min on the Balanced plan,
  ASPM index 1 = Moderate, the 00:22→09:14 sleep and the Realtek wake
  source in the power-troubleshooter event, the corrected AER on root
  port 0:1.0 (device 460D, the CPU's x16) at 17:54, and the VDD xml's
  `<friendlyname>Intel(R) UHD GRAPHICS 770</friendlyname>` — all as stated.
  Set 2026-10-11 (Claude, via `powercfg`): standby and hibernate timeouts
  on AC to never, PCIe link-state power management on AC to Off. The
  clean week restarts from here with S3 genuinely off.
  2026-10-12: the AC standby timer is back at 15 minutes, set by Logan
  on purpose — sleep is allowed on the dev box until production deploys,
  and the production account's provisioning turns it off (roadmap item 4
  carry-in). No crash since 10-10 12:01.
  **2026-10-20: the clean week ended — three hard crashes, none near a
  resume**: 10-17 14:07 (~16 h after the 10-16 21:55 restart), 10-19 16:38
  (7.5 h after the 09:09 resume), 10-20 08:36 (15.3 h after the 10-19
  17:16 boot). Each left the same WHEA 1 at the next boot, its sections
  all the firmware-error-record reference (`81212a96-…`), as before the
  flash, plus a WHEA live kernel dump. Nothing ran on the card (no batch
  since 10-15); BIOS 1836, RAM 2666, driver 32.0.101.9034 and
  `.wslconfig` unchanged; Windows updated and restarted 10-14 01:29. The
  times fall in the Arc's flicker window (below), and the flicker dumps
  stopped at 10-16 20:08, the evening before the first crash: the
  working theory is that the headless Arc's engine hangs grew from
  recovered resets into whole-box hangs. The dummy plug tests both.
  **2026-10-12: the black flickers do leave a record** — not as a 4101
  in System, but as a graphics-watchdog live kernel dump
  (`Microsoft-Windows-WerKernel/Operational`, "Component WATCHDOG …
  Live Kernel Dump", report `Kernel_141_*`: 0x141
  VIDEO_ENGINE_TIMEOUT_DETECTED, an engine reset Windows recovers without
  a full TDR). A pair at 14:25:11 and 14:25:24 was the flicker Logan saw,
  each followed ~10 s later by a display re-enumeration in the Intel
  Graphics Software log. The same dumps cluster on 10-09 15:27–15:52 (the
  Firefox episodes) and ten times on 10-10 04:50–12:12, then none until
  today. No ComfyUI was running (batch 5b ended 14:16); on the Arc were
  Windows Terminal, DWM and Zed — **Zed ignores its `GpuPreference=1` pin
  like Terminal** (both its path and Store identity are pinned; it drew at
  ~33% of the Arc's 3D engine at 14:30), and so does VS Code (its GPU
  process at 14:58 had engines on the Arc only, 0–2.6%, with `Code.exe`'s
  path pinned exactly): none of the three dev apps can be moved by the
  pin. Their own switches are the way off the card — Terminal's "Use
  software rendering", VS Code's `"disable-hardware-acceleration": true`
  in `argv.json`. Intel Graphics Software crashed in
  the Arc's Level Zero library (`ze_intel_gpu64.dll`) on 10-09 15:49 and
  10-10 09:53, inside the earlier clusters, and its performance overlay was
  switched on at 14:07 today. **Every dump is the Arc**: Logan copied all
  46 from `C:\Windows\LiveKernelReports` and the WER queue (admin) to
  `C:\Users\tarsier\dumps`, and WinDbg's `!analyze -v` reads 0x141 in
  `igdkmdnd64.sys` — Intel's discrete-GPU driver; the UHD 770 runs
  `igdkmdn64.sys` — in the System process for all of them except one
  in `vmwp.exe` (10-07 09:01) and one 0x193 in `dxgkrnl.sys`, across
  the Aug 30 driver build (10-07/08) and the Sep 30 one (32.0.101.9034,
  since). Two more flickers came with the apps moved off: 15:05:37
  (Intel Graphics Software closed, Zed closed) and 15:10:19 (Terminal
  on WARP, VS Code without hardware acceleration; only csrss and
  ApplicationFrameHost drawing on the Arc, ~3%), then 15:36:30 with
  only csrss (12%) and DWM (6.5%) on it. No WHEA or PCIe error
  coincides with any dump. So the Arc's driver hangs an engine during
  ordinary desktop use, whichever app is on it. Logan: the flickers
  began when the Arc went headless (monitors moved to the UHD 770) and
  never happened with a monitor on it; Windows kept a watchdog dump about
  monthly since 2025-02, then 2, 9, ~25 and 4 a day from 10-07. Decided
  2026-10-12: **a DisplayPort dummy plug on the Arc**, so it runs as a
  display card again; the app switches above stay on, since a display
  changes the card's state, not which apps draw on it. The flickers start
  hours into a session (Logan's observation, checked against boots and
  resumes): 6.0–6.5 h after the 10-09 09:24 boot, 8.8–16.5 h after the
  10-09 20:01 one, 5.5–6.7 h after today's 08:53; none on 10-11 in ~6 h
  after a resume; each cluster ends at a reboot. Not tied to batches
  (10-10's began at 04:50 with none running), and not the driver's
  retained pool (0.8 GB at 15:40, lower than the morning). Check with
  the plug in through a session well past 6 h: no new WATCHDOG dump
  means headless was the trigger. The dumps kept coming until the plug:
  10-13 (4 between 10:33 and 10:53), 10-15 22:31–22:33 (eleven, one a
  full kernel dump), 10-16 (14, 02:33–20:08). **The plug went in
  2026-10-20** (UGREEN DP, Windows names it `UGRC775`), booted 15:45; the
  Arc drives it at 1920×1080 at 60 Hz and DWM composes on the card. Check
  after 2026-10-21 00:00 for WATCHDOG dumps, 6008/41 and WHEA 1; a week
  of none closes both this entry and the crash half of the freeze entry.
  Read 2026-10-22: one more unexpected shutdown, 10-20 20:26 with the plug
  in, unlike the three before it — **no WHEA record**, and a
  `ResourceTimeout` live dump at 20:45 before Logan's 20:47 restart, which
  itself ended in a power-off (41 at 20:51): a stall, not a firmware
  fatal. Logan then freed ~700 GB on C: (955 of 1,907 GB free now; M:
  362 of 477) and set the BIOS so the cards and SSDs never power down;
  Windows' AC standby timer and PCIe link-state power management both
  read 0 (never/off). Since the 10-20 20:51 boot: no 6008/41, no WHEA,
  no WATCHDOG dump, across three S3 sleeps (10-21 09:51, 23:47, 10-22
  09:44) — S3 still powers the cards off whatever the BIOS device
  settings say. Several changes landed together (plug, space, BIOS
  power), so a clean week closes the entry without naming which fixed
  it. The repeated
  bursts of `LiveKernelEvent` 141/124/193 in Application every few hours
  are Windows Error Reporting resending the same queued reports, not new
  faults. **2026-10-27 (`/gpu-health` before the LoRA set's first batch):
  one more — 10-25 14:45 unexpected shutdown, WHEA 1 at the 20:50 boot,
  24 h up since 10-26 14:09; nothing ran on the card (no batch since
  10-26's 12h). Compression 5.4 GB at idle (16 preceded the October
  freezes); BIOS 1836, RAM 2666, driver 32.0.101.9034, `.wslconfig`
  unchanged; smoke green twice, 0 leaked, ~77 TFLOPS warm.
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
