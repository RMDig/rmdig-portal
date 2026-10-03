# 33 — The portal map and the SAR workspace

> **Status:** Phase 1 built (this PR). Phases 2–4 are planned. They wait on cross-repo
> contracts, doc amendments and counsel. The owner decided these on 2026-10-03, after two
> parallel reviews: one of the map, with five lenses, and a SAR-enablement deep dive across
> AvServ, AvApp, the portal and legal/operations.

## 1. Owner decisions (2026-10-03)

1. **One map.** A single signed-in `/map` page, with layers chosen by role.
2. **Emergency contacts use AvApp plan 46.** They see a person's alert only while it is
   open (Twilio Verify code, no account), then 24 h of status with no location. There is
   no standing "followers" history view.
3. **SAR teams join the system for public release.** If an approved team's service area
   covers where a user is checking out, the app offers that team as an extra emergency
   contact for the check-out.
   - Each team writes its own terms for being an emergency contact.
   - The user must read and accept those terms (explicit opt-in) before the team is added.
   - This combines rmdig-ai doc 03 (match by geography) with AvApp doc 20 (the user
     chooses).
4. **SAR teams see both kinds of alert on the map, with a legend.**
   - **Red:** alerts dispatched to that team.
   - **Orange:** other emergencies in its area.
   - Orange covers users who didn't add that team, so it shows only what their consent
     covers. Without consent it is approximate and carries no identity (see §4).
5. **Counsel decides** the new SAR and map questions. The counsel packet
   (`~/Desktop/AvAI-counsel-review`) gets a new addendum.

Rules that come from the reviews:

- **Vocabulary.** The map never claims monitoring, coverage, live tracking or routing
  that doesn't exist. No forbidden claims (CLAUDE.md §0). "Incident" belongs to Incident
  Detection; overdue check-outs are "alerts".
- **No routing claim.** Nothing routes alerts to SAR orgs today. The portal no longer
  says it does: the under-review banner, the members page and the dashboard card were
  corrected in this PR.
- **Approval stays manual.** An approved org's service area or terms change only through
  operator review.

## 2. Phase 1 (built)

- **`/map`** (`app/(portal)/map`) shows each viewer only their own data:
  - SAR members see their organizations' service areas, with status (approved, under
    review, suspended);
  - advertisers see their ad targets. Radius targets are drawn. National and
    state/county/place targets are listed only, because we don't hold their boundaries;
  - staff also see every organization except rejected ones.
- **Scoped on the server.** The scoping happens in `lib/map/queries.ts` (one query per
  layer; polygons simplified to about 50 m and 5 decimal places). The builders in
  `lib/map/layers.ts` are pure, and the client only draws what it receives.
- **View-only.** Editing an approved org's area would change routing without review
  (§0), so areas stay on the forms where they were set.
- **Accessible.** There's a layer checkbox panel, a legend in plain words, and every
  shape is also a list item: selecting one zooms to it. A failed layer says so; it never
  renders as an empty map.
- **One basemap.** `components/map/basemap.ts` is shared by every map. OSM attribution
  is always shown; the preview map had dropped it. Geometry helpers live in
  `lib/map/geometry.ts`.
- **Tiles.** Free OpenStreetMap raster tiles have no service guarantee. That's fine for
  editors and overviews. **Any safety layer (Phases 3–4) needs a tile provider with a
  guarantee.** That's an owner cost decision.

## 3. Phase 2: your own history

- A signed-in user sees their own check-outs and alerts, read through a new AvServ S2S
  endpoint (`GET /v1/internal/accounts/{id}/history`).
- The page shows at most the retention window (currently about 90 days), and redacted
  locations stay redacted.
- `/privacy` gains "the alert's location" in its description of history (counsel).
- **Needs:** the AvServ endpoint and contract, plus AvServ's first retention and deletion
  job.

## 4. Phase 3–4: SAR teams in the system (release scope)

### AvServ

1. **Org sync from the portal.**
   - `PUT /v1/internal/sar-teams/{orgId}` carries status, type (`sar` or `patrol`),
     name, service-area polygon, dispatch channels, and the published terms version and
     hash.
   - AvServ rejects anything the portal didn't approve.
   - The portal is the only place approval happens.
2. **`sar_teams` becomes a replicated projection fed by the portal,** with polygons.
   Today it is node-local, operator-inserted, and its areas are county names.
3. **Terms.** Immutable terms versions, plus append-only per-user acceptances
   (`account × team × version × hash`) that replicate across nodes.
4. **Offering teams at check-out.** A "teams covering here" query, kept separate from
   the public directory (plan 34 §0).
5. **Check-outs with more than one target.** A check-out can carry several SAR targets,
   which are additive: the personal contact stays required. A missing or stale
   acceptance is rejected, never dropped silently.
6. **SAR dispatch.**
   - Sent in parallel with the contacts, never delaying them.
   - Channel order: webhook (HMAC), then SMS, then email.
   - A ledger key per target; an `Idempotency-Key` per delivery; the duplicate
     disclaimer goes to teams too.
   - Org-level consent and opt-out records, never the per-user `partner_notices` or
     `sms_opt_outs`.
7. **`data_share_log`.** Every dispatch and map read is recorded. CPA deletion requests
   propagate through it.
8. **Map feeds.**
   - **Red:** alerts dispatched to the team, at full detail.
   - **Orange:** alerts in the area whose user didn't add the team. De-identified by
     default (a coarse cell, the type and an age bucket); more detail only under a new
     consent.
   - Both read from both nodes and are merged. An outage returns 503, never an empty
     list.
9. **Contact removal** (`DELETE /v1/contacts/{id}`), and an acknowledgement endpoint
   (informational; never suppresses escalation).

### AvApp

1. **A signed, cached roster of active teams** with polygons and terms hashes, separate
   from the directory service.
2. **A coverage check before submit,** using the planned route (plan 46 A2), else the
   last fix, else an area the user picks. It works offline.
3. **The team offer on Check-Out.**
   - Never pre-selected; nothing shown when no team covers the area.
   - Several teams, crossed boundaries and stale rosters are all handled.
4. **The terms screen,** reusing agreement capture (version, hash, scroll to the end),
   with the terms cached for offline accepts.
5. **Binding the team to the check-out** happens after arming. A refused bind never
   turns into "not checked out".
6. **Team status during a check-out.**
   - Banners for a team that is suspended or whose terms changed.
   - After an alert, show delivery to each target and the team's acknowledgement.
7. **Settings → SAR teams:** accepted terms, and a way to stop using a team.
8. **Privacy and store changes together.** Doc 43's "Shared?" answers, `/privacy`, and
   the Sentry scrub all change in the same release.

### Portal

1. **Organization type** (`sar_team` or `ski_patrol`, AvApp doc 36 §9.3), with
   type-specific proof and a call back to the patrol's published number.
2. **Resubmit** after the operator requests changes (`/sar/[orgId]/edit`).
3. **Changing an approved org's area.** A proposal table plus operator review, comparing
   old and new areas side by side. An edit never touches the live area.
4. **Team terms authoring.**
   - An editor for org admins, with the forbidden-claims check.
   - The operator approves every version.
   - Published versions are immutable.
5. **Org → AvServ sync.**
   - Sent on approve, suspend, reactivate, area approval and terms publish.
   - Loud on failure, with `avserv_synced_at` and an operator resync button.
6. **SAR workspace on `/map`.**
   - Red and orange layers with a legend, for dispatchers and admins only.
   - A `sar_map_view_log` row is written before any data is returned.
   - When data can't load, the page says so explicitly, with no blank map, and
     tells the reader to use the coordinates in the text and call 911.
7. **Roles and membership:** remove members, change roles, revoke invites, keep at
   least one admin, an audit log, and MFA for org admins.
8. **Proof documents become private** (signed URLs, staff only).
9. **Email notifications:**
   - terms submitted or decided;
   - area change decided;
   - suspension or reactivation;
   - sync failure.
10. **Runbook sections:**
    - the verification checklist (call-back, roster check, test drill);
    - re-verification;
    - terms review and area-change review;
    - resync;
    - map audit pulls.

### Legal, carrier, store (counsel)

1. **Whether a SAR team is a third party under the CPA.** This drives the data
   agreements, retention (doc 20 suggests 12 months), and deletion pass-through.
2. **Consent.**
   - One opt-in for "the teams in this area", or one per team?
   - When must the user re-accept (new team, new terms version)?
3. **Orange map.**
   - Does it need its own opt-in?
   - Does coarsening to about 1–3 km take it out of "precise geolocation"?
4. **Team-written terms.**
   - Who is party to them, and which document controls when they conflict with ours?
   - What floor of clauses can a team not waive?
   - Does hosting them create liability for us?
5. **Liability.**
   - Volunteer teams have no duty to respond, and AvAI doesn't call 911.
   - Draft text already says "AvAI does not call … search and rescue … for you". That
     sentence must change.
6. **A2P.** Is an accepted team "personally designated"? Or do teams need webhook or
   email only, or an amended or new campaign? What does STOP from a team mean?
7. **Store declarations.** Apple and Play "Shared?" answers likely change to "yes,
   third-party partners".
8. **Patrols.** Ski patrols are commercial entities. Do they need different terms or
   consent?
9. **Contracts and insurance.** The SAR partnership contract, insurance, and authority
   to accept on behalf of an org.

### Doc conflicts to settle first

| Conflict | Where |
|---|---|
| SAR is a paid tier vs. offered at release | AvApp doc 20 §3 |
| Routing to every matching org vs. user opt-in | rmdig-ai doc 03 |
| "Until the alert fires, the team has no access" vs. the orange layer | doc 20 :314 |
| SAR dashboard link in SMS vs. the no-links rule | doc 20 §2.2, doc 46 S8 |
| `incident_dashboard_url` hosted on AvServ vs. the portal as the human surface | doc 20 :250 |
| "Contracted to be on-call", auto-escalation to 911 | rmdig-ai 04, doc 20 :275 |
| "AvServ won't double-alert" vs. at-least-once delivery | rmdig-ai 03 :52 |
| First SAR partner after v2.0 vs. at release | AvApp doc 41 :222 |
| Patrol in scope at release, same table as SAR | doc 36 §9.3 |

## 5. Order

1. **Docs:** settle the conflicts above and amend AvApp doc 20, rmdig-ai 03 and AvServ
   plan 34. Send the counsel addendum.
2. **Portal hygiene now:**
   - verify Blob and the AvServ link in production;
   - make proof documents private;
   - add org type, resubmit and member management.
3. **Contracts and sync:** AvServ endpoints for the sync, terms and acceptances; the
   portal terms editor and sync.
4. **Dispatch:** AvServ dispatch to teams with `data_share_log`; the AvApp roster,
   offer, terms screen and bind; drills.
5. **Map:** the red layer, then the orange layer once consent is decided. Plan 46's
   contact view runs in parallel.
6. **Before launch:**
   - store and privacy updates, all at once;
   - a staging drill that kills both nodes;
   - a soft launch with 3–5 teams.
