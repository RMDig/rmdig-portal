# 38 — A team's area on accepted users' phones

Status: **built, behind the revision 4 gate (2026-11-13).** This is the portal half of
AvApp plan 68 (leaving a team's area), which is part of the SAR launch: AvApp's SAR
teams don't ship without phase 1. AvServ confirmed the wire shape (2026-11-13) and
reports `syncRevision: 4` once its applier and area route are built. Nothing is sent
before every node reports it.

## 0. Owner decisions (2026-11-13)

- **A team's area goes to a phone only after that phone's user accepted the team's
  terms,** whether the team is listed or not. AvServ serves the area at
  `GET /v1/sar-teams/{teamId}/area/{sha256}` to accounts with a current acceptance.
  The portal sends a simplified copy for that purpose.
- **Nearby searches use plan 34 D2's one consent (Q2d).** `publicListing.consent`
  stays as written (the directory and the `/map` area layer) and also lists the team
  in AvApp's nearby search, by name and terms only. There's no separate setting,
  field or column. See plan 34 D2.
- **Drill teams follow the same rules.** The home team's area goes only to drill2's
  phone, after drill2 accepts, and never into logs or docs.

## 1. The device copy (`deviceServiceArea`)

Built by `lib/sar/device-area.ts` from the area **as the sync sends it**
(`serviceArea`), because that's the shape AvServ treats as the team's area.

- **Method:**
  1. Transform to the UTM zone of the area's centroid, so the work happens in
     metres.
  2. `ST_Buffer` by 51 m (mitre joins).
  3. `ST_SimplifyPreserveTopology` at 50 m.
  4. `ST_MakeValid`, keeping polygons only.
  5. Transform back to WGS 84 and round to 6 decimals.
- **It always covers the area.** Simplifying moves an edge by at most the tolerance.
  The extra metre of buffer covers rounding and reprojection. Every copy is still
  checked with `ST_Covers` on the rounded shape.
- **What the phone can conclude.** The true edge lies 0 to about 101 m inside the
  copy's edge. Outside the copy means certainly outside the area. A hole narrower
  than about 100 m disappears, so near one the phone reads "inside". AvServ accepts
  this: it can only cost an advisory warning, and the team alert's outside-the-area
  field is worked out by AvServ from the full area, holes included.
- **Point cap: 5,000** (`ST_NPoints`). It's checked when the area is saved
  (`assessArea`), after AvServ's own caps, and a refusal says how much to simplify.
  In practice this cap binds well before AvServ's 1 MiB.
- **Wire:**
  ```json
  "deviceServiceArea": {
    "geometry": { "type": "Polygon", "coordinates": [ … ] },
    "toleranceMeters": 50,
    "bufferMeters": 51
  }
  ```
  The geometry is a `Polygon` today, and a `MultiPolygon` is valid. The canonical
  bytes follow the same rules as `serviceArea`.
- **A copy that fails at sync time** (a team saved before the check, or a portal
  bug) is reported to Sentry. The team still syncs without it, so a suspension or any
  other change is never held back by it.
- **AvServ checks too.** Each node checks the type, ring validity and the cap. A node
  that refuses a copy stores the team without it, pages AvServ's on-call, and the
  area route answers an explicit error.

## 2. The revision 4 gate

Revision 3 is `drill` (sar_team_sync.md §6), so the copy is **revision 4**. The
portal now reads the fleet's revision on every sync (`readFleetRevision`: the lowest
revision any node reports, or 0 when a node can't be read):

| Field | Needs | Below it |
|---|---|---|
| `maxActiveCheckouts`, `acceptanceMode` | 2 | team held (as before) |
| `drill` | 3 | team held (as before) |
| `deviceServiceArea` | 4 | **field left out; the team still syncs** |

A node that can't be read for one sync leaves the copy out of that sync, and AvServ
then holds no copy until the next one. That errs safe: the phone knows no shape.

## 3. Held for counsel

- The line telling the team that its area is shown on accepted users' phones (AvApp
  plan 68 b). Not written; it goes with the onboarding and terms wording once counsel
  answers.

## 4. Later: alert position (AvApp plan 68 c)

The team alert may gain `position: {outsideArea, distanceMeters}` (null when unknown)
on overdue and Send Help. That's pending counsel (team alert fields, question 36).
AvServ sends the contract after counsel. The alert view then shows the position and
says plainly when it's unknown. Nothing is built yet.

## 5. Tests

- **Unit:**
  - the sync body (the copy at revisions 0–4, an absent copy, drill teams);
  - the sync (fleet read, copy built from the sent area, a failed or throwing build
    still syncs and reports, no coordinates in the logs);
  - the fleet read;
  - the refusal text and the geometry schema.
- **Integration (PostGIS):**
  - the copy covers simple, jagged, holed and southern-hemisphere areas, and fills a
    narrow hole;
  - the copy is the same bytes every time, at 6 decimals;
  - the cap refusal;
  - the area check refuses by the phone cap under 1 MiB and in AvServ's words over it.
