# RescueGroups.org — what the terms actually license (read 2026-08-25)

Verbatim clauses, fetched 2026-08-25 by Claude for the roadmap item 3
display question; quoted so a decision can cite them without re-reading
the site. Companion to `doc/rescuegroups-application.md` (what we declared
when the key was granted 2026-08-02) and ADR-0006.

## API Terms of Service — https://rescuegroups.org/api-terms-of-service/

- **License.** "Subject to your compliance with the restrictions below, we
  grant you a limited, non-exclusive, non-transferable and revocable
  license to access the API and associated documentation to develop, test,
  and support your websites, services, products, and applications." …
  "These Terms do not grant you any rights to the data accessed through the
  API other than for temporary use and display in your services."
- **Scope = the key application.** "Use of the API data shall be described
  in the API Key information … Use of the data for any service that
  provides features other than those described in the API Key will be
  considered a violation of these terms."
- **Tracker.** "If your API Key is displaying animals and organization data
  to the public, every pet detail page must contain the included Pet
  Adoption Tracker image."
- **Attribution.** "RescueGroups.org does not require any attribution or
  logo in your Service when using our API or API data. However, if a link
  or attribution is included, it should be 'Powered by RescueGroups.org' or
  similar and link to our main corporate website."
- **Caching.** "The data may be temporarily cached in your system for use
  in your applications." … "We recommend updating daily, but no less
  frequently than weekly."
- **Termination.** "All copies of the data, including backups, and all
  information derived or extracted from the data must be immediately
  removed if your access to the API is terminated."
- **Fees.** "You may charge a fee for your services, however you may not
  sell, rent, or lease access to the API or the API data."
- **Absent:** any clause on modifying/cropping/framing pictures or
  derivative works; any clause on picture ownership; any opt-out mechanics.

## Site Terms of Service (the shelter's grant to RescueGroups) — https://rescuegroups.org/terms-of-service/

- "You remain the owner of all individual data and animal pictures when
  uploaded to the Service."
- The shelter grants "a non-exclusive, royalty-free, worldwide right and
  license (with right of sublicense) to RescueGroups.org, its licensees,
  successors and assigns, to collect, compile, use, reproduce, display,
  distribute, create derivatives works of, and transmit the data and
  pictures to third parties, for use in any media or medium now known or
  hereinafter developed without further compensation".
- "The Service includes an online pet listing that can be automatically
  sent to other external pet adoption listing websites."

## What we declared in the key application (granted 2026-08-02)

"Display adoptable animals (name, photos, breed, age, description, status,
and organization info) on public pages that link back to the listing
organization" and, for cards, "the animal's actual listing photo with
attribution and a link back." Generated artwork was declared as based on
"the shelter's own authorization and their own photos, not on API data."

## Reading

The chain is: shelter → RescueGroups (sublicensable display + distribution
of pictures) → API partner (temporary use and display, scoped to the
application). Displaying listing photos and descriptions on our pages, and
the listing photo on a card, is inside what we declared and inside what
the API terms grant. What the API terms do NOT grant is anything beyond
"temporary use and display" — so no permanent copy, no derivative
artwork from API photos, and everything purgeable. This corrects ADR-0006's
Context line "no aggregator grants photo derivative-work rights" only in
its breadth: RescueGroups holds those rights and sublicenses *display*,
not derivation.
