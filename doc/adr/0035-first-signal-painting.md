# ADR-0035: A painting starts at the first signal — the webhook or the donor's return

Status: accepted (2026-11-03). Logan, directly: "you can accept adr0035". The first-signal rule, the token page and the cookie's
role are his decisions, and all seven questions below are answered, 6 and 1's lack of an IP limit as the moderator read them and
told him. Named here before he accepted it and not settled by those words, so still his: CLAUDE.md's line, the sponsor page's copy
of the approved line, and "What shelters were told" in Consequences. Answers marked "to the moderator" were said in that session.
Amends ADR-0004, ADR-0022, ADR-0027 and `doc/DIRECTION.md`. The webhook hardening that ships ahead of this is ADR-0027 as amended
2026-11-03.

## Context
A painting starts from a recorded donation: `snapshotKeepsake` runs when a donation completes, and
`keepsake.donation_id` is `NOT NULL UNIQUE` (`doc/flows.md`, ADR-0022 §1). The webhook is the only
thing that records a donation, and two facts make that a poor place to hang the painting.

**It can be slow.** Logan's production bank gift, submitted at 14:30 UTC on 2026-11-03, landed on
`/thanks` at once, and its receipt came within about 4 minutes, confirming his "authorization for
Every.org to initiate an ACH debit". No webhook had arrived at 14:34. How long one takes is not yet
measured, and may be days.

**It can be lost.** Every.org's docs state no retry, the one failed delivery we saw never came back
(oplog 0018), Caddy held nothing during a roll, and DigitalOcean's maintenance failed the database
over at 00:23 UTC on 2026-11-03. Every.org's documented API lists no donations, and its undocumented
`/v0.2/donations` answers our keys with 403 (read 2026-11-03), so nothing can catch a missed gift
yet. ADR-0027 as amended 2026-11-03 narrows the loss, but can't close it.

All three of Logan's real gifts (card, PayPal, bank) landed on `/thanks` straight after paying. Logan,
2026-11-03: "We don't want the experience of our donors waiting days for the painting. if something
bounces thats fine, if they actually went through the process their intentions were probably good."

## Decision
1. **A painting starts at the first signal: the webhook, or the donor's return.** Logan, 2026-11-03.
   Either signal alone is enough, up to decision 7's limits. A bounced bank debit keeps its painting.
2. **Money claims don't change.** "Your $2 is on its way" and `donation_stats` still rest on the
   webhook alone (ADR-0027 §4–5). A return says nothing about money.
3. **Each gift returns to its own `/thanks/<token>`, and the URL stays.** Logan, 2026-11-03: "we need
   to make the thanks page a url that can't be guessed", and a donor with several gifts must reach each
   one. The token is its own 128-bit value, never the intent id: the id is what lets a forged webhook
   land, and this URL gets forwarded. It is scrubbed from error reports like the webhook's path.
4. **The token is not proof of checkout.** `donateLink` puts `success_url` on a URL the browser has
   before paying, so anyone who submits the form can read the token and open it. It stops strangers and
   the "just go to `/thanks`" shortcut, and no more than that. Only Every.org's donation data could separate a
   payer from a non-payer, whose token is just as real, and `/v0.2/donations` is closed to us (revisit triggers).
5. **The token opens the page on any device, and the cookie guards the rest.** Logan, 2026-11-03,
   on the cookie: "yeah keep the cookie, seems like a safety thing". Showing the full address and every
   write (`fixDonorEmail`, the later face pick) need the cookie. Plain `/thanks` lists the cookie's
   gifts that have a return or a donation, never every id: the cookie gains an id at form submit, so
   the rest are attempts nobody finished, and linking one would paint a gift never made, by a click or
   by a `next/link` prefetch.
6. **One painting per gift, enforced by a key and a check, never by the page.** Logan, 2026-11-03:
   "make sure it only triggers it that one time". Nothing is queued in the request path:
   - The token GET does one conditional UPDATE of the return time and nothing else, because
     `WaitingRefresh` re-runs the page every 5 s and `PgBoss` isn't in the Next process.
   - The webhook is unchanged: `closed_at` is already its signal.
   - One droplet worker sweep takes intents with a signal and no keepsake, confirmed first, then unconfirmed
     within decision 7's limits, and inserts the keepsake on conflict do nothing. The photo isn't tied to that insert
     (decision 11).
   - Owed means a keepsake with no `art` fact. Whoever ships the handler ships the send, with a
     singleton key on the keepsake id and `singletonSeconds`, because on a standard queue a key alone dedupes nothing (measured, `tests/keepsake.test.ts`), and a handler that exits if art facts exist. pg-boss 12.26.3
     deletes a job left unclaimed for 14 days, and a failed one 7 days after its attempts run out, so a
     lost job must be re-sendable. "Queue on the insert that wrote" would lose a paid painting.
7. **Confirmed gifts are never counted and go first; unconfirmed ones are limited, and over a limit they wait** (question 1).
   Limits are in cycles, where a cycle is the four paintings of one keepsake, sent in one email.
   - Confirmed gifts go first in the painter and in the mail, since Resend's free plan stops at 100 emails a day (ADR-0027
     decision 6). An eleventh gift paints on its webhook, at the front of the queue.
   - **At most 25 unconfirmed cycles in a rolling day across all emails,** counted before painting in decision 6's sweep, as
     keepsakes whose intent is still open, so a gift that confirms gives its place back. A return counts only once it is 2 minutes old, so a
     fast webhook wins: card 3.5 s and PayPal 13 s from `donationDate` to `received_at`, one gift each, bank unmeasured.
   - **At most 3 cycles a rolling day per email on unconfirmed gifts,** counted at the send (decision 8).
   - **Over either, the gift goes the next day with room or when its webhook arrives, whichever comes first.** Nothing can tell
     a real gift from a fake before the webhook, so this applies to all of them. One burst of 90 gifts can send one inbox 3
     cycles a day for 30 days, until that person unsubscribes, and a script that resubmits daily would do the same under a hold.
   - **One address can't spend the total:** no new unconfirmed painting while its normalised address has 3 keepsakes on open
     intents with the address still held, at most one per address a tick. Many addresses can still spend it.
   - **A tick's work is bounded,** or a flood's pending rows cost more every tick. When the total is spent the sweep skips the
     query. Otherwise it reads the newest 1,000 pending, by a partial index on return time where open with an address, and
     filters those. So after a burst that stops, a real gift gets the next place; during a sustained flood it waits for its
     webhook, and a lost webhook then means no painting.
   - Hitting a limit reports, in counts, and the daily check in Consequences is the watch.
8. **The per-inbox count is a keyed HMAC in a short-lived list, written and read at the send.** The digest is of the
   normalised address: lowercase, no `+` tag, no Gmail dots, `googlemail.com` as `gmail.com`, for the comparison only, never
   for sending. The list is separate from `email_suppressions`, where a row means never mail, the primary key allows one row
   per address, and ADR-0027 as amended 2026-11-02 says "never for every donor". A row holds the digest and a time and no
   gift id, since a digest beside a gift could be tested after the address is erased.
   - `donor_email` still goes on `email.delivered` (ADR-0027 as amended 2026-11-02, decision 4), so `/thanks`,
     `correctDonorEmail`'s null guard and the schema comment stay. Rows count by time, not by a gift's current address, so a
     `fixDonorEmail` move never frees an inbox, and the send counts the address the mail really goes to.
   - The list, its `/privacy` line ("about a day") and the HMAC key come with the art email, so slices C and D need none of
     them. Without the key an unconfirmed mail waits and a confirmed one still goes, never a plain-address fallback. The key
     stays off the GPU box, and the digest's input carries its own prefix, so a row can't be matched to a suppression.
   - Reads filter on time, so a late purge never miscounts, and rows past 48 hours report. No foreign key, so by-hand deletion
     can leave a row to age out, and says so.
   - The sweep's guard (decision 7) needs no key, only a SQL form of the normaliser beside the code's, on one shared fixture.
     Drift there only wastes a place, because the send's count is the hard limit.
   - Neither limit closes `doc/issues.md`'s "Nothing limits how fast intents can be minted": the form still creates rows.
9. **A keepsake keys on the intent, and reaches its donation through it.** `keepsake.intent_id` is `NOT
   NULL UNIQUE`, and `donations.intent_id` already exists, so a late webhook needs no UPDATE of an
   append-only row. A card with no donation shows the animal and the painting, with no amount or date.
10. **The painting email states no amount and doesn't say money arrived.** The intent holds no amount,
    and a donor can change it at Every.org. It carries one line on why this address got it.
11. **The photo is held at the first signal, on the droplet, per listing and outside decision 7's total,** so nothing is
    held for a checkout nobody finished, and a gift waiting for a place or a webhook can't lose its photo when the dog is
    adopted (ADR-0022 as amended 2026-11-02). A flood costs one hold per sponsorable listing, not one per gift. RescueGroups resets every connection from the droplet (ADR-0033) and the photos are on
    `cdn.rescuegroups.org` (ADR-0006), and oplog 0023 read a HEAD from the droplet on 2026-11-04: 200 in 0.46 s, one photo, no reset. All of a listing's photos unless `paintings` says the painter needs fewer.

### Proven before it counts
- Simultaneous token hits, a webhook and two sweeps give one keepsake, and a re-sent job paints nothing twice.
- "Abandoning records no return" can't be a unit test, since only Every.org's page shows what it fetches,
  and a bad `success_url` fails silently onto another charity's page (`link.ts`). On staging in Logan's
  browser, with a one-off uncommitted `success_url` of a made-up alphanumeric id on the hooks tunnel's one
  path, where `next dev` logs each request: open checkout and abandon, no GET; pay with the test card, one
  GET, path intact. Staging has only the card, so the first bank or PayPal token return is the watched
  first gift on Spencer's list.

## Questions Logan answered
1. **A limit on unconfirmed paintings? Answered** (decision 7). Logan, to the moderator,
   2026-11-03, in order: "i don't want to impose a limit"; then that a script can mint new tokens without paying, asking about
   limiting by email or IP; then "so i'm thinking yes 10 per email sounds fine to me for a day, however if there is an eleventh
   donation and the webhook comes then we should create the painting then and there for that user"; then "yes correctly handle
   variants can we do this when counting?. and 3 painting cycles per email a day is fine, as long as the legit others still
   work the next day or when their webhook comes in." Told that silence would read as yes to "10 unconfirmed paintings overall",
   he answered: "no its 3 painting cycles per day per email. 4 paintings come in a cycle automatically." The moderator then explained
   that the total means cycles across all emails, not a limit on one person, recommending 10, and he answered: "no do 25
   overall". Having a total is what lets the per-email count stay at the send: without one, it would also have to run before
   painting to protect the GPU, and the HMAC key would come before slice D. He didn't name the absence of an IP limit, and was told silence reads as yes. "if something bounces thats fine" doesn't cover spam complaints from strangers' addresses, which
   land on `monsterpaws.org`, the domain sign-in links will share, so the limits and the unsubscribe are what stands against that.
2. **Does the token page ever show the painting? Answered: never.** Logan, to the moderator, 2026-11-03: "the thanks page doesn't
   show the painting ever. its immediately visited after a donation which takes time to create the painting. we show the image
   of the animal from its listing." So the painting goes by email only, and ADR-0027 as amended 2026-11-02, decisions 2–3, and
   "there are no public paintings" (ADR-0022 as amended 2026-11-02) stand. The page shows the listing's photo under the rule
   `/thanks` already has, `visibleAnimalById` and `pickLicensedDisplay`: an ended listing or a shelter's takedown closes the photo
   and its RescueGroups pixel, and the species emoji takes over (ADR-0015 decision 3, ADR-0029 §5). The no-cookie view follows
   the same rule, so opening a forwarded link loads that pixel, as `/privacy` already says of pages showing a photo. The art is
   still kept, through decision 3's account link, §6 and `keepsake_fact`'s R2 keys, and `/privacy` gets a line saying so
   (Logan, to the moderator, 2026-11-03: "okay to privacy update").
3. **What does a forwarded link show? Answered.** Not nothing, as this plan first said. The no-cookie view shows the
   animal's name and listed photo, the shelter and the status, with no amount and no masked address, since a masked address
   still shows the domain. Logan, to the moderator, 2026-11-03: "yeah i think that was the idea. no cookie means you can see
   the email or amount", read as a typo for "can't", and told so; he confirmed it: "i think thats what i and the other
   chat decided".
4. **What happens after a shelter withdraws? Answered.** ADR-0022 reads the grant "as of the gift's date", a keepsake can
   now predate its donation, and Logan's "still make the painting" covers a paid gift. He objected to the first proposal,
   that a return needs a grant active at that moment, because a bank donor mid-checkout shouldn't wait days for a webhook.
   Logan, to the moderator, 2026-11-03: "I think 24 hours is better". A return within 24 hours of `created_at` paints even
   after a withdrawal, on its own constant, since `JUST_STARTED_MS` means something else. A later return after a withdrawal
   waits for the webhook, and a confirmed gift always paints, reading the grant as of `created_at`, when the button was open.
5. **How long is an unconfirmed address kept? Answered: 30 days from the form's submit.** Logan, to the moderator, 2026-11-03:
   "what time should the erase date be? what does it line up with?", then "yes keep 30". `eraseAbandonedAddresses` doesn't skip
   returned intents: that would give them the open-ended hold of a paid gift, and paintings have no date, so a stranger's typed
   address would wait indefinitely. It lines up with the 30-day cookie and the 30 days `/privacy` already states.
   A webhook closes the intent and holds the address anyway, so a real bank gift loses out only if its webhook takes over 30
   days, which ADR-0027 already accepts. So an unconfirmed gift whose address is gone gets no painting, and a real donor
   whose webhook was lost has 30 days for the painter to reach them. The sweep and the handler skip such a gift, and the
   token page still works after erasure.
6. **Limit by address? Answered, as the moderator read it and told him** (decision 8). Logan, to the moderator, 2026-11-03: "as far
   as email storing goes, can't we just use the hash list we are keeping permanantly? thoughts?", then the words in question 1.
   He answered "yes" to counting at the send without naming the form.

   **A stranger's stop** is what ends the cost in decision 7. One-click unsubscribe writes nothing yet, and ADR-0027 says a
   suppression is "written only on a bounce or complaint". Proposed: it writes one on the normalised digest and erases the
   address at once on every intent of that inbox, since several can be waiting, so the same address is refused on the sponsor
   page (decision 7 of that amendment). The link can't look the address up, since it may be gone by the click, so it carries
   the HMAC. Those decision 7 words and `/privacy`'s marker line then name unsubscribing too. A bounce stays exact, since a
   server can treat `+` literally, and the check looks up both digests. No suppression exists yet, so this is still cheap.

   It acts only on POST, never on GET: a mail scanner that prefetches the link would otherwise write a permanent suppression and
   erase every waiting address with no click, the trap `schema.ts` records for sign-in links. So the header is RFC 8058's
   `List-Unsubscribe-Post`, and the link in the body opens a page with a button. A stop reaches confirmed gifts' waiting
   paintings too, so the page after the button says those won't come by email and that the donor can write to hello@.
7. **Is the painting promised? Answered.** Logan, to the moderator, 2026-11-03: "honestly in the privacy we probably need a line that
   we don't guaruntee you recieve art in exchange for the donation. that sounds like a legal obligation and there could be
   cases where the art just never arrives. we do our best of course." And later: "no guaruntee line needs to be more friendly
   something that assures them we try to make all painting requests if you have an issue email us (?)". Then: "the line is still
   no good. we need to say something like rare cicumstances or errors cause us to not send one. we need to make it sound like it
   should work but stuff happens you know". Approved, to the moderator, 2026-11-03: "yes that line works", about:

   > Your painting is our thank-you, and it should reach your inbox once it's ready. In rare cases, an error or something out of
   > our control can stop one being made or sent. If that happens, write to hello@monsterpaws.org and we'll sort it out. Your
   > donation goes to the shelter either way.

   It goes on `/privacy`, where his first words put it. The sponsor page's keepsake section is the moderator's recommendation,
   since there is no terms page and nobody reads `/privacy` before paying, and he hasn't named it. The flat "A gift already made
   still gets its painting" changes too: "yes keep 30, and change it to can still get". `/privacy` says so now, and the shelter
   term follows in `template.ts`. ADR-0022 and ADR-0027 keep their recorded wording, each with a pointer here. Every.org's
   receipt also bears on this: `doc/issues.md`.

## Consequences
- Paintings will outnumber recorded gifts, and without Every.org's data we can't tell a bounce, a fake and a
  lost webhook apart. A daily check flags returned intents with no webhook after a few days, which gives a
  real failure rate and a list to fix by hand.
- `thankYouIntent` keeps a returned gift current instead of falling back after an hour, and `/thanks`'s waiting
  copy changes, and can't say a painting has started, since it may be waiting for a place.
- `keepsake` needs a migration (0017), and `donation_intents` a token and a return time (0018). Oplog 0021 runs
  before D: a worker must never pick up a gift with no animal.
- Comments that go false with C: `link.ts` ("never from this URL") and the two cookie comments in `/thanks`, with
  the page's bookmark copy and `/privacy`'s cookie line.
- `snapshotKeepsake`, the hold and the owed list are the donate stream's. The `art.generate` handler has no owner
  (the moderator recommended the donate stream, after Spencer), so slice D stops at "owed".
- **What shelters were told.** `template.ts:85` says a donor "gives what they like, and gets a small painted
  keepsake", and a painting can now exist with no gift. Spencer's yes rests on what it was told, so this is Logan's
  call before its grant is recorded.
- ADR-0027 as amended 2026-11-02, decision 4, says "Until a webhook records the gift, nothing is sent to that address",
  which goes false with the first painting from a return. `eraseAbandonedAddresses` returns only ids and leaves Resend's
  list alone, so it must take a mailed address off that list too.
- **The art email is sent by a droplet sweep, not by the painting's job,** because a mail over the count has to go later.
  Confirmed first, then unconfirmed oldest first against the 30-day clock, one per inbox a tick; unsent unconfirmed cycles
  are at most 750, so the tick is cheap, and the backlog after a long painter outage takes about 8 days at Resend's 100 a day. It needs a recorded fact that the mail went, since a lost `email.delivered` keeps the
  address, and a retry would mail again. It writes the count and the claim first, so a crash over-counts, never over-mails.
- **Reaching 30 days ends the wait.** An open intent whose address is erased (question 5) is dead: the handler doesn't paint it,
  and it no longer counts as owed, or it would hold a photo past ADR-0022's "when the last painting owed is done". Art already
  painted stays, with no mail, and nothing removes it yet: a sustained flood adds up to 100 images a day to R2. A later webhook finds no address, which ADR-0027 as amended 2026-11-02 already accepts, and the
  donor can write to hello@.
- CLAUDE.md's "Generate **only on donation**" line changes on Logan's approval.
- `/privacy` says nothing about keeping a painting either way. That line comes with the first
  painting.

## Alternatives
- **Webhook only.** Rejected: bank donors wait, and a lost delivery costs a paid painting.
- **Paint on form submit.** Rejected by Logan: the form takes no money, mails unverified addresses and exposes the
  GPU queue. The token is one request more than this, so the difference is decision 7's limits, an abandoned checkout, which reaches
  no token, and order.
- **Over a limit, webhook only, with a hold on the intent.** Rejected by Logan: "as long as the legit others still work the next
  day". It would have stopped one burst mailing for 30 days, not a script that resubmits daily.
- **A permanent row in `email_suppressions`.** Asked by Logan. A row there means never mail (decision 8), and it would be a
  lasting record that an address tried, which ADR-0027's erasure avoids.
- **Keeping `donor_email` past delivery to count from it.** Rejected for the changed fix rule, `/thanks` and `/privacy`. A live
  check with erase on delivery holds an inbox to one at a time, never to a total.
- **Counting per email before painting only.** A `fixDonorEmail` move dodges it, and days of paintings can reach the send together.
- **Showing the painting on the token page.** Rejected by Logan (question 2): the page is visited straight after a gift, long
  before a painting exists.
- **Verifying that we created the token.** Asked by Logan, 2026-11-03. It doesn't separate payers from non-payers: a
  non-payer's token is real too (decision 4).
- **A token that redirects to plain `/thanks`.** Rejected: a donor with five gifts couldn't reach each one.
- **Token only, no cookie.** Rejected by Logan: the link would work as a key to the donor's address and painting.
- **Queue the job on the insert that wrote.** Rejected: pg-boss deletes unclaimed jobs, and the insert never repeats.

## Revisit triggers
- Every.org grants our key `/v0.2/donations`, or a lookup by charge id: unconfirmed gifts could be checked instead
  of capped.
- Every.org says it retries, or how long it waits.
- A measured webhook delay for bank, which sets how long a real gift waits, and more than one gift each for card (3.5 s) and
  PayPal (13 s).
- A flood the total doesn't hold, or that keeps real gifts waiting: a limit by IP goes back to Logan, 5 gift starts a day,
  counted in the app's memory with nothing written. It has a precondition, from the docs and code, not measured.
  `doc/infra.md` opens 443 to everyone and records no Authenticated Origin Pulls, the `Caddyfile` has no `trusted_proxies`, and
  `src` reads no client address. So a direct hit on the droplet can send any `cf-connecting-ip` it likes, and `x-forwarded-for`
  should show Cloudflare's edge, which would put unrelated donors on one counter. It means measuring both headers and the live
  firewall, then Caddy's `trusted_proxies` with Cloudflare's ranges, or limiting 443 to them, a production change with its own
  oplog entry. The address stays out of reports and logs (ADR-0010 as amended 2026-11-02).
- A spam complaint from an address that gave nothing, a real gift delayed behind unconfirmed ones, or the daily check
  showing a flood: decision 7's numbers go back to Logan.

## Note (2026-11-03): question 2 and the share page (ADR-0036)

Question 2's answer stands for `/thanks`: that page never shows the painting. Its "there are no public
paintings" no longer holds for a keepsake published under ADR-0036, whose page has its own token, never
this ADR's.

## Amendment (2026-11-04): no bank option until the return signal ships

To reach real gifts by the Meta deadline, a painting starts at the webhook alone for now, and slice C follows (`doc/plans/demo-chain-contract.md`).
A bank gift confirms days later, and Logan's own had no webhook after 4 minutes, so a bank donor would wait days: what this ADR set out to stop.
Logan, to the moderator: "if not yes we can just do card and paypal right now". The donate link offers card and PayPal, and the sponsor page stops
mentioning bank. **Slice C puts `bank` back in `method`, and the sentence with it:** "Paying by bank sends every cent."

## Amendment (2026-11-03): what the painting email's build changed

Built for the Meta demo's local chain (`src/core/email/`, `doc/plans/demo-chain-contract.md`). Everything here is
the send's own detail, except the first, which changes decision 8.

- **No key, no send, for any gift.** Decision 8 says that without the key "an unconfirmed mail waits and a confirmed one
  still goes". A confirmed mail with no key can't be checked against the never-mail list, which breaks ADR-0027's "the
  check runs before every send", so nothing goes. Agreed with the moderator, 2026-11-03.
- **The unsubscribe link carries a mac over the digest.** Question 6's link carries the HMAC, and any POST to it writes a
  permanent row. Without a mac, a stranger could fill `email_suppressions` with made-up digests.
- **A claim is good for 23 hours.** Resend keeps an idempotency key for 24 (docs, read 2026-11-03), so a send with an unknown
  outcome retries under the same key for 23 hours, then stops and reports. The key is the share token, never the keepsake
  id: a dev run and production share one Resend team, so production's keepsake 1 under a dev run's key would be refused. A second attempt past the key's life could
  mail twice. A refusal that left nothing clears the claim, so its window starts again, and a refusal that can't be
  retried holds the row for a person.
- **The sent record is `painting_email_sends`, never a `keepsake_fact`.** Facts are deleted by basis, and the sweep would
  read a deleted record as unsent and mail again.
- **The images go inline, as JPEG attachments.** A link would need a public URL for every painting, and a remote `path`
  has no stated fetch time. Resend's limit is 40MB per email after Base64 and its batch endpoint takes no attachments, so
  it's one POST per email. Inline images "may be rejected by some clients (especially webmail)", so the text says they're
  attached.
- **Live mail takes a named value.** Mailpit is the default. `EMAIL_LIVE=1` needs `RESEND_API_KEY` and
  `EMAIL_LIVE_ALLOWED_TO`, and neither is filled by `env:dev`, since a sweep with a live key could mail any address in a
  dev database. `EMAIL_LIVE=production` is the droplet's, to anyone.
- **No hold on the first day's mail.** Nothing goes on its own without `EMAIL_SWEEP=on`, and production runs with it on. A
  hold for a person to see the four paintings first was proposed, and Logan declined it, to the moderator, 2026-11-03: "no i
  wont look before the first day emails. they will just go out and hopefully we do a good job. i can review the images from
  the media bucket throughout the day". `npm run email -- list | send-owed --keepsake <id>` stays as the by-hand tool.
- **Art comes from one of two named sources.** `EMAIL_ART_SOURCE=media` reads the published copy on
  `media.monsterpaws.org` by `share_token`, since home paints and the droplet mails and real paintings go on the share page
  (Logan, 2026-11-03: "yes real paintings on the share page is what we want"). `store` reads the local store, for the crew's
  rehearsal. Taken down means unreadable, so a painting is never mailed from a stale copy. `EMAIL_SHARE_LINKS=off` leaves the
  Share button out, for a rehearsal with no published page.
- **The webhook is verified by hand, with no new dependency.** Svix's scheme is a few lines of `node:crypto`, and a test runs
  Svix's own published vector. Neither Svix's nor Resend's docs state a tolerance (read 2026-11-03), so ours is 5 minutes.
  Its row holds the `svix-id`, the type and Resend's mail id, never the event's `to`.
- **The mail cleans a listing's name for its own words.** A listing's name is as published, such as "Sparrow (Courtesy Post)
  Foster or Adopt Me!" or "A310627". `spokenAnimalName` keeps what reads as a name, and when none survives the mail says
  "the animal you chose" and still sends. The keepsake's `name` fact stays as published.
- **A complaint is a person's stop, so it covers the inbox,** like an unsubscribe, and erases every gift of it. ADR-0027 didn't
  say which digest. A bounce writes a row only when its type is `Permanent`: a soft one must never cost a donor's only address.
  `email.suppressed` counts as permanent, and `email.failed` keeps the address and reports.
- **A bounce stays visible, as ADR-0027 as amended 2026-11-02, decision 4, says.** A permanent bounce raises an alert and sets
  `refused_code = 'bounced'` on the send row, and `/thanks` says so and takes a new address, which clears that row and mails
  again under a key of its own. That is the only case that clears a sent row. Once mail has left with no bounce, a fix is refused
  and the page says what happened, never "Saved." `email.delivered` erases only the address it was sent to.
  `npm run email -- bounced | readdress` is the by-hand resend for a donor without that browser.
- **The words are Logan's.** He approved the email's on 2026-11-03 ("yes email wording is good"), having asked for its title,
  then the unsubscribe page, `/privacy`'s marker line and the three `/thanks` sentences ("yeah those are fine"), and ADR-0027's
  decision 7 words with "or you unsubscribed" added, as question 6 says ("yes to unsubscribe workind"). His wording audit then
  changed the mail, the unsubscribe page and the ask: no "gift" a reader sees, nothing saying a painting is theirs, and the
  painting as our thank-you, which we try to make ("approved, for the wording", 2026-11-04).
- **The sweep walks the owed list, a batch a tick.** Gifts that can't send yet, a suppressed address, a set not yet published,
  would otherwise hold every place and stop all painting mail with nothing reported. An erased address isn't owed at all.
  What keeps waiting reports at most hourly. A bad API key or a spent quota retries, since it says nothing about a gift.
