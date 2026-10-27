# ADR-0030: Link previews — every page sends a card, one brand image until a shelter's photo may be it

Status: accepted (2026-10-27). Decisions agreed with Logan 2026-10-27.

## Context
monsterpaws.org launched on 2026-10-27 (oplog 0001) sending no Open Graph
or Twitter card tags: `src/app/layout.tsx` set a title and a description
and nothing else. A link pasted into LinkedIn, X, Slack, Discord or
iMessage therefore rendered as a bare title, found while drafting the
first launch post the same day (`doc/issues.md`, now removed).

Shared links are how donors arrive — DIRECTION.md's share moment is "the
viral loop" — and `robots.ts` already refuses to fence the preview
fetchers out for that reason (ADR-0024). The brand plan has carried an
og-image since 2026-07-29 and never built it. ADR-0028's Most Viral prize
is scored on X engagement to 2026-11-08, and the launch post goes out this
week, so the card has to exist before either.

What constrains the image:

- **A listing's photo is licensed for display on our pages**
  (`aggregator-display`, ADR-0006 as amended 2026-08-25), and
  `generateMetadata` on the animal page already keeps the licensed
  description out of the meta tags because "a meta tag is syndicated far
  past" the page. A photo in `og:image` is cached and shown by every
  platform the link lands on, off our pages and outside our purge.
- **The crew's paintings are ours** (ADR-0008's brand carve-out;
  `doc/consent/0001-the-crew.md`), pixels only, each marked
  `monsterpaws.org · 2026` in the corner (ADR-0022, open question), so a
  shared image leads back to us. The consent record covered the home
  section only.
- Platforms favour 1.91:1 (1200×630) and crop other shapes to it in the
  feed, centred; the paintings are 1216×832 (1.46:1), and Beetle fills her
  frame from ears to paws, so any 1.91:1 version of her loses the head or
  the paws.
- Next's file convention (`src/app/opengraph-image.jpg` plus `.alt.txt`)
  emits the `og:image` and `twitter:image` tags with width and height, and
  the `metadataBase` in the root metadata makes the URLs absolute.
  Generating the image in code (`ImageResponse`) needs fonts bundled and a
  render per build for a picture that changes when Logan changes his pick.

## Decision

### 1. Every page sends an Open Graph and a Twitter card
The root metadata sets `metadataBase` to `https://monsterpaws.org`,
`openGraph` with the site name, locale and `type: "website"` only, and
`twitter.card: "summary_large_image"`. **No page sets `openGraph`, and the
root's carries no title, description, url or images.** Next's resolver
(`inheritFromMetadata`, read 2026-10-27) fills the card's title and
description from each page's own `title` and `description` after the
segments merge, and merges the root's image file in beside them; a
page-level `openGraph` object replaces the inherited one whole, image and
site name included, which the first build of this slice proved on
`/animals`. No `og:url` is sent: a platform takes it as canonical, so the
shared address stays the one pasted. Card text follows the rule the animal
page already keeps: **our own words, never the licensed description**.

### 2. One brand image for every page, built from the crew files
`src/app/opengraph-image.jpg` is Beetle's painting (Logan's pick,
2026-10-27; batch 12g, 029) **as it is, 1216×832, uncropped and unscaled**,
with the wordmark laid over the backdrop to her left, as large as the
space beside her allows and never touching her (Logan, the same day). The
script reads her silhouette from the ink row by row and takes the widest
spot beside her nearest her middle, so the wordmark sits on the wash where
she narrows rather than being held back by her tail, and a different pick
places it afresh. The platforms do their own 1.91:1 crop in the feed;
the full painting is what a click or a hover shows. `scripts/og-image.ts` (`npm run og:image`) builds it from
`public/brand/crew/` and `public/brand/wordmark-v1.png` with `sharp`,
which Next already installs for the image optimizer and is now a named
dev dependency; the file is committed, never hand-edited, and rebuilt by
the command when the pick changes. `tests/crew-assets.test.ts` holds it to
the crew's rule: pixels only, no metadata segment. The alt text names the
dog and the product. The consent record is extended to off-site display
of the crew's paintings and photos in link previews and in posts Logan
writes.

### 3. Never a listing's photo in a card until its licence says so
Animal pages carry the brand image. A listing's hotlinked photo enters
`og:image` only for a shelter whose grant covers it (first-party tier,
ADR-0006 decision 6, recorded under `doc/consent/`), or after
RescueGroups' terms are read for syndication and the reading recorded in
`doc/rescuegroups-api-terms.md`. Until then a cat's link shows a
bloodhound, and that is the honest card.

### 4. Verified by e2e
`e2e/previews.spec.ts` asserts, on the home, browse, animal, claim and
demo pages, that `og:title` and `og:description` match the page's own
`<title>` and description, `og:site_name` is set, no `og:url` is sent,
`og:image` is absolute under `metadataBase`, `twitter:card` is
`summary_large_image`, and the image route answers `image/jpeg` at the
painting's 1216×832.

## Consequences
- The launch post and the hackathon posts get a card with Beetle on it.
- Every page shares the one image. Per-page images are a `generateMetadata`
  change on the page that needs one, and an `opengraph-image` file in any
  segment overrides the root's; nothing here has to be undone.
- Changing the pick is `npm run og:image` and a commit; the script, not a
  design tool, is the record of how the file was made.
- `sharp` appears in `devDependencies` at the version Next's lockfile
  already pins; no new code reaches the lockfile.
- ADR-0022's open question (a mark on a donor's keepsake) is untouched: the
  mark that travels here is the crew's.
- `og:image` is absolute under `https://monsterpaws.org` on every
  environment, including e2e's `:3100` and the hackathon's demo stack
  (ADR-0028 §4): the demo stack's cards show production's image, and the
  link itself stays the demo stack's.

## Alternatives
- **The wordmark alone on cream.** Safe and dull; the painting is the
  product, and the mission says ship the one that inspires more joy.
- **Ducky's photo beside her painting.** The pair explains the product in
  one frame; Logan chose Beetle's painting alone, and the pair is a post's
  image rather than every page's. Open as a later pick.
- **A generated image per page (`ImageResponse`).** Fonts, a render per
  build, and a text layout for one picture that is a hand-picked painting.
  Rejected until a page needs its own words in the image.
- **The animal's own photo on its page.** The best card and the one the
  licence does not cover. Deferred by decision 3.
- **A 1200×630 card.** Built three ways first (a wordmark column beside
  the painting, the painting centred on matching paper, a full-width crop
  that kept the head and lost the paws); Logan rejected the added paper
  and the crop alike: the painting as it is, the wordmark on it.

## Revisit triggers
- A shelter's first-party grant: that shelter's animals may carry their own
  photo on their cards (decision 3).
- RescueGroups' terms read for syndication of photos.
- The donor's keepsake ships (ADR-0022): a collection page's card wants the
  keepsake, which is the donor's, and the mark question must be settled.
- The mascot icon arrives (the brand plan's green M): a square avatar for
  the social accounts, not this image.
- A platform changes its ratio or size limits (X's 5 MB, Facebook's 8 MB;
  the build fails on either), or a feed's centre crop of the 1.46:1
  painting cuts Beetle badly enough to want a 1.91:1 pick.
