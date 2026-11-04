# ADR-0036: A keepsake's paintings get a public page of their own, with no donor on it

Status: proposed (2026-11-03). Logan asked for the page and chose its bucket. Accepting this ADR is his,
along with the consent line for `doc/consent/0001-the-crew.md`.

## Context
Logan, to the moderator, 2026-11-03: "no lets build the share page that opens form the email".

Until now a painting has gone by email only. ADR-0022 as amended 2026-11-02 rests on that: "Nothing is
taken down, because there are no public paintings", and ADR-0035's question 2 repeats it. **This ADR
reverses that clause for anything published here.** Both ADRs keep their recorded wording.

A share link on X, Facebook, LinkedIn or Bluesky carries only a URL, and the platform builds its card
from that page's `og:image`, so a chosen painting needs a URL of its own. Instagram and TikTok have no
share link, so the image file itself has to reach the phone's share sheet.

Production has no keepsake rows to read: the first paintings are made on a local database. So the page
reads published files, not the database.

## Decision
1. **Three routes under `/share`.** `/share/<token>` shows the four paintings and is the email's link.
   `/share/<token>/<n>` (1 to 4) shows one, with its own card. `/share/<token>/<n>/painting.jpg` is the
   image. Not on `/thanks`, which Logan ruled out, and not under `/demo/`, which `robots.ts` closes.
2. **Its own token.** 128 random bits as 22 base64url characters, never the intent id or the `/thanks`
   token. It is checked against `^[A-Za-z0-9_-]{22}$` before any key or URL is built, and error reports
   scrub it (`SECRET_IN_PATH`).
3. **Nothing about the donor.** No login and no cookie. The manifest holds a name and a kind, and
   `parseManifest` keeps those two fields whatever else a file holds, so an address, amount, intent id
   or donor name can't reach a page.
4. **Crew only for now.** `npm run share -- publish` takes a slug from `CREW` and refuses anything else.
   That holds until Logan decides what a shelter's withdrawal or a rights objection does to a shared
   painting. **Before any real donor's page:** a `/privacy` line, and shelters told, Spencer first.
5. **The source is a base URL from config, and that is `monsterpaws-media`.** `SHARE_BASE_URL` holds
   `share/<token>/manifest.json` and `share/<token>/<n>.jpg`. Logan, 2026-11-03: "yes bucket okay. its
   currently private switch it if you can". So it is `https://media.monsterpaws.org`, public through
   that hostname, with no R2 secret on the droplet (`doc/oplog/0026-media-public-write-key-first-publish.md`).
   **Public access is bucket-wide, so a photo held for painting never goes in this bucket**, and neither
   does a shelter animal's painting until the decision in 4 is made. Unset, every share page is a 404.
   Only the loader knows the source, so it can move to the database later without touching a page. Only a
   404 means "not published": any other failure is reported, so a broken source can't pass for a takedown.
6. **Images go through our own route, unoptimized.** The card's URL stays on monsterpaws.org, and
   `next/image`'s optimizer never keeps a second copy that a takedown wouldn't reach.
7. **Out of search, open to preview bots.** `noindex` in the page and `X-Robots-Tag` on the image, and
   never a `robots.txt` fence: a fenced page can't show a crawler its `noindex`, and it stops the preview
   bots too.
8. **The card is the painting.** `/share` is the one sanctioned exception to `layout.tsx`'s rule against
   a page-level `openGraph`. Next can stream metadata into `<body>` for an agent off its bot list, and
   Bluesky's fetcher is off it. Measured on a production build with the source slowed by 1.5 s: `og:image`
   is in `<head>` for every agent, because each page awaits the same data as its metadata. An e2e test
   pins that on raw HTML, for `/share` and `/animals/[id]`.
9. **Save everywhere, and three ways to share.** Save is a same-origin download. The four platforms are
   plain links, never a widget or a platform's script (ADR-0032). Where the browser can share files,
   `navigator.share` hands over the image file alone, fetched ahead of the tap, for Instagram and TikTok.
   Instagram has no share link, but Logan asked to see it: "i don't see instagram which would be nice". So
   it gets a button that opens that sheet, or, with no sheet, saves the image and says to post it by hand.
10. **Publishing proves itself.** The command re-encodes from pixels alone, refuses any size but
    1216×832, reads each upload back by hash, and writes the manifest last, so a failed upload leaves no
    page. It prints each hash and the URL. Real writes go under an oplog entry and use the pair already
    in `pass`. Logan: "the cloudflare api tokens are already in pass. they are the generic named ones not
    models or vault. these apply to monsterpaws-corpus and monsterpaws-media". That pair can also write
    the corpus, so the bucket is the constant `SHARE_BUCKET`, the tool refuses any other
    `SHARE_WRITE_BUCKET`, and it accepts only the exact keys of a share:

        SHARE_WRITE_ENDPOINT="$(pass show cloudflare/r2-endpoint | head -n1)" \
        SHARE_WRITE_ACCESS_KEY_ID="$(pass show cloudflare/r2-access-key-id | head -n1)" \
        SHARE_WRITE_SECRET_ACCESS_KEY="$(pass show cloudflare/r2-secret-access-key | head -n1)" \
          npm run share -- publish <crew-slug> <1.png> <2.png> <3.png> <4.png>

11. **Takedown means deleting the token's files and purging Cloudflare.** `npm run share -- takedown
    <token>`, with those keys plus `SHARE_BASE_URL=https://media.monsterpaws.org`, `CLOUDFLARE_ZONE_ID` and
    `CLOUDFLARE_PURGE_TOKEN`, deletes the manifest first, so the page goes at once, then every painting, and
    confirms each one reads back absent. It then purges the pages, the images and the files on the media
    hostname. Cloudflare holds an image for up to a month, so a takedown isn't finished until the purge
    runs: without the purge's keys the command says so and exits 2. It refuses to start without an https
    `SHARE_BASE_URL`, which would leave the media hostname's copies unpurged.

## Consequences
- A published painting is public to anyone holding the link, and a link can travel anywhere.
- **A takedown can't reach everything.** A platform's cached card and a saved copy outlive it, the same
  limit ADR-0030 records for cards.
- The crew's consent record doesn't cover this page until Logan's line is in
  `doc/consent/0001-the-crew.md`.
- Anything in `monsterpaws-media` is public to whoever has its key. The hostname lists nothing, a token
  can't be guessed, and our pages link only to our own routes. The media hostname itself sends no
  `noindex`, so its files stay out of search only because nothing links to them.
- `doc/flows.md`'s keepsake-art flow and `doc/infra.md`'s diagram still name this bucket for card art and
  original photos. Both need correcting before anything but a crew painting is stored.
- `/deploy`'s image run doesn't cover these routes: `e2e/share.spec.ts` skips under `PW_BASE_URL`, since
  the container has no `SHARE_BASE_URL`. The oplogs check them on the live site instead.
- Only a real phone proves the share sheet offers Instagram and TikTok. e2e stubs that path, because
  desktop Chromium on Linux has no `navigator.canShare`.

## Alternatives
- **On `/thanks`.** Logan ruled it out (ADR-0035, question 2): the page is visited long before a painting
  exists.
- **Under `/demo/`.** `robots.ts` closes it, which stops the preview bots.
- **One URL with a query for the painting.** Platforms key their cards loosely on a query. A path is plain.
- **Reading the database.** Production has no rows yet. The loader leaves this open.
- **A separate public `monsterpaws-share` bucket.** The moderator's recommendation, and it would leave
  media private. Logan chose media, which was built to be served publicly (ADR-0011).
- **Signed reads of a private `monsterpaws-media`.** It works, but it puts a read pair on the droplet, and
  compose gives both containers the same `.env`.
- **`htmlLimitedBots: /.*/`.** Proposed first, then measured as unneeded, and it changes every page.

## Revisit triggers
- Logan decides what a withdrawal or a rights objection does to a shared painting (decision 4).
- Anything that must stay private is wanted in `monsterpaws-media`.
- Keepsake rows reach production, so the loader can read them.
- A takedown is asked for and can't be completed by the rule in decision 11.
- The raw-HTML test fails, because Next stopped keeping metadata in `<head>` for these pages.

The flow is in `doc/flows.md`.
