# 32 — Restriction review requests (portal side of AvServ plan 39)

> **Status: IMPLEMENTING 2026-10-01** (branch `feat/w2-restriction-review`).
>
> **Source of truth:** AvServ `docs/contracts/restrictions.md` rev 1 (origin/main
> `082195b`), which supersedes plan 39 §4. AvServ is the **system of record for
> restriction state**. The portal holds the review requests and their audit log, which keeps
> free-text PII off the safety nodes.
>
> **The AvServ endpoints are specified, not built.** Plan 39 ships with Incident Detection
> after v1.5, so this builds against the contract behind `AVSERV_BASE_URL=mock://`, exactly
> as P-B1–B3 did.
>
> §0 tie-breaker (contract): no restriction ever blocks a safety action. The portal only
> reads restrictions and lifts them; it never issues one (out of scope; contract §3 exists
> for a later operator tool).

## 1. What ships

1. **`/account/review`** (signed-in, under `(portal)`; the path is fixed by contract §8).
   - It lists the **active** restrictions on the signed-in user's linked account, read
     through `GET …/restrictions`.
   - For each one it shows what is restricted (Incident Detection), why (`userReason`), and
     since when (`activatedAt`).
   - The `?restriction=` id only highlights a match. It is **never looked up**.
   - No match on this account means the device-linking explanation (contract §7), with no
     lookup.
   - Pending restrictions are not shown, because the user was never told (contract §6).
   - The review-request form:
     - free text of 20–2000 characters;
     - a server-minted `submissionKey`, which makes submission idempotent;
     - one open request per restriction;
     - a rate limit of 3 per 24 h per AvServ account;
     - CSRF protection from Server Actions' Origin check.
   - Each request shows its status (open, upheld, lifted).
2. **`/admin/restriction-reviews`** (platform staff).
   - A queue filterable by status, open by default.
   - The detail page shows the request, the account's **full restriction history** from
     `GET` (with `operatorNote` and `liftNote`, which are staff-only), the portal's audit
     log, and a decision form.
   - **Decisions:**
     - **Lift** (note required): calls `POST …/restrictions/{id}/lift {note, liftedBy:
       "portal:<staffUserId>"}`. That call is idempotent, so the order is AvServ first,
       then the portal row and log. AvServ emails "restored" (contract §6); the portal
       sends nothing.
     - **Uphold** (note required, staff-only): writes the portal row and log, then emails
       the user. A failed email is logged loudly and the decision is not rolled back.
     - **Close** (note required), offered only when `GET` shows the restriction already
       lifted (for example, from the CLI): writes the portal row and log only.
3. **Audit log:** `restriction_review_log`, append-only, with a row for every submit,
   uphold, lift and close, recording the actor and the note.

## 2. Layout

| File | Role |
|---|---|
| `lib/avserv/request.ts` | Gains the shared contract helpers (`AvServContractError`, `contractFailure`, `callWithFailover`), now used by two clients. `AgreementError` stays as an alias. |
| `lib/avserv/restrictions.ts` | `listRestrictions`, `liftRestriction`, with Zod parsing of the §1 object. Lift uses failover with the same request; a failover-side 404 counts as lag. |
| `lib/avserv/restrictions-mock.ts` | In-process mock. An account whose mapped login email has a `+restricted` local-part tag gets one seeded active restriction (dev/E2E only). Lift is idempotent, and the first lift's note and actor stand. |
| `lib/restrictions/review.ts` | Zod schemas, the actor string, scope labels, the visible-restriction filter. |
| `lib/db/schema.ts` + migration `0014` | `restriction_review_requests`, `restriction_review_log`, two enums. |
| `app/(portal)/account/review/*` | Page, form, action. |
| `app/(portal)/admin/restriction-reviews/*` | Queue, detail, decision form, action. |
| `lib/email/templates/RestrictionReviewUpheldEmail.tsx` + `send.ts` | The uphold email; added to the legal-copy scan. |

## 3. Schema (migration 0014, append-only)

- **`restriction_review_status`:** `open | upheld | lifted | closed`.
- **`restriction_review_action`:** `submitted | upheld | lifted | closed`.
- **`restriction_review_requests`:**
  - `id`, `user_id` → users (cascade), `avserv_account_id`, `restriction_id`;
  - `submission_key` (unique), `message`, `status`, `created_at`;
  - `decided_at`, `decided_by_user_id` → users (set null), `decision_note`;
  - **unique (`restriction_id`) WHERE status = 'open'**;
  - an index on (`status`, `created_at`).
- **`restriction_review_log`:** `id`, `request_id` → requests (cascade), `action`, `note`,
  `actor_user_id` → users (set null), `created_at`; indexed on `request_id`.

**Production migration before merge** (CLAUDE.md §3.8).

## 4. Errors

Every AvServ failure surfaces to the person acting:
- the user page shows "couldn't load, refresh";
- the staff lift shows AvServ's `code` and message;
- `404 restriction_not_found` on lift reads "already gone? refresh". The contract makes
  `restriction_not_found` indistinguishable for another account's id;
- 503/5xx/network errors read "try again", and the lift is safe to retry.

Faults go to `logger.error`. No path queues silently.

## 5. Tests

- **Unit:**
  - the restrictions client (wire shape, failover with the same body, lag flag, error
    codes, schema drift);
  - the mock (seeding, idempotent lift);
  - both actions: happy path, auth, staff gate, validation, rate limit, idempotent resubmit,
    one-open rule, foreign or unknown restriction id refused without a lookup, AvServ
    failure loud, uphold email failure not rolled back, lift order (AvServ before the DB
    write).
- **Legal-copy scan:** the new user page and the email template.
- **E2E (mock):** a restricted persona sees the restriction and submits a request; staff
  lifts it with a note; the request shows as lifted.

## 6. Two-lens (preliminary)

**Architectural effect.**
- AvServ stays the system of record. The portal stores only review text and its log, as
  plan 39 §0.4 intends.
- Every S2S call is account-scoped (contract §8).
- The shared contract helpers move to `request.ts` because there are now two call sites.
- The migration is additive: new tables only.

**Execution effect.**
- Nothing is live until AvServ builds plan 39.
- In production today, `GET` against the real AvServ returns 404 (route absent), so the
  review page shows its error state. Nothing links there yet (no notices are sent).
- No Edge, env or public-route change.
- The AvServ "restored" email and the portal uphold email never double up (contract §6).
