# RescueGroups.org API key application (draft)

Form: https://www.rescuegroups.org/?page_id=1004
(Adoptable Pet Data API: https://rescuegroups.org/services/adoptable-pet-data-api/)

ToS note (ADR-0006): use is contractually scoped to this description —
candor here is the legal foundation. If scope changes later, we notify them
and re-describe before shipping the change.

---

**Name:** Logan Bresnahan

**Company/Organization:** Monster Paws (monsterpaws.org) — independent
project, operating as a free public-benefit service; no cut is taken from
any donation.

**Contact:** hello@monsterpaws.org (forwards are live; personal: loganbbres@gmail.com)

**Service URL:** https://monsterpaws.org

**Service description:**

Monster Paws is a free website that encourages people to sponsor adoptable
shelter animals. Visitors browse adoptable pets, and when they choose to
donate, 100% of the donation goes directly to the animal's shelter or rescue
through Every.org (a registered 501(c)(3) donation platform). Monster Paws
never processes payments, never takes a fee or percentage from donations,
and displays no advertising. Operations are funded only by an optional,
zeroable tip that donors may add for the site itself.

How we would use the API:

- Display adoptable animals (name, photos, breed, age, description, status,
  and organization info) on public pages that link back to the listing
  organization, refreshed at least daily via polling.
- Include the RescueGroups.org Pet Adoption Tracker image on every pet
  detail page, as required.
- Honor organization- and animal-level export preferences: animals or
  organizations that disappear from the feed are treated as revoked and
  removed from public display on the next poll.
- Data is cached to serve pages and refreshed on schedule; if our API
  access ever ends, all RescueGroups-derived data will be purged per the
  Terms of Service (our database tags every RescueGroups-sourced record for
  exactly this purpose).

Donor experience: after donating, the donor receives a digital "keepsake
card" for the animal on their Monster Paws account. For animals sourced
from the RescueGroups API, the card displays the animal's actual listing
photo with attribution and a link back. Separately from the API, when a
shelter gives us direct written permission, we create stylized illustrated
artwork of their animals for these cards — that artwork program is based on
the shelter's own authorization and their own photos, not on API data.

Our goals are more adoptions and more donations for the organizations you
serve: every animal page promotes the animal's adoption profile first, and
every dollar donated goes to the organization. We will maintain a public
privacy policy describing data use, and we're happy to answer any questions
or adjust our implementation to your requirements.

**Category:** adoption promotion / donation facilitation for shelters and
rescues (non-commercial; no sale of products or data)
