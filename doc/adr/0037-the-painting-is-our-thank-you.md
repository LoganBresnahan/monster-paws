# ADR-0037: The donation is the gift to the shelter, and the painting is our own thank-you

Status: accepted (2026-11-04). Logan approved the audit's table, to the moderator: "approved, for the wording".

## Context
Every.org's receipts say "No goods or services are provided to you in exchange for your gift". Our own words
said the opposite: "Sponsor a real shelter animal and get a keepsake painting", "What you get", "they're all
yours to keep". Logan: "i think we just need to audit our words to never say something like 'exchange' etc.
everything has to be uh whats the word...kinda like 'try' of 'our own volition'. basically we need to audit our
words everywhere".

## Decision
**The donation is the gift to the shelter, and the painting is our own thank-you, which we try to make. Nothing
a donor or shelter reads says or implies you give in order to get.** That covers every page, metadata, alt text,
link previews, emails and the shelter ask. In what a person reads:

1. **"We try to", as our thank-you.** Never "you get", "in exchange", or a promise of a painting. The sponsor page
   says only "As our thank-you, we try to paint {name} and email you the paintings."
2. **"Donation", never "gift".** Logan: "still try to avoid 'gift'". Code and identifiers keep the word.
3. **"Painting", never "keepsake".** Logan: "okay, painting it is". Code keeps `keepsake`. "Sponsor" stays.
4. **Nothing says a painting is the donor's:** no "yours", "yours to keep", "your painting" or "your collection".
   Logan: "as far as the users 'collection' we need to avoid that they are 'theirs' more like, you can view the
   painting on your sponsor history page". Only the demo has that page (ADR-0028 as amended 2026-11-04). A real
   donor's email and thank-you page say "You can view the paintings here", linked to the share page (ADR-0036).
5. **Paintings already sent "can't be recalled"**, in place of "stay with those donors", because a shelter still
   has to be told we can't pull them back.

`e2e/demo.spec.ts` and `e2e/share.spec.ts` fail on these words on the home page, the demo and the share pages.

## Consequences
- **This changes our words, not what happens.** A painting still only follows a donation, so this doesn't settle
  whether a painting affects Every.org's receipt. That stays the open question in `doc/issues.md`.
- `doc/DIRECTION.md:23`, "In return the donor gets", says the opposite. It is Logan's to change, and he has been asked.
- Words already sent can't change: Spencer's thread and any shelter already written to read "gets a small painted
  keepsake". Words outside the repo, such as social bios and posts, the hackathon write-up and the video, have to
  be read by hand.
- Some of these lines replace words Logan approved earlier (ADR-0035's question 7). Those ADRs keep their recorded
  wording.

## Alternatives
- **Another name for "keepsake".** "Remembrance" reads like a memorial. "Memento" and "token" have the same
  problem as "keepsake", or worse. "Portrait" was the second choice.
- **Dropping "Sponsor".** It isn't what says give-to-get, and it is on every button, heading and `/sponsor` URL.
- **"We can't promise a painting" on the sponsor page.** Logan: "we don't need" it. "We try to" says enough.

## Revisit triggers
- Every.org or an advisor answers the receipt question.
- Accounts ship, and a real donor has a sponsor history page to point at.
