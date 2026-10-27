# ADR-0032: Social accounts — three channels, one name, posted by hand, nothing a licence does not cover

Status: accepted (2026-10-27). Decisions agreed with Logan 2026-10-27.

## Context
monsterpaws.org is live (oplog 0001) and the first post about it is being
drafted. Until today Monster Paws had one social presence: a LinkedIn
company page Logan made on 2026-10-26, with the wordmark on white and a
description that promised "100%" of every donation to the shelter, which
card fees mean we cannot guarantee and which the site itself stopped
saying (the site says "we keep $0", ADR-0027). The hackathon needs an X
account: Most Viral is scored on X engagement to 2026-11-08 and the demo
post with the submitted link goes out 11-02 → 11-03 (ADR-0028 §bonus
prizes; `doc/plans/meta-hackathon.md`, phase 4). DIRECTION.md names the
share moment the viral loop and says donors arrive by shared links;
ADR-0030 built the card those links carry.

What constrains the accounts:

- **Rights.** A listing's photo and description are licensed for display
  on our pages (`aggregator-display`, ADR-0006 as amended 2026-08-25) and
  for nothing off them (ADR-0030 decision 3). The crew's paintings and
  photos are ours, with consent for the card and for Logan's posts
  (`doc/consent/0001-the-crew.md`), and the brand files are all rights
  reserved (TRADEMARKS.md). A shelter is named as a partner only under its
  own grant (ADR-0029).
- **The bright lines** (DIRECTION.md): no rarity, nothing tradeable, no
  pressure. A social post is the easiest place to break them — a countdown,
  a "last chance", a "rare" dog — and the easiest to screenshot.
- **Money words.** "We keep $0" is the claim we can make; "100%" is the one
  we cannot (ADR-0027). Generated or drafted text never claims care that is
  not attested (CLAUDE.md).
- **The hackathon delineation** (ADR-0028 as amended 2026-10-26): only
  work dated 2026-10-27 or later is the entry, and anything older is shown
  as labelled context. The launch post is about the product and says
  nothing of the hackathon; the hackathon posts say what was built this
  week and what existed.
- **Names.** `monsterpaws` is taken on X and on Bluesky; the domain is
  ours, and Bluesky lets a domain be the handle.
- **Credentials.** `pass` is the registry for every credential, listed by
  name in `doc/infra.md` (CLAUDE.md, Infra ops). hello@monsterpaws.org is a
  Cloudflare Email Routing forward to Gmail (`cloudflare/email-token`), so
  an account registered to it has its recovery mail land in the inbox
  Logan reads.

## Decision

### 1. Three channels now, under one address and one name
- **LinkedIn**: the company page (made 2026-10-26), where Logan's own
  profile posts and the page reposts. Updated 2026-10-27: the logo on the
  site's cream, a cover that is a band of Beetle's painting, the tagline
  and description with "we keep $0".
- **X**: `@monsterpawsorg`, created 2026-10-27. The hackathon's channel
  (ADR-0028) and the one the Most Viral post goes out on.
- **Bluesky**: `@monsterpawsorg.bsky.social`, created 2026-10-27. The
  handle becomes `@monsterpaws.org` by the `_atproto` TXT record set in
  Cloudflare 2026-10-27 (`cloudflare/dns-token`, TTL 300, `did=did:plc:…`,
  resolving at 1.1.1.1 and 8.8.8.8 the same hour); the domain as the handle
  is the verification.
- **YouTube**: a Monster Paws channel under Logan's own Google account
  (a brand channel: its own name, handle, avatar and banner; owners and
  managers added under its permissions, never a second Google account for
  one channel), created 2026-10-27, handle `@monsterpawsorg`. A home for
  the hackathon video and nothing else yet.

All four carry the same display name, "Monster
Paws", link to https://monsterpaws.org and nowhere else, and use the
card's sentence as the bio (ADR-0030's description, shortened to fit).
**Instagram and Facebook wait** for the first shelter's grant: they are
where shelters and adopters are, and a feed there wants a shelter's animals
and a real card, neither of which exists yet. Nothing else (TikTok,
Threads, Mastodon) until a reason is written here.

### 2. The assets are built from the brand files by a script
`scripts/social-assets.ts` (`npm run social:assets`) writes into
`var/social/` (gitignored; the script is the record, as `og:image` is for
the card, ADR-0030):

- `logo-cream-400.png` and `-1024.png`: the wordmark on the site's cream
  (`--background`, `#faf4e8`), 8% inset, for LinkedIn, which shows it
  square.
- `avatar-cream-400.png`: the same at 14% inset, for X and Bluesky, which
  show it round; at 8% the wordmark's corners come within 8 px of the
  circle.
- `cover-beetle-1128x191.png`: a band of Beetle's painting from her eyes to
  her muzzle at the painting's own scale, for LinkedIn's cover.
- `header-beetle-1500x500.png`: the whole painting's width from her ears
  to her shoulders, scaled to 3:1, for X's and Bluesky's headers.
- `banner-beetle-1024x576.png` and `-2560x1440.png`: the painting's whole
  width at 16:9 with her eyes and nose at the vertical centre, for YouTube,
  which shows the middle 29% of a banner on every device and the rest only
  on a TV. Her head is at the top of the painting, so the canvas is
  extended above it with the painting's own top wash, stretched and
  flipped so the seam is continuous; nothing of her is duplicated and she
  is not zoomed.
- `watermark-150.png` (the wordmark on nothing) and `watermark-cream-150.png`:
  YouTube's video watermark, laid over the bottom-right of every video.

**No wordmark on a cover or header**: every platform lays the avatar over
it, and the first LinkedIn cover with the wordmark doubled the name.
Pixels only, like every crew-derived file. The crew's consent is extended
to these bands on the project's own accounts.

### 3. Posted by hand, in our own words, with the card doing the preview
Logan posts; Claude drafts in his voice when asked. **No scheduler, no
API posting, no automation, no cross-posting tool**: a post is a decision
each time, and the accounts never hold an app password or API key until an
ADR says what for. What a post may carry:

- Our own words, the site's pages (the card from ADR-0030 is the preview),
  the crew's paintings and photos, a keepsake pair once a donor has one
  and has said yes.
- "We keep $0" and the Every.org rail, never "100%".
- A shelter's name only under its grant (ADR-0029), and an animal's care
  only when it is attested.
- Hackathon posts dated and delineated: what was built this week, what
  existed, in the same words as the branch README (ADR-0028).

Never: a listing's photo or description (ADR-0030 decision 3); rarity,
scarcity or urgency about any animal, a countdown, a streak (DIRECTION's
bright lines); the word "blockchain" or any token framing; an animal
presented as ours when it is a shelter's; anything about a donor without
their yes. Replies and DMs that ask about an animal go to the shelter's
listing, never answered with facts we do not hold. The launch post on
LinkedIn says sponsoring is not live yet rather than implying it is.

### 4. Credentials in the registry
`social/linkedin`, `social/x` and `social/bluesky` in `pass`, each holding
the password, the 2FA recovery codes and the TOTP secret (`pass` has no
OTP extension here; the secret is kept so the authenticator can be
re-enrolled), listed by name in `doc/infra.md`'s registry under "Social
accounts". 2FA on from day one. The X account's email notifications off,
so hello@ stays a mailbox people write to. Bluesky's app passwords: none
until decision 3 changes.

### 5. No cadence
Nothing here promises a posting rhythm, a follower target or a content
calendar. The channels exist so the launch post, the hackathon posts and a
shelter's news have somewhere to go; a cadence is a decision for when
there is a shelter and a card to show.

## Consequences
- The LinkedIn page says "we keep $0" and matches the site; the "100%"
  claim is gone from the one place it still stood.
- The hackathon has its X account before the posts phase, and the Most
  Viral link has a home.
- Rebuilding an asset is `npm run social:assets`; a new pick for the band
  is a `top` in the script, as the card's is in `og-image.ts`.
- The site's footer still links the email and the source only. Social
  links in the footer are a product change for when the accounts have
  something on them (revisit trigger).
- Three more entries in `pass`, three more rows in the registry, and a
  recovery path that does not depend on a browser session or one phone.
- `npm run social:assets` is a package.json script with no new dependency:
  `sharp` and `tsx` are already there (ADR-0030).

## Alternatives
- **One account, LinkedIn only.** Where Logan's network is, and useless
  for Most Viral, which is X. Rejected for the hackathon's duration at
  least.
- **Facebook and Instagram now.** Where shelters are, and where a feed with
  no shelter's animal on it is a feed of five founders' pets. Deferred to
  the first grant.
- **A scheduling tool (Buffer, Hootsuite) or posting through the APIs.**
  Convenience bought with a standing credential on every account and the
  temptation to post on a rhythm rather than on news. Rejected until an
  ADR names the need.
- **Beetle's card image as the avatar.** Proposed and declined: a 1.46:1
  painting in a 400 px circle shows a patch of wash, and the wordmark on
  cream is the name.
- **The wordmark on the covers.** Built first for LinkedIn and removed the
  same day: it doubled the page's logo laid over it.
- **Posting from Logan's personal X.** The hackathon's link and a shelter's
  later news belong to the project, not to one person's account.

## Revisit triggers
- A shelter's first-party grant: open Instagram and Facebook, and that
  shelter's animals may appear in posts.
- Bluesky's `_atproto` record set and the handle `@monsterpaws.org` verified
  in the app, both 2026-10-27. Done; stays as provenance.
- The mascot icon arrives (the brand plan's green M): a square avatar in
  place of the wordmark on cream.
- A second person posts: shared-credential rules for `social/`.
- Any post that is not by hand — a scheduler, a bot, an API — is a new ADR.
- The accounts have posts: social links in the site's footer.
- A platform's harassment, impersonation or a handle squat: the response is
  written as an amendment, not improvised in a reply.
