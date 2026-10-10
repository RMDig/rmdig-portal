# 34 — Team service areas on the map for every user (DRAFT)

Status: **owner decisions D1–D4 made 2026-10-10 (§4); counsel review pending.** Nothing here is built. It extends
plan 33 (the portal map) and reuses AvServ plan 34 (the public SAR partner
directory). Repo-qualified references: "AvServ plan 34" is the directory, and
"plan 33" is this repo's map plan.

## 0. Goal and safety framing

**Ask (owner, 2026-10-09):** any signed-in user can open `/map` and see which SAR
teams list a service area in a region, for example before a trip. The map centers on
the user's location if they choose to share it.

These rules hold for every phase:

- **No coverage or rescue claim.** Plan 33 §1 applies: the map never claims
  monitoring, coverage, live tracking or routing. A team's area on the map means
  only that the team agreed to show where it operates. It doesn't mean the team will
  be alerted about, or respond to, anyone there. The layer is called "SAR teams that
  list an area here", never "coverage". Every visible string joins the
  `legal-copy.test.ts` scan.
- **No alert data for these users.** The red and orange layers (plan 33 §1.4) stay
  with team admins and dispatchers. A user who isn't on a team sees no alert, no
  check-out, and nothing about any person.
- **Directory, not dispatch.** This layer reads only the public listing (AvServ plan
  34 §0.2). It shares no query or type with alert routing, the "teams covering here"
  offer at check-out (plan 33 §4), or the red map.
- **Opt-in per team.** No team's area appears without its admin's explicit,
  recorded consent. That's separate from approval and from AvServ's directory
  consent, unless D2 merges them.
- **The user's location never leaves the browser.** "Use my location" calls the
  browser's geolocation API and only moves the map. It isn't sent to the server,
  logged, or stored. Precise geolocation is sensitive data under the CPA (CLAUDE.md §0).

## 1. Out of scope: crowd-sourced help for a missed check-in

Showing open alerts to the public, so that bystanders could help, was considered
and **set aside**. It would need its own plan and counsel before any code:

- An alert discloses a specific person's last location. That's sensitive data under
  the CPA, and the user consented to share it with their chosen contacts and teams,
  not the public.
- Pointing untrained people at an avalanche incident creates new danger.
- It would be a major new safety claim, which the beta can't support (doc 16 §6.2).

## 2. What users see (phase 1, signed-in `/map`)

- **Every signed-in user gets the Map tab.** `NavViewer.hasMap` becomes true for all.
  Teams, advertisers and staff keep their extra layers.
- **New layer: "SAR teams that list an area here".** It shows each consenting,
  **approved** team's service area as a light outline, with the team's public name and
  its public website link (from the directory listing) in a popup.
- **"Use my location" button** next to the map. If the user allows it, the map
  centers on them at a regional zoom. If they decline, or never click, the map starts
  on the default region. The browser remembers the choice; we don't.
- **Notice above the map** (wording `[COUNSEL]`): "Teams shown here have chosen to
  list where they operate. This doesn't mean a team monitors this area, will be
  alerted, or will respond. In an emergency, call 911."
- **Empty state:** "No SAR teams list an area here yet." That's true early on.

**Phase 2 (later):** a public, signed-out version on a public route (the §3.7 rules
apply). It needs a cached, DB-light read path, and counsel's sign-off on public
display.

## 3. Data and consent

- **Consent record.** Each team's admin gets a "Show our service area to AvAI users"
  toggle on the team page, with the consent text `[COUNSEL]`. Turning it on or off is
  logged with who and when, in a new `sar_org_listing_log` or on
  `org_membership_log`; that choice is part of D2. Turning it off removes the area from
  the layer at once.
- **What's shown.** Only teams that are `approved`, consenting, and **not**
  suspended, leaving or withdrawn. The area is the approved `region_geom`, simplified
  (for example `ST_SimplifyPreserveTopology` to about 100 m) so the outline doesn't
  imply precision or point at a base location. No member, contact, phone or
  proof-document data is shown.
- **Approval stays manual (§0).** Consent can only hide or show an approved area; it
  never changes the area itself. Changing the area still goes through review.
- **Read path.** A server component on `/map` reads the consenting teams'
  simplified areas in one query and caches them for a few minutes. Area changes are
  rare and consent changes take effect within the cache time. No AvServ call is made
  at request time.

## 4. Owner decisions (2026-10-10)

- **D1: signed-in first.** Phase 1 is the signed-in `/map` only. A public,
  signed-out page waits for counsel's sign-off on public display.
- **D2: one shared consent.** A team decides once, in the portal: "list our team and
  show our service area". The portal syncs that consent to AvServ in the team
  sync, and AvServ's directory `public_listing_consent` follows it, so the map
  and the directory never disagree. This adds one field to the team sync contract
  (an AvServ change, §6 step 6).
- **D3: outline plus a light fill,** with the area simplified to about 100 m
  (`ST_SimplifyPreserveTopology`). That's readable at a regional zoom without
  implying street-level precision. A thin outline with a roughly 10% fill keeps
  overlapping teams legible.
- **D4: advertisers see the layer,** like every other signed-in user. Their own ad
  target layer is unchanged.

## 5. Counsel questions (add to the counsel packet)

- The notice wording in §2, and the team consent text in §3.
- Whether showing a team's area to users creates any duty or reliance, even with
  the notice.
- `/privacy`: whether a client-only "Use my location" needs disclosure, even though
  nothing is sent or stored.

## 6. Build outline (after D1–D4 and counsel)

1. **Migration:** a consent column (or table) on `sar_orgs`, plus a log of consent
   changes. Applied to production before merge, as usual.
2. **Team page:** the consent toggle for org admins, as a server action with tests
   (admin-only, logged, re-checks approval).
3. **`lib/map`:** a `listedTeamAreas()` query (approved, consenting, simplified) with
   a cache; unit tests for every filter; an integration test against PostGIS for
   the simplification.
4. **`/map`:** the new layer, the notice, the empty state, and `hasMap` for everyone.
   "Use my location" is a client component using `navigator.geolocation`, with no
   server call.
5. **Tests:** the copy scan covers the new strings; e2e checks that a plain user sees
   the layer and no alert layers; unit tests check the role gates.
6. **AvServ (D2):** carry the consent in the team sync, so AvServ's directory
   `public_listing_consent` follows it. Coordinate that contract change with
   the AvServ session before the portal side ships.

## 7. Open questions

- Should a team's public website link be required before it can be listed?
- What does a user see for an area where two teams overlap? (Both, with no ranking.)
