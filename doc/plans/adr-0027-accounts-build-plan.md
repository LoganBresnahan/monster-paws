# ADR-0027 build plan — donor accounts

Derived from `doc/adr/0027-donor-accounts.md` by the `adr-plan` workflow on
2026-10-16 (13 slices, 15 agents); wording edited by hand. Nothing has shipped:
no account tables exist (latest migration `drizzle/0010`), and the only thing
already in place is the `resend/api-key` credential with DKIM verified.

Every slice is opus-grade, so this ADR has no Fable slice. Six slices carry an
adversarial verify pass (⚠), which runs before the slice is checked off.
Check items off as they ship.

## Phases

1. **foundations: the Every.org webhook, and the schema**
   - [ ] `everyorg-webhook-setup` — low, mechanical. The staging webhook is
     self-serve: Logan's own account at staging.every.org/developer, after
     its email verification. Its token goes in `pass`, the infra.md table, a
     commented `.env.example` line and the `env-dev.sh` fill, by name only.
     The questions email to partners@every.org (signing, retries, a lookup by
     `chargeId`, monthly gifts, staging test cards) was drafted 2026-10-16;
     its answers may retire ADR-0027's first revisit trigger. The production
     webhook is a separate setup before launch.
   - [ ] `donor-account-schema` — medium, moderate. Additive tables only, so
     the corpus is untouched: accounts, passkey credentials, sessions,
     sign-in links (stored hashed, with expiry and `used_at`), donation
     intents (128-bit id, nonprofit slug and EIN), `everyorg_webhook_payloads`
     (append-only, inside the donor-owned deletion exception, so its comment
     differs from `raw_payloads`), donations (unique `chargeId`),
     `donation_stats`, email suppressions, **and keepsakes** (see risk 1).
     The two things to check in the diff: `donation_stats` has no FK and no
     account, intent, `chargeId` or email, so no cascade can ever reach it;
     and every donor-owned row carries the ownership column deletion needs.
     A `doc/flows.md` skeleton with every stage `(planned, ADR-0027)` can
     land here.

2. **the session boundary and email transport** (parallel)
   - [ ] `session-dal` — medium, moderate ⚠ verify. Follow
     `node_modules/next/dist/docs/01-app/02-guides/authentication.md`: a
     random token stored hashed as a row, the cookie httpOnly, Secure and
     SameSite=Lax, read only in one cached DAL function, never at a layout's
     top level; a new session on every sign-in, plus revocation and sign-out.
     Verify: no raw token at rest, no session fixation, expiry and revocation
     checked on every read path.
   - [ ] `resend-transactional-email` — medium, moderate. One sender fixed to
     monsterpaws.org; sign-in mail through its own sender, which takes no
     other content; List-Unsubscribe and List-Unsubscribe-Post on everything
     else; a suppression check before every send; the signed bounce and
     complaint webhook (verified over the raw body, with a timestamp
     tolerance) writes suppressions. Unit test it with a good fixture and a
     tampered one. The webhook signing secret goes in `pass` and infra.md
     here, and the SDK, if used, gets its own ADR line.

3. **the sign-in link, the intent, the export** (parallel; disjoint files)
   - [ ] `email-link-sign-in` — medium, moderate ⚠ verify. Consume the
     token in one `UPDATE … WHERE used_at IS NULL AND expires_at > now()
     RETURNING`; never consume on GET, because mail scanners prefetch links
     (the GET page posts a confirm); creating an account on first
     verification must not race an existing account for the same email.
   - [ ] `donation-intent-donate-link` — medium, moderate. A CSPRNG id, the
     cookie flags, the redirect host fixed to Every.org,
     `partner_donation_id` set to the id. Needs the shelter-to-nonprofit
     mapping (see risk 2). Builds against a placeholder token if the webhook
     setup slips.
   - [ ] `account-export` — medium, moderate. A pg-boss job builds one
     archive (art at full size, cards, donation history, account JSON) in R2
     under an unguessable key behind a short-lived link. One test proves it
     is scoped to its own account. The archive library gets its ADR line.

4. **passkeys and the webhook trust boundary** (independent; verify each)
   - [ ] `passkey-auth` — high, moderate ⚠ verify. SimpleWebAuthn (its ADR
     line here). Any number per account, named, listed, removable. Verify:
     each challenge is single-use and bound to its ceremony; a passkey is
     never added to an account the caller hasn't proven they own; a sign
     count of 0 from synced passkeys is accepted; removing the last passkey
     leaves email recovery in place; the RP ID holds across :3000, :3100 and
     production.
   - [ ] `everyorg-webhook-endpoint` — high, moderate ⚠ verify. Store the
     body verbatim before parsing anything; match on `partnerDonationId`
     alone, against an open intent, with an exact slug and EIN check; a
     unique `chargeId` makes it idempotent; closing the intent, inserting the
     donation and enqueuing the art happen in one transaction; the path
     carries our secret; logs carry no identities. Anything unmatched is kept
     and logged, never acted on.

5. **stats, and the thank-you page and claim**
   - [ ] `anonymous-donation-stats` — medium, moderate. The stats row is
     written in the webhook's donation-insert transaction, only when the
     insert actually happened (`ON CONFLICT DO NOTHING RETURNING`). Every
     count reads only `donation_stats`. "Sponsors" counts gifts, not
     distinct donors (the row has no donor in it), and the comment says so
     with `(ADR-0027)`.
   - [ ] `thank-you-and-claim` — medium, moderate ⚠ verify. The intent
     cookie holds the keepsake for this browser; keeping it means an email
     and then a passkey; the claim email goes to the webhook's address only
     when the donor shared one; the no-email warning is shown before the
     donor leaves. Verify: a claim binds to the right account, a claim link
     can't be replayed after a passkey claim, the webhook email is only a
     hint. The Playwright donor-flow e2e lands here.

6. **deletion, and closing the docs**
   - [ ] `account-deletion` — high, moderate ⚠ verify. Export offered first,
     then every donor-owned row and its R2 art, in an order that never leaves
     a DB row pointing at deleted art. Tests assert it deletes neither too
     little (webhook payloads naming the donor, R2 objects) nor too much: the
     corpus, `event_log`, attestations and the `donation_stats` row count are
     unchanged.
   - [ ] `accounts-docs-flow-privacy` — low, mechanical. Reconcile
     `doc/flows.md` (each earlier slice updates its own box in its own
     commit; this is the final pass); the privacy page names Resend as a
     processor; the infra.md rows; roadmap item 4's carry-in; and the
     ADR-0025 decision on whether "Recently viewed" syncs for a signed-in
     donor, by its own amendment.

**Critical path:** `donor-account-schema` → `session-dal` →
`donation-intent-donate-link` → `everyorg-webhook-endpoint` →
`anonymous-donation-stats` → `account-deletion`.

## Sequencing risks

1. **Keepsakes have no table in the ADR's list.** Thank-you, export and
   deletion all need one (the art and card R2 keys per donation). Settle it
   in the schema slice, even as a minimal row, so no later slice needs a
   mid-stream migration.
2. **Nothing maps a shelter to an Every.org nonprofit slug and EIN.** Decide
   where that mapping lives at the start of phase 3. A shelter with no
   mapping gets no donate button, never a dead one (ADR-0015).
3. **The webhook setup is Logan's errand.** If it slips, the intent slice
   builds against a placeholder and the webhook units run on fixtures; only
   the end-to-end staging check waits.
4. **The production roll.** Nothing lets a real donor give or make an
   account until export, deletion and the privacy page naming Resend have
   shipped. Passkeys can be dogfooded in production (the cross-device QR
   needs a real domain) with donating hidden, or the roll waits for phase 6.
   That is still item 3b's call: no production database until the loop works.
5. **Resend's free-tier daily cap** is checked against expected sign-in and
   claim volume before launch.
