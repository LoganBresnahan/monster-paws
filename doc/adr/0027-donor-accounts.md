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

