# 33 — The portal map and the SAR workspace

> **Status:** Phase 1 is built. Phase 2 (your own history) is not started. Most of the
> portal half of Phases 3–4 is built (§4 "Built"); ORANGE and the suspension email are
> not. The original decisions date from 2026-10-03, after two parallel reviews: one of
> the map, with five lenses, and a SAR-enablement deep dive across AvServ, AvApp, the
> portal and legal/operations.
>
> **Revision 2 (2026-11-04):** the owner's SAR check-out-partner decisions D1–D9 and the
> portal's +9 PR sequence (§6).

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
- **Approval stays manual.** Staff approve each organization's status and each terms
  version (O2); a team edits its own area (D3, §6.1).

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
- **View-only.** Areas are edited in the team's area editor (§6.3), not on `/map`.
- **Accessible.** There's a layer checkbox panel, a legend in plain words, and every
  shape is also a list item: selecting one zooms to it. A failed layer says so; it never
  renders as an empty map.
- **One basemap.** `components/map/basemap.ts` is shared by every map. OSM attribution
  is always shown; the preview map had dropped it. Geometry helpers live in
  `lib/map/geometry.ts`.
- **Tiles.** Free OpenStreetMap raster tiles have no service guarantee. That's fine for
  editors and overviews. **Any safety layer (Phases 3–4) needs a tile provider with a
  guarantee.** That's an owner cost decision. Since #130 the basemap is MapTiler
  Outdoor when keyed, with OpenStreetMap as the unkeyed fallback.

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
5. **At most one SAR team per check-out** (D1), additive: the personal contact stays
   required. A missing or stale acceptance is rejected, never dropped silently.
6. **SAR dispatch.**
   - Sent in parallel with the contacts, never delaying them.
   - Every usable channel in parallel: `portal` and `email` at +9 (D9); `sms` and
     `webhook` later.
   - A ledger key per target; an `Idempotency-Key` per delivery; the duplicate
     disclaimer goes to teams too.
   - Org-level consent and opt-out records, never the per-user `partner_notices` or
     `sms_opt_outs`.
7. **`data_share_log`.** Every dispatch and map read is recorded. CPA deletion requests
   propagate through it.
8. **Map feeds.**
   - **Red:** alerts dispatched to the team, at full detail.
   - **Orange:** open alerts in the area whose user didn't add the team, as
     de-identified per-cell counts with a k floor (D8, §6.6).
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
3. **Area edits** by the team's admins at any time, synced on save (D3, §6.3).
4. **Team terms authoring.**
   - An editor for org admins, with the forbidden-claims check.
   - The operator approves every version (O2).
   - Published versions are immutable.
5. **Org → AvServ sync.**
   - Sent on approve, suspend, reactivate, area edit and terms publish.
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
   - suspension or reactivation;
   - sync failure.
10. **Runbook sections:**
    - the verification checklist (call-back, roster check, test drill);
    - re-verification;
    - terms review;
    - resync;
    - map audit pulls.

### Built (portal origin/main, checked 2026-11-04)

| Portal item | State |
|---|---|
| 1 Org type, incl. ski patrol | ✅ `orgType` `sar_team`/`ski_patrol`, patrol re-verify cron |
| 2 Resubmit | ✅ `/sar/[orgId]/edit`, pending only |
| 3 Area edits | Checks ✅ 9.3 (`lib/sar/area-checks.ts`); approved-team edit ✅ 9.4 (`/sar/[orgId]/area`, `sar_org_area_log`, sync on save, staff email), both 2026-11-06; overlap and large-area warnings ✅ 9.5; keyboard entry and the one editor ✅ 9.6 (`AreaEditor`, `VertexTable`) on `/sar/new`, resubmit and the area page (§6.3) |
| 4 Team terms | ✅ editor, forbidden-claims check, operator approval (`/admin/sar-terms`). `area_map` not offered since 9.1 (2026-11-06); staff publish refuses a draft that still names it |
| 5 Sync | ✅ `lib/sar/sync.ts`: approve, suspend, leaving, withdraw, re-verify, terms publish, staff resync. Sends only the `portal` channel; `serviceAreaLabels` (from `regionName`) and `publicListing` (`consent: false`) since 9.2 (2026-11-06) |
| 6 Workspace | RED ✅ (`lib/map/red.ts`, both nodes merged, `sar_map_view_log`); ORANGE ⬜ (9.14) |
| 7 Roles and membership | ✅ remove, change role, revoke invite, last-admin rule, `org_membership_log` |
| 8 Private proof | ✅ staff-only route; production Blob not yet verified (status §1) |
| 9 Emails | Terms submitted and decided ✅, team alert email ✅ (daily retry cron); suspension/reactivation and no-admin ✅ 9.13 (2026-11-06) |
| 10 Runbook | ✅ review, sync, terms, intake, alerts layer, members, removal, suspend |

### Legal, carrier, store (counsel)

1. **Whether a SAR team is a third party under the CPA.** This drives the data
   agreements, retention (doc 20 suggests 12 months), and deletion pass-through.
2. **Consent.**
   - One opt-in for "the teams in this area", or one per team?
   - When must the user re-accept (new team, new terms version)?
3. **Orange map.**
   - Does it need its own opt-in?
   - Does AvServ's 0.02° cell (about 2 km) take it out of "precise geolocation"?
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

## 6. +9: SAR check-out partners

Wire names are AvServ's PROPOSED 2026-11-04, unbuilt contracts: `sar_team_sync.md` §5
(sync revision 2), `sar_terms.md` §6 (approvals), `sar_feeds.md` §2a (ORANGE v1); the
server side is AvServ plan 41 §17. Nothing ships to real teams until counsel lands the
[COUNSEL] items.

### 6.1 Decisions (owner, 2026-11-04)

Final; they override plan 34, AvApp plan 47 and AvServ plan 41 where those conflict.

| ID | Decision | Portal |
|---|---|---|
| D1 | Up to 3 check-out partners, **at most one a SAR team**; a personal contact still required | — |
| D2 | "One at a time" mode alerts the team at once, in parallel with the first contact | — |
| D3 | Admins edit the team's area freely, pending or approved; staff approve the org's status only; area review dropped; bound check-outs keep the team | 9.3–9.6 |
| D4 | `acceptanceMode` `open` or `confirm_first`; approval per user, once per terms version, never per check-out (mirrors AvServ plan 63) | 9.7, 9.8 |
| D5 | Optional `maxActiveCheckouts`, enforced at bind; covering marks a full team; a cross-node race may go one over (accepted) | 9.7 |
| D6 | The team's ack is signed like the contacts' safety acks | — |
| D7 | The contact's alert says the team "was also sent" it, with its verified public phone; never implies a response; needs the A2P 38a re-filing | 9.9 |
| D8 | ORANGE built in +9 behind a flag, release gated on counsel and the k floor; `area_map` hidden until then | 9.1, 9.14 |
| D9 | AvServ emails the team's verified on-call address directly; the portal's notify retry goes from daily to minutes | 9.10–9.12 |

- **D3.** The abuse guard is AvServ's bind-time area check (B2), the §6.3 warnings, an
  append-only area log staff can read, and suspension. §0 reworded for this (O1, decided).
- **D4.** Pending list: `GET …/approval-requests` from both nodes, merged by
  `acceptanceId`; decisions `POST …/approvals/{acceptanceId}` (`approved` | `declined`)
  to **both** nodes; route group `sar_approve`. The team sees `userDisplayName` and
  `acceptedAt` only [COUNSEL]. A mode switch applies to new binds only (AvServ plan 41
  §17.6 [ESCALATE]).
- **D5.** 1–10,000 or `null`. The team page shows each node's `activeCheckouts` and
  `overCapacity` (`GET` §5.4).
- **D7.** `publicPhone {e164, verifiedAt, publishConsentAt}`, separate from
  `contact_phone` (the operator's callback), verified with the existing Twilio Verify
  flow, publication consent [COUNSEL]. `contactLineName` (1–32 GSM-7) names the team.
- **D8.** `area_map` was `offered: true` until 9.1 (`lib/sar/terms-rules.ts`). At
  revision 2 AvServ refuses the **whole** PUT naming it (`422 capability_not_available`)
  while `AVSERV_SAR_AREA_FEED` isn't `on`: strip, never retry. Terms versions are
  immutable, so a published version carrying it needs a remove-only successor
  (`requiresReacceptance: false`) before revision 2 reaches production. None exists
  (checked 2026-11-06); staff publish now refuses any version naming it.
- **D9.** The `email` channel carries the on-call `address`. AvServ `origin/main`
  accepts it (`internal/api/sarteams.go:385`) but doesn't dispatch it (B1); revision 2
  does (§5.5), with bounces in `channelStatus` (`bouncedAt`).

### 6.2 Version gate

The portal sends **any** §5 field (`acceptanceMode`, `maxActiveCheckouts`,
`publicPhone`, `contactLineName`) only once **every** node's `GET` reports
`syncRevision ≥ 2` (absent means 1): a revision 1 node ignores unknown fields and would
store a confirm-first team as open. Until then the team page doesn't offer those
settings and says why. A revision 2 node answers `503 sar_capture_unavailable`
(`Retry-After: 300`) while a peer runs `SARApplierVersion < 6`: a per-node failure,
shown and retried. New refusals the team page surfaces: `capacity_invalid`,
`public_phone_invalid`, `contact_line_name_invalid`.

### 6.3 Area editor

One editor for `/sar/new`, resubmit and the post-approval edit
(`app/(portal)/sar/[orgId]/area`). Server checks at save run on the geometry the sync
sends (`ST_SimplifyPreserveTopology` 0.0005°, 6 decimals, `lib/sar/sync.ts:34`).

1. **Overlap warns, never blocks.** It names the other live orgs (approved, pending,
   suspended, leaving) and offers a previewed clip, `ST_Difference(new,
   ST_Union(others))`. A clip that leaves nothing or a MultiPolygon is refused with the
   reason: the portal stores and sends one `Polygon` (`lib/sar/geo.ts:7`,
   `lib/sar/sync-body.ts:97`). Covering returns every overlapping team; the user picks
   at most one (D1). Public display: portal plan 34 §3.
2. **Large area: soft warning** above the land area of the largest Colorado county,
   about 12,400 km² (`ST_Area` on geography; O8, decided).
3. **AvServ's caps, checked first.** `serviceArea` ≤ **1 MiB compacted** (`413
   area_too_large`; sync body ≤ 2 MiB; `internal/api/sarteams.go:34–36, 333`); ≤ 50
   polygons, 10,000 vertices per ring and 100,000 per org (`area_invalid`,
   `internal/sargeo/sargeo.go:29–33`). `lib/sar/geo.ts:13–14` allows 50 × 10,000, so
   without this check a portal save succeeds and every node refuses the sync. The
   refusal says how much to simplify.
4. **Keyboard vertex entry:** a coordinates table that round-trips with the drawing
   (WCAG 2.1.1; the drawing map has no keyboard path today).
5. **Sync on save:** area plus an area-log row (who, when, old and new), then
   `syncSarOrg`. A failed node shows on the team page and is retried (9.11); staff can
   resync and get an informational email of each change.

### 6.4 Gaps folded into +9

- **Reachability** on the team page and staff queue: a member with a deliverable
  email, `usable` on every node (`unusableReason`, incl. `no_usable_channel`), and a
  verified on-call email. An unreachable approved team is flagged to staff.
- **No ack** after N minutes [ESCALATE]: re-email members and the on-call address, then
  RMDig staff. Informational; never suppresses the contacts' escalation.
- **No admin left.** `lib/sar/membership.ts` stops removal and demotion, not account
  deletion or staff removal; cover that path with a staff email and a team-page
  banner. What follows is [ESCALATE].
- **Suspension email.** None today (`emailDecision: null`,
  `app/(portal)/admin/sar-approvals/actions.ts:73, 75`); admins get one each way.
- **`serviceAreaLabels`** from `regionName` (≤ 20 labels of 1–100 characters,
  `internal/api/sarteams.go:293–299`) and **`publicListing`** `{consent, consentAt,
  websiteUrl, givingUrl, blurb ≤ 280, logoRef ≤ 200}` with `consent: false` until
  portal plan 34's toggle. AvServ accepts both; the portal sends neither.

### 6.5 PR sequence

Each PR carries its tests and passes the pre-PR gate; migrations reach production
before merge (§3.8); new strings join `legal-copy.test.ts`.

| ID | Scope | Gate |
|---|---|---|
| 9.0 | This revision (plans 33, 34, 00) | Owner review |
| 9.1 | `area_map` `offered: false`; terms actions refuse it; remove-only successor for any published version carrying it. **Built 2026-11-06.** No successor needed: production's only terms version (the rejected drill team, v1) has `checkout_alerts` alone (`pnpm prod:read`, 2026-11-06) | None |
| 9.2 | Send `serviceAreaLabels` and `publicListing` (`consent: false`). **Built 2026-11-06**; `regionName` capped at AvServ's 100-character label limit (production's longest: 8) | None |
| 9.3 | `lib/sar/area-checks.ts`: caps, `ST_Area`, overlap, clip; PostGIS tests at 1 MiB. **Built 2026-11-06** (`assessArea`, `checkAvservCaps`); not yet called: 9.4 wires it into the save | None |
| 9.4 | Post-approval area edit: action, area log (migration), sync on save, staff email. **Built 2026-11-06:** `saveAreaAction`, migration 0035 `sar_org_area_log`, "Service area" tab for approved teams; a pending team still changes its area by resubmitting | 9.3 |
| 9.5 | Overlap (clip preview) and large-area warnings. **Built 2026-11-06** on `/sar/[orgId]/area` (`checkAreaAction`, `AreaWarnings`): size, overlapping teams by name, "use the area without the overlap", and the O8 threshold `LARGE_AREA_KM2` = 12,361.85 km² (Census 2024 Gazetteer, Las Animas, GEOID 08071). `/sar/new` and resubmit still show none: they move to the one editor with 9.6 | 9.4 |
| 9.6 | Keyboard vertex entry (`components/map/VertexTable.tsx`); keyboard-only Playwright, axe. **Built 2026-11-07:** one `AreaEditor` (map plus corner-points table, each filling the other) on `/sar/new`, resubmit and `/sar/[orgId]/area`; the check (`area-check-action.ts`) runs on all three, naming other teams and offering the clip only to an approved team's admins; create and resubmit now refuse an area AvServ would refuse; the `NEXT_PUBLIC_E2E` GeoJSON box is gone, and the e2e types the area into the table (`sar-area-keyboard.mock.spec.ts`, axe on the editor) | 9.4 |
| 9.7 | `acceptanceMode`, `maxActiveCheckouts` | §6.2 gate |
| 9.8 | Confirm-first pending list: merge, decide to both nodes, audit log, admin email; outage shown, never empty | 9.7; `sar_terms.md` §6 built; field list [COUNSEL] |
| 9.9 | `publicPhone`, `contactLineName`: verify, consent, sync | §6.2 gate; [COUNSEL]; A2P 38a re-filing |
| 9.10 | On-call `email` channel: add, verify by link, re-verify on change | AvServ dispatches `email` on both nodes |
| 9.11 | Minute-level notify retry and per-node sync retry; Sentry monitors kept in step (`tests/unit/cron-jobs.test.ts`) | Vercel Pro (O7) |
| 9.12 | Reachability; no-ack escalation (once per alert) | 9.10, 9.11; N [ESCALATE] |
| 9.13 | Suspension, reactivation, no-admin emails (failure logged, not rolled back). **Built 2026-11-06:** team admins emailed on suspend/reactivate (no staff note); no-admin banner on the team pages and a daily approver email (`/api/cron/sar-no-admin`); what staff then do stays [ESCALATE] | None |
| 9.14 | ORANGE behind `FEATURE_SAR_ORANGE` (§6.6); `area_map` back with the flag; disclosure | AvServ feed `on`; counsel; k floor [ESCALATE] |

9.1–9.6 and 9.13 are built. The rest wait on their gates.

### 6.6 ORANGE layer (D8)

Drill teams (plan 37) never get the layer or appear in it: it's for real teams'
admins and dispatchers, and AvServ leaves drill accounts out of the feed (plan 66
§3.5). 9.14 filters on `sar_orgs.is_drill` and tests it.

`GET …/area-alerts` (`sar_feeds.md` §2a) from both nodes. Cells carry `cellId`,
`cell {lat, lon, sizeDeg: 0.02}`, `count`, `kinds`, `ages` (`lt_1h` … `gt_24h`); the
page carries `suppressed`, `kFloor`, `asOf`. Merge per `cellId` taking the **larger**
`count` and buckets (never sum), and the larger `suppressed`. Show `kFloor` and
`suppressed` so a sparse map never reads as "all clear". `503 area_feed_disabled` and
`503 feed_unavailable` are explicit states. `sar_map_view_log` is written first.

### 6.7 +10: what AvApp plan 63 needs

AvApp plan 63 makes the app a team surface; AvServ plan 65 lists the server hooks. The
portal stays the source of truth for membership: members need a linked account
(AvServ plan 23); a membership sync (`accountId`, role, since; AvServ plan 65 §1; wire
shape [AVSERV]) lets each node check roles itself; a removal or role change syncs at
once and is retried (9.11). Its own plan, written with AvApp plan 63.

### 6.8 Open decisions

All four decided by the owner on 2026-11-05.

- **O1. Decided: §0 reworded.** CLAUDE.md §0 said "never add a path around the
  approval queue", which conflicted with D3. It now reads: staff approve every
  organization by hand, never automated or bypassed; an approved team edits its own
  service area, and every edit is logged, synced and emailed to staff. 9.4 is unblocked.
  9.4 also updates the comment in `sar/[orgId]/edit/actions.ts` that cites the old rule.
- **O2. Decided: yes.** Staff approve each terms version, because users agree to that
  text and the lint can't catch everything.
- **O7. Decided: Vercel Pro.** Hobby runs a cron at most daily (`lib/cron/jobs.ts:5`), and
  9.11 needs minutes. Pro costs about $20 per member per month (confirm on Vercel's pricing
  page), and plan 36 S-D8 also needs it. An external scheduler was rejected: its runs can
  be late or skipped, and it adds a dependency. AvServ's email (D9) is the independent
  path; this retry is the backstop. 9.11 ships only after the project is on Pro.
- **O8. Decided: the largest Colorado county.** The large-area warning shows above Las
  Animas County's land area, about 12,400 km². 9.5 computes the exact figure from the
  Census TIGER/Gazetteer data. Other anchors, for reference: Broomfield 85 km² (smallest
  county), San Juan 1,000, Summit 1,600, Gunnison 8,400, Colorado 270,000.
