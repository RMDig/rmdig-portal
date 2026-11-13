# 35 — Automated data-deletion requests (DRAFT)

**Update 2026-10-28:** the manual path (D6) now has an "Erase in AvServ" button
on `/admin/deletion-requests` (owner-approved; AvServ plan 47 shipped except 4c,
which waits on counsel). A person clicks every step with their own reader id;
the worker, cancel window and §2 automation stay unbuilt until 4c and the
decisions below.

**Update 2026-11-13:** owner decision D11 (§10): a confirmed deletion **ends** a
check-out that is out but not alerted, instead of waiting behind it. An alerted
check-out, an open Send Help and a live incident still hold the erasure. This
amends the first rule in §0. Unbuilt; needs AvServ changes (§10.4).

Status: **draft, 2026-10-11, revised after a three-lens security review the same day
(§9). Owner decisions (§6) and counsel review (§7) pending.** Nothing here is built.
Today a confirmed request is carried out by hand from the runbook "Data-deletion
requests" (CPA deletion drill, 2026-10-11). This plan automates the low-risk common
case and routes everything else to the operator. It is `§0`: it changes a Colorado
Privacy Act process, touches precise-location data, and can remove a person's
safety setup. It needs AvServ changes first (§5).

## 0. Goal and rules

**Ask (owner, 2026-10-11):** when someone confirms a deletion request, delete their
data and email them, without the operator running CLI commands and SQL by hand.
**Constraint:** this must not let anyone delete someone else's account, or let a bug
or a leaked key delete many accounts.

These rules hold throughout:

- **Never force an erasure past live safety state, on any node.** An alerted
  check-out, an active Send Help, a live incident or a SAR message in flight blocks
  erasure. The automation waits and retries. It never closes, cancels or works around
  any of these. **One exception (D11, §10):** a check-out that is `out` and not
  alerted is ended by the erasure, because the requester was told so and accepted it
  when they confirmed. The trip is never reported as checked in.
- **Automate only the low-risk case.** An account is erased without a person only
  when every condition in §2 holds. Anything else is `held` with a reason for the
  operator. Holds are cheap; a wrong erasure can't be undone.
- **Erase only what this request proved, and nothing found later.** The account list
  is collected once, frozen on the request, and bound to the request's email on
  AvServ's side too (§5).
- **A page load or a background fetch never confirms, cancels or erases.**
- **Bounded blast radius.** Caps on both services (§5): a leaked key or a runaway
  worker can erase a handful of accounts at most before everything stops and pages.
- **Fail loud.** Every hold, retry, failure and erasure is logged, reported to Sentry,
  shown on `/admin/deletion-requests`, and stays on the 45-day clock.
- **The DB row is the source of truth.** A failed email never rolls back a completed
  erasure (CLAUDE.md §3.2).

## 1. Prerequisites (ship before any automation)

These are worth shipping on their own; most close gaps that exist today.

1. **Google sign-in requires `email_verified`.** *(Shipped separately, 2026-10-11.)*
   Auth.js doesn't check the claim. Without it, a Google account carrying an
   unconfirmed address could link into the row with that email. It also anchors D2:
   AvServ's login email is only as good as the portal's verification of it.
2. **Previews can't reach production AvServ.** *(Shipped with 1.)* The preview guard
   now rejects a real `AVSERV_FAILOVER_BASE_URL` and any signing key on a preview.
3. **Confirm by deliberate action.** `confirm/page.tsx` confirms on render today, and
   mail scanners open links on delivery. The link opens a page that names the
   categories to be deleted (no account details: links get forwarded) and asks the
   requester to **type their email address** and press **Confirm deletion**.
   - The server action takes the token as a hidden field. It never takes a request
     id, because ids are shown to users.
   - It moves `pending_confirmation → confirmed` compare-and-set.
   - CSRF and framing are already covered: server actions check Origin, and
     `next.config.ts` sends `frame-ancestors 'none'`.
4. **One pending request per address.** A new submission replaces the old one, and
   there's a daily cap per address. This replaces up to 72 confirmation emails a day
   to someone being harassed.
5. **Admin coverage of every open state.** The clock (`lib/deletion/clock.ts:34`), the
   queue (`admin/deletion-requests/page.tsx:30`), the lookups and Mark completed
   (`actions.ts:41,85,132`) filter on `status = 'confirmed'` only. They must cover
   every non-terminal state before any new state exists, with a test per state.

## 2. When a request may be automated

The worker (§4) erases without a person only if **all** of these hold. Otherwise the
request is `held` with the first failing reason.

| Check | Hold reason |
|---|---|
| Exactly one AvAI account, and it is the portal user's `avserv_account_id`; the portal user's current `lower(email)` equals the request's; AvServ's `primary_email` for that id equals it too | `unverified_match` |
| Or: no portal user, and exactly one AvServ **login** match (`primary_email`, citext, set only from a portal-verified email) | `unverified_match` |
| No app-email-only matches | `unverified_match` |
| The account lookup answered on every node | retry, then `node_unreachable` after 7 days |
| No portal account at all and no AvServ match | `no_account` (reply with a counsel-worded "we hold no data" notice; never "we erased your data") |
| The portal user has no MFA, no platform role, no org or advertiser membership | `strong_account` |
| The user isn't the last admin or member of an `approved` org and holds no platform role (cascades would bypass `manage-actions.ts`' last-admin rule and `admin/team/actions.ts:232`) | `org_continuity` |
| No rows the user created that block the delete (`sar_orgs`, `advertiser_accounts`, invitations) | `owns_org_rows` |
| No `alerted` check-out, Send Help or non-cancelled incident in the last 90 days, and no check-out in the last 7 days | `recent_safety_activity` |
| No live safety item on **any** node (§5 preview), other than an `out`, never-alerted check-out, which the erasure ends (D11, §10) | retry; a peer holding an erasure pages |
| No SAR team received data (`data_share_log`, read before erasure and stored) | `teams_to_notify` (until counsel approves the notice) |
| The requester isn't an emergency contact with no account. Their details live in other people's accounts and check-outs. | `contact_requester` |
| Under the daily erasure cap | `rate_ceiling` (pages) |
| Requests entered by staff from the support mailbox | always held; the operator attests how the requester was authenticated |

## 3. The flow

```
pending_confirmation --(typed confirm)--> confirmed
confirmed --(cancel window, D1)--> collecting --> held(reason) | erasing
erasing --> completed | held(reason)
held(retryable) --(next run)--> collecting or erasing
confirmed / collecting --(cancel by button)--> cancelled
any non-terminal --(operator, compare-and-set)--> completed (manual path, D6)
```

1. **Collect** (once): run the §2 checks, read the share log from every node, and
   **freeze** the account list and share log on the request (`erasure_plan` jsonb).
   Never re-collect once an erase has been attempted. A new account under the same
   email (for example, a sign-up again) isn't covered by this request.
2. **Preview on every node** right before erasing (§5). Any live item or an
   unreachable node → retry next run.
3. **Erase** the frozen account on one node:
   - `POST /v1/internal/accounts/{id}/erasure` with
     `{requestRef, email, confirmedAt}` and `X-AvAI-Reader: portal-user:automation:<requestId>`
     (AvServ only accepts `portal-user:` readers).
   - 200 → record. 409 live → retry. 409 `email_mismatch` → `held(unverified_match)`
     and page: something is wrong.
   - A timeout is **unknown**, not failed. Read the erasure status on every node; never
     re-POST to the failover node. A status with another `requestRef` (an operator
     got there first) is recorded as such.
   - Use a longer timeout than the default 4 s (`lib/avserv/request.ts:18`).
4. **Confirm on every node** (`GET …/erasure`). A node holding the erasure behind a
   live item it has and the origin doesn't is a **safety page**, not a quiet retry.
   The origin skips that account's later events (AvServ `store/erasure.go:466-496`),
   so the live trip has lost cross-node redundancy. See §5 item 6.
5. **Delete the portal user** by `lower(email)` and id, compare-and-set. An already
   missing user is fine (idempotent).
6. **Complete:** `WHERE status = 'erasing'` → `completed`, with a generated note
   (account, nodes, counts, teams). Email the requester (D5) and the admins.

## 4. Where and how it runs

- **A cron route,** `/api/cron/deletion-worker`, with the existing `CRON_SECRET`
  bearer check and Sentry cron monitor. Daily on Hobby, hourly on Pro. The cancel
  window is enforced in the SQL predicate (`confirmed_at < now() - interval`), not
  by the schedule, so a leaked cron secret only runs the worker early.
- **A lease, not a long transaction.** Claim a request by setting
  `lease_until = now() + 10 min` compare-and-set. Then do the HTTP calls outside any
  transaction (postgres-js behind the pooler, function timeouts). A stale lease is
  picked up again. Each step is idempotent.
- **One request per run per account,** and a per-run cap.
- **No "run now" or "skip window" button.** An operator can only finish a request by
  hand (the manual path) or release a hold to the next run.
- **Feature flag** `FEATURE_DELETION_AUTOMATION`, default off, plus a separate kill
  switch the cap also trips.

## 5. AvServ changes (AvServ plan 47; required before the grant)

**Agreed 2026-10-11:** AvServ plan 47, "Erasure guardrails before account_erasure is
granted", covers everything below. Order: after W8. No portal key gets
`account_erasure` until plan 47 ships. The shapes the portal client builds against
are in §5a.

Today no portal key holds `account_erasure` (default-deny, `config.go:1075`), so a
stolen portal key can't erase anything. The grant changes that. AvServ trusts the
portal completely: `requestRef` is free text (`api/erasure.go:65`), the internal
tier has no rate limit, and service JWTs have no maximum lifetime
(`auth/service.go:145-148`, unlike the operator tier). Before the grant:

1. **Daily erasure cap** per node from its own `account_erasure` rows (env, about 5 at
   beta). Above it: 429 `erasure_rate_limited` and a page.
2. **Page on every erasure** at beta volume (Info only today, `erasure.go:83`).
3. **Bind the request to the account:** the body carries `email` and `confirmedAt`.
   Refuse with 409 `email_mismatch` unless `primary_email` equals the email, and
   unless the account was created before `confirmedAt`.
4. **A separate kid for erasure,** `svc-key-portal-erasure`, scoped to
   `account_erasure` only. Its private key is a Production-only Vercel variable. The
   read key never gets the group, so erasure can be revoked on its own.
5. **Enforce `exp - iat ≤ 5 min`** on service tokens (today it's the portal's promise
   only, `lib/avserv/service-jwt.ts:24`), and log the kid on every erasure.
6. **`GET …/erasure-preview`** in the same group, exposing the existing dry run, so
   the worker can check live state on every node first. Also decide whether the
   origin should apply a check-out-open event for an account it erased within the
   last N minutes, so a trip opened on a peer in the replication window keeps its
   redundancy.
7. **A second-channel notice** (D1): a contract for telling the account's linked
   devices "a deletion was requested", with a cancel action, and after erasure an
   in-app "your account was deleted; you're no longer protected" instead of a
   generic sign-out (AvApp too).

### 5a. Endpoint shapes (from AvServ, 2026-10-11; final in AvServ plan 47)

**`POST /v1/internal/accounts/{accountId}/erasure`**
- Token: kid `svc-key-portal-erasure`, scoped to `account_erasure` only; `exp - iat ≤ 300 s`, else 401.
- Header: `X-AvAI-Reader: portal-user:automation:<deletionRequestId>`.
- Body: `{"requestRef": "<deletion_requests.id>", "email": "<deletion_requests.email>", "confirmedAt": "<deletion_requests.confirmed_at, RFC 3339>"}`.
  Both `email` and `confirmedAt` are read from the request row on the server, never
  from user input.

| Response | Meaning | Worker does |
|---|---|---|
| 200 `ErasureResult` | erased, or `alreadyErased: true` on a repeat | record |
| 400 `invalid_request` / `reader_required` | our bug | `held(client_error)`, page |
| 404 `account_not_found` | not on this node | next node |
| 409 `erasure_blocked_active` | live safety state; nothing erased | retry next run |
| 409 `email_mismatch` | the account isn't this requester's | **stop:** `held(unverified_match)`, page, never retry |
| 409 `account_newer_than_request` | the account was created after confirmation | **stop:** `held(unverified_match)`, never retry |
| 429 `erasure_rate_limited` + `Retry-After` | node's daily cap (default 5) | `held(rate_ceiling)`; AvServ pages |
| 503 `erasure_unavailable` + `Retry-After` | nothing changed | retry next run |

**`GET /v1/internal/accounts/{accountId}/erasure-preview`** (same group and headers)
- 200 `{accountId, node, alreadyErased, erasable, live: [{kind, id}]}`; 404 `account_not_found`.
- Called on **every** node first. Erase only when every node says `erasable`.

## 6. Owner decisions

| ID | Question | Recommendation |
|---|---|---|
| D1 | A cancel window, and how it reaches the person? | **72 h, 7 days if a device was seen in the last 30 days.** The cancel link is a button (a GET cancel would let a scanner cancel genuine requests), sent by email **and** to the account's devices (§5.7). The inbox may be the attacker's. Never notify emergency contacts. |
| D2 | Auto-erase a login-email match? | **Yes, only under §2's invariant**, together with §1.1 (Google `email_verified`). |
| D3 | Notify SAR teams automatically? | **No, not yet:** `held(teams_to_notify)` until counsel words the notice. |
| D4 | A node that never answers? | Retry; `held(node_unreachable)` after 7 days. |
| D5 | The completion email | Counsel-worded: complete, categories erased, what's kept (tombstone, SMS opt-out list, `data_share_log`) and why. |
| D6 | Keep the manual path? | **Yes,** compare-and-set so the operator and the worker can't both finish a request. |
| D7 | Signed-in deletion | Add "Delete my account" in settings, behind a session that has passed MFA. For a `strong_account` that's the self-service route instead of the operator. |
| D8 | Daily cap value | 5 per day per node at beta (AvServ's default); revisit with volume. |
| D9 | A check-out opened on a peer during the replication window after an erasure (AvServ plan 47 open point) | **Decided (owner, 2026-10-11): safety first.** The origin applies the check-out-open event so both nodes watch the live trip, pages, and re-erases when the trip closes (AvServ plan 47 §7). |
| D11 | A deletion confirmed while the user is checked out | **Decided (owner, 2026-11-13): end the trip.** The confirm page warns that confirming ends any current trip; the erasure closes an `out` check-out as ended by deletion (never `checked_in`); a notice to the contacts that the trip ended is recommended (O4, open). An alerted check-out, open Send Help or live incident still holds the erasure until resolved. Detail in §10. |
| D10 | Who the per-erasure page reaches | **Agreed with AvServ (plan 47, 2026-10-11):** every erasure to the operator via Pushover; `email_mismatch` and a cap hit to PagerDuty as well. |

## 7. Counsel questions

- Is a link click plus a typed confirmation a "commercially reasonable" request
  authentication for an **irreversible automated** erasure of sensitive geolocation?
  Do the held categories in §2 need a second factor?
- The CPA 45-day extension notice for a request held behind a live safety item
  (after D11, only an alerted check-out, open Send Help or live incident holds one).
  Should it be sent around day 30? And does the clock run from the request or from
  its confirmation?
- Wording: the completion notice (D5), the "no data held" reply, the SAR team notice
  (D3), the device notice (D1), and D11's confirm-page warning and contact notice
  (§10.2, §10.3).
- Does `/privacy` need to describe the automated process or the cancel window?
- Emergency contacts who ask for deletion: what do we owe them, given that their
  details sit in another person's account for that person's safety?

## 8. Build order

1. §1.1–1.2 (shipped together, 2026-10-11).
2. §1.3–1.5: typed confirmation, one pending request per address, admin coverage of
   every state. Public route: copy scan, Playwright spec.
3. AvServ §5, its own plan and release. Then the separate erasure key is granted.
4. Migration: new states (rebuild the enum; `ADD VALUE` can't be used in drizzle's
   single transaction, memory "pg-enum-add-value-transaction"), `hold_reason`
   (a closed set of values), `erasure_plan`, `lease_until`, `attempts`,
   `cancel_token_hash`. Integration test on a fresh migrate.
5. Portal erasure client (`lib/avserv/`): Zod at the boundary, a mock for e2e, the
   timeout-means-unknown rule.
6. Worker behind the flag, with a unit test for every §2 check and every AvServ
   response.
7. Admin UI for the held reasons; emails after counsel; then the flag on.
8. **Drill again** with an account that has a check-out and a contact (AvServ drill
   follow-up, 2026-10-11), plus an attempted erasure of a second account under a
   mismatched email (it must be refused). After D11: one account with an `out`
   check-out (the trip ends, the contact gets the notice, never an all-clear) and one
   with an alerted check-out (held until it resolves).

D11 (§10) can ship before the worker: the warning and acknowledgment (§10.2) on the
confirm page first, then the AvServ change (§10.4), after which the operator's
**Erase in AvServ** button ends an `out` trip instead of reporting it blocked.

## 9. Review record (2026-10-11)

Three independent reviews (who can cause a deletion; service-key blast radius;
safety, abuse and workflow), verified against `origin/main` of both repos. They led
to §1.1, §1.2, §1.5, the §2 table, the frozen account list, §5 and D7. They confirmed
as sound:

- AvServ's live-item check runs inside the erase transaction under `FOR UPDATE`.
- Erasure is all-or-nothing and idempotent, with `erased_ids` stopping a late event
  from recreating data.
- The 256-bit hashed deletion token.
- The intake's same answer for every address.
- `account_erasure` stays default-deny.

## 10. D11: a deletion confirmed during a check-out (owner decision 2026-11-13)

### 10.1 The decision

Counsel was asked (privacy policy v4, retention comment, question 6) how to treat a
deletion request from someone who can't be confirmed safe while their trip is open.
The owner decided instead: **tell the requester, and make ending the trip part of what
they confirm.** The request then completes on the normal clock instead of waiting
behind a trip that may stay open with no time limit.

**Ended, not checked in.** A check-in is the user's own statement that they are back;
AvServ never records one the user didn't make. The requester may not be the
traveller: `/account/delete` needs no sign-in, and confirming proves control of the
inbox only (§1.3). So the trip closes with its own status. (An all-clear isn't at
stake: AvServ sends one only after a delivered overdue alert, and an alerted trip
holds the erasure, §10.3. A trip D11 ends was never alerted, so its contacts would
hear nothing on a check-in either.)

**Why tell the contacts at all.** They hear nothing when a quiet trip ends normally,
so the notice is new, not a replacement. It exists for the case where the requester
isn't the traveller: it lets the people who would have been alerted know that no
alert will come, so they can reach the user. Whether to send it is O4 (§10.6).

### 10.2 The confirm page

- **Every requester sees the warning,** not only those checked out. The page can't
  show account state (links get forwarded, §1.3), and rendering it must not call
  AvServ. Draft, for counsel: *"If you are checked out on a trip when we delete your
  data, the trip ends. AvAI stops watching it, and your emergency contacts are told
  it ended. They are not told you are safe. If an alert about you is open, we finish
  the deletion once it is resolved."*
- **A required tick box:** *"I understand that deleting my data ends any trip I'm
  checked out on."* Recorded as `ends_checkout_ack_at` in the same compare-and-set
  that moves the request to `confirmed`; the action refuses a confirm without it
  (validation test). A request confirmed before D11 has no acknowledgement and keeps
  today's behaviour: held behind the trip.
- **The specific "you're checked out" message goes to the user's phone,** the only
  place that can show account state safely: the device notice (§5.7, D1) says
  *"You're checked out. Deleting your account ends this trip,"* with its cancel
  action.
- Public route rules apply (CLAUDE.md §3.7): no auth, the copy is added to
  `tests/unit/legal-copy.test.ts`, and the Playwright deletion spec covers the tick box.

### 10.3 What ends and what holds

AvServ decides from the state **at erasure time**, inside the erase transaction under
`FOR UPDATE`. A trip that goes overdue between confirmation and erasure is therefore
held, not ended.

| State at erasure | Result |
|---|---|
| Check-out `out`, never alerted, request has the acknowledgement | Ended by the erasure; contacts get the notice below |
| Check-out `alerted` (an overdue alert went out, no check-in) | Held until resolved (§7 extension notice if it nears day 45) |
| Open Send Help | Held |
| Live (not cancelled) incident | Held |
| SAR message in flight | Held |
| Request has no acknowledgement (confirmed before D11) | Held, as today |

**The contact notice.** Sent to each contact who accepted the role on that trip, on
the trip's channels. Draft, for counsel: *"AvAI: [Name]'s trip has ended because their
AvAI account was deleted. AvAI is no longer watching this trip. This does not mean
they checked in."* It is a new message type, so before it ships: the `/sms` message
list, the Terms of Service program list, the A2P campaign samples, and the
compliance-copy twins (CLAUDE.md §0) all change together.

### 10.4 AvServ changes (AvServ plan 47 §12, proposed 2026-11-13)

Summary; plan 47 §12 is the authority. It also makes a trip **past due but not yet
marked alerted** block, using the watchdog's own overdue test, and answers the first
call with `202 erasure_pending` while the notice goes out (a new "retry next run" row
in §5a).


1. The erasure body gains `endOutCheckout: true`, set only when the request row has
   `ends_checkout_ack_at` (read from the row, never from input, like `email`).
   Without it, an `out` trip returns today's `409 erasure_blocked_active`.
2. In the erase transaction, an `out` check-out closes with a new status (proposed
   `ended_by_erasure`), never `checked_in` or `cancelled`, and no all-clear is queued.
   Any held state in §10.3 returns 409 as today.
3. **The notice goes out before the data does.** An erasure deletes the outbox rows
   naming the account (plan 47 H1), and with them the contacts' numbers. So it runs
   in two steps: close the trip and queue the notice; erase once its delivery attempts
   are recorded. Plan 35's retry loop already fits this; the manual button shows the
   first step's result.
4. The closure replicates as its own event so the peer stops watching before the
   erasure reaches it. A trip opened on the peer during the replication window
   (plan 47 §7, D9) follows the same table.

### 10.5 Remaining risk

Someone who controls only the inbox can confirm a deletion and end a real trip early.
Mitigations: the cancel window and the device notice (D1) reach the real user first;
the contact notice tells the contacts the trip ended and that this doesn't mean the
user is safe; the signed-in, MFA route (D7) is the self-service path for strong
accounts. With the notice (O4), the worst case is a trip ended early **with its
contacts told**; a trip is never recorded as checked in by anyone but the user.

### 10.6 Open points

- **O1 (counsel):** wording of the confirm-page warning and the contact notice (§7),
  and whether `/privacy`'s deletion text should say that deletion ends a current trip.
- **O2 (owner):** new check-outs during the cancel window. Recommendation: allow them
  (the device notice warns); the erasure ends whichever trip is `out` when it runs.
  Plan 47 D2 already refuses new arms once a node holds the erasure.
- **O3 (AvServ):** the two-step close-then-erase (§10.4 item 3), and the event shape
  for `ended_by_erasure`.
- **O4 (owner):** send the contact notice, or end the trip without telling the
  contacts? Recommendation: send it, for the inbox-only case in §10.5. The cost is a
  new message type (§10.3: `/sms`, the Terms of Service list, the A2P samples and the
  copy twins change together). Without it, §10.5's worst case becomes a trip ended
  with no one told, and the warning and draft texts above drop their contact clause.
- **Unchanged:** an emergency contact requesting their own deletion while serving on
  someone's live trip stays `held(contact_requester)`. D11 covers only the traveller's
  own trips.

### 10.7 Tests

Per CLAUDE.md §4.3: the confirm action refuses without the tick box and records it
with the confirm (unit); the erasure client sends `endOutCheckout` only from the row
(unit); each §10.3 row against the AvServ mock, including an `out` trip that is
alerted by the time the erasure runs (unit); the confirm-page copy in the legal-copy
scan; the Playwright deletion spec with the tick box; the §8 drill.
