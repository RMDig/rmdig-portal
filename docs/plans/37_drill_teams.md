# 37 — Drill teams and drill logins (portal half of AvServ plan 66)

Status (2026-11-09): **owner decisions made (§1); P1 merged (#207); P2 merged (#208); P3 built.** AvServ plan 66
(`docs/plans/66_drill_fixtures.md`, AvServ PR #473) is the system plan, and its §4 is the
shape agreed between the two sessions, with these decisions recorded in AvServ PR #475.
This file is authoritative for the portal's half. AvServ step 1 (the sync `drill` field,
revision 3, the capabilities route) is in AvServ rc112, live on both nodes since
2026-11-09: `GET /v1/internal/sar-teams/capabilities` answers `{"syncRevision":3}` on
avserv-2 and avserv-3. Nothing here edits AvServ or AvApp.

## 0. Why

Production needs a permanent drill SAR team, with its own admin and dispatcher logins,
so the SAR path can be tested live at any time without touching a real user or team
(plan 66 §1). The portal can't make one today:

- The only drill team, `a308ddea-…` ("AvAI Drill Team"), is `rejected`. That is final:
  no transition leaves it. It stays as it is.
- A new one needs a second approver. The review action refuses the submitter and the
  team's members (`app/(portal)/admin/sar-approvals/actions.ts`, the conflict check),
  and the operator is the only `rmdig_sar_approver`. The rule is right for real teams.
  A drill team has no outside party for it to protect.
- Nothing marks a team or a login as a drill, so nothing can keep them apart from real
  ones. "Hidden" test rows would rely on habit. These are **marked**: the database knows
  a drill row, refuses to change it, and every log entry says what it is.

## 1. Owner decisions (2026-11-09, given to the portal session directly)

| ID | Decision |
|---|---|
| DR1 | **Solo activation.** A separate `activate_drill` decision, offered only on drill rows, to a user who holds both `rmdig_admin` and `rmdig_sar_approver`. Logged `drill_activated` with the note "drill org activated by the operator; not an independent review". CLAUDE.md §0 is amended to allow this path for drill teams only (§3). |
| DR2 | **Drill alerts email the drill logins** (plan 66's portal O-1). A drill team's alerts, which arrive on the drill intake, are emailed to its members with DRILL in the subject and body. A real team's drill deliveries keep today's handling: stored, shown as a drill, no email. |
| DR3 | **Drill logins use plus addresses at rmdig.ai**, for example `name+drill1@rmdig.ai`. The database enforces the shape (§4.2), so a drill login always reaches an inbox the operator reads, and password reset works. |

Plan 66 O1–O3 stay AvServ's or the owner's. O3 (where the area goes) is chosen at
registration, inside the §4.4 limits.

## 2. Rules

1. **Drill is permanent.** A team or login that is a drill stays one, and a real one
   never becomes a drill (plan 66 R4). Enforced by database triggers, not by the UI.
2. **Drill and real never mix.** A drill login joins only drill teams, and a drill team
   accepts only drill logins. A drill login never holds a platform role. Staff manage
   drill teams from `/admin` and are never members.
3. **A drill team is never synced as real.** The sync sends `drill: true` for every
   drill team, and holds a drill team back until every node reports
   `syncRevision ≥ 3` (§4.5). Sent to an older node, the team would be stored as real.
4. **A drill team is never placed over a real team.** Its area is small, and it can't
   be saved over the area of a real team that isn't rejected or withdrawn. A real team
   may later cover it, and is never told (§4.4).
5. **A drill team never reaches a real surface.** It is left out of the public map
   (plan 34), ORANGE (plan 33 9.14), staff counts and the new-application email (§4.7).
6. **The approval queue is untouched for real teams.** Approve never shows on a drill
   row, `activate_drill` never shows on a real row, and the conflict check is unchanged.
   Tests pin both directions.
7. **Fail loud.** A live delivery for a drill team, a drill sync refused by a node, or a
   drill email that fails is logged and sent to Sentry. None of them is retried quietly.

## 3. CLAUDE.md §0 amendment (P1)

Added after the approval paragraph:

> **Drill teams** (plan 37) are the one exception. A drill team is registered only from
> `/admin`, is marked drill in the database and to AvServ for good, never receives a
> real user's alerts, and is activated by the operator through the separate, logged
> "Activate drill team" decision. The exception never extends to a real team, and a
> real team can never become a drill team.

## 4. Design

### 4.1 Drill teams in the database (migration 0036, P2)

- `sar_orgs.is_drill boolean NOT NULL DEFAULT false`, set only at insert.
- A trigger refuses any UPDATE that changes `is_drill`, either way.
- `CHECK (NOT is_drill OR (name ILIKE '%drill%' AND org_type = 'sar_team'))`. AvServ
  refuses any other drill team (`422 drill_team_invalid`), so the portal refuses it first.
- `proof_doc_url` becomes nullable with `CHECK (is_drill OR proof_doc_url IS NOT NULL)`.
  A drill team has no proof document, because there is nothing outside RMDig to verify.
  A real team still can't exist without one.
- New status-log actions `drill_registered` and `drill_activated`. Postgres can't use a
  new enum value in the transaction that adds it, which is why 0025 compares status as
  text. The migration keeps to that rule.
- 0036 follows #202's 0035. If #202 merges later, this migration is renumbered (§3.8).

### 4.2 Drill logins (migration 0036, P2 and P4)

- `users.is_drill boolean NOT NULL DEFAULT false`, with the same immutability trigger.
- `CHECK (NOT is_drill OR lower(email) ~ '^[a-z0-9._-]+\+drill[a-z0-9._-]*@rmdig\.ai$')`
  (DR3). A real user can't become a drill user, so this never touches a real address.
- Triggers enforce rule 2:
  - an `org_memberships` insert fails unless the user's and the team's `is_drill` match;
  - a `user_platform_roles` insert fails for a drill user.
- **Creation (P4b):** an `rmdig_admin` creates a drill login on the drill team's admin
  page: the address and the team role. One transaction writes the user with
  `is_drill = true` and the membership, and the login is emailed a link to set its
  password (the reset-token flow). It isn't an invitation: accepting one adds an account
  that already exists, and an account's drill flag can only be set when it's created.
  An address that already has an account is refused, so a real account is never turned
  into a drill one. Sign-up refuses the drill address shape, so a real account can't
  take one first, and a real team can't invite one. Sign-in is by password or passkey
  with two-factor, as for anyone (`MFA_ENFORCEMENT=all`).

### 4.3 Registration (P4)

`/admin/sar-drill/new`, for `rmdig_admin` only. It never goes through `/sar/new`, so the
public form can't set the flag.

- Name (must contain "drill"), contact name, a drill contact email, area, and the
  contact phone. The phone is verified by the existing Twilio Verify flow and is the
  operator's drill phone. The unique-phone index applies as usual.
- No proof document and no operating-status upload. The status log records
  `drill_registered` with "registered by the operator; nothing outside RMDig verified".
- The new row is `pending`. Then: create the first drill login as team admin (§4.2),
  publish the drill terms, activate (§4.6).
- The area starts as the owner's chosen circle (§5, operator step 1), drawn in the
  editor so it can be moved.
- Drill teams are listed on `/admin/sar-drill`. They're left out of the approvals queue
  and its count, and the review action refuses approve, reject, request changes and
  re-verify on them (rule 6). That's in P4a, so a registered drill team can never be
  approved while P5 is still to come.
- **Terms:** the operator writes and publishes them through the existing terms flow.
  The wording lint applies, and the text says this is not a real team (plan 66 §4).

### 4.4 Area (P4)

The plan 33 9.3 checks (`lib/sar/area-checks.ts`), with two extra limits for drill
teams: an area of at most **4 km²** (about a 1 km-radius circle), and **no overlap** with
the area of any team that is neither drill nor rejected or withdrawn. The overlap is
refused, not just warned. The same limits apply when the drill area is edited.

**The reverse is allowed, with no warning.** A real team may later save an area that
covers the drill circle. This must never be refused, because a county team has to be
able to cover its whole county. The real team's admins see nothing about it: the 9.5
overlap warnings, the clip and the area checks leave drill teams out, so a drill team's
name or shape never reaches a real team's admins (rule 5). The overlap is harmless,
because AvServ never offers a drill team to a real account (plan 66 R2), and a drill
account binds only drill teams (R3). The operator can move the drill area at any time.

One consequence for plan 66 O3: once real teams cover a whole region, a new drill area
can't be placed there, because the check refuses it. So the operator chooses the place
while it's still free, and the drill area then stays where it is.

### 4.5 Sync (P3)

- **A shared per-node protocol gate.** `GET /v1/internal/sar-teams/capabilities` on
  every node (service JWT, group `sar_sync`; AvServ `sar_team_sync.md`, #474) answers
  `{"syncRevision": n}`. The gate passes for revision `r` only when **every** configured
  node answers 200 with `syncRevision ≥ r`. A missing field, an unreachable node, a
  lower value or any other status holds the sync. Plan 33 9.7 reuses the same gate for
  revision 2. The portal's own `sar_orgs.sync_revision` is a send counter, not this.
- **Drill teams:** `drill: true` in every body. Without the revision 3 gate, the team is
  held back with the reason `drill_support_pending`, shown as "Waiting for drill
  support on every node". It is never sent without the flag.
- **Refusals.** `422 drill_team_invalid` and `409 sar_team_drill_immutable` are
  permanent: logged at error, sent to Sentry, never retried. `503` with `Retry-After` (a
  node's applier is behind) is a per-node failure, shown and retried.
- Real teams send no `drill` field, so their body and hash don't change.

### 4.6 Activation (P5)

- `activate_drill` takes a drill team from `pending` to `approved` and sets
  `approved_at` and `approved_by_user_id` (the sync needs both). It is offered to a
  user holding both `rmdig_admin` and `rmdig_sar_approver`, and is re-checked on the
  server. It uses the same review-revision check as approve, so nobody activates a
  version they haven't seen.
- Approve, reject and request-changes never apply to a drill row. Suspend, withdraw and
  reactivate work as for a real team. A reactivated drill team goes back to `pending`,
  and the operator activates it again.
- The approve action refuses a drill row, and `activate_drill` refuses a real row, each
  with a logged warning.

### 4.7 Kept out of real surfaces (P6)

- `/admin/sar-approvals` lists drill teams in their own "Drill teams" section and leaves
  them out of the queue and its counts.
- The new-application email never fires, because registration doesn't go through
  `/sar/new`.
- The area-changed staff email says "(drill)" in its subject.
- Public listing consent is forced off in the sync body (plan 33 9.2). Plan 34 and 9.14
  leave drill teams out when they're built, and their plans say so.
- The `portal-sar-no-admin` check (9.13) still covers drill teams. A drill team with no
  admin can't be exercised either.

### 4.8 Intake and email (P6)

- **Live intake:** a non-drill message for a drill team is refused with a permanent
  `400 live_for_drill_team`, plus a Sentry event (plan 66 §4). AvServ pages on it.
- **Drill intake:** a drill team's messages are stored and shown as drills, as now.
  They are also emailed to the team's members (DR2) through the existing fan-out
  (`lib/sar/alert-notify.ts`). `emailsTeam` becomes "not a drill, **or** a drill for a
  drill team". The templates add a DRILL marker to the subject and a line at the top of
  the body. The new copy joins the `legal-copy.test.ts` scan.
- A real team's drill deliveries (a node in drill mode) still email no one.

### 4.9 Later (P7): a drill AvAI user

Owner, 2026-11-09 (plan 66 O2). Phase D's first production pass uses a device-only
drill account: the fixed drill device, with no portal user. A planned follow-up adds a
drill portal user linked to a drill device that is a real AvAI install. This drills the
user side end to end: device link, portal sign-out (AvApp O15, #470), consent, the SAR
teams list, the area-share setting, and erasure.

- The user is an `is_drill` row with a plus address at rmdig.ai (DR3). It is created
  the same way as a drill login (§4.2) but with no team membership, so it holds
  neither a team role nor a platform role.
- **Drill status belongs to the account, not only to `AVSERV_DRILL_DEVICE_IDS`.** A
  link across the line is refused on both sides: a drill portal user with a real
  AvServ account, or a real user with a drill account. This works like the team-flip
  refusal (R4). The portal check needs AvServ to report an account's drill status
  in the device-link exchange; the wire shape is AvServ's (plan 66 §6 follow-up).
- It is left out of user counts and exports. A drill user's account-security notices
  and its own alert emails are sent as usual, to the plus address, because those are
  part of what it tests. Which other emails, if any, it should not receive is settled
  when P7 is planned.
- Erasure: the CPA deletion flow runs for it as for anyone. Erasing a drill user is
  the erasure drill (AvServ `docs/drills/cpa-deletion.md`).

Not built until Phase D's first pass is done. Its own PR sequence is written then.

## 5. PR sequence

Each PR carries its tests and passes the pre-PR gate (CLAUDE.md §4.2). The migration
reaches production before merge (§3.8).

| ID | Scope | Waits on |
|---|---|---|
| P1 | This plan, `00_status.md`, CLAUDE.md §0 (§3) | Owner review |
| P2 | Migration 0036: `is_drill` on teams and users, triggers, CHECKs, nullable proof, log actions; schema tests on PostGIS. **Built 2026-11-09** (`tests/integration/drill-schema.test.ts`) | #202 (0035) merged |
| P3 | Per-node capabilities gate (`lib/avserv/`), drill sync body and hold, refusal handling; mock-backed. **Built 2026-11-09:** `lib/avserv/sar-capabilities.ts` (`syncRevisionGate`, for 9.7 too), `drill_support_pending`, Sentry on `drill_team_invalid` and `sar_team_drill_immutable` | P2 (AvServ revision 3 is live, rc112) |
| P4a | Drill registration (`/admin/sar-drill`), the area limits, drill teams left out of real teams' area warnings and clip, kept out of the approvals queue and refused by its review action. **Built 2026-11-09** | P2; plan 33 9.3 and 9.5 merged |
| P4b | Drill logins: created by an admin with a set-password link; sign-up and real-team invites refuse the drill address shape. **Built 2026-11-09** (`createDrillLoginAction`, `lib/sar/drill-address.ts`) | P4a |
| P5 | `activate_drill` and the drill section of the approvals page; tests pinning both directions of rule 6 | P2, P4 |
| P6 | Intake refusal, DRILL emails, exclusions, area email "(drill)"; a mock Playwright spec for register → activate → sync held → drill alert emailed | P3–P5 |

| P7 | Later: a drill AvAI user (§4.9) | Phase D's first production pass; AvServ plan 66 §6 follow-up (account-level drill flag) |

**Operator, after P6 and AvServ plan 66 step 2:**
1. Register the drill team. Its area is a 1 km-radius circle (about 3.1 km²) centred on
   the Colorado State Capitol, Denver, near 39.7393, -104.9848. The owner chose this on
   2026-11-09 (plan 66 O3), and the exact point doesn't matter. If registration refuses
   it for overlapping a real team, use another public spot nearby where no one starts a
   trip, and tell the owner where.
2. Invite its drill logins and publish its terms.
3. Activate it, and confirm both nodes report revision 3 and the team synced.
4. Run AvServ `sar-phase-d.md`'s production pass.

## 6. Two-lens notes for the PRs

**Architectural effect:** drill becomes a property of the team and the login, enforced in
the database, so production can test the SAR path while real teams are live. The one new
path past hand approval is limited to rows the database proves are drills, which a real
row can never become. The capabilities gate is one abstraction with two call sites
(revision 3 here, revision 2 in 9.7).

**Execution effect:** every new column defaults to today's behaviour, so P2–P6 change
nothing until a drill team is registered. The new failure modes are a node below
revision 3 (the team is held, shown, not sent) and a misrouted live message for a drill
team (refused, paged). Neither affects a real team's alerts.
