---
name: shipshape
description: Verify Monster Paws is shipshape — tests cover the public surface (suite green twice), docs (DIRECTION/roadmap/ADRs/CLAUDE.md) match the code, and the domain conventions hold (append-only corpus, derived embeddings, trust hierarchy, R2-keys-not-blobs, no unattested claims in generated text). Use after substantive changes, before commits, or when asked whether the project is in order.
---

# /shipshape — repo verification pass

Three gates: **Tests**, **Docs**, **Conventions**. Check all three even if one
fails early — the deliverable is the full report, not the first failure.
Propose fixes; do **not** apply them unless the user asks.

**Pre-scaffold guard:** if the repo has no code yet (roadmap item 1 unshipped),
run the Docs gate only and say so — don't fabricate test results.

## 0. Scope the audit

```bash
git status --short && git diff HEAD --stat
```

Uncommitted work is the primary audit surface; spot-check the rest. Full
audit only when asked.

## 1. Tests gate

The suite must be green **twice in a row** (the flaky bar — queue- and
timing-sensitive tests must survive a loaded machine):

```bash
npm test
npm test
```

Also: `npm run typecheck` clean, and `npm run e2e` (Playwright) green against
the dev build. E2E against the *production* build is `/deploy`'s job, not
this gate's.

Coverage is judged by **behavior mapping**, not a percentage. Enumerate the
public surface in scope and name the test that pins each behavior. The
standing high-value surfaces (grow this list as they're built):

- **Entity resolution / normalizer**: same animal across two feeds merges;
  distinct animals don't; trust hierarchy picks shelter-API facts over
  aggregator facts; recency breaks ties within a tier.
- **Append-only invariants**: corrections create rows, never mutate;
  re-ingesting an identical payload is idempotent.
- **Attestation sign/verify**: round-trip verifies; any byte tampered fails;
  a claim verifies from the R2 flat file alone (no DB).
- **Eval scorers**: faithfulness scorer flags a fabricated care claim;
  CLIP-QC scorer ranks a real-photo match above a wrong-dog image (golden
  fixtures).
- **Donation flow e2e**: browse → donate (Every.org test mode) → card appears
  in collection.
- **Weekly confirm e2e**: event queue renders → confirm-all → attestations
  published.

A new or changed public behavior with no test naming it = **gap**.

## 2. Docs gate

**ADRs** (`doc/adr/NNNN-slug.md`, Nygard style). Any **decision** in scope —
new dependency, changed contract or algorithm, pattern adopted or rejected —
needs an ADR or a superseding update. Implementation detail is not a decision.

**Roadmap** (`doc/roadmap.md`): shipped work checked off; frontier matches
reality; deferred sub-tasks pinned as carry-ins, not dropped.

**DIRECTION.md**: still describes what the product actually is — loop, tiers,
money rails, bright lines. Scope changes land here, not just in code.

**CLAUDE.md Commands**: every listed command still exists and runs.

Drift check, per doc that names code artifacts:

```bash
git log -1 --format='%ct %h' -- doc/<doc>.md
git log -1 --format='%ct %h' -- <files it describes>
```

If a source is newer than the doc, read the diff since the doc's commit and
either confirm the doc still matches or name the exact stale claim.

## 3. Conventions gate

Domain conventions, each checkable — everything flagged is a violation unless
listed as an allowed escape. (Tighten these greps to exact schema/file names
at scaffold time; the invariants are settled now.)

**Append-only corpus** — no UPDATE/DELETE against raw-payload or event-log
tables anywhere in app code:

```bash
grep -rn "update\|delete" src --include='*.ts' | grep -i "rawPayload\|eventLog\|event_log\|raw_payload"
# expect: no hits outside migrations/ and tests/
```

**Derived embeddings** — every embedding write carries its model id:

```bash
grep -rn "embedding" src/db --include='*.ts' | grep -v "embedding_model\|embeddingModel"
# review any hit that inserts vectors without a model id
```

**Images are keys, not blobs** — no base64/bytea image storage; DB stores R2
keys only:

```bash
grep -rn "base64\|bytea" src/db --include='*.ts'
# expect: no image-related hits
```

**Attestation mirror** — every attestation publish path also writes the R2
flat file (grep the publish service for the R2 write; its absence is a
violation of ADR-0003's survivability property).

**Bright lines** — no rarity fields on animals, no trade/transfer surface, no
countdown/streak/scarcity UI copy:

```bash
grep -rni "rarity\|legendary\|streak\|only [0-9]* left" src
# expect: no hits
```

## 4. Report

```
SHIPSHAPE REPORT
  tests        ✓|✗   <n>/<n> twice · typecheck clean · gaps: <behavior lacking a test, or none>
  docs         ✓|✗   ADRs current · roadmap frontier true · drift: <doc: stale claim, or none>
  conventions  ✓|✗   violations: <file:line, or none>
```

For every ✗, list the concrete fix (file:line, what to change). All green →
the ship is shipshape. 🐕
