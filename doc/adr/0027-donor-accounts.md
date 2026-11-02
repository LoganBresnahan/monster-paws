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
3. **The dev server behind it has its own port, 3027,** because another
   worktree's server on :3000 would answer 404 to a delivery, and Every.org's
   docs state no retry.
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
