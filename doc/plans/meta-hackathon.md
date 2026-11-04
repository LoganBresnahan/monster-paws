# ADR-0028 build plan — the Meta hackathon, on the `meta` branch

The ten days from kickoff to submission, as ADR-0028 (and its amendments of
2026-10-23 and 2026-10-26) decided them. This file lives on the branch and
records the branch's own choices; a choice becomes an ADR only if it comes
back to topdog. Dates are ET. The branch is a worktree at
`../monsterpaws-meta`; rebase it on topdog every morning
(`git rebase topdog`), because the browse-first launch and the donate loop
land there in the same window.

**The rule that shapes everything** (ADR-0028 as amended 2026-10-26): only
work dated 2026-10-27 or later is the entry, and the demo shows nothing
older except as labelled context. Every slice below names what it adds to
the delineation table in `README.md`.

## Open questions, answered here as they close
- **Delineation:** no ruling sought (Logan, 2026-10-26; ADR-0028 as
  amended 2026-10-26, decision 2). The README table, the first frame and
  the git history are the whole answer.
- **A shelter's yes by 10-30?** *Status:* (pending; replies to the 10-23 ask)
- **The Model API terms:** read at source 2026-11-04: Terms of Service (last
  updated 2026-10-09), Data Commitments, Model Designation policy. The content,
  retention, training and restriction sections were read closely, and payments,
  disputes and the exhibits skimmed; the Privacy Policy and the Global Processor
  Terms were not read.
  - **Training:** SAM 3.1 is a Standard Model, so what we send doesn't train
    Meta's models (5.1). That holds on a plain Model API key: Logan: "i made it
    under meta model api -> api keys section". A Muse Code subscription would
    default to Contributor (3.3).
  - **Retention has no end date** (4.4). Content may also develop Meta's safety
    systems (4.1) and be reviewed by a person (10.3). Calls set `store: false`,
    which turns off the response being stored, not those.
  - **Outputs** may not train a competing model (10.1(ix)); evaluating and
    benchmarking our own systems is allowed. Publishing benchmarks to promote a
    competing product isn't (10.1(xi)), so the video promotes nothing against
    SAM 3.1.
- **Which photos go to Meta:** Logan, 2026-11-04: "i'm okay for all the crew
  except for the plum photo called downloadfile or something", then "bro i said
  DO NOT send the plum download file". `SAM3_APPROVED` in `comfyui/detect.py`
  is the 16 photos he was asked about, without that one; any other photo stops
  the run before a call. We warrant our rights in every input (4.1), so Commons
  photos stay out too, and real gifts to Spencer don't go because it hasn't been
  asked.
  **Cleaned copies (2026-11-04):** stripping metadata leaves pixels alone. Plum's
  collar tag, with a personal detail on it, was legible at the size sent in
  `PXL_20250423_185424061.PORTRAIT.jpg` and `PXL_20250422_224206531.jpg`, and
  `Stacey/IMG_3110.jpg` showed a readable web address on a screen. All six of
  those photos had already gone, 4 calls each. Logan, relayed by the moderator:
  "Its fine all the personal info is just mine for all photos. the arm is my wife.
  lets just clean the images so they can be used". `comfyui/clean_crew.py` writes
  opaque-covered, pixels-only copies to `var/explore/crew-clean/` (gitignored), and
  only those copies are on `SAM3_APPROVED`. A run naming an original sends its clean
  copy, read by the client itself; `Plum/downloadfile.jpg`, a shelter's photo, stays
  off. Clean copies went on Logan's plain yes: "yes copies look good". The other 10 photos were read
  at the size sent and show no legible number or address, as Claude read them. All
  74 response ids returned 404 on a read-only lookup and `/v1/files` is empty, so
  nothing is stored for the API to delete; what Meta keeps for safety review is
  unknown. The measured table below is from the original 16.
- **The deadline:** 21:00 ET on 11-04, which is 02:00 UTC on 11-05, as ADR-0028
  says. Logan, relayed by the moderator session: "Submissions are due tomorrow:
  Nov 4th at 9:00 PM ET".

## Phases

0. **10-26, kickoff — setup and measurement design; nothing counts yet**
   - [ ] `credits` — low, mechanical. The claim form (**submitted 10-26**,
     credits arrive in batches); a card on the account (the
     pre-authorisation releases); a spend-limit notification at $150. The
     key into `pass` as `meta/model-api-key`; a row in `doc/infra.md`'s
     credential table by name; a commented line in `.env.example`
     (`MODEL_API_KEY`, "meta branch only, ADR-0028"). Trap: the key never
     reaches topdog's `.env.example` or compose files.
   - [x] `discord` — joined 10-26. Office hours 10:00–11:00 ET daily from
     10-27, in text, for SAM 3.1 questions as they come up.
   - [ ] `blind-set-4` — medium, verify. The fourth set, never seen by any
     rule (ADR-0026 §7; `doc/plans/subject-detection.md`, Open): the crew
     shot shelter-grade (crate door, leash and hand, fluorescent light, from
     above, across the room, lying down), GPS stripped, plus any photos a
     shelter has sent under a grant. Listings written **before** any run,
     in `comfyui/explore/detect-blind4.json`, with the truth boxes drawn by
     Logan and sealed. Verify: no photo in it appears in set1, holdout,
     blind3 or tripods.
   - [ ] `readme-skeleton` — low. The delineation table in the branch's
     `README.md`: two columns, "built 2026-10-27 → 11-04 (commits)" and
     "existed before (what it is)", filled as slices land; the video's
     first frame is this table.
   - [ ] `/gpu-health` before the window, and the card idle.

1. **10-27 → 10-29 — the `sam3` pipeline, measured once**
   - [x] `sam3-client`. In `comfyui/detect.py`, a `sam3` entry for
     `DETECT_PIPELINES`: one Responses call per (photo, phrase), `stream: false`,
     `store: false`, `metadata.include_confidence: "true"`, re-encoded pixels as
     a base64 data URL, stdlib only. Boxes come from our own small parser; masks
     aren't decoded yet, so `meta-sam-parser` isn't needed. Each raw reply is kept
     per (image, phrase) in `sam3-raw/`, so a run replays offline with no key. A
     reply from any model but `sam-3.1` is refused, because the terms make that
     check ours. `comfyui/sam3_test.py` proves the refusals against a stub server.
   - [x] `sam3-prompts`. "a {species}", "a {colour} {species}", "the head of a
     {species}" and "a {other}", one call each. "and" in a colour works ("a black
     and tan dog") despite the docs' warning. The head phrase scored highest on
     Beetle's two photos (0.93, 0.91, against 0.87, 0.65 for "a dog head"), with
     the same box. **Changed from this plan:** SAM 2.1 still outlines sam3's boxes
     (Logan, to the moderator: "first lets just develop on sam 2.1"), so masks
     from the API are the later step; the raw replies already hold them.
   - [x] `sam3-rules`. Candidate rules and votes run unchanged. `FLOOR["sam3"]`
     is 0.0: the lowest box in 74 calls was 0.52 ("a white cat"), the lowest "a
     {species}" 0.86, and no false box appeared, so there's nothing to tune and a
     floor could only empty a pool and break always-one (ADR-0026). A real false
     box would change this. sam3 has its own second look on crops, so OWLv2 never
     decides a sam3 close call; no photo here has needed it yet, so that path has
     only run against the stub.
   - [x] `sam3-measure`, **changed: crew only, and not blind.** `detect-blind4.json`
     was never built, and set1, holdout and blind3 hold Commons photos, which
     can't go to Meta. The table below is on `detect-sam3.json`, photos the rules
     have already seen. Don't call it blind in the video or the write-up. Logan
     chose SAM 3.1 for the demo before this ran, so it decides nothing.
   - [ ] `sam3-crops`. `crops.py` runs on sam3's output (16 grown boxes in
     `grown.json`). The painting goes through `paintings`' glue. `Plum/downloadfile.jpg`,
     one of Plum's two in `keepsake-crew.json`, is refused, and Logan chose to
     replace it: "i guess we need to get rid of the download photo and regenerate
     the plum photos". His other five photos already run on sam3.
   - README: "sam3 pipeline, prompts, measurement, crops" with commits.

   **Measured 2026-11-04, 16 crew photos, seen by the rules, boxes read by
   Claude on the sheets (Logan hasn't checked them):**

   | | SAM 3.1 | OWLv2 |
   |---|---|---|
   | The listing's animal chosen | 16 of 16 | 16 of 16 |
   | Box visibly cuts the animal | 0 | at least 5 |
   | Head box on the head | 15, 1 missing | 14, 1 on the rump, 1 missing |
   | IoU with a hand-drawn box, 4 photos | 0.85, 0.76, 0.73, 0.73 | 0.78, 0.77, 0.72, 0.70 |
   | Time | 0.4 to 1.7 s a call, about 5 s a photo | 63 s for the 16, about 4 s a photo |
   | Money | $0.0025 a call, $0.01 a photo | none |

   The clearest five for OWLv2: `Beetle/IMG_3545` (no head, and its head box on the rump),
   `Stacey/IMG_3110` (the cat split into three, head and shoulders chosen),
   `Stacey/IMG_20200516` (head and chest), `Ducky/PXL_20241027` (hindquarters),
   `Ducky/PXL_20250621` (snout, and no head box). SAM 3.1's missing head is
   `Ducky/PXL_20250411`, which the painter doesn't read. That photo's hand-drawn
   box doesn't sit on the dog in the upright photo (0.27 and 0.23), so it's left
   out of the IoU row. SAM 2.1's outline on `Marty/IMG_4288` bleeds onto the head
   of the person behind him, which is a reason to try the API's masks. 74 calls
   on these photos plus 2 on a generated image, $0.19.

   The clean copies, 2026-11-04: 24 more calls, $0.06, $0.25 in all. On the six
   copies the chosen box is the same as on the original (IoU 1.00) and the head box
   0.98 to 1.00, so the covers changed nothing the painter uses. Sheets safe to
   show are in `var/explore/detect-sam3-clean/`, from `detect-sam3.json`; they still
   show people in Ducky's and Marty's photos, which Logan accepted, and a plant web
   page in `Stacey/IMG_20200516`.

2. **10-30 — the decision, and the open-models session**
   - [ ] `decision-10-30` — Logan. A shelter's grant in hand → the stretch:
     topdog's donate loop (ADR-0027 phases 3–5, account-less) ships on
     production and the demo includes a real donation. No grant → the base
     demo on the crew. Recorded above and in the roadmap row.
   - [ ] 12:00 ET: Fireworks on the Muse open models; decide the Glimmer
     maybe (below) after it.

3. **10-30 → 11-01 — the demo stack**
   - [ ] `demo-stack` — high, verify. A separate **small DigitalOcean
     droplet** for two weeks, not a second compose project on the production
     droplet: the browse-first launch (ADR-0028 as amended 2026-10-23) is
     happening on that box in the same days, and two stacks changing on one
     host in one week is the collision ADR-0028 §4 meant to avoid. Compose
     project `monsterpaws-meta`, Caddy, the app, a worker without
     `art.generate`, its own Postgres; hostname `meta.monsterpaws.org` (or
     the one Logan picks) in Cloudflare; seeded through the real pipeline
     as `e2e/` seeds `monsterpaws_e2e` (ADR-0017), with **rights-cleared
     animals only**: the crew as listings labelled the founders' pets, plus
     a shelter's animals under a grant. Oplog entries (ADR-0023) planned
     before touching it and at teardown after 11-10; `doc/infra.md`'s
     diagram carries the box while it exists. Verify: the stack cannot
     reach the production database (no credential for it anywhere on the
     box), and the crew pages say "not up for adoption".
   - [ ] `demo-surface` — medium. What a judge clicks: an animal page with
     the photo, the detection overlay (both pipelines, the chosen box and
     head), and the painted card; a page for the blind4 numbers. Nothing
     offers a donation unless the stretch shipped, and then the donate
     button goes to production's loop, not the demo's.
   - README: "demo stack, overlay pages" with commits and the oplog numbers.

4. **11-02 → 11-03 — the video, the write-up, the posts**
   - [ ] `video` — medium. Three minutes: frame one the delineation table;
     the problem (two cats on a chair, a litter, a hand); the listing's
     words becoming one phrase per call; the overlay, both pipelines; the
     blind4 numbers; the crop; the card painted on the home card arriving
     when it is ready; the live site; if the stretch shipped, Logan making
     a real $10 donation and the thank-you page. Every photo owned or
     consented (the waiver's warranty, ADR-0028 §9).
   - [ ] `write-up` — low. Problem, who benefits, the Meta piece and what
     it surfaced, what is new, next steps; links to monsterpaws.org, the
     branch, the plan, ADR-0028.
   - [ ] `posts` — low. The demo on X with the link submitted for Most
     Viral; the gallery entry; the shelters written to on 10-23 told where
     to vote (Community Vote, one per verified account, announced 11-16).
   - README: final table, every row with its commits.

5. **11-04 — submit before 21:00 ET**
   - [ ] `submit` — low. Repository public (it is; AGPL, ADR-0008), video
     link reachable, the branch and the plan linked, Logan listed. Submit
     by mid-afternoon; the last office hours are that evening.
   - [ ] `/gpu-health` again before 11-09; the pre-painted set ready for
     the live finals.

## Maybes (ADR-0028 as amended 2026-10-26, decision 3)
- **Muse Glimmer for the colour-word table** (Best Build on Open Weight
  Models, $10k): the detector's colour vote needs a word for each of the
  source's 161 colour entries, and Glimmer reads text and images. On the
  DigitalOcean GPU (`scripts/gpu-rental.sh`) or Modal's credits. Decide
  after the 10-30 session; only if phase 1 is done by then. A real need
  (ADR-0026 Consequences), never a prop.
- **Muse Image for the LoRA cleanup**: low. Qwen-Image-Edit's cleanup was
  rejected 2026-10-23 for restyling the brushwork; Muse Image would have to
  do better on the same 22 paintings, and anything trained on its output
  waits on the terms. Try only if a day is free.

## Risks
- **Delineation.** Disqualification is at the judges' discretion. The
  README table, the first frame and `git log --since=2026-10-27` are the
  three proofs; existing pieces are named as existing every time they
  appear.
- **The home card.** It paints the demo set and must be healthy to 11-09.
  Nothing else runs on it during the paint.
- **The production launch in the same week.** Topdog's browse-first launch
  and this branch's demo stack are separate boxes for that reason; the
  branch never deploys to the production droplet.
- **Shelter silence.** The base demo needs no shelter; the stretch does.
  The 10-30 decision is a date, not a hope.
- **A card on the Meta account.** The spend limit is set before the first
  call; the key lives on the branch only.

## What came back (filled at the end)
- (nothing yet; a piece returns to topdog only by its own ADR with a
  blind-set measurement — ADR-0028 §1)
