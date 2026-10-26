# 0001: The crew — the founders' pets on the home page

- **Granter:** Logan Bresnahan, founder, owner of all five pets and taker of
  the photos.
- **Date:** 2026-10-26.
- **Grant:** display of one real photo and one AI watercolour of each pet on
  monsterpaws.org's home section ("Meet the crew", roadmap item 3c), labelled
  the founders' pets, not up for adoption. Not a shelter grant: nothing here
  enters the registry (`src/core/shelters.ts`) or the corpus.
- **Basis:** the founder's own pets and his own photos; given in the working
  session that built the section, and in the commit that adds this file.
- **Files:** `public/brand/crew/<pet>-painting.jpg`, `<pet>-photo.jpg` (the
  whole photo, opened from the card) and `<pet>-thumb.jpg` (a square on the pet)
  (TRADEMARKS.md: all rights reserved), each re-encoded from pixels alone so
  no EXIF, GPS or generator metadata ships, the paintings and whole photos
  marked `monsterpaws.org` in the bottom-right corner; `tests/crew-assets.test.ts`
  fails on any metadata segment.

| Pet | Painting (Logan's pick) | Made by |
| --- | --- | --- |
| Plum | batch 12g, 007 | klein-v1 (11c), the anatomy traced out and repainted by klein Base |
| Marty | batch 11b, 020 | klein-v1, as painted |
| Beetle | batch 12g, 029 | klein-v1 (11b), the anatomy traced out and repainted by klein Base |
| Stacey | batch 11c, 023 | klein-v1, as painted |
| Ducky | batch 12h, 022 (w0.0018) | klein-v1 (11a), the anatomy traced out, repainted by klein Base, a line inked after |

The batches are read in `doc/plans/base-model-candidates.md` (ADR-0004 as
amended 2026-10-23). Revoking is deleting the files and this section in one
commit.
