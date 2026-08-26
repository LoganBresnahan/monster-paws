# ADR-0016: A living style guide at /design

## Context

The brand system is nine color tokens, one radius and a feel ("cuddly") in
`src/app/globals.css`, with no place to see them together. Animal pages
(ADR-0015 phase 3) are the first real UI, and the design decisions they need
— type scale, card shapes, states, dark mode — are hard to make from hex
codes. Logan wants to iterate visually, and an LLM building pages needs the
same reference.

## Decision

- `/design` is a dev-only route (`notFound()` in production) rendering every
  token and every reusable pattern the site uses, in light and dark.
- Color values are read from the live stylesheet, never re-listed: the page
  cannot drift from `globals.css`. The token *roster* lives in
  `src/ui/tokens.ts`; a token missing there is the only possible drift.
- Dark mode is forceable via `html[data-theme]` in addition to the OS
  preference, so both themes can be reviewed on one screen.
- When a pattern on `/design` is used by a second page, it becomes a
  component under `src/ui/` and `/design` renders the component, not a copy.

## Consequences

- Design conversations happen against the page, and a proposal is a section
  on it before it is a component.
- The dark token block is duplicated in CSS (a selector list cannot span a
  media query); `/design` makes a mismatch visible.

## Alternatives

- Storybook: real, but a dependency and a second build for a nine-token
  system. Revisit at ~10 components.
- Figma / design-tool source of truth: no designer on the team; design-in-code
  was chosen 2026-07-29.

## Revisit triggers

- More than ~10 components in `src/ui/` → evaluate Storybook.
- A designer joins → revisit the source of truth.
