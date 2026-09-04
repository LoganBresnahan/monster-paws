# ADR-0018: Source prose is entity-decoded at render, by our own table

## Context
The first real detail page (ADR-0015 phase 3, roadmap item 3) rendered a live
RescueGroups description and showed the reader `I&#39;m a chill girl.&nbsp;`.
The display layer stores what the source published, and RescueGroups publishes
`descriptionText` HTML-encoded.

Measured on the rebuilt 2026-09-04 corpus, not assumed:

- 32,298 of 45,139 stored descriptions (72%) contain at least one entity.
- Zero contain an HTML tag — `descriptionText` is already tag-stripped upstream.
- The named entities are a long tail: `&nbsp;` 220,693, `&rsquo;` 59,861,
  `&#39;` 43,715, `&mdash;` 15,161, down through accented letters, `&frac12;`,
  `&zwj;` and mojibake like `&acirc;`.

Nothing else needs this: 0 of 64k `org_name`, `listing_org` and `breed` values
carry an entity, and exactly one animal `name` does.

## Decision
1. **Decode at render, never at promotion.** `animal_display.description`
   keeps the source's bytes verbatim, and `decodeEntities` (`src/ui/text.ts`)
   runs in the page. The stored row stays a faithful copy of what the source
   published, replay rebuilds it identically, and a decoding bug is fixed by a
   deploy rather than by a re-poll of 64k records.
2. **Decoding is not editing.** ADR-0015 decision 4 renders the shelter's words
   verbatim as a quotation; reading the encoding they were published in is what
   makes that true, not an exception to it. Nothing is trimmed, reordered or
   summarized.
3. **Our own table, no dependency.** The named set is the one the corpus
   contains, plus the punctuation a shelter keyboard produces; numeric entities
   (decimal and hex) decode generically. **An unknown name is left standing
   verbatim** — a wrong guess puts a character in a shelter's mouth, a literal
   `&hearts;` is merely ugly.
4. **The output is a text node, never markup.** `dangerouslySetInnerHTML` is
   what would turn this from decoding into injection; a decoded `&lt;script&gt;`
   in a text node is four harmless characters. Malformed numerics, lone
   surrogates and out-of-range code points return the original text rather than
   throwing, because one bad character in one listing must not take down a page.

## Consequences
- One more place that must be updated if a second source publishes prose in a
  different encoding; the trap is a normalizer that decodes on the way IN,
  which would make the corpus and the page disagree about what was published.
- The table is incomplete by construction. That is visible (a literal entity on
  a page), not silent, and the fix is one line.
- 72% of detail pages read as their shelter wrote them instead of as their
  shelter's CMS encoded them.

## Alternatives
- **A dependency (`he`, `entities`).** Rejected for v1: complete tables for a
  problem whose measured surface is one field on one source, against a
  dependency in the render path of every page. The revisit trigger below is
  where this comes back.
- **Decode in the normalizer, store decoded text.** Rejected: the display row
  stops being what the source published, and every fix needs a replay over the
  corpus rather than a deploy.
- **Render with `dangerouslySetInnerHTML`.** Rejected: it would make a shelter's
  listing text executable in our page for the sake of characters we can decode
  safely. `descriptionText` carries no tags to honour anyway.

## Revisit triggers
- Literal entities show up on a page from a source we do not control — take the
  dependency instead of growing the table.
- A source publishes prose WITH tags (a scrape of shelter HTML is the likely
  one) — that is a sanitization decision, not this one, and needs its own ADR.
- The decoded output is ever passed to the update-generation pipeline (item 8)
  — decide there whether the model reads stored or rendered text.

## Amendment (2026-09-04): whitespace is tidied at render too

Dogfooding the first detail pages: one description rendered ~4,000px tall and
was mostly empty, because the source's CMS writes paragraph gaps as lines
holding a single `&nbsp;`. Decoding alone turned five characters into one
invisible one — the blank lines stayed.

`tidyWhitespace` (`src/ui/text.ts`) therefore runs after `decodeEntities`, in
that order and only in that order, and does exactly two things: strips trailing
whitespace (non-breaking space included) per line, and collapses any run of
blank lines to one.

It is deliberately **vertical only**. Runs of spaces inside a line are left
alone and nothing is rewrapped: an indented fee table is the shelter's
formatting, and this ADR's line — presentation of their words, never editing of
them — is what says we may fix the encoding and not the prose. The document's
own leading and trailing blank space is trimmed; indentation inside it is not.
