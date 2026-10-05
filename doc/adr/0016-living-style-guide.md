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

## Amendment (2026-10-02): the site is light for everyone; dark is opt-in

The original decision let the OS preference switch the whole site to the dark
palette. Logan decided the site starts with one look: the cream ground is the
brand, and a single theme is one thing to get right before launch instead of two.

### Decisions
1. **No attribute means light, on every OS.** The `prefers-color-scheme: dark`
   block no longer applies by itself. It now matches only
   `<html data-theme="system">`, so the follow-the-OS code is kept and
   reviewable, but nothing turns it on for visitors.
2. **The dark tokens stay**, reachable through `data-theme="dark"` or
   `"system"`. `/design`'s toggle (light · system · dark) is the only thing that
   sets them.

### Consequences (added)
- A visitor on a dark OS sees the cream site. Native controls follow the page,
  which declares no `color-scheme`, so they stay light too.
- Turning dark mode on for visitors later is one change in one place: either
  set the attribute site-wide, or widen the media query's selector back to
  `:root:not([data-theme="light"])`.

### Revisit triggers (added)
- Visitors ask for dark mode, or analytics (if they ever exist) show
  late-night reading patterns where a dark ground would matter.
