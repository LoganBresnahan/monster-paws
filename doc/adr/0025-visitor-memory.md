# ADR-0025: What we remember about a visitor stays on the visitor's device

## Context
Browsing 64k+ animals, a visitor loses track of the ones they liked. On
2026-10-05 Logan asked for a history of the animals a person has viewed, so
they can get back to one easily.

That reads like account territory, and no account decision exists. The roadmap
puts "donor accounts" in item 4, DIRECTION and ADR-0022 assume a donor's
keepsakes live "in their account", and nothing decides how anyone signs in or
what we hold about them. A viewing history built on accounts would quietly make
that decision for item 4, and would put sign-in in front of something every
visitor can use anonymously today.

The site's defaults point the other way. Session Replay is off (ADR-0010 as
amended 2026-09-29), logs carry identifiers and never identities (ADR-0010), and
nothing on the site tracks a visitor.

## Decision
1. **"Recently viewed" lives in the visitor's browser** (`localStorage`), never
   on our servers. Each animal detail page adds itself: the animal's id and when
   it was viewed, nothing else. Newest first, capped at 50, a repeat view moving
   the animal to the top.
2. **A `/recent` page renders the list as ordinary cards.** It shows today's
   name, photo and place, fetched by id through the same helpers browse uses, so
   a stored id never bypasses the visibility predicate or the licensed display
   pick (ADR-0015). An animal that is no longer visible shows as **"no longer
   listed"**, never "adopted": an absence is not an outcome (ADR-0020).
3. **The ids sent to fetch those cards are never stored or logged with anything
   that identifies the visitor.** The request carries the list; the server
   answers and forgets it.
4. **"Clear history" empties it,** and nothing anywhere else needs clearing.
5. **No account is required, and none is implied.** When accounts exist (item
   4), whether a signed-in donor's history syncs is that ADR's question, opt-in,
   and never a backfill from a browser that did not ask.

## Consequences
- History is per browser and per device. A phone and a laptop keep separate
  lists, and clearing site data erases it. That is the cost of keeping it off our
  servers, and the page says so.
- No new table, no new personal data, and nothing for a privacy policy to
  disclose beyond "your browser remembers what you viewed here".
- It is a client island in the gallery's and the filters' terms (ADR-0015 as
  amended): component state plus `localStorage`, no state library. It does not
  pay CLAUDE.md's owed Zustand ADR.
- Not built: this records the decision. Building it is a roadmap carry-in.

## Alternatives
- **History in Postgres, keyed by an anonymous cookie.** Rejected: it creates a
  per-visitor behavioral record we would then have to protect, retain and
  explain, for a convenience the browser provides alone.
- **History only for signed-in donors.** Rejected: it makes accounts a
  prerequisite for something every anonymous visitor wants, and decides item 4's
  account model by accident.
- **Favorites ("save this animal") instead of history.** Not rejected: a
  different feature. Saving is deliberate and history is automatic. If favorites
  arrive, they follow the same rule: on the device until accounts exist.

## Revisit triggers
- Accounts land (item 4): decide sync, opt-in only.
- Visitors ask for history across devices before accounts exist. Then accounts
  are the answer, not a cookie.
- The list needs more than id and time (notes, tags). Then it is favorites, and
  this ADR is amended.
