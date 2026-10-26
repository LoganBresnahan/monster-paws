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
- **The Model API terms, read in full:** do outputs feed training? Needed
  only if Muse Image or Glimmer output trains anything. *Status:* (unread)

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
   - [ ] `sam3-client` — medium, moderate. In `comfyui/detect.py`, a `sam3`
     entry for `DETECT_PIPELINES`: one Responses call per (photo, phrase),
     `stream: false`, `metadata.include_confidence: "true"`, the image as a
     base64 data URL; records parsed from the `<0f>` grammar
     (`meta-sam-parser`, pinned, or a 40-line parser of our own if the
     package drags dependencies into the explore image); the **raw
     response cached per (photo, phrase)** beside OWLv2's raw boxes, so
     rules change without another API call and the whole run replays
     offline. Zero matches is a normal result and an empty pool for that
     phrase. Trap: one noun phrase per call — a list returns nothing.
   - [ ] `sam3-prompts` — low. The same four asks as OWLv2, one call each:
     the species, the species with its colour, the species' head, the other
     common species. Masks come from the API, so SAM 2.1 is skipped for
     this pipeline and the measured-colour vote reads the API mask.
   - [ ] `sam3-rules` — medium. The candidate rules and the six votes run
     unchanged on sam3's pool; floors re-derived from its confidence scale
     on set1 only (the seen set), never on blind4. Record every floor and
     why in this file.
   - [ ] `sam3-measure` — medium, verify. Run owlv2 and sam3 on set1,
     holdout and blind3 (seen; for debugging), then **once** on blind4,
     both pipelines, same photos, same listings. Table here: chosen-right
     per set, margins, head-box hits, seconds a photo, dollars. Whichever
     wins blind4 paints the demo; the loser is still in the video as the
     comparison. If sam3 wins, ADR-0026's revisit trigger fires for the
     open-weight question — on topdog, later, not here.
   - [ ] `sam3-crops` — low. The chosen box and head box into the existing
     crop step; the crew painted by klein-v1 on the home card from sam3's
     crops (`comfyui/guard.sh batch`, the usual rules). These are the demo
     cards and the pre-painted set for the finals.
   - README: "sam3 pipeline, prompts, measurement, crops" with commits.

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
