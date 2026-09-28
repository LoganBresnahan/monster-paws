# ADR-0022: A keepsake is a snapshot held on its own basis, never a view of the listing

## Context
DIRECTION promises that a donor's keepsake — the card, its art, the animal's
name, breed, age and shelter — "lives permanently in the donor's account". The
listing side cannot keep that promise, and was never meant to:

- `animals`, `animal_identities` and `animal_display` are **derived and
  purgeable** (ADR-0003, ADR-0015). `purgeDisplay` shipped 2026-09-28; a full
  source purge (ADR-0006 decision 4) deletes RescueGroups facts too, and item
  10's cross-source merge will rebuild animal rows under a card's feet.
- RescueGroups' terms require that on termination "all copies of the data …
  and **all information derived or extracted from the data** must be
  immediately removed" (`doc/rescuegroups-api-terms.md`). A name copied from
  the API into another table is still extracted from it; copyright is
  irrelevant, because this is a contract.
- Our granted key application said the same thing to RescueGroups
  (`doc/rescuegroups-application.md`): RG-sourced cards show "the animal's
  actual listing photo", RG-derived data is purged if access ends, and the
  artwork program "is based on the shelter's own authorization and their own
  photos, not on API data".

So a separate keepsake table is necessary but not sufficient. What makes a
keepsake field keepable is **the basis we hold it on**, not the table it sits
in. Found while designing the display purge, 2026-09-28, before item 4 gave
donations anything to point at.

## Decision

### 1. `keepsake` is its own entity, written once at donation
When a donation completes (roadmap item 4), a keepsake is **snapshotted** from
what the listing shows at that moment: "Biscuit, as listed on 2 Oct 2026". It
is append-only in the ADR-0003 sense — never UPDATEd; a correction is a new
row. A card never changes because a feed later edited a listing.

**The card renders from the keepsake alone** — never through `animals` or
`animal_display`. The listing side may be purged, rebuilt or merged (item 10)
without touching a single card.

### 2. Every field carries the basis it is held on, by name
Three bases, named and persisted (the name, never a rank — ADR-0006 as
amended):

| basis | covers | survives |
| --- | --- | --- |
| `donation` | amount, date, the recipient nonprofit (Every.org's record and ours) | always |
| `grant:<slug>:<permission>` | facts, photo, art a shelter authorized directly | per the grant's end terms (ADR-0006 as amended 2026-09-28) |
| `aggregator:<source>` | facts and the hotlinked photo from an aggregator | per the license's end terms — for `rescuegroups`, purged |

A field has exactly one basis. A value available on two bases takes the
**most durable** one — a shelter grant over an aggregator — and nothing else.

### 3. A field is a row, so a purge is a set delete
The permanent `keepsake` row holds only `donation`-basis data. Every other
field is its own `keepsake_fact` row — `(keepsake_id, field, value, basis,
snapshotted_at)` — so ending a basis deletes the rows that name it, as a set,
with no UPDATE of the keepsake. This is the ADR-0006 purge exception reaching
one more table, and only by basis.

The pointer from a keepsake to the live listing (for the ADR-0020 timeline) is
itself listing data: it lives beside the facts, carries the listing's basis,
and purges with it.

### 4. An aggregator-only card degrades to its donation, and says so plainly
A donor who sponsors an animal whose shelter never spoke to us gets a card
built on `aggregator:rescuegroups`. If RescueGroups access ends, that card
keeps its `donation` half — "A sponsorship at Shelter X · 2 Oct · $25" in the
Monster Paws frame — and loses the name, photo and facts. That is what we told
RescueGroups the card would be. No copy frames the loss as urgency or as the
donor's fault (DIRECTION bright line 3).

### 5. Permanence is earned by consent, and asked for up front
AI art is already gated on a shelter's `digify` grant (ADR-0006 decision 5), so
the full keepsake DIRECTION describes exists only where a shelter has spoken to
us directly. The consent ask (roadmap item 5) gains a **retention clause**:
keepsakes already given to donors — the animal's name, breed, age, photo and
artwork — stay in those donors' accounts if the shelter later withdraws
permission. The shelter's answer becomes the grant's end terms, with evidence.
It must be in the first email: asking at the first revocation is too late.

## Consequences
- The card and the listing are decoupled. Item 10's merge and every purge are
  safe for donors by construction.
- DIRECTION's "permanently" holds for consented shelters and not for
  aggregator-only sponsorships; DIRECTION is amended to say so.
- Item 4 grows a snapshot step and two tables. Item 5's email grows a clause
  that a lawyer should read before it reaches a real shelter.
- A basis has to exist before a field can be written, so every keepsake
  write passes through one function that names it — the point of temptation
  for a "just copy the name" shortcut, and the place the rule is enforced.
- The flow is drawn in `doc/flows.md` § Keepsake snapshot (planned, item 4).

## Alternatives
- **Render the card from `animals`.** Rejected: every purge, rebuild and merge
  becomes a change to a donor's memory, and an RG termination erases cards.
- **Copy everything into a separate table and call it ours.** Rejected: the
  table changes nothing about the terms; it is extracted data, and it breaks
  the promise in our key application.
- **One keepsake row with nullable fields, nulled on purge.** Rejected: an
  UPDATE on an append-only table, and a purge that has to know every column.
- **Refuse to sponsor unconsented animals.** Rejected: donations to any US
  501(c)(3) work before partnerships (ADR-0005), and aggregator donations are
  what warm up shelter outreach. A degraded card is honest; no sponsorship is
  worse.

## Revisit triggers
- RescueGroups agrees in writing that keepsake snapshots survive termination
  for existing donors — `aggregator:rescuegroups` gains a retention term, and
  §4's degradation becomes rare.
- A shelter declines the retention clause — decide whether its cards carry
  `grant` basis with a purge term, or stay `aggregator`-basis.
- A donor asks to delete their own keepsake — donor-initiated deletion is a
  privacy question, not a basis question; it needs its own decision.
