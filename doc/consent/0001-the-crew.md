# 0001: The crew — the founders' pets on the home page

- **Granter:** Logan Bresnahan, founder, owner of all five pets and taker of
  the photos.
- **Date:** 2026-10-26.
- **Grant:** display of one real photo and one AI watercolour of each pet on
  monsterpaws.org's home section ("Meet the crew", roadmap item 3c), labelled
  the founders' pets, not up for adoption. Not a shelter grant: nothing here
  enters the registry (`src/core/shelters.ts`) or the corpus.
- **Extended 2026-10-27 (ADR-0030):** the same paintings and photos in the
  site's link-preview card (`src/app/opengraph-image.jpg`, built from Beetle's
  painting by `npm run og:image`) and in posts Logan writes about Monster
  Paws on his own accounts, which is off-site display the original grant did
  not name.
- **Extended 2026-10-27 (ADR-0032):** bands of Beetle's painting as the cover and
  header of the project's own social accounts (LinkedIn, X, Bluesky), built by
  `npm run social:assets`.
- **Extended 2026-10-27 (ADR-0029):** Beetle's painting as the one image in the
  shelter outreach ask (`ASK_IMAGE` in `src/core/outreach/template.ts`), loaded
  from monsterpaws.org into a shelter's inbox — Logan's choice the same day, as
  the face of Monster Paws everywhere.
- **Extended 2026-11-03 (ADR-0036, ADR-0028):** the crew's photos as the source of keepsakes painted for the
  Meta demo; those paintings on public share pages at monsterpaws.org; and the crew's photos, with their
  metadata removed, sent to Meta's Model API to find the animal in each one, except `Plum/downloadfile.jpg`,
  which never goes to Meta. Meta doesn't train on these, but it may keep them with no time limit.
- **Basis:** the founder's own pets and his own photos; given in the working
  session that built the section, and in the commit that adds this file.
- **Files:** `public/brand/crew/<pet>-painting.jpg`, `<pet>-photo.jpg` (the
  whole photo, opened from the card) and `<pet>-thumb.jpg` (a square on the pet)
  (TRADEMARKS.md: all rights reserved), each re-encoded from pixels alone so
  no EXIF, GPS or generator metadata ships, the paintings marked
  `monsterpaws.org · 2026` and the whole photos `monsterpaws.org` in the
  bottom-right corner; `tests/crew-assets.test.ts`
  fails on any metadata segment.

| Pet | Painting (Logan's pick) | Made by |
| --- | --- | --- |
| Plum | batch 38d, 015 | klein-v1, as painted: three-quarter view, collarless words |
| Marty | batch 37a, 004 | klein-v1, as painted: colour reworded as batch 11b |
| Beetle | batch 35a, 039 | klein-v1, as painted |
| Stacey | batch 37a, 020 | klein-v1, as painted |
| Ducky | batch 35a, 023 | klein-v1, as painted |

Portraits since 2026-11-03. Logan: "we are going to do portraits because we can't guarantee a clean body.
so the crew photos need updated." Only the paintings changed, and the real photos and thumbs are as they
were. None of these went through the hand step, unlike the earlier picks, which git keeps. The batches are
read in `doc/plans/base-model-candidates.md` (ADR-0004 as amended 2026-11-03). The link-preview card, the social banners and the image in shelter outreach (the 2026-10-27 extensions
above) keep Beetle's earlier full-size painting. Logan: "keep full size beetle". That is batch 12g, 029,
made by klein-v1 (11b), the anatomy traced out and repainted by klein Base, kept pixels only as
`public/brand/crew/beetlefull-painting.jpg`, which no page shows; `src/app/opengraph-image.jpg` is unchanged.
Revoking is deleting the files and this section in one
commit.
