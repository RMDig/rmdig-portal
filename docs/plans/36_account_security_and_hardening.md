# 36 — Account security and hardening (portal side of AvApp plans 54–57)

Status: **draft, 2026-10-17; owner decisions (§8) all decided 2026-10-18, as recommended.
S1 done (#161). AvServ contracts rev 1 written 2026-10-18 (§6).** Nothing else here is built. AvApp merged plans 54 (App Lock), 55 (Second PIN), 56 (encryption across the
system) and 57 (false alarms) on 2026-10-17 (AvApp `21f9da3`, PR #288). This plan is the
portal's share of them, in the order the owner set. It was read against portal `origin/main`
`e1bc368`, AvServ `origin/main` `04510c8` and AvApp `origin/main` `21f9da3`.

**AvServ owns the contracts.** `device_revoke.md` rev 1 and `security_events.md` rev 1
(2026-10-18) are in AvServ PR #299 (`061d4e2`). Both are **specified, not built**: AvServ
builds them in its plan 52 steps 3–4. The portal builds against them behind
`AVSERV_BASE_URL=mock://`, the same way plan 32 built against `restrictions.md`.
`false_alarm_reports.md` (plan 57 §5) comes later. Nothing here edits AvServ or AvApp. §6 has
the contract facts the portal depends on.

## 0. Rules

Owner, 2026-10-17:

1. **An abuser may control a user's email or portal login.** Plan every feature assuming the
   person signed in may not be the account's owner.
2. **So security notices are opt-in and off by default** (plan 54 D11).
3. **Duress state never appears in the portal.** Not in the security-events view, an export, an
   erasure preview, a log line or Sentry (plan 55 rule 4, §3.4). The portal has no word for
   it: no schema, enum value, label or string.
4. **A complainant never learns any outcome** (plan 57 rule 4).

Carried from the plans and CLAUDE.md:

5. **A user revoke never cuts the safety net.** A revoked phone still sends Send Help and
   heartbeats, can start a new check-out, and its armed check-out stays watched (plan 54 §7.1;
   `device_revoke.md` §2, §6). It **can't check in**, so a trip started on it alerts unless the
   user checks in from another linked device (§4 of the contract; AvApp D9). The portal's copy
   says all of this plainly. **Amended 2026-10-18** (AvServ plan 52 D3): the operator ban no
   longer cuts Send Help or the heartbeat either. It stays operator-only and is still the wider
   cut, but it is not a "full 401", and nothing in the portal can call it.
6. **No restriction or report ever blocks a safety action** (plan 57 rule 1; restrictions
   contract tie-breaker). The portal never decides misuse automatically.
7. **Fail loud, except where silence is the safety behaviour.** Every failure here is visible
   to the user and in Sentry. The single exception is rule 3: an unknown event kind from
   AvServ is dropped, and only a count is logged, never its name.
8. CLAUDE.md §0 applies to the reset code, `/report`, and every notice or public copy. Counsel
   writes any binding text.

## 1. Order

| Step | Items | Plan 56 / 54 / 57 ref | Waits on |
|---|---|---|---|
| **S1 now** | Local dev off the production DB | 56 P1 | — (**done, §2**) |
| **S2** | Sessions: list, revoke one or all, revoke on password change, hashed tokens, `auth_time` | 56 P3 | — (portal only) |
| **S3** | Scoped service-JWT kids, starting with a revoke key | 56 P4, 54 §7.1 | Built on the mock now; AvServ installs the kid after its revoke build ships on both nodes |
| **S4** | Device revoke UI, security-events view, opt-in notices, passkeys then `MFA_ENFORCEMENT=all`, App Lock reset code | 54 §7, §4.6 | S2, S3; built on the mock against the rev 1 contracts; live once AvServ plan 52 ships |
| **S5** | Hardening: CSP, OAuth tokens, TOTP key id and replay, SAR payload, DB TLS and https, log IPs and phones, rotation table, Render | 56 P2, P5–P8 | — (portal only; Render is owner) |
| **S6 later** | `/report`, per-user block, SAR disposition and decline, false-alarm queue | 57 §2, §5 | AvServ plan 39 built; `false_alarm_reports.md`; counsel; DV advocate |

S2 and S5 need nothing from AvServ. S3 and S4 now have their contracts, so they can be built on
the mock in parallel with AvServ's build.

## 2. S1 — local dev off production (done 2026-10-17)

Finding (56 P1), confirmed: `.env.local` `DATABASE_URL` reached the **production** branch
(`ep-crimson-thunder-…`), and `DATABASE_URL_UNPOOLED` reached `vercel-dev`, CI's E2E parent.
`drizzle.config.ts` reads `DATABASE_URL`, so a local `pnpm db:migrate` would have migrated
production, and a local `pnpm dev` wrote to it.

Done:

- Created a new branch, `local-dev` (`br-winter-tree-b7n0wvvl`), in the **preview** project
  `rmdig-portal-preview`, forked from `preview-seed`. It holds test personas and no production
  data, and it is migrated to 27/27.
- Repointed both `.env.local` URLs at `local-dev` (on the owner's machine; not in git).
- Documented it in [infrastructure.md](../infrastructure.md) "Local development database":
  refreshing the URLs, migrating, resetting, the host check, and "don't `vercel env pull`".

Owner checks:

- Any other machine or checkout with an old `.env.local`.
- **Checked 2026-10-18: the Vercel Development env's `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED` point at `vercel-dev`** (`ep-rough-pond-…`). That's a branch of the
  production project, last reset from production on 2026-07-25. Today it holds one user row (the
  owner's own) and 11 of 27 migrations, so there is no third-party data yet.
  - The risk is a future reset: the runbook resets `vercel-dev` from production when migration
    history drifts. That would copy all production data into the Development env, into CI's
    e2e parent (`ci.yml:152`), and into any `vercel env pull`.
  - **Proposed (owner to approve):** point Vercel Development at `local-dev`. Move CI's e2e
    parent off `vercel-dev` (to an empty-schema branch, or to the preview project) before
    `vercel-dev` is ever reset again.

## 3. S2 — sessions (before any per-device revoke)

Today:

- Sessions are Auth.js DB rows, `sessions(sessionToken PK, userId, expires)` at
  `lib/db/schema.ts:111`. The token is stored raw.
- The adapter looks rows up by exact token (`@auth/drizzle-adapter` `pg.js:110-162`).
- The credentials path mints its own row in the `jwt.encode` override (`lib/auth.ts:48-73`).
- Changing the password keeps every other session, on purpose (`settings/account-actions.ts:116`).
- A password reset deletes all sessions, but not in one transaction with the new hash
  (`(auth)/actions.ts:460-469`).
- There is no session list, and no timestamp to judge "recent login".

### 3.1 Schema (one migration)

`sessions` gains these columns:

- `id uuid default gen_random_uuid() unique`: the handle the UI and revoke use, so no token or
  hash ever reaches the browser.
- `created_at timestamptz default now()`.
- `auth_time timestamptz`: when this session last proved the password plus a second factor, or
  a passkey, or a Google sign-in.
- `last_seen_at timestamptz`, written at the existing 24 h `updateAge`.
- `user_agent text`, truncated to 200 characters, so the list can say "Safari on iPhone".

No IP is stored (§8 S-D4). `sessionToken` keeps its name and holds `sha256(token)` hex from
now on.

### 3.2 Hashed tokens

- `lib/auth/session-adapter.ts` wraps the Drizzle adapter's `createSession`,
  `getSessionAndUser`, `updateSession` and `deleteSession`: it hashes the incoming token, and
  `createSession` still returns the **raw** token, because core sets the cookie from it.
- The `jwt.encode` override goes through the wrapped adapter.
- This uses the same hashing as `lib/auth/reset-tokens.ts`: SHA-256, because the token is
  high-entropy and random.

Cut-over: the migration deletes every session row, so everyone signs in once more (S-D1). That
is honest and leaves no dual-read path. Because migrations run on production before the merge
(CLAUDE.md §3.8), sessions created between the migration and the deploy are raw and fail after
the deploy, which means a second sign-in at most. Run the migration right before the merge.

### 3.3 What ships

1. **`/settings/sessions`**: one row per session, showing device, browser, signed in, last
   active, and "this browser". It has **Sign out** per row and **Sign out everywhere else**.
   Both need a recent login (§3.4).
2. **Password change revokes every other session.** The comment at `account-actions.ts:116`
   inverts. A reset deletes the sessions and sets the new hash in one transaction.
3. **MFA disable or regenerate, passkey removal, and any revoke** also sign out every other
   session.
4. **Portal security events**: a new append-only table, `account_security_events(id, user_id,
   kind, at, session_id?)`. Its kinds are `password_changed`, `password_reset`, `mfa_enabled`,
   `mfa_disabled`, `recovery_codes_regenerated`, `passkey_added`, `passkey_removed`,
   `session_revoked`, `sessions_revoked_others`, `notices_on` and `notices_off`. It stores no
   free text and no IP. It is the portal half of the §5.2 view.

### 3.4 Recent login

`requireRecentAuth(maxAgeSec)` in `lib/auth/recent-auth.ts` reads the current session's
`auth_time` (S-D2 proposes 10 minutes). When it is stale, the action returns
`{reauth: true}` and the UI opens `/reauth?returnTo=…`.

- Password accounts re-enter the password plus TOTP or a passkey (`verifyActorPassword`'s
  rate limit, `admin/team/actions.ts:42`).
- Google-only accounts redo Google sign-in with `prompt=login` and `max_age` (S-D3).

`auth_time` is set when a session is created and when re-authentication succeeds, never when
a session is merely refreshed. The `admin/team` password re-entry moves onto this helper.

### 3.5 Tests

- Adapter wrapper: stores the hash, returns the raw token, and looks up or deletes by hash.
- Revoke one or all: only the user's own rows are affected; another user's session id is
  refused.
- Password change: other sessions gone, this one kept.
- Reset is transactional.
- `requireRecentAuth`: fresh, stale and missing `auth_time`.
- A Playwright mock spec covers sign-in, the session list, signing out the other session, and
  that session getting the sign-in page.

## 4. S3 — scoped service keys

Today one Ed25519 key with kid `svc-key-portal-1` signs every call (`lib/avserv/request.ts:73`).
AvServ already supports per-kid route groups through `AVSERV_SERVICE_KEY_SCOPES` (AvServ
`config.go:1182-1196`). The portal is the side that doesn't separate its keys.

- A second kid, `svc-key-portal-device-admin-1`, scoped **only** to `device_admin`
  (`device_revoke.md` §3.1).
  - AvServ's doctor FAILs a node where `device_admin` is held with another group or by two
    keys.
  - The install steps are in the AvServ runbook, "Portal device-admin key". AvServ installs it
    **after its revoke build ships on both nodes**.
  - The key pair is generated with the `svc-key-portal-1` procedure (portal runbook "AvServ
    service key").
- **Security events are read with the everyday key** `svc-key-portal-1`, which AvServ grants the
  new read-only group `security_events` (`security_events.md` §5). The revoke key isn't used
  to read.
- In the portal, `avservFetch` takes a `keyRole: "default" | "device_admin"`. Revoke, revoke
  preview, revoke-others and the App Lock reset code use `device_admin`; everything else stays
  `default`.
- New env triple: `AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64`, `…_KID` and `…_KEY_SHA256`, with
  the same build check as today's key (`scripts/check-service-key.ts`). It is added to
  `lib/env.ts`, `.env.example` and Vercel Production (an owner check).
- When the key is unset, or a node answers `403 path_not_allowed` or `503
  device_admin_unavailable`, revoke shows "unavailable" and reports to Sentry. It never falls
  back to the default key.
- Later, one kid per remaining group (`sar_ack`, `account_lookup`, `sar_feed`) as each is next
  touched. This needs no new design.

Tests: each client sends its role's kid; a missing `device_admin` key fails loud and never
signs with the default key.

## 5. S4 — plan 54 §7 in the portal

### 5.1 Revoke on `settings/devices`

`DevicesList` is read-only today (`settings/devices/DevicesList.tsx:12-15`, "needs a separate
AvServ write endpoint"). It gains:

- **Sign out this phone**, per device:
  1. Recent login (§3.4).
  2. The **revoke preview**: `GET …/devices/{id}/revoke-preview` on **every node**, merged the
     way the erasure pages merge results (contract §3.2).
     - `live[]` is **informational**: it never blocks a revoke, and the revoke cuts none of
       it. The portal says "this stays watched".
     - Kinds are a closed list: `checkout` ("a trip you've started"), `help_request` ("an open
       Send Help"), and `held`. `held`, and any kind the portal doesn't know, are shown as "an
       open safety item" (rule 3).
     - `revoked: true` on a node means it's already signed out there.
  3. A reason: lost, stolen or "I don't use it" (`lost` / `stolen` / `user`).
  4. `POST …/revoke` to every node. There is no 409: live state never blocks it.
- **What the user is told** (rule 5, honest copy):
  > This phone can no longer see your trips or change your contacts. If it's still with you,
  > it can still send Send Help and start a new trip, and any trip already started on it is
  > still watched. **It can't check in.** If a trip on it is under way, check in from another
  > linked phone, or your contact will be alerted. To use the phone again, link it as a new
  > phone.

  The contract's §4 makes the cost explicit: an abuser who holds the portal login can force a
  false alert by revoking the victim's phone. The owner accepted this on 2026-10-18 (AvServ
  plan 52 D1). The copy says so where the abuse is possible, in Settings help, not as a threat
  on the button.
- **Sign out all other phones** uses `revoke-others {keepDeviceId, reason}`.
  - `keepDeviceId` is **always sent**. The user picks the phone to keep, or **None**, which
    sends `null` and revokes them all. An absent field is a 400, so "none" is always
    deliberate.
  - The kept phone is checked first on each node. `404 device_not_found` (not replicated
    there yet) or `409 keep_device_revoked` revokes **nothing on that node**. The portal shows
    it as that node's result and offers a retry.
  - Each node revokes only the devices it knows at the time of the call, so every node is
    called.
- **Per-node results, retries and timeouts** (contract §3.3):
  - Every node is called, and each node's answer is shown.
  - One success reaches the rest by replication. A node that didn't answer is a **partial
    result**: "Signed out on one server; the other didn't answer. It will catch up." There's a
    retry button.
  - A timeout is **unknown, not failed**. Re-POSTing is safe: a repeat answers 200 with
    `alreadyRevoked: true` and the original `revokedAt` and `reason`.
  - A `404` on one node may mean the phone hasn't replicated there yet. It's shown as
    "not there yet", with a retry.
- **The node window** (contract §4): a node that hasn't applied the revoke still accepts a
  check-in from the phone. Calling every node narrows the window but can't close it. The plan
  says so; the UI doesn't need to.
- The page also offers the S2 action, "Sign out every other browser".
- Each revoke writes a portal event (§3.3), and AvServ emits its own (§5.2).

### 5.2 Security-events view (`/settings/security`)

- It merges the AvServ feed with `account_security_events`, newest first.
  - Feed: `GET …/accounts/{id}/security-events?cursor=&limit=`, read from **every node**
    (`security_events.md` §4; the `sar_feeds.md` pattern in `lib/avserv/sar-feeds.ts`).
  - Each node is oldest-first with its own opaque cursor. `nextCursor: null` means nothing
    newer yet, so the portal keeps the last non-null cursor.
  - Events dedupe on `id`, which is a UUIDv5 of the action, the same on both nodes. The
    **earliest** `at` wins.
  - A node that doesn't answer makes the list "may be incomplete", said on the page.
- Kinds are the contract's closed list: `register`, `link`, `revoke`, `contact_add`,
  `contact_remove`, `cancel`.
  - The portal's Zod enum lists **only** those.
  - An unknown kind is dropped and counted (`security_events.unknown_kind_dropped`, count
    only; rule 3).
  - AvServ guarantees no duress event, field, ordering, gap or timing, ever (contract §2).
- Rows show what, when and which device. The feed carries no contact names, numbers, emails or
  locations, and the portal adds none. A removed contact must not be named to whoever reads
  the account.
- Reader header: `X-AvAI-Reader: portal-user:<id>`. Every read is logged on the node.
- Needs recent login: the history itself is sensitive (rule 1).

### 5.3 Opt-in email notices

- A new column, `users.security_notices_at timestamptz null`, is off by default (rule 2).
  Turning it on or off needs recent login, and both are events.
- Content: "A security change happened on your AvAI account at <time>. Sign in to see what
  changed." No kind detail, no names, no device names. The inbox may be the abuser's, and a
  notice must not tip off a removed contact.
- Portal events notify as they happen.
- AvServ events notify from a cron that reads each opted-in account's feed from every node.
  - It reads from the last cursor, kept per account and node in a new table,
    `security_notice_cursors(user_id, node, cursor, updated_at)`.
  - It uses reader `portal-user:automation:security-notices` (contract §5).
  - On Vercel Hobby crons run once a day, so the latency is a day until the planned move to Pro
    (S-D8).
  - Turning notices on starts from the current end of each feed, so no backlog is emailed.
- A template in `lib/email/templates/`, added to the legal-copy scan.

### 5.4 Passkeys (WebAuthn), then `MFA_ENFORCEMENT=all`

- **`@simplewebauthn/server` and `/browser` as a second factor beside TOTP** (S-D5). This
  avoids Auth.js's experimental passkey provider, and it slots into the existing
  credentials-challenge flow (`credentials-authorize.ts:115-134`).
- New table: `webauthn_credentials(id, user_id, credential_id unique, public_key, counter,
  transports, nickname, created_at, last_used_at)`. The RP ID is `rmdig.ai`, the canonical host;
  `app.`/`www.` 308 there.
- A passkey satisfies the second factor at sign-in, in re-auth (§3.4) and in the MFA gate.
  The counter is checked, and a regression is refused and reported.
- **Disabling MFA needs the password** as well as a factor (56 P6). Google-only accounts need a
  recent Google re-login instead.
- **Then `MFA_ENFORCEMENT=all`**, a Vercel env change by the owner (00_status §1 already plans it
  at launch).
  - Google-only accounts keep the P1.2 boundary: Google's own 2FA covers them, and they're not
    challenged (S-D6).
  - Before flipping it, check how many password accounts have no factor, so nobody is locked
    out at the flip: they get the enrol page on their next visit, not a refusal.

### 5.5 App Lock PIN reset code (plan 54 §4.6, D2)

- **Get an App Lock reset code**, per device. It needs recent login, and the account must have
  MFA or a passkey.
- AvServ issues the code (`device_revoke.md` §3.5):
  `POST …/accounts/{id}/devices/{deviceId}/app-lock-reset-codes`, using the `device_admin` kid.
  - The code is 8 characters in the link-code alphabet, has a 10-minute TTL, is single use and
    bound to that device, and is stored hashed on AvServ.
  - The portal shows it **once** and never stores or logs it.
  - Call one node, and the other on a timeout or 503. Two live codes are harmless.
  - `409 device_revoked` means a revoked phone has no App Lock to reset. `429 rate_limited`
    (AvServ backstop: 3 per device and 5 per account a day, per node) shows its `Retry-After`.
- Copy (§0 rule 8; counsel only if it becomes binding): "Entering this code on your phone
  starts the same 24-hour wait as 'Forgot PIN'. It never makes the wait shorter. Your real PIN
  still cancels it."
- Mint is rate limited in the portal: 3 per day per account. Link-code mint is rate limited the
  same way, because today it has no portal limit (`settings/actions.ts:24`). Minting a code is
  an event (§3.3).

### 5.6 Tests

- Mock-client tests for revoke, revoke preview, revoke-others and the reset code:
  - the generic rendering of `held` and of an unknown preview kind;
  - `alreadyRevoked` repeats;
  - `keepDeviceId: null` always sent for "None";
  - `409 keep_device_revoked` and `404` shown per node;
  - a timeout retried;
  - `400 reader_required` never reached (the header is always set).
- A merged feed: dedupe by `id` keeping the earliest `at`; per-node cursors kept apart; an
  unknown kind dropped with a count-only log; one node down shown as incomplete.
- The revoke copy names check-in from the revoked phone as refused.
- Every action needs recent login.
- Notices are off by default; turning them on or off needs recent login; the email has no
  detail.
- Passkey registration, authentication and the counter regression check (simplewebauthn test
  vectors).
- MFA disable needs the password.
- A Playwright mock spec: revoke flow and partial-node message.
- **A rule-3 guard test**: a repo scan fails if `duress`, `second pin` or `second_pin` appears
  in `app/`, `lib/` or `components/`.

## 6. AvServ contracts (rev 1, 2026-10-18; AvServ PR #299, `061d4e2`)

Answered, specified and not built. AvServ plan 52 builds them: step 3 is the revoke and reset
code, step 4 is security events.

1. **`docs/contracts/device_revoke.md` rev 1.** The facts the portal builds on are in §5.1 and
   §5.5:
   - routes in group `device_admin`;
   - closed preview kinds (`checkout`, `help_request`, `held`);
   - `keepDeviceId` required, nullable;
   - per-node answers, `alreadyRevoked` repeats, and timeouts that are safe to retry;
   - `410 device_revoked` for the app;
   - `X-AvAI-Reader` required;
   - the reset code (§3.5).
2. **`docs/contracts/security_events.md` rev 1** (§5.2–5.3 above):
   - six kinds;
   - UUIDv5 ids;
   - a per-node cursor;
   - the everyday key plus `security_events`;
   - no duress, ever.

   Retention (proposed 400 days, held while live) and erasure (rev 1 default: deleted with the
   account) are **[COUNSEL]**.
3. **Kid `svc-key-portal-device-admin-1`.** Its install steps are in the AvServ runbook
   ("Portal device-admin key"). It's installed after the revoke build ships on both nodes.
4. **Still open on AvServ's side:** hashing link codes at rest and an AvServ-side mint limit
   (AvServ plan 52 §3.7, D14, open with the owner). The portal's own mint limit (§5.5) doesn't
   wait on it.
5. **Later:** `false_alarm_reports.md` (plan 57 §5) and restrictions contract rev 2.

**Portal data in the same scope.** `account_security_events` and `security_notice_cursors` are
deleted with the portal user (`ON DELETE CASCADE`), which matches the contract's rev 1 erasure
default. The runbook's deletion steps name them once they exist.

## 7. S5 — hardening

| # | Item (56 ref) | Change | Tests |
|---|---|---|---|
| H1 | **Nonce-based CSP** (P2, beta blocker B6) | `middleware.ts` (Edge, no `lib/env`, CLAUDE.md §3.6) makes a per-request nonce and sets `script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src 'self'` plus the MapTiler hosts, `tile.openstreetmap.org` and the Sentry ingest host, `worker-src 'self' blob:`, `img-src 'self' data: blob:` plus the tile hosts, `style-src 'self' 'unsafe-inline'` (16 inline `style=` uses and MapLibre). JSON-LD blocks are data, not script. Ship **Report-Only for a week** with reports to Sentry, then enforce. The maintenance 503 page sets its own policy. | Header unit test per route class; a Playwright check that `/map` renders with no CSP violation |
| H2 | OAuth tokens (P5) | The adapter wrapper's `linkAccount` drops `access_token`, `refresh_token` and `id_token`, since nothing reads them (`lib/auth.ts:13,26` only). A migration nulls the existing ones. | Wrapper strips; sign-in still works |
| H3 | TOTP key id and replay (P5) | Format `v1:<kid>:<iv>:<tag>:<ct>`. `MFA_ENCRYPTION_KEYS` is packed `kid:hex` (the current key becomes kid `k1`, and the old 3-part format reads as `k1`). `pnpm mfa:reencrypt` moves every row to the newest kid. A `users.totp_last_step` column is updated atomically on use, refusing any step ≤ last. | Round-trip per kid; legacy read; re-encrypt; replay in the same window refused |
| H4 | SAR intake payload (P5) | **Encrypt `lastFix`, `plannedRoute` and `note` inside the jsonb** with the H3 helper and its own kid (S-D7). Retention stays as it is (positions nulled 24 h after the alert ends, rows gone at 90 days, `lib/sar/retention.ts`). | Intake stores ciphertext; the alerts page shows plaintext; retention still nulls |
| H5 | DB TLS, https (P7) | `ssl: 'require'` in `lib/db/index.ts`. `AVSERV_BASE_URL` and the failover URL accept only `https://` or `mock://` (`lib/env.ts:80,97`). | Env schema rejects `http://` |
| H6 | Logs (P7) | IPs are HMAC-pseudonymised like emails, under a new `LOG_PSEUDONYM_KEY`, so `NEXTAUTH_SECRET` stops keying pseudonyms and phone proofs. Raw IPs, emails and phones also come out of `rate_limits.key` (hashed). Phone fields join the redact list, and `lib/sentry-scrub.ts` masks phones and IPs. | Redact and scrub cases |
| H7 | One rotation table (P7) | The runbook gains "Key rotation": every key, cadence, procedure, last rotated, and what rotating it breaks (e.g. `NEXTAUTH_SECRET` voids open phone proofs until H6). It adds the missing entries for `MFA_ENCRYPTION_KEYS` (after H3), `CRON_SECRET`, Twilio and the age key. | Docs |
| H8 | Old Render site (P8) | **Still live on 2026-10-17**: `rmdig-ai.onrender.com` answers 200 with no security headers, and its old `/collection_signup` form still serves. Owner: confirm nothing links there, then suspend the Render service. | Owner check |

## 8. Owner decisions (all decided 2026-10-18)

| ID | Question | Decision |
|---|---|---|
| S-D1 | Hashed-token cut-over | **Decided (owner, 2026-10-18):** **Delete all sessions in the migration**: everyone signs in once (at most twice across the deploy gap). No dual-read code. |
| S-D2 | "Recent login" window | **Decided (owner, 2026-10-18):** **10 minutes** for revoke, the reset code, MFA changes, the events view and the notice toggle. |
| S-D3 | Re-auth for Google-only accounts | **Decided (owner, 2026-10-18):** **Google again with `prompt=login` and `max_age=0`.** If Google doesn't honour it on a test account, ask them to set a password first. |
| S-D4 | What the session list stores | **Decided (owner, 2026-10-18):** **User agent only, no IP.** Rule 1 makes a location trail in the account a risk, not a help. |
| S-D5 | Passkey implementation | **Decided (owner, 2026-10-18):** **SimpleWebAuthn as a second factor** beside TOTP, not Auth.js's experimental provider. Passwordless sign-in is a later, separate decision. |
| S-D6 | `MFA_ENFORCEMENT=all` for Google-only accounts | **Decided (owner, 2026-10-18):** **Keep the P1.2 boundary** (not challenged). "All" means every password account. |
| S-D7 | SAR payload: encrypt or shorten | **Decided (owner, 2026-10-18):** **Encrypt the three location and free-text fields**. Retention is already short (24 h for positions after close). |
| S-D8 | Notice latency for AvServ-origin events | **Decided (owner, 2026-10-18):** **Daily on Hobby; 10 minutes after the Pro move.** Portal events go out immediately. |
| S-D9 | CSP rollout | **Decided (owner, 2026-10-18):** **One week Report-Only, then enforce.** A nonce makes every HTML page dynamic, including the static public pages (S-D10). |
| S-D10 | Static public pages under a nonce CSP | **Decided (owner, 2026-10-18):** **Accept dynamic rendering** (cost: no full-route cache; the pages stay DB-free, CLAUDE.md §3.7). The alternative is hash-based CSP with Next's experimental SRI. |
| S-D11 | Render site | **Decided (owner, 2026-10-18):** **Suspend it** once a check shows nothing points there. |

## 9. S6 — plan 57, later

Gate: AvServ plan 39 (restrictions) built, `false_alarm_reports.md` rev 1, counsel (plan 57
§6), DV-advocate review shared with plan 55 G5. Shape only, so the later plan starts from the
rules:

- **`/report`** (public, CLAUDE.md §3.7: no auth, no `lib/auth`).
  - Phone plus a Twilio Verify code. Verify is Production-only today and is used only by
    signed-in flows (`app/(portal)/phone-verify-actions.ts`), so a public flow needs its own
    limits: per IP, per phone and per day.
  - The answer is **the same whether or not that number received an alert**, with the same
    timing.
  - After the code: that phone's own received alerts by date and type only. "This didn't look
    right", with a note that stays in the portal, plus **Stop alerts from this person** (the
    per-user block, sent to AvServ).
  - The complainant learns nothing back (rule 4). It goes on the maintenance stays-up list.
- **SAR disposition** (`real`, `no_incident`, `misuse_suspected`, plus a note) and **decline
  future dispatch from a user**, in `/sar/[orgId]/alerts`.
  - These are org-level actions for team admins only, not one volunteer.
  - They use a new S2S call, so the ack keeps meaning "received".
- **`admin/false-alarm-queue`** for human review only. A named operator, plus a second reviewer
  for any restriction (plan 57 §3.3). It never shows a reporter's identity or a duress-linked
  item (rules 3–4). Issuing a restriction from it waits for restrictions rev 2.

## 10. PRs

| PR | Contents | Waits on |
|---|---|---|
| 1 | **This plan**, the S1 infrastructure doc, `00_status` row | — |
| 2 | S2 schema + hashed adapter + `auth_time` + recent-auth helper (migration: prod before merge) | — |
| 3 | S2 `/settings/sessions` + revoke on password change + transactional reset + portal events table | PR 2 |
| 4 | H5 + H6 + H2 (small, independent) | — |
| 5 | H3 TOTP key id, re-encrypt script, last-step (migration) | — |
| 6 | H1 CSP Report-Only, then a one-line enforce PR | — |
| 7 | S3 scoped kid in the portal (mock first) | Live: AvServ installs the kid after its revoke build |
| 8 | S4 revoke UI + preview on the mock | PR 3, PR 7 (contract rev 1 ✅) |
| 9 | S4 security-events view + opt-in notices (migration: cursors table) | PR 3 (contract rev 1 ✅) |
| 10 | S4 passkeys + password-to-disable (migration) | PR 2 |
| 11 | S4 App Lock reset code + link-code rate limit | PR 8 |
| 12 | `MFA_ENFORCEMENT=all` (Vercel env, owner) | PR 10 shipped |
| 13 | H4 SAR payload encryption, H7 rotation table | PR 5 |
| — | S6 (plan 57) | §9 gates |

## 11. Owner checks (not verifiable from the repo)

- Vercel: the Development env `DATABASE_URL` (§2); new env vars in Production (§4, H3, H6);
  the `MFA_ENFORCEMENT` flip; cron frequency (S-D8).
- Production headers after H1. On 2026-10-17, `curl -I https://rmdig.ai/` shows the baseline
  CSP, HSTS with preload, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions
  policies. HSTS preload **registration** at hstspreload.org.
- Neon: encryption at rest, PITR window and enforced TLS for both projects; that `local-dev`
  stays in the preview project.
- Sentry: "Prevent storing IP addresses" and server-side scrubbing on the portal project.
- Google: that `prompt=login` / `max_age` forces a fresh sign-in (S-D3).
- Twilio: Verify on a public route, and its fraud guard (Verify Fraud Guard / geo permissions)
  before `/report`.
- Render: whether `rmdig-flask` still runs and anything links to it (H8).
