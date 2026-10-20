# Issues

Known defects and rough edges, mostly found by dogfooding (ADR-0019). This is
the **inbox**, not the plan: `doc/roadmap.md` says what we are building and
`doc/plans/` says how, and a finding graduates out of here the moment it earns
a checklist item, an ADR, or a carry-in pinned to the work that will hit it.

Newest first within each section. Delete an entry when it is fixed — the commit
is the record, and a file of ticked boxes stops being read.

## Data quality

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

- **The browse disclaimer says more than the rule does.** "We show animals
  their shelter has kept up to date" reads as "updated recently". The rule
  (`visibleAnimals`, ADR-0015 as amended) is: in the source's live listings as
  of our last poll (within 8 days), and edited by the shelter within the last
  **2 years**. Proposed precise wording: "We only show animals that are still
  in their shelter's live listings and whose listing the shelter has updated in
  the last two years." Logan to choose. Found 2026-10-02.

## Ops

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
  of none closes both this entry and the crash half of the freeze entry. The repeated
  bursts of `LiveKernelEvent` 141/124/193 in Application every few hours
  are Windows Error Reporting resending the same queued reports, not new
  faults.
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

- **1,404 animals (2.2%) render their organization's name with no link home** —
  the source publishes no usable URL for them, and we never assemble one
  (ADR-0015 as amended). Under the terms' link-back promise this is the honest
  floor rather than a defect, but it is worth watching: if the share grows, the
  org's email or phone may have to stand in. Found 2026-09-04.
