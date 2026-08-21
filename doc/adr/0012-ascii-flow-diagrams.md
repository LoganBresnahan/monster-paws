# ADR-0012: Process and data flows are ASCII diagrams in `doc/flows.md`

## Context
`doc/infra.md` has carried three ASCII diagrams (deployment, CI/deploy, data
custody) since ADR-0007, under a same-commit rule: change the deployment
shape, update the picture. The rule held — the R2 credential split (ADR-0011)
updated both diagrams in the commit that made it. Nothing equivalent existed
for what moves *through* the system. The ingest pipeline's four stages, the
stage-1-only boundary of the live RescueGroups poll, the vault-before-observe
ordering, the per-field trust merge and the three consent gates were each
stated in prose across an ADR, a plan and several code comments, and the one
thing prose states worst — where a boundary sits, what is built and what is
planned — is exactly what an agent or a reviewer arriving mid-file needs.

Three formats were on the table: ASCII in markdown, Mermaid fences, rendered
images.

## Decision
1. **One file, `doc/flows.md`, holds every process and data flow diagram.**
   ADRs link to it ("see `doc/flows.md` § RescueGroups daily poll") and do
   not embed diagrams. An ADR is a decision and gets superseded; a diagram is
   the current shape and gets updated. Keeping them apart is what kept
   infra.md's pictures alive. `doc/infra.md` keeps the deployment, CI and
   custody diagrams — its lane is *where things run*, flows.md's is *what
   moves*.
2. **ASCII, in fenced code blocks.** The same idiom infra.md already uses.
   Every box names a real symbol, table or key shape, so a diagram is a grep
   target against `src/` in both directions, and a shape change is readable
   in a plain `git diff`.
3. **Each diagram cites its governing `ADR-NNNN`** in its heading, and a
   stage that is not built yet is marked `(planned, phase N)` or
   `(planned, item N)`. Shipped and planned must be distinguishable at a
   glance, or the diagram lies about the frontier.
4. **Same-commit rule.** Change a flow's shape — a stage added or removed, a
   boundary moved, an external call added — and the diagram changes in the
   same commit. CLAUDE.md carries the rule; `/shipshape`'s Docs gate checks
   it mechanically: every identifier boxed in flows.md must still resolve in
   `src/`, and a diff touching a file a diagram names triggers a re-read of
   that diagram.
5. **Gate on "a flow changed", not "an ADR exists".** Most decisions (license,
   logging, a client library) have no flow. A diagram-per-ADR rule would
   produce decorative boxes and bury the four that matter.

## Consequences
- Five diagrams exist as of this ADR: ingest pipeline stages, RescueGroups
  daily poll, consented scrape vault path, trust-hierarchy merge, consent
  grants. Two reflect running code end to end; the others mark their
  unbuilt stages.
- A refactor that renames a boxed symbol fails `/shipshape` until the
  diagram follows — that friction is the point.
- Sequence-shaped flows (the RescueGroups call) are drawn as vertical
  lifelines in ASCII. That is fine at the current scale (≤ 3 participants)
  and is the first thing to strain.
- Diagrams are not a second copy of an ADR's reasoning. A caption is one or
  two sentences naming the invariant and pointing at the ADR.

## Alternatives
- **Mermaid fences.** Diffable text, and GitHub renders it. Rejected: the
  layout is the renderer's, so neither the author nor an agent can verify
  what the reader sees; the *shape* of a change is unreadable in a diff;
  rendering differs between GitHub, VS Code and a terminal, and the
  terminal is where most of this repo gets read. Mixing two dialects with
  the existing infra.md diagrams would be worse than either alone.
- **Rendered images (PNG/SVG, draw.io, Excalidraw).** Rejected: not
  greppable, not diffable, need a tool to edit, and drift is invisible
  until someone opens the file.
- **Diagrams inside each ADR.** Rejected for the supersession reason in
  decision 1.
- **Prose only, in the ADR and code comments.** The status quo. Rejected:
  the boundaries it describes worst are the ones that matter most.

## Revisit triggers
- A flow needs more than ~4 participants in a sequence, or a box grid wider
  than ~90 columns — ASCII is straining and Mermaid's sequence diagrams
  become the cheaper option for that flow.
- flows.md exceeds ~10 diagrams — split by domain (ingest / donation /
  attestation), same rules per file.
- The shipshape identifier check produces more false positives than catches
  across three consecutive runs — tighten the box vocabulary or drop to a
  by-hand read.
