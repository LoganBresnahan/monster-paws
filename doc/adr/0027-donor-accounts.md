# ADR-0027: Donor accounts — passkeys with an email link, tied to Every.org by our own donation id

Status: accepted (2026-10-16). Decisions agreed with Logan 2026-10-15
and 2026-10-16.

> Self-amended 2026-10-22: the schema landed — an intent owns its donation
> and keepsake until a claim; a suppression is a keyed digest that outlives
> account deletion; an intent names its animal by source identity; the
> shelter-to-nonprofit mapping is a table (below).

## Context
DIRECTION and ADR-0022 assume a donor's keepsakes "live in their account",
and roadmap item 4 carries "the accounts ADR comes first": nothing decides
how a donor signs in, what we hold about them, how an Every.org donation is
tied back to an account, or deletion. ADR-0025 kept "Recently viewed" on the
visitor's device so that it would not make this decision for item 4.

Every.org (ADR-0002) is the only money rail. Its donate link takes a
`partner_donation_id` we choose and `partner_metadata` (base64 JSON), and a
`webhook_token` makes it POST each completed donation to our endpoint
(docs.every.org, Partner Webhook, read 2026-10-15): `chargeId`,
`partnerDonationId`, `partnerMetadata`, `amount`, `netAmount`, `currency`,
`frequency`, `donationDate`, `toNonprofit {slug, ein, name}`, and the
donor's name and `email` **only if the donor chose to share them**. The
docs describe **no request signature** and no retry policy. The webhook
is self-serve: an Every.org account creates it in the developer dashboard,
and staging has its own (staging.every.org/developer, after an explicit
email verification; re-read 2026-10-16).

The site's defaults (ADR-0010, ADR-0025): no tracking, logs carry
identifiers never identities, nothing about a visitor leaves their device
unless it must.

## Decision

### 1. A donor signs in with a passkey; an emailed link is the way in without one
WebAuthn passkeys, any number per account — one per credential manager
(Google Password Manager, iCloud Keychain, Windows Hello, 1Password…),
each named, listed and removable in the account (Logan, 2026-10-15). On a
device without one, the browser's own cross-device flow (a QR code read by
the phone) or the emailed link signs in, and the site then offers "add a
passkey for this device". The emailed link is single-use, short-lived, and
the recovery path for a lost device. No passwords, no third-party sign-in.

### 2. The email address is the account's anchor, and the only identity we hold
An account is an email address (verified by the link or at passkey
registration), its passkeys, its sessions, and what it owns: donations and
keepsakes. A display name is optional. We hold no address, phone or
payment detail; Every.org holds the donation's money side and the receipt.
Sessions are rows in Postgres behind an httpOnly, Secure, SameSite=Lax
cookie, read only in a Data Access Layer function, never in a layout's top
level (Next.js 16's authentication guide).

### 3. A donation is tied back by an id we mint, never by the donor's email
Each donate click mints a `donation_intent`: an unguessable id (128 random
bits) recorded with the animal, the recipient nonprofit's slug and EIN, and
the account or browser that started it. The donate link carries it as
`partner_donation_id`. The webhook is matched on that id alone; the email,
when shared, is a hint for a claim message (decision 5), never the key.

### 4. The webhook is unsigned, so it is never trusted beyond its intent
- Every webhook body is stored verbatim, append-only, before anything is
  read from it (ADR-0003); a donation is derived from it.
- It is accepted only for an open intent whose nonprofit matches
  `toNonprofit`; `chargeId` makes it idempotent; anything else is kept and
  logged, never acted on.
- The endpoint path carries a secret of ours as well as Every.org's token.
- What a forged call can buy is bounded: a keepsake for an intent that
  forger already holds (only the browser that clicked knows the id). That
  costs us one art set on the home GPU. Accepted, with the revisit
  trigger below.

### 5. The account is made after the donation, never before it
A donor gives with no sign-up (Logan, 2026-10-15). The thank-you page holds
the keepsake for this browser — the intent's id in a cookie — and offers to
keep it in an account: an email, then a passkey on this device. A donor
who leaves first is sent a claim link to the webhook's email when the
donor shared it; one who shared none and left keeps nothing but the
donation, and the thank-you page says so before they go. No wall stands
in front of the gift; the claim step is needed anyway, because the art
arrives later (ADR-0004).

### 6. Deleting an account deletes everything, after offering the donor a download
Logan, 2026-10-15: "delete everything but offer to let them download all
their stuff before". The delete page offers an export first — every
keepsake's art at full size, its card, the donation history and the
account's data as JSON, one archive — then deletes the email, name,
passkeys, sessions, intents, the raw webhook payloads that name the
donor, donations, keepsakes and their R2 art. This is a sanctioned
exception to append-only for **donor-owned rows only** — never the
corpus, the event log or attestations — beside ADR-0022's purge by
basis. Every.org's donation record and receipt are theirs and stay.

The counts survive it (Logan, 2026-10-16: "we don't want to lose the
count… we just make them all anonymous"). When a donation is recorded it
also writes an anonymous stats row — animal, nonprofit, amount,
currency, frequency, date — with no account, intent, `chargeId`, name or
email in it, and every count (a shelter's sponsors, an animal's gifts,
totals) reads only those rows. Deleting an account therefore never
touches a stat and never needs to: there is nothing in the stats row to
delete.

## Consequences
- Email is **Resend**, already provisioned (`resend/api-key`, sending
  only, DKIM verified for monsterpaws.org 2026-07-30; `doc/infra.md`);
  Cloudflare Email Routing stays the inbound side, so replies to hello@
  reach Logan. DMARC is strict (`p=reject; adkim=s`): mail is sent as
  exactly monsterpaws.org, and any sending subdomain is verified in
  Resend before its first message. Sign-in links never share an email
  with anything else; every other email carries a one-click unsubscribe;
  Resend's bounce and complaint webhooks (signed) feed a suppression
  list. The weekly digest (item 8) moves to its own sending subdomain
  when it lands, so bulk reputation never touches sign-in. Resend is a
  processor of donors' addresses and the privacy page names it; its
  free tier's daily cap is checked against volume before launch.
- New dependency: a WebAuthn server library (SimpleWebAuthn, MIT, the
  candidate), its own line in the build plan.
- The partner webhook is created in Every.org's developer dashboard,
  staging first, from an account Logan owns; its token goes in `pass` and
  `doc/infra.md`'s table like every credential. Signing, retries and a
  lookup by `chargeId` are asked of partners@every.org, since the docs
  are silent and each answer may retire a revisit trigger.
- Tables: accounts, passkey credentials, sessions, sign-in links,
  donation intents, the raw webhook payloads, donations, the anonymous
  donation stats (append-only, never deleted), email suppressions; and the export (decision 6) as a job that builds the
  archive in R2 behind a short-lived link. A flow diagram
  for donate → webhook → keepsake goes in `doc/flows.md` with the build
  (ADR-0012).
- "Recently viewed" stays on the device (ADR-0025); whether it syncs for
  a signed-in donor is decided at build, by its own amendment.

## Alternatives
- **Email link only.** Less to build; every visit costs a trip to the
  inbox. Kept as the fallback, not the front door.
- **Google / Apple sign-in.** One tap for many, but a big-tech login and
  its tracking on the donate path, and not every donor has or wants one.
- **Email and password.** Password hashes to hold, resets and lockouts to
  own, breach exposure: everything passkeys exist to remove.
- **A hosted identity service** (Clerk, Auth0). A monthly bill and donor
  identities held off our platform, against ADR-0003.
- **Tie donations by the donor's email.** Every.org omits it when the
  donor declines to share it, and an email is not proof of anything.

## Revisit triggers
- Every.org adds webhook signing or a donation lookup by `chargeId`:
  verify against it and drop the bounded-forgery acceptance.
- Forged or unmatched webhooks appear in the raw log.
- Donors report losing access with no passkey and no email to hand.
- Passkey support regresses in a browser donors use, or cross-device
  sign-in fails in dogfooding.

## Amendment (2026-10-22): the schema — ownership, suppressions, animal identity

### Context
Phase 1 of `doc/plans/adr-0027-accounts-build-plan.md` drew the tables
(migration `drizzle/0011`). Drawing them raised four questions §§3–6 left
open, settled with Logan the same day. Two facts found while checking:
Resend already keeps its own suppression list, team-wide and holding the
plain address, blocking sends after a hard bounce or complaint until removed
(resend.com docs, read 2026-10-22); and Outlook and Yahoo reissue addresses
after about a year of inactivity, while Gmail never does.

### Decision
1. **An intent owns its donation and keepsake until an account claims it**
   (Logan, 2026-10-22). `donation_intents.account_id` is null until the
   claim sets it; account deletion follows one path: account → intents →
   donations → keepsake → its facts and R2 art. No foreign key on that path
   cascades: deletion is an ordered procedure, and an accidental DELETE
   errors instead of spreading.
2. **A suppression is a keyed HMAC of the lowercased address, and it
   outlives account deletion** (Logan, 2026-10-22: "I don't want to fully
   rely on Resend's suppression list"). Our check runs before every send,
   independent of Resend. The row holds no address and no bare hash (a
   bare hash is tested by guessing), so §6's "delete everything" holds
   with nothing in it to delete. Account deletion also removes the plain
   address from Resend's list by API, so the processor keeps no copy.
   A suppression is lifted only by hand, when the address's owner writes
   to hello@ — the recycled-address case.
3. **An intent and a stats row name the animal by source identity**
   `(source, external_id)`, never `animals.id`, which a replay rebuild does
   not keep stable (ADR-0013).
4. **The shelter-to-nonprofit mapping is `shelter_nonprofits`**, keyed by
   `animals.shelter_external_id` with source and fetched-at like any fact;
   no row, no donate button (ADR-0015). Built in phase 1, so phase 3 needs
   no migration.

The webhook's raw row keeps the body as text, not jsonb, so an unparsable or
forged body is kept too, and its headers with any carrying our auth token
redacted: the staging webhook issued an auth token the docs never mention,
and the headers are how we learn whether Every.org sends it.

### Consequences
- The HMAC key is a new secret in `pass`, filed with the Resend slice.
- A face pick is a `keepsake_fact` with `field='face'`, as `doc/flows.md`
  drew it; there is no picks table.
- A recycled address can sign in to the account it used to belong to through
  the emailed link. That is a weakness of email recovery itself, and passkeys
  don't close it, since the link is the recovery path. The
  `email-link-sign-in` verify pass weighs refusing the link for an account
  whose address has hard-bounced.

### Revisit triggers (added)
- A donor reports an account reached through a reissued address, or a
  hard bounce lands on an account's own address.
- Someone writes in to lift a suppression: count them, and if they are more
  than rare, offer the lift on the sign-in page itself.


## Amendment (2026-10-26): the donate loop's pages are designed in the demo first

The account-less donate loop (decisions 3–5; phases 3–5) has no page design
yet. Its pages are drawn first as `/demo`'s sponsor, thank-you and collection
pages (ADR-0028 as amended 2026-10-26), with the crew and no money moving,
and Logan reviews them there. The real pages are built from that design, with
what the demo cannot show added on: the intent minted before the hand-off,
the Every.org donate link carrying its id, the webhook, the claim link. Three
things the design must already respect:

- **the amount starts at $1** in the design and follows Every.org's real
  minimum once a measured donation shows it (ADR-0002 as amended 2026-10-26);
- **"we keep $0"**, never "100%" (same amendment);
- **the keepsake arrives when it is ready**, never instantly (ADR-0004 as
  amended 2026-10-05): the thank-you page shows the animal's real photo and a
  link to their card ("See {name} in your collection"), and the card shows
  the painting under way until it lands. No separate "save" step: the card is
  already in the donor's collection (Logan, 2026-10-26).

## Amendment (2026-11-02): the staging webhook's tunnel

### Context
Every.org's staging webhook posts to `staging-hooks.monsterpaws.org`, which has
no DNS record, and the plan's only requirement is a tunnel to `monsterpaws-dev`
that never reaches the droplet. The tunnel exposes a dev server to the internet.
That server serves pages production doesn't, and its error pages show more than
production's do.

### Decision
1. **A Cloudflare Tunnel, locally managed, on the zone we already run** (oplog
   0017). The connector is outbound only and runs as a pinned `cloudflared`
   container. A proxied CNAME to the tunnel has no address behind it, so the
   host cannot fall through to the droplet.
2. **It forwards one path.** `^/api/webhooks/everyorg/[A-Za-z0-9]+$` on that host
   goes to the dev server and everything else answers 404, from a config file in
   this repo with a test on its text, never a dashboard setting
   (`scripts/staging-hooks.yml`, `tests/staging-hooks.test.ts`). The pattern is
   closed at both ends because a bare prefix also forwards
   `/api/webhooks/everyorg/../../../design`, which collapses to `/design` behind
   it. Our path secret stays alphanumeric to match (`pass generate -n`).
3. **The dev server behind it has its own port, 3027, on loopback only.** Its own
   port because another worktree's server on :3000 would answer 404 to a delivery,
   and Every.org's docs state no retry. Loopback because `next dev` listens on
   every interface by default, and under this machine's mirrored networking that
   could let the LAN reach the whole server around decision 2.
4. **It runs only for a staging session,** by `npm run hooks -- up`, and comes
   down after. Nothing restarts it.

### Consequences
- New tool, no new runtime dependency: `cloudflared` runs only as that container,
  never in the image or on the droplet. Its version is bumped by hand.
- Two `pass` entries, `cloudflare/tunnel-token` and
  `cloudflare/staging-hooks-tunnel-credentials` (`doc/infra.md`).
- Bot Fight Mode covers this host, and the production hook host after it. Whether
  it lets Every.org's POST through is unproven until a real delivery. If it
  blocks, turning it off is a zone-wide choice for Logan, with its own oplog
  entry.
- Production's hook host is not this tunnel: it is the droplet through Caddy, on
  its own hostname, with its own three secrets and its own oplog entry.

### Alternatives
- **`cloudflared` quick tunnel (`trycloudflare.com`):** no token and no zone
  change, but a random hostname on each run, and the Every.org webhook's URL
  would have to change each time.
- **A dashboard-managed tunnel:** one fewer file, but its reach would be a setting
  nobody reviews or tests.
- **ngrok or similar:** another vendor seeing every staging payload, when
  Cloudflare already sees this zone's traffic.
- **Port-forwarding at home:** opens a port, and ADR-0033's rule is that the house
  opens none.

### Revisit triggers
- Every.org's staging POST is blocked at the edge (see Consequences).
- A staging delivery is lost while the tunnel was down often enough to justify
  leaving it up.

## Amendment (2026-11-02): Bot Fight Mode off for the zone

### Context
The tunnel's amendment left it unproven whether Bot Fight Mode would let Every.org's POST
through. Logan's staging gift proved it does not: Cloudflare's firewall export shows the
POST, to the webhook's real path at 16:53:41 UTC, answered `managed_challenge` by
`bot_fight_mode`, from Amazon's AS16509, user agent `node`. A server can't solve a
challenge, and the setting covers the zone, so production's hook host would fail the same
way. Cloudflare's docs say it can't be skipped by WAF custom rules or Page Rules; only Super
Bot Fight Mode, on a paid plan, can. In that export's 24 hours it challenged 57 other
requests, 53 from Microsoft's network and the commonest paths probes, while the 277 blocked
exploit attempts came from the managed ruleset, a separate setting.

### Decision
**Bot Fight Mode is off for the whole zone** (Logan, 2026-11-02; oplog 0018). The managed
ruleset stays on, and AI crawlers stay allowed.

### Consequences
- Requests it would have challenged now reach the origin. Read the firewall events and the
  droplet's load about a week on.
- Anyone turning it back on stops every webhook delivery, with no error on our side:
  nothing reaches the tunnel, the droplet or `everyorg_webhook_payloads`.

### Alternatives
- **A paid plan with Super Bot Fight Mode and a skip rule:** keeps the protection, at a
  monthly bill the numbers above don't justify yet.
- **A Worker outside the zone in front of the hook:** more moving parts, unproven.
- **A DNS-only hook host:** exposes the droplet's address, against `doc/infra.md`'s rules.

### Revisit triggers
- Probing that loads the droplet, or heavier than that one day's 57 challenges.
- Moving to a paid plan for any other reason: then skip the hook's path and turn it back on.

## Amendment (2026-11-02, later): the email is asked on our page, and the art goes by email

### Context
Decision 5 stood no wall before the gift and sent a claim link to the webhook's
email only if the donor shared it; a donor who shared none and left kept nothing.
That was written when the keepsake waited in a browser. Art arrives late (ADR-0004
as amended 2026-10-05), and the first donors' art has no date at all: nothing until
the anatomy LoRA ships (Logan, 2026-11-02). Every.org's docs also say a partner
webhook can be configured to carry no donor info, so its address can't be what a
painting depends on.

### Decision
1. **The email is required on our sponsor page, before the hand-off to Every.org.**
   Logan, 2026-11-02: "we need to send the art via email so they have to give it to
   us. we don't want to rely on every.org giving us their email." This amends §5's
   "no wall": there is still no account, password or sign-up before the gift, but
   there is one field. The intent holds the address (`donation_intents.donor_email`);
   it is still never the key a webhook matches on (§3).
2. **The art goes to the donor by email.** The cookie no longer has to hold the
   keepsake. It stays only so the thank-you page can name this browser's gift.
3. **The art email links to making an account.** Coming back to view the art, frames
   and the animal's story are account features.
4. **A donor with no account has their address erased from our rows once the
   painting is delivered,** under the email rules above (Logan: "make sure we adhere
   to those when we 'delete'"; "we only delete the email after we get the 'okay' from
   resend"):
   - The okay is Resend's `email.delivered`, "successfully delivered the email to the
     recipient's mail server", never `email.sent`, which fires when the API call
     succeeds, before any delivery is tried
     ([event types](https://resend.com/docs/dashboard/webhooks/event-types), read
     2026-11-02). A lost event keeps the address, the safe direction. It proves the
     mail server took it, not that it reached the inbox.
   - `email.delivery_delayed` and `email.failed` keep the address and wait or retry.
   - `email.bounced` writes the suppression and erases the address, which we can no
     longer use (Logan, 2026-11-02: "i think so"). The thank-you page then says the
     painting couldn't be delivered and takes a new address. A donor without that browser
     writes to hello@ with their Every.org receipt, and it is resent by hand. Both land
     with the art email.
   - A gift nobody finished has its address erased after 30 days (Logan, 2026-11-02),
     by the daily `donate.erase-abandoned` job. The intent row stays, because a late
     bank webhook still has to find it. Until a webhook records the gift, nothing is
     sent to that address. Closing a tab erases nothing: a donor can pay and close it,
     and browsers don't reliably say a tab closed.
   - Erasing never touches a suppression, which holds no address and outlives
     deletion (as amended 2026-10-22). One is written only on a bounce or complaint,
     never for every donor.
   - Erasing also removes the plain address from Resend's list by API, as account
     deletion does.
5. **The art email keeps the sending rules.** Sign-in links share an email with
   nothing else, so its account link signs nobody in: it opens a page where the donor
   enters an address and gets a separate sign-in mail. It carries a one-click
   unsubscribe and all four paintings, and never says "choose one" (ADR-0004 as
   amended 2026-10-14).
6. **One email per gift: the painting.** Logan, 2026-11-02: "just the 1 email would be
   good". There is no confirmation email. Every.org's receipt says the gift arrived
   (production's did on 2026-11-03, oplog 0019; neither staging gift sent one), and the thank-you page shows the address with a way to fix it, which costs no email
   and catches a typo. It asks the donor to check the address and to bookmark the page
   until the painting arrives (Logan, 2026-11-02). The URL carries no id, so a bookmark
   works only in that browser and for the cookie's 30 days after the gift, and the page
   says so (Logan: "make sure we say that on the page too"). The page means the gift just
   started, or else the newest paid one, so an attempt left unfinished can't hide a paid gift.
   Fixing it changes the gift the page showed, and only one in this browser's cookie, and an
   erased address never comes back. Resend's free plan allows 100 a day and 3,000 a month, and
   Pro 50,000 a month with no daily limit, so the backlog when the painter ships is
   queued and spread out, or waits for Pro.
7. **A suppressed address is refused on the sponsor page, and told why.** We can't mail
   it, so taking the gift would take money for a painting that can't arrive. The words
   (Logan, 2026-11-02): "We can't send email to that address, so {name}'s painting
   wouldn't reach you. This can happen when an earlier message bounced or was marked as
   spam. Please use another address, or write to hello@monsterpaws.org and we'll sort it
   out." It lands with `resend-transactional-email`, since nothing writes a suppression
   before then.
8. **A raw webhook row holds no donor.** This is a sanctioned departure from §4's
   "stored verbatim". Logan, 2026-11-02: "we don't need to store any of that info".
   `storableBody` keeps a named list (`event`, `chargeId`, `partnerDonationId`, `amount`,
   `netAmount`, `currency`, `frequency`, `donationDate`, `paymentMethod`, and
   `toNonprofit`'s `slug`, `ein`, `name`), each to a shape, so neither a field Every.org adds
   later nor a person's name in a kept field can put a donor in a row. It records the names of
   what it dropped, without their values, so a new field gets noticed. A body we can't read
   keeps only its size and a hash keyed by our secret. The row is
   still written first and never UPDATEd. A hash of a whole readable body was rejected:
   everything else in it sits beside the hash, so a reader of the table could test
   guesses at a donor's address, the reason a suppression refuses a bare hash (as
   amended 2026-10-22).
9. **Requiring the auth token waits for the real bank and PayPal gifts.** It came in
   `Authorization` on both card gifts, undocumented. The row marks it on every delivery.
   If it arrives on every method, it becomes a further check; made one before then, a
   real gift by a method that omits it would not count until someone noticed.
10. **A privacy page, and deletion by hand, come before any real gift.** `/privacy` says
    all of the above in plain words and names its processors. A donor with no account
    has no account to export or delete, so deletion is a request by email, done by hand:
    the intent, its donations and its raw rows go, and `donation_stats` and any
    suppression stay, as in §6. This replaces the build plan's bar of account export and
    deletion for the account-less loop; both still come with accounts.

11. **A gift already made still gets its painting, whatever the shelter says later.**
    Logan, 2026-11-02: "we need to still send the painting even if the shelter asks us to
    take it down. we can take down the listing but we still need to make the painting." A
    withdrawal or a takedown closes the Sponsor button at once, so no new gift can start,
    and a gift already recorded is painted and emailed as normal (ADR-0022 as amended
    2026-11-02).
12. **Bank and PayPal are tested with real gifts on production.** Logan, 2026-11-02: "we can
    test paybal and the bank with real transactions once we get it in prod. bank uses plaid
    and it doesn't look like a sandbox version on the staging page." Staging's PayPal also
    asked for a PayPal sandbox account. Only the card is measured on staging. The same gifts
    answer what staging couldn't. A production receipt shows name, date, amount and tip, and **no
    charge or donation id**, and its date isn't UTC's, so a donor is found by nonprofit, amount and date
    within a day, not by id (oplog 0019).
13. **Those gifts go through a hidden page, the one exception to "no permission, no button"**
    (ADR-0002 as amended 2026-11-02). Logan, 2026-11-02: "a one off page that isn't marked
    anywhere, i can just type in the url", "real tests with my money". It gives to Spencer Pet
    Rescue, first named as Rainbow Bridge Hospice Rescue: "because spencer rescue can take
    donations we want to test with that on the secret prod page". A test gift to Spencer is not
    a yes from Spencer: its permission to paint is a separate grant. The repo is public, so `/test-gift/<EVERYORG_TEST_PAGE_SECRET>` is hidden by
    a secret, answers 404 without it, and is linked from nothing. No animal, so no painting. It
    runs the real form through Cloudflare in a real browser, the real webhook and the real
    `/thanks`. Afterwards its rows go, found by `animal_external_id = 'test-gift'` and never by
    slug or EIN, which Spencer's real gifts will share, before Spencer's button opens, in their
    own oplog entry (0021), planned from what the gifts produced, since a bank gift can take days to
    settle. The page's code goes with the next deploy. Its `donation_stats` rows go too, the one
    sanctioned exception to §6's permanent totals, since a gift with no animal doesn't belong in
    them (Logan, 2026-11-02: "yes delete the test stats rows").
14. **The production webhook is on the main domain:**
    `https://monsterpaws.org/api/webhooks/everyorg/<secret>` (Logan, 2026-11-02: "main domain").
    It needs no new hostname, DNS record or Caddy block, and Bot Fight Mode is off for the whole
    zone, so a separate host would buy nothing. The staging tunnel's host stays as it is.

### Consequences
- `donation_intents.donor_email`, nullable, additive.
- §5's claim link to the webhook's email and its no-email warning are gone, along
  with the need for the webhook's address.
- `resend-transactional-email` and the suppression HMAC key now come before the art
  email.
- While there is no painter the address is held with no end date, and the sponsor
  page says the painting has none. The privacy page must say so too, and that after
  erasure we can't look a donor up by email.
- The sponsor and thank-you pages say the painting comes by email, with no date. Neither
  says "if the shelter gives permission": without it there is no Sponsor button (ADR-0002
  as amended 2026-11-02, later).
- The thank-you page shows the address to whoever holds the cookie, a shared browser
  included, so the cookie lasts 30 days (Logan, 2026-11-02). After that the page can't name
  the gift, and the donor still has Every.org's receipt.
- An address erased at 30 days means a gift that settles after that has nowhere to send
  its painting. The production bank gift says whether that can happen.
- Production can carry `EVERYORG_ENV=production` before any shelter opens: with no grant there
  is no Sponsor button, and only the hidden page reaches www.every.org.
- The test gift's rows must be gone before `snapshotKeepsake` or `art.generate` ship, or a real
  worker could pick up a gift with no animal.

## Amendment (2026-11-03): the webhook survives a deploy and a database failover

### Context
Logan, 2026-11-03: relying on webhooks "seems somewhat fragile... what if a deploy occurs when a webhook
fires?" He is right. Every.org's docs state no retry, the one failed delivery we saw never came back (oplog
0018), and a public docs issue (everydotorg/charity-api-docs #46) shows another partner asking support for a
replay, which suggests none is automatic without proving it. Caddy's `reverse_proxy app:3000` holds nothing
during a roll. DigitalOcean's maintenance window is Tuesday 00:15 UTC, and on 2026-11-03 it failed the database
over at 00:23:13. `createPool` sets no connection or query timeout, so an insert during a failover can hang until
Cloudflare gives up at about 100 s, and the sender has a failure by then. Neither gap has been measured, and no
gift arrived during that failover.

The webhook still carries the money record whatever ADR-0035 decides about paintings, so this ships ahead of it.

### Decision
1. **Caddy holds requests during a roll:** `lb_try_duration 30s` on the `reverse_proxy`, until oplog 0023 times a
   real roll on the droplet. Caddy's docs: a failed connection is always retried, POSTs included, and only GETs after
   a round trip that failed. `lb_retry_match` is not added: Next finishes a request it already holds (measured below),
   and a retried POST needs `request_buffers` too, or it hangs for the whole hold and then answers 502.
2. **The store has its own clock of a few seconds, then the delivery goes to disk and answers 200.** A hang
   counts as a failure, not only an error. Logan: "yes to caddy holding requests and saving to disk". A late insert
   plus a replay makes two raw rows, which the row lock, `closed_at` and `donations_charge_uq` make safe.
3. **A folder of files on a named volume shared by app and worker, never a database.** Memory is wiped by the
   deploy this protects against, and SQLite would be a dependency for a folder's job. One file per delivery, written
   to a temp name and renamed, so a half-written file is never read.
4. **A file holds what the row would hold:** storable body, redacted headers, partner id, time received. It never
   holds a name, email or street address (as amended 2026-11-02, decision 8). Replaying through `receiveWebhook` would corrupt the row:
   re-shaping a cleaned body turns `droppedKeys` into `["droppedKeys"]`, which loses how a new field gets noticed,
   and would lose the headers (the `Authorization` marker that amendment's decision 9 waits on) and the real `received_at`.
   So store splits from decide, and replay inserts that row and decides from it. A spooled row must equal a direct one.
5. **Decisions get an append-only table keyed on payload id,** donor-owned like its payload, written inside `decide`
   and after its early returns. Undecided means no row. Today `decision_failed` is only a log line and a report, and
   selecting "completed, open intent, no donation" would re-decide `nonprofit_mismatch` and `charge_on_other_intent`
   every minute forever, since both leave the intent open. The migration backfills production's rows as decided, so
   the proof row and the test-gift rows never re-run, with the outcome `before_this_table`, since the old code never
   recorded one and this doesn't guess. It assumes every existing row was decided, so a `decision_failed` row from before
   the migration would never re-run, and the bank delivery could land that way: oplog 0023 reads, before migrating, every row
   with a completed event and no donation, and accounts for each. Oplog 0021's delete takes decisions before payloads: the
   link blocks the other order.
6. **A timer in the worker replays the folder and re-runs undecided rows each minute, on the droplet only**
   (`doc/flows.md`: the home worker registers nothing else, and only production's compose sets `WEBHOOK_SPOOL_DIR`).
   A plain timer, never pg-boss: once the worker is up it must keep running and reporting through an outage, and 1,440
   jobs a day would only add rows. A worker booting into an outage exits at `boss.start()` and restarts until it ends,
   reporting `[worker] fatal`, and the files wait. It reports when a file outlives 10 minutes, because its failing is
   otherwise silent. An undecided row gets 30 seconds first, since a younger one is probably still inside its own request.
7. **It is proven before production needs it:** the published image with compose's real volume against a private
   Postgres, never the shared dev Postgres, which other worktrees' tests and servers use. A listener that never
   answers gives the hang case.
8. **Oplog 0023 is one deploy:** Caddy's restart first, then the timed roll, with no separate roll, since each one risks
   the bank delivery. `./Caddyfile` is a single-file bind mount, and after git replaces the file a running container
   still reads the old text, so `caddy reload` would succeed on the old config: verify from the running config through
   Caddy's admin API, and keep `pull app worker` so the unpinned `caddy:2-alpine` doesn't move. A POST to a wrong secret
   path during the roll proves the hold with no row written. A HEAD from the droplet to `cdn.rescuegroups.org` is a read
   step, for ADR-0035's photo hold. Aim: live before 2026-11-10 00:15 UTC, since the maintenance window still reads
   pending.

### Measured (2026-11-03, images built from this tree, compose's real volume, a private Postgres)
| Case | Result |
|---|---|
| Healthy | 200 in 0.06 s; one row each in payloads, decisions, donations and stats |
| Database stopped | 200 in 0.03 s, one file holding no donor, `droppedKeys` and the auth marker kept. Recorded 80 s after the database returned, the file gone |
| A listener that never answers | 200 in 5.03 s, one file. Sweeps reported `clock_expired` meanwhile. Recorded 35 s after the database returned, and the next delivery took 0.02 s |
| A roll, 200 POSTs at 4 a second | Every one answered 404 from the app, slowest 1.3 s, no 502 |
| A 9.6 s delivery with the roll at 3 s | 200 and recorded, from the old app, on the old container. The recreate took 10.9 s, so the old app sat until `docker stop`'s 10 s |
| Caddy with no app at all | Holds a POST and delivers it intact once the app comes up (7.1 s); 502 at 30.1 s if it never does |
| A connection cut after the request was sent | 502 at once. With `lb_retry_match` alone, 502 after the whole 30 s; with `request_buffers 128KiB` too, delivered |

Moved to a real failover, these are the limits. The droplet's roll is slower than this machine's, which is what oplog 0023
times. `createPool` still sets no connection timeout, because `connectionTimeoutMillis` would also limit the wait for a
free slot, which the ingest shares. So a connection to a host that vanished without closing it can hold a slot until TCP gives
up. The clock keeps deliveries safe meanwhile and the 10-minute report fires, but it recovers only as those slots free.

### What Every.org's docs and API now say (read 2026-11-03)
- **The Context's "only if the donor chose to share them" is out of date.** The Partner Webhook page: "Partner webhooks
  include donor info by default; Every.org can configure your webhook to exclude it." Excluding it would mean a name or
  address never reaches us, so it is asked.
- **The documented API has no donation lookup:** nonprofit lookup, search, browse and fundraisers. A nonprofit's record
  holds `hasAdmin` and `donationsEnabled`.
- **`/v0.2/donations` is undocumented and closed to us.** It answers 400 "API key missing" with no key and 403 with our
  public or private key, where a made-up path answers 404. Probing stopped there. Access is asked, since it could catch
  a missed gift.
- To ask support@every.org, sent by Logan, with no path, secret or key in it: retries and replay; how long their client
  waits for our response; whether anything but the donor's browser fetches `success_url`; when a bank gift's webhook
  fires; access to `/v0.2/donations`; leaving donor info out of our webhook; and what its receipt says about goods or services,
  and whether a keepsake from a partner changes that.

### Consequences
- Migration 0016. `doc/infra.md` and `doc/flows.md` change in the slice's own commit, marked planned until then.
- Closes `doc/issues.md`'s "A delivery stored but not decided has no way back in". What remains of the failover entry is a
  droplet lost with its disk, which ADR-0035's return signal and daily check partly cover.
- By-hand deletion and account deletion add the decisions rows. A spool file holds an intent id only for the minutes
  until it replays, or until the report fires.

### Alternatives
- **SQLite or an in-memory database.** Rejected above.
- **A second Postgres, or a hosted queue in front of the webhook.** Rejected: a new moving part to protect one route on a
  $22/mo box, and a queue would hold deliveries somewhere else again.
- **Answering 500 with the file written.** Rejected: nothing suggests Every.org retries, and the delivery is safe.
- **`lb_retry_match` with `request_buffers` on the webhook's path.** Not needed yet: measured above. It stays the fix if oplog
  0023 shows a delivery cut during a roll on the droplet.

On the droplet, through Cloudflare, oplog 0023, 2026-11-04: Caddy's restart, a 2,240 ms gap with no hold; the roll, 3.06 s, 180 POSTs at 2 a second, all
404, no 5xx, slowest 9.47 s; a delivery through the spool recorded 72 s after its received time. `lb_retry_match` wasn't needed.

### Revisit triggers
- Every.org documents a retry, or says how long it waits: the hold and the clock are set against it.
- A file outlives the report's 10 minutes on production.

## Amendment (2026-11-03): a painting at the first signal (ADR-0035)

ADR-0035 starts a painting at the webhook or the donor's return, so decision 4's "Until a webhook records the gift, nothing is
sent to that address" goes with it, and decision 11's "still gets its painting" becomes "can still get" in what we tell people
(its question 7). The address stays erased on `email.delivered` and at 30 days from the form's submit (its questions 5 and 6).
Both decisions stay as recorded above.
