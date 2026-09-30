# 31 — Web onboarding: required identity + signed agreement (portal side of AvServ plan 23)

> **Status: IMPLEMENTED 2026-09-30 (branch `feat/23-account-agreement`).** Rev 2 follows AvServ contract
> revision 2.
>
> **Source of truth:** AvServ `docs/contracts/account_agreement.md` rev 2 (origin/main
> `c65cdc8`), §2, §4, §5, §8 and §10; server plan `docs/plans/23_required_account_and_agreement.md`.
> AvServ is the **system of record**. The portal is a synchronous front end over the plan 05
> S2S service-JWT tier. The server side is live with both flags off:
> - the S2S calls answer `404 agreement_capture_disabled`;
> - `GET /v1/agreement/current` answers `404 agreement_not_published`.
>
> Nothing can be accepted in production until counsel's text is published **and** capture is
> on. Where this doc and the contract disagree, the contract wins.

---

## 1. What ships

1. **Account state on `/settings`.** A new "AvAI account" card reads
   `GET /v1/internal/accounts/{id}` (a plain read with no lock, served during a peer upgrade). It
   shows:
   - activated or not, and when;
   - the legal name and the name on your alerts;
   - the verified email;
   - acceptances;
   - `needsAcceptance`;
   - `agreement.required`.
2. **Identity.** The card has a form for **legal name** and a separate **"Name on your alerts"**
   field, which is the AvServ `displayName` (D1). It saves with
   `PUT /v1/internal/accounts/{id}/identity`. Email is never sent: the account's email is the
   portal's verified login.
   - The alert name is prefilled from the portal display name **only** when that name passes
     the contract §3.2 display-name rule. Otherwise the field is left empty for the user, and a
     save shows AvServ's message.
   - A legal-name change after activation is allowed on the portal. AvServ logs it and sets
     `needsAcceptance`, and the card then offers re-acceptance.
3. **Agreement page, `/settings/agreement`.** It renders the **pinned** version exactly:
   - the markdown text, through `react-markdown` with raw HTML skipped;
   - the assent line;
   - each attestation's label.

   Agree stays disabled until the end of the text has scrolled into view (D2). A pinned value
   of `null` (today) shows "not published yet" and no form.
4. **Acceptance.** The page calls
   `POST /v1/internal/accounts/{id}/agreement-acceptances` synchronously, with:
   - identity (legal name + alert name) in the same body, as one atomic call;
   - an Idempotency-Key minted once per user act;
   - the browser's IP and user agent.

   On a network error, 5xx or 503, the portal retries the **same key** on the failover node
   (§3). The user always sees the answer.
5. **Pin tooling + CI.**
   - `pnpm agreement:pin <version>` pins the text **and wording** from AvServ.
   - `pnpm agreement:check` compares every pinned hash against AvServ: the text, the assent,
     each attestation, and the attestation set.

**Not in scope:**
- `/terms`: the counsel draft and store gate stay as they are.
- A public no-auth agreement page.
- Any portal-side record of acceptances. AvServ is the record, so this adds **no migration**.

## 2. Layout

| File | Role |
|---|---|
| `lib/avserv/request.ts` (new, extracted from `client.ts`) | `AvServError` (now with an optional AvServ `code`), `isMock`, `commonStatusError`, and `avservFetch(baseUrl, path, init)`: signs the service JWT, applies the timeout, and wraps network failures. `client.ts` keeps its public surface and re-exports `AvServError`. |
| `lib/avserv/agreement.ts` (new) | `getAccount`, `putIdentity`, `acceptAgreement`. §3.1 body Zod schema; AvServ error bodies → `AvServError{status, code, retryAfter}`. The failover node is used only by `acceptAgreement`. |
| `lib/avserv/agreement-mock.ts` (new) | A stateful in-process mock for `mock://`: capture on, accounts keyed by id, identity rules via the prefill check, acceptances. Uses the published fixture only under the E2E seam (§4). |
| `lib/agreement/pinned.ts` (generated) | `PINNED_AGREEMENT: PinnedAgreement \| null`: version, text, assent text, attestations `{id, text, required}`. Strings are JSON literals, so bytes (LF, no BOM) survive bundling. `null` today. |
| `lib/agreement/index.ts` (new) | `sha256Hex`, `presentedAgreement()`: the pinned version (or the E2E fixture) with **computed** hashes. The contract forbids hard-coding hashes. |
| `lib/agreement/names.ts` (new) | `passesAlertNameRule`, a twin of contract §3.2 `displayName`, used **only** to decide the prefill (AvServ stays authoritative); `normalizeName` (NFC, whitespace collapse, trim). |
| `lib/agreement/errors.ts` (new) | AvServ code → user message, retryable?, fault?. Faults go to `logger.error` + `Sentry.captureException`. |
| `lib/agreement/pin-check.ts` (new) | Pure compare logic for the CI check (unit-tested). |
| `scripts/pin-agreement.ts`, `scripts/check-agreement-pin.ts` (new) | Operator pin tool; CI check wrapper. |
| `app/(portal)/settings/AvaiAccountCard.tsx` + `avai-account-actions.ts` (new) | Card + `saveAvaiIdentityAction`. |
| `app/(portal)/settings/agreement/page.tsx`, `AgreementForm.tsx`, `actions.ts` (new) | Page + `acceptAgreementAction`. |

**Env.**
- New optional `AVSERV_FAILOVER_BASE_URL`, added to `lib/env.ts` and `.env.example`. It is the
  second node for acceptance retries. When unset, the portal tries one node, as today.
- CI node URLs live in the workflows, not `lib/env.ts`, since they are not runtime config.
- Nothing touches the Edge bundle or `app/(public)/`.

## 3. Flows

**Page load** (`/settings` card, `/settings/agreement`):
- **No `avservAccountId`:** "Your account isn't linked to AvAI yet. Sign out and back in" (the
  P-B1 map retries at login).
- **Otherwise:** `getAccount`:
  - `404 agreement_capture_disabled` → "not available yet" (the card says so; the form is
    hidden);
  - `404 account_not_found` → support message (suspended or retired; never loop);
  - network/5xx → "couldn't load, refresh" + `logger.error`.

**Save identity** (`saveAvaiIdentityAction`):
1. Session → account id.
2. A per-user rate limit: `avai-identity:<userId>`, 20/h.
3. Zod: trim, 1–100 and 1–40 **code points** after NFC + whitespace collapse.
4. `putIdentity` sends only the non-empty fields.
5. AvServ `invalid_legal_name` / `invalid_display_name` → a field error with **AvServ's
   message**. The portal does not re-implement the Unicode rules beyond the prefill check.

**Accept** (`acceptAgreementAction`):
1. **The page mints the key** (`randomUUID()`) server-side into a hidden input's `defaultValue`,
   which survives the React 19 form reset. Retry clicks resend the same key; a reload is a new
   act.
2. The action checks the session, the link, the per-user rate limit (`avai-accept:<userId>`,
   20/h), and `presentedAgreement()` ≠ null.
3. It checks the form:
   - `version` equals the presented version;
   - `presentedInFull === "true"` (set by the scroll marker);
   - the assent box is ticked;
   - every `required` attestation is ticked;
   - the identity fields are present.
4. **Browser IP:** the first `x-forwarded-for` hop, else `x-real-ip`. If neither exists, the
   action refuses **without calling AvServ**. It never sends the portal's address.
5. It builds the body:
   - `version`, and `contentHash` = sha256(pinned text);
   - `identity {legalName, displayName}`, never email;
   - `assent`:
     - `method: "checkbox_and_button"`;
     - `textHash` = sha256(assent text);
     - `presentedInFull: true`;
     - `displayedAt` (server render time), `acceptedAt` (now);
   - `attestations`: the ticked ones, each `{id, textHash, value: true}`;
   - `client {ip, userAgent, locale}` (first `Accept-Language` tag).
6. It calls the primary node. On a network error, `500 internal` or any 503, it retries **once**
   on `AVSERV_FAILOVER_BASE_URL` with the same key. There, a `404 account_not_found` is
   replication lag (contract §4), reported as retryable.
7. **On 200:** it revalidates `/settings` and `/settings/agreement`, shows "Agreement accepted —
   your AvAI account is active", and logs `{event:"agreement.accepted", acceptanceId, version,
   activated}` with no name or IP.

## 4. Pinning, rendering, the E2E seam

- **Rendering is exact:** the text through `react-markdown` (`skipHtml`, no plugins), and the
  assent line and attestation labels as plain text. The hashes cover the source strings (the
  markdown bytes, not the rendered HTML).
- **`pnpm agreement:pin v1`:**
  1. fetches `GET /v1/agreement/v1` from the first node that answers;
  2. verifies `contentHash` and every `textHash` against the bytes;
  3. writes `lib/agreement/pinned.ts`.

  A mismatch aborts the pin.
- **E2E seam:** with `E2E_AGREEMENT_FIXTURE=1` **and** `AVSERV_BASE_URL=mock://*` (both
  required; production sets neither), `presentedAgreement()` returns a clearly labelled test
  fixture when the pin is `null`, and the mock accepts it. This follows the existing
  `E2E_FAKE_BLOB` precedent.
- **Legal-copy scan:**
  - the agreement page chrome (`app/(portal)/settings/agreement/*.tsx`,
    `AvaiAccountCard.tsx`) joins the forbidden-phrase scan;
  - the pinned text and wording (counsel's, AvServ-hashed) are not scanned;
  - the E2E fixture wording is.

## 5. Error mapping (contract §3.3 + §4)

| Code | User sees | Ops |
|---|---|---|
| 200 | Accepted / active | info |
| `invalid_legal_name`, `invalid_display_name` | field error (AvServ's message) | info |
| `invalid_json`, `invalid_idempotency_key`, `invalid_assent`, `invalid_attestations`, `invalid_client_ip`, `email_not_accepted`, `invalid_account_id`, `attestation_declined`, `attestation_missing` | "Something went wrong on our side; we've been notified" | **fault** (portal bug) |
| `agreement_hash_mismatch`, `agreement_wording_mismatch`, `agreement_version_retired` | "This agreement was updated; we're publishing the new version. Try again later." | **fault** (release needed; ≥ 30-day window) |
| `agreement_capture_disabled`, `agreement_not_published` | "Not available yet" | info |
| `account_not_found` (primary) | "Your AvAI account needs attention: contact support@rmdig.ai" | warn |
| `account_not_found` (failover only) | "Try again in a minute" | warn (lag) |
| `idempotency_conflict` | "Reload the page and try again" | fault |
| `identity_incomplete` | "Fill in your legal name and the name on your alerts" | warn |
| `identity_locked` | (unreachable for the portal) | fault |
| 503 (`agreement_version_unknown`, `agreement_capture_unavailable`, `agreement_catalog_invalid`), 500 `internal`, network | "Try again in a few minutes" (same key kept) | warn; fault once both nodes fail |

Nothing is queued silently.

## 6. The CI hash check

`pnpm agreement:check --mode pr|daily` asks the nodes listed in `AGREEMENT_CHECK_NODES`
(`https://avserv-2.rmdig.ai,https://avserv-3.rmdig.ai`, set in the workflow) and takes the first
authoritative answer.

| Pinned | AvServ | PR mode | Daily mode |
|---|---|---|---|
| `null` | `404 agreement_not_published` | pass | pass |
| `null` | current published | **warn** | **fail** ("pin vX") |
| `vN` | 200: text, assent and every attestation (id, text hash, required) match | pass (warn if `status` ≠ `current`) | same |
| `vN` | any hash or the attestation set differs | **fail** | **fail** |
| `vN` | `404 agreement_version_unknown` | **fail** | **fail** |
| any | every node unreachable or 503 | warn | **fail** |

**Where it runs:**
- as a step in `ci.yml`'s `verify` job (main-targeted PRs + main pushes);
- in a daily `agreement-pin.yml` schedule.

## 7. Tests (CLAUDE.md §4.3)

**Unit** (pure; `vi.mock` of auth, db, rate-limit, `next/headers`, the AvServ modules, Sentry):
- **The agreement client:**
  - the GET parses a §3.1 body (a drifted one is refused);
  - the PUT never sends email;
  - the accept call sends the `Idempotency-Key` header and carries `client.ip` and `userAgent`;
  - every error body maps to `{status, code}`;
  - failover: the same key is sent to both nodes, and `account_not_found` on the second node
    counts as lag.
- **The mock:** capture flow, idempotent replay, required-attestation refusal.
- **`names.ts`:** accept and reject vectors taken from contract §3.2 (NFC, NBSP collapse, Latin
  range, × ÷ ǀ refused, digits refused, 40-code-point bound).
- **`pin-check`:** every §6 row, both modes.
- **`presentedAgreement`:** computed hashes; LF/BOM guard; the seam requires both flags.
- **`saveAvaiIdentityAction`:**
  - happy path;
  - unauthenticated;
  - no link;
  - rate-limited;
  - an AvServ 400 becomes a field error;
  - a failure is loud.
- **`acceptAgreementAction`:**
  - happy path (body snapshot);
  - unauthenticated;
  - pinned `null` → no call;
  - missing IP → no call;
  - not presented in full → no call;
  - a required attestation unticked → no call;
  - each §5 class surfaces;
  - rate-limited.
- **Legal-copy:** the new scan surface.

**E2E** (Playwright, mock):
1. sign in;
2. the card shows "not activated";
3. open the agreement;
4. fill the names;
5. scroll to the end;
6. tick;
7. Agree;
8. "active";
9. the card shows active with one acceptance.

## 8. Contract gaps: answered (contract rev 2 §10)

| # | Gap | Answer | Portal effect |
|---|---|---|---|
| G1 | Read without a PUT | `GET /v1/internal/accounts/{id}` | Used; no empty-PUT stopgap |
| G2 | Missing codes | Added to the tables | Mapped in §5 |
| G3 | Pinning vs re-fetch | A pinned portal needs a release; ≥ 30 days `accepted` | §5 fault + daily CI |
| G4 | Canonical wording | Served with the version; `attestation_missing` for a required one | Pinned with the text; CI-checked |
| G5 | Identity in the accept body | Confirmed | One atomic call |
| G6 | Failover | Same key on the other node; `account_not_found` there is lag | `AVSERV_FAILOVER_BASE_URL` |
| G7 | Capture flags across nodes | Operator keeps them identical; peermon pages | `agreement_capture_disabled` = "not yet" |

## 9. Owner decisions (approved 2026-09-30)

- **D1:** a separate "Name on your alerts" field, prefilled only when the portal name passes
  the rule.
- **D2:** Agree disabled until the end of the text has scrolled into view (counsel to confirm;
  AvApp does the same).
- **D3:** render the server-served wording; no placeholders.
- **D4:** CI strictness per §6.
- **D5:** `react-markdown` with raw HTML off.

## 10. Two-lens review (preliminary; repeated on the diff)

**Architectural effect.**
- Three S2S calls on the plan 05 tier (read, identity, accept) plus a pinned, CI-verified copy
  of AvServ's text and wording.
- AvServ stays the system of record: no migration, no local acceptance table.
- `lib/avserv/request.ts` is extracted: seven call sites, and W2 reuses it.
- The portal display name stays the portal's own. The alert name is AvServ's (D1), so no shared
  assumption breaks.

**Execution effect.**
- New failure modes (AvServ unreachable, capture off, a stale pin) each surface to the user and
  to the logs/Sentry. Nothing queues.
- Browser-IP forwarding fails closed.
- The failover is optional (new env var, off by default).
- CI gains a network step (warn-only on PRs when unreachable).
- The build is unaffected while the pin is `null`.
- No Edge or public-route change. Login/MFA, P-B1, device link and SAR are untouched.
