# 36 — Account security and hardening (portal side of AvApp plans 54–57)

Status: **draft, 2026-10-17. Owner decisions (§8) open; S1 done in this PR.** Nothing else
here is built. AvApp merged plans 54 (App Lock), 55 (Second PIN), 56 (encryption across the
system) and 57 (false alarms) on 2026-10-17 (AvApp `21f9da3`, PR #288). This plan is the
portal's share of them, in the order the owner set. It was read against portal `origin/main`
`e1bc368`, AvServ `origin/main` `04510c8` and AvApp `origin/main` `21f9da3`.

**AvServ owns the contracts.** `device_revoke.md` and `security_events.md` (plan 54 §7.1–7.2)
and later `false_alarm_reports.md` (plan 57 §5) are **not yet written** in AvServ. The portal
builds against each one behind `AVSERV_BASE_URL=mock://` once its rev 1 lands, the same way
plan 32 built against `restrictions.md`. Nothing here edits AvServ or AvApp. §6 lists what to
ask AvServ for.

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
   heartbeats, and its armed check-out stays watched (plan 54 §7.1). The full 401 cut stays
   operator-only. The portal's copy says this plainly.
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
| **S3** | Scoped service-JWT kids, starting with a revoke key | 56 P4, 54 §7.1 | AvServ adds the kid and its scope |
| **S4** | Device revoke UI, security-events view, opt-in notices, passkeys then `MFA_ENFORCEMENT=all`, App Lock reset code | 54 §7, §4.6 | S2, S3; AvServ `device_revoke.md`, `security_events.md` |
| **S5** | Hardening: CSP, OAuth tokens, TOTP key id and replay, SAR payload, DB TLS and https, log IPs and phones, rotation table, Render | 56 P2, P5–P8 | — (portal only; Render is owner) |
| **S6 later** | `/report`, per-user block, SAR disposition and decline, false-alarm queue | 57 §2, §5 | AvServ plan 39 built; `false_alarm_reports.md`; counsel; DV advocate |

S2 and S5 need nothing from AvServ, so they can run in parallel with AvServ's contract work.

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
- Whether the Vercel **Development** env's `DATABASE_URL` still points at `vercel-dev`, which
  is a production fork with production data. `vercel env pull` would bring it back.

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

- **Ask AvServ** (§6) for a second kid, `svc-key-portal-device-admin-1`, scoped **only** to the
  new `device_admin` group (plan 54 §7.1). Its key pair is generated with the
  `svc-key-portal-1` procedure (runbook "AvServ service key").
- In the portal, `avservFetch` takes a `keyRole: "default" | "device_admin"`. Revoke, revoke
  preview, revoke-others and the App Lock reset code use `device_admin`; everything else stays
  `default`.
- New env triple: `AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64`, `…_KID` and `…_KEY_SHA256`, with
  the same build check as today's key (`scripts/check-service-key.ts`). It is added to
  `lib/env.ts`, `.env.example` and Vercel Production (an owner check).
- When the key is unset, revoke shows "unavailable" and reports to Sentry. It never falls back
  to the default key.
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
     way the erasure pages merge results. The `live[]` items are shown in plain words, and any
     kind the portal doesn't know is shown as "an open safety item" (rule 3: plan 55 §3.4's
     generic `held`).
  3. A reason: lost, stolen or "I don't use it".
  4. `POST …/revoke` to every node.
- **What the user is told** (rule 5, honest copy): "This phone can no longer see your trips or
  change your contacts. If it's still with you, it can still send Send Help, and any trip
  you've already started is still watched. To use it again, link it as a new phone."
- **Sign out all other phones** uses `revoke-others {keepDeviceId}`. The portal can't tell
  which phone is in the user's hand, so the user picks the one to keep. "None" waits on
  whether the contract allows it (§6).
- **Partial results** are loud: "Signed out on one server; the other didn't answer. It will
  catch up." The node is named in the log, there's a retry button, and the replication outbox
  is the backstop (plan 54 §7.1).
- The page also offers the S2 action, "Sign out every other browser".
- Each revoke writes a portal event (§3.3), and AvServ emits its own (§5.2).

### 5.2 Security-events view (`/settings/security`)

- It merges the AvServ feed (`security_events.md`, a cursor read from both nodes and
  deduplicated by event id, the `sar_feeds.md` pattern in `lib/avserv/sar-feeds.ts`) with
  `account_security_events`, newest first.
- AvServ kinds come from plan 54 §7.2: register, link, revoke, contact add, contact remove,
  cancel. The portal's Zod enum lists **only** those. An unknown kind is dropped and counted
  (`security_events.unknown_kind_dropped`, count only).
- Rows show what, when and which device, and never a contact's name or number. A removed
  contact must not be named to whoever reads the account.
- Needs recent login: the history itself is sensitive (rule 1).

### 5.3 Opt-in email notices

- A new column, `users.security_notices_at timestamptz null`, is off by default (rule 2).
  Turning it on or off needs recent login, and both are events.
- Content: "A security change happened on your AvAI account at <time>. Sign in to see what
  changed." No kind detail, no names, no device names. The inbox may be the abuser's, and a
  notice must not tip off a removed contact.
- Portal events notify as they happen. AvServ events notify from a cron that reads the feed
  cursor. On Vercel Hobby, crons run once a day, so the latency is a day until the planned move
  to Pro (memory: beta blocker plan; S-D8).
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
- AvServ issues the code, as it issues link codes today (`lib/avserv/client.ts:209-262`), using
  the `device_admin` kid. The endpoint is part of the §6 ask.
- Copy (§0 rule 8; counsel only if it becomes binding): "Entering this code on your phone
  starts the same 24-hour wait as 'Forgot PIN'. It never makes the wait shorter. Your real PIN
  still cancels it."
- Mint is rate limited in the portal: 3 per day per account. Link-code mint is rate limited the
  same way, because today it has no portal limit (`settings/actions.ts:24`). Minting a code is
  an event (§3.3).

### 5.6 Tests

- Mock-client tests for revoke, revoke preview, revoke-others and the reset code, including the
  generic rendering of an unknown preview kind.
- A merged feed with an unknown kind: it is dropped, and the log holds only a count.
- Every action needs recent login.
- Notices are off by default; turning them on or off needs recent login; the email has no
  detail.
- Passkey registration, authentication and the counter regression check (simplewebauthn test
  vectors).
- MFA disable needs the password.
- A Playwright mock spec: revoke flow and partial-node message.
- **A rule-3 guard test**: a repo scan fails if `duress`, `second pin` or `second_pin` appears
  in `app/`, `lib/` or `components/`.

## 6. Asks of AvServ (the owner relays; this PR edits nothing there)

1. **`docs/contracts/device_revoke.md` rev 1** (plan 54 §7.1):
   - the three endpoints;
   - preview `live[]` kinds as a closed list, with a generic `held` for anything the portal must
     not name;
   - whether `keepDeviceId` may be absent;
   - `410 device_revoked`;
   - `X-AvAI-Reader`;
   - the App Lock reset-code endpoint, plus the code's shape and TTL.
2. **`docs/contracts/security_events.md` rev 1** (§7.2):
   - kinds and fields, with event ids for deduplication across nodes;
   - the cursor;
   - retention;
   - a written guarantee that no duress event is ever emitted.
3. **Kid `svc-key-portal-device-admin-1`** in `AVSERV_SERVICE_KEYS`, with scope `device_admin`
   only.
4. **Later:** `false_alarm_reports.md` (plan 57 §5) and restrictions contract rev 2 (the new
   scopes and portal issuing).

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

## 8. Owner decisions

| ID | Question | Recommendation |
|---|---|---|
| S-D1 | Hashed-token cut-over | **Delete all sessions in the migration**: everyone signs in once (at most twice across the deploy gap). No dual-read code. |
| S-D2 | "Recent login" window | **10 minutes** for revoke, the reset code, MFA changes, the events view and the notice toggle. |
| S-D3 | Re-auth for Google-only accounts | **Google again with `prompt=login` and `max_age=0`.** If Google doesn't honour it on a test account, ask them to set a password first. |
| S-D4 | What the session list stores | **User agent only, no IP.** Rule 1 makes a location trail in the account a risk, not a help. |
| S-D5 | Passkey implementation | **SimpleWebAuthn as a second factor** beside TOTP, not Auth.js's experimental provider. Passwordless sign-in is a later, separate decision. |
| S-D6 | `MFA_ENFORCEMENT=all` for Google-only accounts | **Keep the P1.2 boundary** (not challenged). "All" means every password account. |
| S-D7 | SAR payload: encrypt or shorten | **Encrypt the three location and free-text fields**. Retention is already short (24 h for positions after close). |
| S-D8 | Notice latency for AvServ-origin events | **Daily on Hobby; 10 minutes after the Pro move.** Portal events go out immediately. |
| S-D9 | CSP rollout | **One week Report-Only, then enforce.** A nonce makes every HTML page dynamic, including the static public pages (S-D10). |
| S-D10 | Static public pages under a nonce CSP | **Accept dynamic rendering** (cost: no full-route cache; the pages stay DB-free, CLAUDE.md §3.7). The alternative is hash-based CSP with Next's experimental SRI. |
| S-D11 | Render site | **Suspend it** once a check shows nothing points there. |

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
| 2 | S2 schema + hashed adapter + `auth_time` + recent-auth helper (migration: prod before merge) | S-D1, S-D2, S-D4 |
| 3 | S2 `/settings/sessions` + revoke on password change + transactional reset + portal events table | PR 2 |
| 4 | H5 + H6 + H2 (small, independent) | — |
| 5 | H3 TOTP key id, re-encrypt script, last-step (migration) | — |
| 6 | H1 CSP Report-Only, then a one-line enforce PR | S-D9, S-D10 |
| 7 | S3 scoped kid in the portal | AvServ kid installed |
| 8 | S4 revoke UI + preview on the mock | PR 3, PR 7, `device_revoke.md` rev 1 |
| 9 | S4 security-events view + opt-in notices | PR 3, `security_events.md` rev 1 |
| 10 | S4 passkeys + password-to-disable (migration) | PR 2, S-D5 |
| 11 | S4 App Lock reset code + link-code rate limit | PR 8 |
| 12 | `MFA_ENFORCEMENT=all` (Vercel env, owner) | PR 10 shipped, S-D6 |
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
