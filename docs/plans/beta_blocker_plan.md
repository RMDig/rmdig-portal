# Beta blocker plan

Status: **open**. Written 2026-10-07 from a seven-lens, read-only audit of
`origin/main`: portal `226fc41`, AvServ `1c0157f`, AvApp `0aff5a0`.

The seven lenses were CI/CD, resilience, testing, security, observability,
data and privacy, and the contracts between services.

Full report (private artifact): https://claude.ai/artifact/Jkh1A8NmbFqweQ7q6NkiNe

This file is the working plan. Each **workstream** (W1–W7) is sized for one
Claude Code session in its own worktree, and is mostly disjoint from the others
so they can run in parallel. A session picks up one workstream: it reads this
file plus the repo's `CLAUDE.md`, then works through the items. When it is done,
it ticks the boxes here.

Line numbers are approximate (`≈`) and were taken at the SHAs above. Re-locate
them before editing.

**Tags**

- `re-checked`: confirmed a second time by reading the code directly during the
  audit.
- `§0`: touches SAR approval, public safety copy, or legal and privacy text.
  Confirm with the owner and counsel before shipping, per CLAUDE.md §0.

---

## 1. Blockers (must be fixed, or explicitly accepted, before real users)

| ID | Finding | Repo | Workstream |
|---|---|---|---|
| B1 | **Account takeover through Google sign-in.** An attacker signs up with the victim's email and their own password, and the row stays unverified. The victim later signs in with Google. `allowDangerousEmailAccountLinking` links Google into that row, and the `signIn` callback marks it verified, so the attacker's password now passes `authorize`. Code: `lib/auth.ts:109`, `≈225-235`. `re-checked` | portal | W1 |
| B2 | **An alert SMS counts as delivered once Twilio accepts it.** `dispatch.go:≈280` sets `Delivered=true` on a Twilio 2xx. A later `failed`/`undelivered` status callback is only logged (`internal/api/twilio.go:≈181`), and the peer skips the window once that "delivery" replicates. Plan 42a §1 already names this defect. `re-checked` | AvServ | W3 |
| B3 | **The published retention is not enforced.** `/privacy` says check-outs are kept "about 90 days" and heartbeat data "7 days". AvServ purges only `data_share_log` (`internal/config/retention.go`). These tables are never purged: `checkouts` (which holds `last_location` and `contact_phone`), `incidents`, `help_requests`, `alert_ledger`, `outbox`, `twilio_inbound_events`, and the device heartbeat. Backups also outlive the stated 30 days (`deploy/backup/backup.sh:≈67`, `mirror.sh:≈40`). `re-checked` `§0` | AvServ | W5 |
| B4 | **A deletion request can't be carried out on AvServ.** There is no account-erasure route and no runbook procedure. The append-only triggers on `account_identity_change` and `agreement_acceptance` refer to an "audited purge" that doesn't exist (`migrations/0026_account_agreement.up.sql:≈97-111`). A foreign key with no cascade blocks deleting the `account` row. The CPA 45-day clock applies. `§0` | AvServ | W5 |
| B5 | **Binding legal text is still placeholders.** Terms has 11 `[LAWYER]` blocks. Privacy lacks the CPA appeal process, the COPPA clause and a mailing address. The agreement pin is `null`. | portal | Human (counsel) |
| B6 | **The portal ships framework versions with critical advisories.** `pnpm audit --prod` shows 7 critical and 33 high. `next 16.2.6` has RCE advisories in next/og `ImageResponse` (used by `app/opengraph-image.tsx`) and in the image optimizer. `next-auth 5.0.0-beta.31` has an advisory that auth can fail open on configuration errors. `maplibre-gl` has an XSS. There is no CSP (`next.config.ts:≈8-21`). `re-checked` | portal | W1 |
| B7 | **Anyone who knows a device ID can get tokens for it.** `POST /v1/auth/device-register` is unauthenticated (`internal/api/router.go:107`). For an existing device it mints fresh tokens for `req.DeviceID`, and attestation is never checked. The ID is shown in full on `/settings/devices` (`DevicesList.tsx:≈48`) and logged by AvServ. Holding it lets someone read location and contacts, or cancel a check-out, which suppresses the overdue alert. | AvServ (+ portal UI) | W4 |

## 2. High priority

| ID | Finding | Repo | Workstream |
|---|---|---|---|
| H1 | The portal's vitest suite (1,010 tests, about 12s) never runs in CI, including the §0 copy scan. The required checks aren't strict. `@vitest/coverage-v8` isn't installed. `re-checked` | portal | W1 |
| H2 | SAR team emails can be lost silently. `lib/sar/intake-handler.ts` answers 200 even if `notifyMembers` throws, and failures only reach pino. When both nodes post at once, the insert-then-count check (`≈141-148`) can see two rows in both handlers, so neither emails. `re-checked` | portal | W2 |
| H3 | AvServ has no paging rule for an alert that is still failing. Rules are missing for `alert_sms_delivery_total{undelivered\|failed}`, `alert_channel_total{failed}`, `sms_dead_path_total` and `watchdog_dispatch_panics_total`. Alertmanager has no dead-man's switch. | AvServ | W3 |
| H4 | The portal's only push alert is UptimeRobot on `/readyz`. The crons (sar-retention, patrol-reverify, and the `CRON_SECRET`-unset path) only log errors, with no Sentry report and no monitor that alerts when a cron stops running. There is no log drain. The CPA 45-day clock only appears on the admin pages. | portal | W2 |
| H5 | Single points of failure: one Twilio Messaging Service and one A2P campaign, one human on call, and the drills not run (clock-skew, dead-canary, avalanche, incident rehearsal). | ops | Human + W3 |
| H6 | AvServ is on Go 1.23, which no longer gets security fixes (`go.mod`, both Dockerfiles). `re-checked` | AvServ | W4 |
| H7 | AvServ and AvApp have no branch protection. AvServ deploys signed tags without checking CI. `cancel-in-progress` also applies to main pushes. CI runs without `-race`. | AvServ | W4 |
| H8 | AvApp release builds depend on hand-typed `--dart-define`s: research mode and the heading-out notice must be off, onboarding on, and the Sentry DSN set. There is no release script and no debug-symbol upload. | AvApp | W6 |
| H9 | AvApp has no in-app path to account deletion (App Store guideline 5.1.1(v)). iOS Settings links to `rmdig.ai/contribute`, which returns 404 (that page is only on PR #89). `re-checked` | AvApp + portal | W6 (+ decision) |
| H10 | `/privacy` doesn't match `PrivacyInfo.xcprivacy`. It claims photos, which aren't declared. It omits the name, the device ID, diagnostics, crash data, the Send Help note and MapTiler. AvServ also serves a second, divergent policy at `/legal/privacy` and `/legal/terms`. `re-checked` `§0` | portal + AvServ | W5 (AvServ side) + Human |
| H11 | The contact SMS consent line promises "automatic accident alerts", which no live campaign covers. The twins are `compliance_copy.dart` and `sms-program-copy.ts`. `§0` | AvApp + portal | Decision first, then W2/W6 |
| H12 | The Neon free tier will likely run out. The 5-minute `/readyz` probe keeps compute awake (about 730 hours a month). Neon, Vercel and Sentry quotas have no usage alerts. | ops | Human |
| H13 | Cross-service contracts depend on hand-copied fixtures, with none for the AvApp → AvServ safety wire. The portal's closed Zod enums mean the portal must deploy before AvServ adds any new value, and that rule isn't written down. | all | W7 |
| H14 | Unfinished surfaces are live in prod. `/advertiser/new` is offered on every dashboard. Advertiser publish and restriction review call AvServ routes that don't exist. 9 server actions have no tests, including `resyncSarOrgAction` and the advertiser actions. | portal | W2 |

## 3. Medium and low (fold into the nearest workstream)

- **SAR org invite (W1).** The invite isn't bound to the signed-in user's email. The accept `UPDATE` lacks `isNull(acceptedAt)` and doesn't check that a row changed (`app/invite/[token]/actions.ts`). `re-checked`
- **Sign-in throttling (W1).** It is keyed only by email (lockout DoS), with no per-IP cap. MFA disable and recovery-code regeneration have no attempt limit. Email-verification tokens are stored in plaintext; store a SHA-256 hash, per §7.
- **SAR approval (W2).** The approve `UPDATE` doesn't re-check `status` or a revision, so it can approve an edit the admin never saw. Staff can approve an org they created. **`§0`: tighten only, never automate.**
- **Org deletion (W2).** Deleting a `sar_orgs` row cascades away its status log, intake messages, acks and view logs. Switch those to RESTRICT or soft delete, and fix the runbook's "delete the org" step.
- **Env documentation (W2).** `docs/infrastructure.md` is missing `AVSERV_SAR_INTAKE_KEYS`, `CRON_SECRET`, `TWILIO_*`, `NEXT_PUBLIC_SENTRY_DSN`, MapTiler and Apple. Make `NEXTAUTH_URL` required in production; links currently fall back to `localhost:3000`.
- **Portal Sentry (W2).** Set `environment` and `release`, add a `beforeSend` scrub, hash emails in auth logs, and send `x-request-id` to AvServ.
- **Public-copy scan (W1).** The scan covers 5 of 20 email templates. Extend it to all of `lib/email/templates` and the `(auth)` and invite pages.
- **Watchdog DB pool (W3).** The watchdog shares the API's pool, which has no `lock_timeout`.
- **AvServ build and rollback (W4).** Pin base images by digest, and add a "roll back one home node" runbook section.
- **AvServ boot test (W4).** Add a test that each supervised loop starts and ticks (`cmd/avserv` is at 4.6% coverage).
- **AvApp CI cost (W6).** About $62 was spent in October's first 7 days. Path-filter the iOS and Android smoke jobs.
- **AvApp coverage (W6).** Raise coverage of `avserv_session.dart` (18.6%) and `notification_scheduler.dart` (16.4%).
- **Dependencies and actions (W1, W4, W6, each in its own repo).** Turn on Dependabot alerts. In the portal, pin actions by SHA and add `permissions: contents: read`.
- **Retention cleanup (W5).** STOPped SMS-only contacts are still texted, relying on Twilio error 21610. Legacy proof documents may still be in the public Blob store (the portal-side query is in the runbook).
- **Restore drill (Human).** Run a portal restore drill and record it. Add a heartbeat after the backup upload.
- **Rotation playbook (Human / docs).** Write a credential-leak rotation playbook covering `NEXTAUTH_SECRET` and `MFA_ENCRYPTION_KEY`.

---

## 4. Workstreams

These are ordered by safety impact. Each one is a single PR, or a short stack. Every
item ships with its tests in the same PR (CLAUDE.md §4.3), and every PR goes through
the two-lens review before the pre-PR gate (§5).

### W1: portal auth and gate (`fix/beta-auth-gate`)

- [ ] **B6.** Upgrade next (≥ 16.3.6), next-auth (≥ 5.0.0 / @auth/core ≥ 0.41.3) and maplibre-gl (≥ 6.4.1).
  - Do this **first**, alone, as its own commit.
  - Then run the full gate and the Playwright mock specs.
  - Add a baseline CSP: `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`. The nonce-based `script-src` can follow later.
- [ ] **B1.** Close the takeover.
  - Recommended approach: when the OAuth link lands on a row that has a `passwordHash` and no `emailVerified`, null the password, delete that user's sessions and verification tokens, and then mark the row verified.
  - Alternative: drop dangerous linking. Decide with the owner (see D1).
  - Tests: the attack sequence fails, and the legitimate Google-only and credentials-only flows still work.
- [ ] Store email-verification tokens as SHA-256 hashes (`app/(auth)/actions.ts:≈82`, `app/api/verify/route.ts:≈28`).
- [ ] **H1.** Add `pnpm test` to the CI verify job, and turn on strict required status checks in the ruleset.
- [ ] Invite: bind to the verified session email, and guard the claim the same way `admin-invite` does.
- [ ] Add a per-IP sign-in bucket, and count only failures toward the per-email lockout. Rate-limit MFA disable and recovery-code regeneration.
- [ ] Extend the `legal-copy.test.ts` scan surface to every email template and the auth and invite pages.
- [ ] Pin CI actions by SHA, add a `permissions:` block, and turn on Dependabot alerts.

There are no migrations, unless the hashed verification tokens need one; check the adapter table.

### W2: portal fail-loud and SAR delivery (`fix/beta-fail-loud`)

- [ ] **H2.** Make the SAR team email reliable.
  - Add a notification-claim table (or column) with a unique `(alert_id, kind)` key, claimed atomically.
  - Record the send state, and add a retry cron for unsent rows.
  - Report send failures to Sentry.
  - Tests: concurrent double intake sends exactly once, and a failed send is retried.
  - **Migration:** apply it to prod before merge (§3.8).
- [ ] **H4.** Make crons and fan-out failures loud.
  - Add `Sentry.captureException` to every cron and fan-out catch.
  - Add Sentry Cron Monitors (or Healthchecks pings) for all crons.
  - Add a CPA-clock cron that warns at about day 30 and pages at about day 40.
- [ ] **H14.** Gate `/advertiser/*` and the restriction-review routes off until AvServ ships those endpoints, and remove the dashboard CTA. Treat a route-level 404 from AvServ differently from `creative_not_found`. Add tests for `resyncSarOrgAction`, `cancelPlatformInviteAction` and `signOutAction`.
- [ ] **SAR approval guard (`§0`).** Add `AND status = <from>` plus a revision or `updated_at` check, fail if no row changed, and refuse self-approval.
- [ ] **Org deletion.** Use RESTRICT or soft delete on the evidence foreign keys (**migration**), and correct the runbook step.
- [ ] **Env and Sentry hygiene.** Make `NEXTAUTH_URL` required in production, update `docs/infrastructure.md` and `.env.example`, set Sentry `environment` and `release`, add `beforeSend`, and send `x-request-id`.
- [ ] **H9 portal side.** Either merge a minimal `/contribute` page (PR #89) or confirm that AvApp hides the link (D3).

This workstream has migrations. Stack it on W1, or coordinate numbering: whoever
merges second regenerates.

### W3: AvServ delivery truth and monitoring (`fix/sms-delivery-truth`)

- [ ] **B2.** Make SMS delivery reflect the carrier's final status.
  - Store each alert SMS's message SID.
  - On a terminal `failed` or `undelivered` callback, mark the channel not delivered, reopen the window (or hand off to the peer), and page.
  - Keep plan 07 [DECIDE A] ("one delivered dispatch per checkout") true by redefining *delivered*, not by double-sending.
  - Update plan 42a.
  - Tests use a fake clock and a fake callback, and cover replication to the peer.
- [ ] **H3.** Page on alerts that are still failing.
  - Add a gauge of undelivered overdue windows older than N minutes, and page on it.
  - Add rules for the four counters above.
  - Add a rules test that every counter documented as "page-worthy" has a rule.
  - Add an always-firing heartbeat rule routed to an external dead-man's switch, and a doctor check that Alertmanager is reachable.
- [ ] Give the watchdog its own small pool with `lock_timeout` and `statement_timeout`.
- [ ] After merging, run the clock-skew and kill-a-node drills on the release tag (H5).

This workstream likely has a migration (the SID column). Coordinate its number with W5.

### W4: AvServ device auth and toolchain (`fix/device-register-pop`)

- [ ] **B7.** Require proof of possession to re-register a known device: the current refresh token, or a key bound at first registration.
  - Specify how AvApp sends it, so a **coordinated AvApp change** follows in W6.
  - Keep old builds working through a migration window (`/v1/client/requirements`), but close the takeover for any device that has already presented the new proof.
  - Rate-limit the endpoint per IP, and stop logging the full device ID.
  - Portal: truncate the device ID in `DevicesList.tsx`. This is a small portal edit; it can go in W1 or W2.
- [ ] **H6.** Upgrade to a supported Go version in `go.mod` (with a `toolchain` line) and both Dockerfiles.
- [ ] **H7.** CI hardening:
  - limit `cancel-in-progress` to PRs;
  - add `-race`;
  - add a "CI green for this commit" check to the runbook's tagging step and to `deploy.sh`;
  - pin base images by digest.
- [ ] Write a runbook section on rolling back a single home node.
- [ ] Add a boot test that every supervised loop registers and ticks.

### W5: AvServ privacy, retention and erasure (`feat/retention-erasure`), `§0`

**Blocked on D2** (the counsel decision on retention periods and which evidence is kept).

- [ ] **B3.** Add purge jobs for each table at the windows `/privacy` states, reusing the fail-safe `RetentionConfig` and `MinRetention` pattern. Bring the backup ring and mirror within the stated window.
- [ ] **B4.** Account erasure:
  - Build the audited purge command that the triggers refer to.
  - Add an account-erasure procedure that covers both nodes and replication.
  - Add a service-to-service erasure endpoint, so the portal deletion flow can call it later.
  - Write a runbook section with the 45-day clock.
- [ ] **H10, AvServ side.** 308-redirect `/legal/privacy` and `/legal/terms` to `rmdig.ai`.
- [ ] Check opt-out state before sending to a STOPped SMS-only contact, rather than relying on Twilio error 21610.

This workstream has migrations (trigger and foreign-key changes). Coordinate with W3.

### W6: AvApp store-ready build (`feat/release-ready`)

- [ ] **H9.** Add a Settings row that opens `rmdig.ai/account/delete`. Resolve `/contribute` per D3.
- [ ] **H8.** Write `tool/release.sh`, which:
  - builds from a committed defines file;
  - asserts the four flag values;
  - builds from a signed tag;
  - runs `apksigner verify`;
  - runs `--split-debug-info` and uploads symbols to Sentry.

  Also fix the stale comment about `key.properties` in CI.
- [ ] Path-filter the smoke builds, and turn on Dependabot alerts.
- [ ] Coverage: test `avserv_session.dart` and `notification_scheduler.dart`.
- [ ] Ship the client side of B7's proof of possession, after W4 defines it.
- [ ] **H11, app twin.** Apply only after D4, and together with the portal twin.

### W7: contract hardening (`chore/contract-goldens`)

This workstream is lower urgency and can start after the blockers.

- [ ] Generate golden request and response JSON from AvServ handler tests into `AvServ/docs/contracts/`.
- [ ] Have the portal's Zod schemas and AvApp's Dart decoders parse those goldens, with a hash pin so drift fails loudly.
- [ ] Write a one-page contract-evolution rule: consumers accept new enum values first, and AvServ emits them afterwards. Optionally parse red-feed items one at a time, so one unknown value doesn't drop the whole feed.

### W1b: portal sign-up follow-ups (`fix/email-first-signup`, stacked on W1)

- [x] D1a: email-first sign-up. The password is set on the verify page. Update the
  e2e and unit tests. (#148)
- [x] D1b: forgot-password can set a password on a Google-only account. (#148)
- [x] Hash emails in auth logs (#148, all log lines); do a lockfile refresh or overrides for the remaining
  transitive high advisories (2026-10-10: unused `react-email` removed, transitive refresh, Sentry 10.76; `pnpm audit --prod` clean, no overrides).

### W2 amendment (before merge)

- [ ] D5: add an `rmdig_sar_approver` platform role in migration 0024, held by the
  founder (granted in the migration or by seed, by email). Only `rmdig_admin` can
  grant it. SAR approve and re-verify require it. The Reviewer role keeps the ad
  queue. Holders may not approve an org they created or belong to.
- [ ] D4, portal twin: narrow `sms-program-copy.ts` together with W6's AvApp twin
  (same release; counsel-approved wording).

### W8: second SMS carrier (AvServ + owner), see §5b

- [ ] Owner: open the provider account and start toll-free verification. This takes
  the longest, so start it first.
- [ ] Write the AvServ plan doc (provider list, failover rules, opt-out unification,
  webhooks, metrics). Owner signs off.
- [ ] Implement, test, and run the failover drill.

### Human track (owner, counsel, consoles)

- [ ] **B5.** Counsel finalizes Terms and Privacy. Then run `pnpm agreement:pin`, and do the `/privacy` factual rewrite from AvApp doc 43 §1 (H10).
- [ ] **H12.** Move Neon to a paid plan, and turn on usage alerts for Neon, Vercel and Sentry.
- [ ] Turn on Twilio auto-recharge, a low-balance trigger and A2P campaign status alerts.
- [ ] **H5.** Name a secondary escalation contact, write the A9 dead-man's switch, and schedule the drills.
- [ ] Decide on GitHub Team for branch protection on AvServ and AvApp.
- [ ] Confirm in the consoles:
  - Alertmanager is running on avserv-2 and avserv-3;
  - Sentry alert rules exist;
  - real dispatch is live on both nodes;
  - the service-key route groups are on both nodes;
  - `AVSERV_SAR_INTAKE_KEYS` is set.
- [ ] Run a portal restore drill and record it.

## 5. Decisions

| ID | Decision | Status |
|---|---|---|
| D1 | B1 approach | **Decided 2026-10-07:** keep Google auto-linking; when Google links into an unverified row, invalidate that row's password (built in W1). |
| D1a | B1 residual (a stranger's sign-up verified by the victim clicking the email) | **Decided 2026-10-07:** move to email-first sign-up. The password is chosen only after the verification link is clicked. |
| D1b | Google-only accounts can't get a password back | **Decided 2026-10-07:** let the forgot-password flow set a password on a Google-only account, since the reset link proves the email. |
| D2 | Retention periods, and which evidence survives erasure | **Open, counsel.** Recommendation: implement the windows `/privacy` already states; counsel decides which agreement evidence is kept on a legal basis. W5 code builds configurable windows meanwhile. |
| D3 | `/contribute` | **Decided 2026-10-07:** ship a minimal page (from PR #89), keep the iOS link. **Known risk:** Apple's rules on donation links in an app depend on nonprofit status. If App Review objects, hiding the iOS link (`kContributeSurfaceEnabled`) is the fallback, with no server change needed. |
| D4 | Contact SMS consent line | **Decided 2026-10-07, wording pending counsel:** narrow both twins (`compliance_copy.dart`, `sms-program-copy.ts`) to the July campaign (missed check-in + SOS). **Lift when Incident Detection alerts ship:** restore the accident-alert wording in both twins, in the same release as the approved campaign cutover (plan 38a). Tracked as a release gate on that work. |
| D5 | Who may approve a SAR org | **Decided 2026-10-07** (grant: the migration gives the role to every current `rmdig_admin`, so no email is hard-coded). Design:  a dedicated `rmdig_sar_approver` platform role. The founder holds it, and only a Platform Administrator can grant it. The general Reviewer role keeps the ad queue but no longer approves SAR orgs. Holders also may not approve an org they applied for or belong to. Implement in W2 before merge, in the same migration. |
| D6 | Spending | **Decided 2026-10-07:** Vercel Pro, Neon paid plan, GitHub Team, Twilio auto-recharge plus a low-balance alert. |
| D7 | Second SMS channel | **Decided 2026-10-07:** add a second text carrier (W8), not an email requirement. Email is a poor emergency channel for most people. **Provider: Telnyx, using a toll-free verified number.** |
| D8 | Node failure domains (S3) | **Resolved 2026-10-07:** avserv-1, avserv-2 and avserv-3 are in separate locations with separate power and internet providers. Record this in the R5 attestation. The cloud node stays on its plan 42 schedule; it is not a beta blocker. |
| D9 | Wave 1 plan-doc sign-offs | **Approved 2026-10-07:** W3's plan 07 §9 meaning of "delivered"; W4's plan 03 decision, CLAUDE.md §9 line and device-register contract. |
| D10 | Portal cron cadence on Vercel Pro | **Decided 2026-10-07:** SAR email retry cron every 10 minutes. |
| D11 | Closing the old-build device window | **Decided 2026-10-07:** set `AVSERV_DEVICE_REGISTER_REQUIRE_PROOF=true` once `avserv_device_register_total{outcome="legacy"}` stays near zero for 2 weeks after the W6 release (and the canary sends proof). |
| D12 | App-level STOP suppression (reverses plan 27 D5) | **Approved 2026-10-07.** Follow-up: AvApp shows the user when a contact has opted out. |
| D13 | Paging tool (Q5) | **Decided 2026-10-07:** PagerDuty Free, for critical safety-path pages only. Pushover stays for everything else, and the secondary installs the PagerDuty app. |
| D14 | Clock-skew early alerts | **Decided 2026-10-07:** the watchdog checks the clock before each dispatch, rather than waiting up to 5 min for the next check. Small plan 37 follow-up after the W3 rebase, because both touch the watchdog. |
| D15 | W8 open questions O1–O4 | **Decided 2026-10-07:** a toll-free number per node; never route around an opt-out; AvServ opt-out state is the single source of truth, with HELP/START replies telling contacts to text START to both numbers; Telnyx `delivery_unconfirmed` counts as delivered, with a page on a high rate. **O5–O11 decided 2026-10-07:**<br>• O5: no duplicate disclaimer.<br>• O6: doctor check fails at P4.<br>• O7: intros go through the provider list.<br>• O8: Telnyx inbound failover URL points at a peer node; status callbacks don't.<br>• O9: **all three Twilio numbers are on one Twilio account**, so a Twilio account problem stops SMS tier-wide today, and W8 is that redundancy.<br>• O10: hedge delay 5s, tuned down if data allows.<br>• O11: Twilio first at beta. |
| D16 | Migration 0041 index locking | **Decided 2026-10-07:** build indexes on hot tables with `CREATE INDEX CONCURRENTLY`, in single-statement migrations (golang-migrate's supported pattern). If the runner can't do it, raise an AvServ tooling item. Handed to the W5 agent. |
| — | Counsel items (B5, D2, D4 wording, CPA appeal/COPPA/address, second-number consent) | **With counsel, 2026-10-07.** |

## 5b. Single points of failure (H5): resolution plan

| # | Single point of failure | Failure mode | Resolution | Owner | Before beta? |
|---|---|---|---|---|---|
| S1 | One SMS provider (Twilio) and one 10DLC campaign | Twilio outage or account problem, campaign suspension, carrier filtering of the campaign | **W8: second carrier.** Use a different provider **and** a different number type (toll-free verified), so neither a provider outage nor a 10DLC campaign problem takes SMS down. Design below. | W8 + owner | Yes |
| S2 | One human on call, single Pushover device | Owner asleep, sick or in the backcountry; pages lapse after 1h | Add an escalation layer: a critical page not acknowledged within 15 min goes to a named secondary by SMS or call. Write a one-page secondary runbook: reach the owner, check the status page, post an announcement, contact Twilio. No production credentials for the secondary at beta. Write the A9 operator dead-man's switch section. Plan coverage for the owner's own trips. | Owner | Yes |
| S3 | Home nodes' failure domain | If avserv-2 and avserv-3 share a site, power or ISP, one outage stops all alerting | Fill in the R5 failure-domain attestation. **If they share any of these, the cloud standby node (plan 42 step 3) becomes a beta blocker.** **Finding 2026-10-09: both live nodes are on Comcast** (a shared ISP). Owner decision: a known, accepted risk for the beta, and a **release blocker for general release**, closed by avserv-1 on a non-Comcast link (AvServ #240, runbook "Failure-domain attestation"). | Owner | Accepted for beta; blocks general release |
| S4 | Release signing key (one YubiKey) | Losing the key means no signed tags, so no fixes reach the cloud node | Enroll a backup YubiKey, add its fingerprint to the deploy pin list, store it off-site. | Owner | Yes |
| S5 | Cloudflare (ingress + DNS for every node) | Check-ins can't arrive, so contacts get false alerts; new check-outs dead-letter in the app | Accept for beta and document it: the failure produces false alerts, never missed ones. A non-Cloudflare ingress comes with the plan 42 cloud node. | Owner | Document only |
| S6 | Email providers (one Postmark account; Resend for the portal) | The secondary channel is down | Accept for beta; SMS (S1) is the primary channel. | — | No |
| S7 | Monitoring stack | Prometheus or Alertmanager dies silently | W3 heartbeat rule plus an external dead-man check. Configure it on each node. | Owner | Yes |
| S8 | Portal (Vercel + Neon, single region) | Portal is down; only SAR team email and the portal pages are affected, not contact alerts | Paid plans (D6), `/readyz` monitoring, SAR email retry (W2). | — | Done or decided |

**W8 second-carrier design notes** (become an AvServ plan doc before code):

- **Provider.** Choose one that runs its own network and has a Twilio-like API (candidates:
  Telnyx, Bandwidth). Choose the number type for independence from the 10DLC campaign:
  toll-free with toll-free verification.
- **Dispatch.**
  - The SMS channel becomes an ordered provider list per node.
  - On a definite API failure or timeout, it falls over to the next provider at once.
  - A B2 carrier-failure reopen re-sends through the *next* provider, not the one that just failed.
  - Prefer at-least-once: an ambiguous timeout may mean a duplicate text, which is acceptable.
- **Compliance.**
  - Consent and the designation intro must cover alerts arriving from either number.
  - A STOP or HELP on either provider updates AvServ's one opt-out state, which suppresses both.
  - Add the second provider's inbound and status webhooks, with signature checks.
  - Get the filing or verification text reviewed against the July campaign samples.
- **Monitoring.**
  - Per-provider metrics and canary.
  - A page when a provider is failing over.
  - A doctor row per provider.
- **Drill.** Disable the primary on one node and confirm the alert arrives through the secondary.

## 5c. Drill programme

Every drill has a written pass criterion and is recorded (date, tag, result, follow-ups)
in the AvServ runbook drill log. The **pre-beta** set runs on the beta release tag.

| Drill | What it proves | Pass criterion | When |
|---|---|---|---|
| Kill a node | The peer takes over within the stagger | Overdue alert delivered by the surviving node; peer-monitor page fires | Pre-beta, then quarterly |
| Clock skew | Clock guard corrects time and never goes silent | Alert still fires on time with a skewed clock; skew page fires | Pre-beta, then quarterly |
| Dead canary | The peer notices a canary that stops reporting | Page within the documented window | Pre-beta, then quarterly |
| Avalanche (burst) | Many simultaneous overdues dispatch within budget | All delivered within the capacity target; no pool exhaustion | Pre-beta, then before raising cohort size |
| Carrier failure (B2) | A carrier-failed SMS reopens, re-sends and pages | Undelivered SMS to a landline-type number; reopen, page and re-send observed | Pre-beta, then after any dispatch change |
| Carrier failover (W8) | A primary provider outage falls over to the secondary | Alert arrives through the secondary within one window | Once W8 ships, then quarterly |
| Monitoring dead-man | A dead Alertmanager or Prometheus pages externally | `make monitoring-down` leads to an external page | Pre-beta on each node, then quarterly |
| Operator escalation | An unacked critical page reaches the secondary | The secondary is contacted within 15 min | Pre-beta, then quarterly |
| Incident rehearsal | The "alert not delivered" runbook works end to end | Tabletop exercise completed; runbook gaps filed | Pre-beta, then twice a year |
| Portal restore | A nightly backup restores to a working database | Restored branch passes `/readyz`; row counts match | Pre-beta, then quarterly |
| CPA deletion end to end | A deletion request finishes within 45 days across services | A test account erased in portal and AvServ; reminders fired | Once W5 ships, then twice a year |

**Status on `v1.5.0-rc53` (2026-10-09), logged in AvServ `docs/drills/log.md`:**

- **Passed:**
  - Dead canary, in both directions.
  - Kill a node, on both nodes.
  - Clock skew.
  - Avalanche burst: a capacity ramp to 10× a 100-user target with no knee, 200 simultaneous on the harness, 25 live on production.
- **Ran but not logged yet:** monitoring dead-man. Log it.
- **Still to run, and what each needs:**
  - **Carrier failure (B2):** an owned landline to send the undeliverable SMS to.
  - **Operator escalation:** the secondary contact set up in PagerDuty.
  - **Incident rehearsal:** the same secondary contact.
  - **CPA deletion end to end:** can run now, by hand. Follow portal runbook "Data-deletion requests" in its order: the teams lookup and AvAI account ids first (both are lost once the portal user is deleted or the AvServ account erased), then W5's erasure CLI on the nodes, then delete the portal user, then Mark completed. The portal doesn't call AvServ's erasure endpoint, and doesn't need to for the drill. Automating that (with the `account_erasure` route group on the portal's key) is a later portal change. The runbook names the CLI since 2026-10-10.
  - **Portal restore:** a restore of the nightly backup to a scratch branch, then `/readyz` and row counts.
  - **Carrier failover (W8):** waits until W8 is implemented.

## 5a. Progress log

**2026-10-07, wave 1 (W1–W4) implemented.** All four are uncommitted in sibling
worktrees, waiting for owner review and signing. Each worktree has a
`.pr-body.md` and a proposed commit split.

| WS | Worktree / branch | Gate | Migration |
|---|---|---|---|
| W1 | `rmdig-portal-w1-auth` / `fix/beta-auth-gate` | typecheck, lint, 1084 tests, build green; critical advisories 7 → 0 | none |
| W2 | `rmdig-portal-w2-failloud` / `fix/beta-fail-loud` | typecheck, lint, 1067 tests, build, 35 integration tests green | `0024_sar_alert_notify_and_evidence_restrict`, prod before merge |
| W3 | `AvServ-w3-delivery` / `fix/sms-delivery-truth` | `go test -race`, vet, promtool, amtool green | `0041_alert_sms_delivery` (renumbered from 0039); **merged AvServ #232** |
| W4 | `AvServ-w4-device` / `fix/device-register-pop` | `go test -race`, vet, image builds green; Go 1.27.1 | `0040_device_proof` (renumbered from 0039); **merged AvServ #229** |
| W5 | `AvServ-w5-retention` / `feat/retention-erasure` | `go test -race`, vet | `0042`–`0048` (renumbered from 0041–0047); **merged AvServ #233** |
| W8 | `AvServ-w8-carrier` (design only) | — | none; design merged as **AvServ plan 45** (#231), renumbered from 43 because plans 43 and 44 already existed |

AvServ main's #228 took migration 0039, which pushed W4 to 0040, W3 to 0041 and W5 to 0042–0048.

**2026-10-09, AvServ wave merged and live.**

- **Merged:** W4 (AvServ #229, `0040_device_proof`), W3 (#232, `0041_alert_sms_delivery`), W5 (#233, `0042`–`0048`), the drill kit (#230), and the W8 design as AvServ plan 45 (#231).
- **Live on both nodes:** `v1.5.0-rc53` @ `02f154e`, schema v48.
  - #234 adds `AlertmanagerNotifyFailing`, which pages when any receiver fails to deliver.
  - #237 labels Pushover recoveries "RESOLVED:" at normal priority.
- **§7.4 monitoring is done on both nodes:** PagerDuty per node, plus healthchecks.io dead-man checks. §7.4 below now has the three setup gotchas.
- **§5c pre-beta drills on rc53:** see §5c for what passed and what remains. Results are in AvServ `docs/drills/log.md`.
- **Finding:** both live nodes are on Comcast (§5b S3; owner decision recorded there).

**2026-10-08 to 10-09, portal wave merged.**

- W1 (#139), header (#140), contribute (#141, closing #89), W2 with migration 0024 (#142).
- The SAR form fixes: 4 MB proof cap, early phone verify, and keeping the document on a rejected submit (#143, #145).
- Follow-ups from the §9 test pass (#144).
- Phone reuse after rejection, with migration 0025 (#146).
- **Production:** Twilio Verify is live (its own subaccount). Sentry cron alerts and browser error reporting are live.
- **Neon:** the Vercel store is disconnected and Neon's own Vercel integration is off; they had been creating production copies for previews (runbook "Connecting to production").

**Merge notes**

- **Portal.** Merge W1, then rebase W2. The only shared file is `lib/db/schema.ts`
  (a comment). Re-run W2's tests after the rebase, because W1's wider copy scan
  will cover W2's new email template.
- **AvServ.** Merge W4, then rebase W3. Seven files overlap: `cmd/avserv/main.go`,
  `docs/runbook.md`, `internal/config/config{,_test}.go`,
  `internal/store/{inbox,outbox,store_test}.go`. Both branches extend replication
  events. Renumber W3's migration, then re-run the full `-race` suite on a fresh
  database.

**Sign-offs needed**

- W3: the plan 07 §9 redefinition of "delivered", plus the notes in plans 40 and 42a.
- W4: the plan 03 "Decision 2026-10-07" section, the CLAUDE.md §9 line, and
  `docs/contracts/device_register_proof.md`.

**New items found during wave 1**

- [ ] **B1 residual.** A victim who clicks the verification email triggered by a
  stranger's sign-up makes the stranger's password valid. Fix: set the password
  only after the email is verified. Needs owner approval.
- [ ] Vercel Hobby crons run at most daily, so the SAR email retry backstop is
  daily. Consider Pro.
- [ ] Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel. Browser Sentry has never run;
  W2 fixes the config filename.
- [ ] Add Sentry alert rules on the `portal-*` cron monitors.
- [ ] Decide whether staff who are members of an org are also barred from
  approving it (currently only the creator is).
- [ ] Turn on strict required checks (portal ruleset) and Dependabot alerts.
- [x] Do a lockfile-refresh or overrides PR for the 20 remaining transitive
  high advisories. (2026-10-10, no overrides needed.)
- [ ] AvServ nodes, each one:
  - set the Twilio status callback URL (B2 does nothing without it);
  - add the dead-man's switch route to `alertmanager.yml` and an external heartbeat check;
  - prove it pages using `make monitoring-down`.
- [ ] Close the old-build device-register window
  (`AVSERV_DEVICE_REGISTER_REQUIRE_PROOF=true`) only after the W6 build is
  `minBuild` and the canary sends proof.
- [ ] Confirm that a freshly bootstrapped node doesn't serve device-register before
  its device rows have replicated.
- [ ] W5's session purge must keep each device's newest session.
- [ ] Fix `internal/opswitch` test isolation (it fails on a reused test database).
- [x] Hash emails in the portal auth logs. This was left out of W2 because it is in W1's file. (#148)

**2026-10-07, wave 2 progress**

- **Contribute** (`rmdig-portal-contribute` / `feat/contribute-minimal`): done; gate green (1,025 tests).
  - Static page, with the payment link, payouts and kit sale cut.
  - Close PR #89 in favor of this one.
  - Merge after W1; both change `legal-copy.test.ts`.
- **W2 amendment:** done; gate green (1,073 tests, 36 integration tests).
  - D5 role added by rebuilding the enum inside migration 0024, because `ADD VALUE` can't be used inside drizzle's single transaction.
  - Current admins are granted the role.
  - The last SAR approver can't be revoked.
  - The consent line is narrowed.
- **W8 design:** `AvServ-w8-carrier/docs/plans/43_second_sms_carrier.md`, a PROPOSAL.
  - Check the plan number against any local plan 43 before committing.
  - 11 open questions are in the doc.

**New items from wave 2**

- [ ] **Twilio opt-out keywords.** The approved campaign lists `OPTOUT` and `REVOKE`, but AvServ `parseKeyword` doesn't handle them, so those opt-outs are never recorded on our side. Handed to W5.
- [ ] Vercel crons stay daily until the Pro upgrade; Hobby rejects more frequent schedules. After upgrading, set `/api/cron/sar-alert-notify` to `*/10 * * * *` (D10).
- [ ] `/privacy` must name Telnyx as a processor before any real traffic goes through it. Counsel.
- [ ] Retake the `/sms` consent screenshot in the release that ships the narrowed consent line (W2 + W6).
- **Drill kit** (`AvServ-drills` / `docs/drill-kit`): done.
  - 11 procedures, a log template, and `go run ./cmd/fleet drill`, which refuses production unless given `--production` and `--drill-account`.
  - Dry-runs on the local harness: kill-a-node passed (surviving node alerted 11s after the deadline); a 200-check-out burst delivered each alert exactly once (worst case 1.9s).
- [ ] **Dead-canary page.** `CanaryHappyLoopStale` can't fire when the canary is stopped, because the metric dies with the container. Only `ScrapeTargetDown`, after about 15 minutes, pages. Add an `absent()`/staleness rule. Fold into the W3 rebase, since W3 owns `rules.yml`.
- [ ] **Clock skew.** A freshly skewed node can dispatch on its wrong clock for up to 5 minutes, until the next clock check, so it could alert early. That's a false alert, never a missed one. Decide whether the watchdog should check the clock before each dispatch (plan 37 follow-up).
- [ ] Operator-escalation drill is blocked on the paging tool (Q5: PagerDuty Free recommended).
- [ ] After W5 lands, add the runbook cross-links listed in `AvServ-drills/.pr-body.md`.
- **W6** (`AvApp-w6-release` / `feat/release-ready`): done.
  - Gates: `flutter analyze` and `check_claims` clean, `flutter test` 1,583 passing.
  - Delivered: in-app deletion row, `tool/release.sh` with a `--check` mode, the device-proof client with a guided re-link, the narrowed consent twin, and path-filtered smoke jobs.
  - The consent twins are verified identical to the portal's.
  - **Fixed an existing safety bug:** if a refresh got a 401 and the re-register then hit a network failure, check-ins were dead-lettered. That path is now retryable.
- [ ] Create the `native-smoke` label in GitHub (AvApp).
- [ ] Split `avserv_client.dart` (769 lines; the guideline is about 400).
- [ ] Upload the Dart obfuscation maps to Sentry. Only native symbols and dSYMs are uploaded today.
- [ ] Bump `minBuild` and then set `REQUIRE_PROOF` only after the W6 build is live in both stores (D11).
- **W5** (`AvServ-w5-retention` / `feat/retention-erasure`): done.
  - Gates: build and vet clean; `go test -race` green apart from two expected failures. The migration-gap test passes once the branch is rebased onto W4 and W3. The `opswitch` failure is the known reused-database isolation bug.
  - Retention purges at the published windows, each with an `AVSERV_RETENTION_*` variable marked [COUNSEL]. Safety state is held, not purged.
  - Erasure: an operator CLI, plus a service-to-service endpoint in a new `account_erasure` route group. The account row is kept but scrubbed. Erasure replicates and is held while a check-out is live.
  - Also: `/legal/*` 308 redirects, the `OPTOUT`/`REVOKE` keywords, app-level STOP suppression, and backups cut to 28 days. Migration `0041_retention_erasure`.
- [ ] **D12, owner sign-off before merge.** App-level STOP suppression reverses plan 27 D5. A contact who texted STOP and has no email gets no alert. This matches `/sms`, `/privacy` and the filing; Twilio already blocks those texts with error 21610. Recommend approving, plus an app follow-up: show the user that a contact has opted out, so they can pick another contact.
- [ ] **Counsel (D2), additional questions:**
  - Should the alert ledger outlive its check-out? It is now deleted together with the check-out.
  - Keep `data_share_log` after erasure?
  - The gap where a node that stops producing backups keeps its last ones past 30 days.
- [ ] Portal `/privacy`: heartbeat data is now "deleted after 7 days", not "reduced to aggregate". Fold into the counsel rewrite.
- [ ] W3 rebase: add page rules for `avserv_retention_held_rows` and for the dead canary.
- [ ] Migration 0041 builds an outbox index without `CONCURRENTLY`, which blocks outbox writes for a few seconds during deploy. Deploy outside active check-out windows, or split the index into a separate non-transactional step.
- [ ] Add the `account_erasure` route group to the portal's service-key scopes when the portal deletion flow starts calling erasure.
- **D16 implemented (W5):**
  - The hot-table indexes now sit in single-statement `CONCURRENTLY` migrations, 0042–0047 (outbox ×2, checkouts, idempotency_keys ×2, device_heartbeat). 0041 keeps only the cold-table indexes.
  - Tested: a 3M-row outbox built alongside 385k concurrent inserts with no failures.
  - W5's migrations are now **0041–0047**.
- [ ] **AvServ tooling:** add a `migrate force <version>` operator command. Today, recovering from a failed concurrent index build needs a manual production `UPDATE` of the migration version (runbook "Deploying migrations 0041-0047").
- [ ] After each deploy of 0042–0047, check for `NOT indisvalid` indexes (runbook).
- **W5 follow-ups done:**
  - `avserv migrate force <version> --confirm` covers the "AvServ tooling" item above. The runbook recovery uses it.
  - `RetentionHeldRowsGrowing` (page) and `RetentionHeldRowsPersist` (warning) are added at the end of `rules.yml`.
- [ ] **AvServ CI has no `promtool check/test rules` step,** so rule tests only run by hand. Add it once W4 (which owns `ci.yml`) is merged. Wire W3's `make rules-test` into CI, and include W5's `deploy/harness/rules_retention_test.yml` in that target during the W5 rebase.
- **W3 follow-ups done:**
  - `CanaryDark` pages 10 min after the canary goes dark; `ScrapeTargetDown` skips the canary job.
  - PagerDuty routing by the `page: pagerduty` label, with Pushover kept on those alerts too. Labelled: `OverdueAlertsUnreached`, `AlertSMSDeadPath`, `AlertSMSFailureNotRetried`, `WatchdogStale`, `WatchdogDispatchPanics`, `NodeDown`.
  - D14 clock check before dispatch, when the last clock verdict is over 60s old or the clock has jumped.
  - The drill doc now names `CanaryDark`.
- [ ] **Owner sign-off:** the plan 37 §3.6 amendment (D14).
- [ ] D14 follow-up: the incident loop doesn't re-check the clock before dispatch yet.
- [ ] **Each node:**
  - put the PagerDuty routing key in `deploy/monitoring/secrets/` (gitignored);
  - point the external heartbeat monitor at PagerDuty directly, since a dead Alertmanager can't page.

## 6. Parallel-session rules

- **One worktree per workstream**, branched from a fresh `origin/main`, never from a
  stale local branch.
- **Migration numbering.** In the portal, only W2 is expected to add migrations. In AvServ, W3
  and W5 will collide, so whoever merges second renumbers. Portal migrations go to
  production **before** merge (CLAUDE.md §3.8).
- **Shared files.**
  - The portal's `ci.yml` is touched by W1 only.
  - AvServ's `ci.yml` is touched by W4 only.
  - `rules.yml` is touched by W3 only.
  - If a session needs to change a file outside its workstream, note it here
    rather than editing it.
- **Merge order.** W1 → W2 (portal). W4 → W3 → W5 (AvServ; W4 first because of the
  Go upgrade). W6 after W4 defines the proof-of-possession contract.
- **Merging and pushing.** Sessions open draft PRs. The owner merges, pushes, tags and
  touches the YubiKey. Batch the merges to save CI and deploy minutes.

- **Header** (`rmdig-portal-header` / `fix/header-nav`), an owner request on 2026-10-07:
  - Support is removed from the header bar; it stays in the footer and the mobile menu.
  - Admin moves to the right of the Settings gear, staff only.
  - Gate green: typecheck, lint, 1,012 tests, build. `.pr-body.md` written.

---

## 7. Operator guide: the beta release, step by step

The authoritative procedures are the runbook sections named here. The AvServ ones
exist on the W3/W4/W5 branches until they merge. These are the commands in order.

### 7.1 Now (no release needed)

- **Twilio console:**
  - turn on auto-recharge and a low-balance usage trigger;
  - subscribe to A2P campaign status alerts;
  - confirm Advanced Opt-Out on the Messaging Service lists `OPTOUT` and `REVOKE`.
- **Telnyx:** open the account and start toll-free verification, one number per
  node (W8).
- **PagerDuty Free:**
  - one service per node with an Events API v2 integration;
  - an escalation policy of owner → secondary after 15 min, phone and SMS;
  - the secondary installs the app.
- **External heartbeat checks** (Healthchecks.io or similar): one per node,
  period 1 min, grace about 5 min, alerting PagerDuty.
- **Each AvServ node:** confirm the Twilio status callback is configured. B2 does
  nothing without it.
  ```sh
  grep -E '^AVSERV_TWILIO_STATUS_CALLBACK_URL=' .env   # expect https://<node>.rmdig.ai/v1/twilio/status
  ```
- **Vercel:**
  - upgrade to Pro;
  - set `NEXT_PUBLIC_SENTRY_DSN` (Production and Preview) and redeploy.
- **Neon:** move to a paid plan and turn on usage alerts.
- **GitHub:**
  - upgrade to Team, then protect `main` on AvServ and AvApp (required CI, no direct push);
  - turn on strict required checks on the portal ruleset;
  - turn on Dependabot alerts in all three repos;
  - create the `native-smoke` label in AvApp.

### 7.2 Portal release (per merge)

1. Merge W1, then rebase and merge contribute, then the header PR.
2. **Before merging W2,** apply migration 0024 to production:
   ```sh
   export DATABASE_URL="$(neonctl connection-string production --project-id lingering-waterfall-99928244 \
     --role-name neondb_owner --database-name neondb --pooled)"
   case "$DATABASE_URL" in *ep-crimson-thunder-aqloj3r3-pooler*) pnpm db:migrate;; *) echo "WRONG URL, not migrating";; esac
   unset DATABASE_URL
   ```
   Then re-run the PR's "Migrations applied to production" job, and merge.
3. After deploy, verify:
   - `https://app.rmdig.ai/healthz` and `/readyz`;
   - one public route and one authed route;
   - `/admin/sar-approvals` still works for you (you now hold SAR Approver).
4. After the Vercel Pro upgrade: set `sar_alert_notify` to `*/10 * * * *` in
   `vercel.json` and `lib/cron/jobs.ts`, and relax `cron-jobs.test.ts` (D10).
5. After the first cron runs, add Sentry alerts on each `portal-*` cron monitor.

### 7.3 AvServ release (W4 → W3 → W5 merged; one signed tag)

Cut the tag per runbook "Rolling a tagged release to the tier" §1 (CI green for that
exact commit, then `git tag -s`). Roll **one node at a time**. On each node:

```sh
git fetch --tags && git checkout v1.5.0-rcN && git status   # must be clean
make up
make doctor 2>&1 | grep -E "watchdog|replication/|peer-monitor/|alertmanager|dispatch/sms-receipts"
# 0042-0048 built indexes concurrently: confirm none is INVALID (must return no rows)
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid"'
```

- Wait for replication lag 0 before the next node, then run the version-parity gate (runbook §3).
- If a concurrent index build failed, follow runbook "Deploying migrations
  0042-0048" (drop the invalid index, `migrate force <N-1> --confirm`, `migrate up`).
- The cloud node deploys the signed tag through its own `deploy.sh`; verify it in the
  parity gate.

Leave `AVSERV_DEVICE_REGISTER_REQUIRE_PROOF` unset until D11.

### 7.4 Monitoring on each node (after the release)

Runbook sections: "The dead-man's switch for alerting itself" and "PagerDuty for
critical safety-path pages".

```sh
mkdir -p deploy/monitoring/secrets && (umask 077; printf '%s' '<pagerduty integration key>' > deploy/monitoring/secrets/pagerduty_routing_key)
# Linux node only: Alertmanager runs as nobody, so it can't read the key otherwise
sudo chown 65534:65534 deploy/monitoring/secrets/pagerduty_routing_key
# copy into deploy/monitoring/alertmanager.yml from alertmanager.yml.example:
#   deadman route + receiver (before the warn route; paste the heartbeat ping URL)
#   pagerduty route, the severity="page" -> oncall route after it, pagerduty receiver
make rules-test
make monitoring-reload
# prove the dead-man pages externally:
make monitoring-down    # wait out the grace -> external page arrives
make monitoring-up      # -> recovers
# prove PagerDuty + Pushover both ring:
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml exec alertmanager \
  amtool --alertmanager.url=http://127.0.0.1:9093 alert add TestPage severity=page page=pagerduty instance=manual-test
make doctor 2>&1 | grep -E "alertmanager|pagerduty"
```

- **Heartbeat check period: 3 minutes.** Alertmanager pings the external check
  every 1–2 minutes, so a shorter period gives false "down" pages.
- Inside the container, `amtool` needs `--alertmanager.url=http://127.0.0.1:9093`
  (as above); without it, it has no Alertmanager to talk to.

Done on both nodes as of 2026-10-09 (§5a).

### 7.5 Pre-beta drills (on the release tag)

Run the §5c pre-beta set using `AvServ/docs/drills/` and `go run ./cmd/fleet drill`.
Record each in `docs/drills/log.md`.

## 8. Session kickoff prompts (one session per repo or role)

Paste each prompt into a Claude Code session opened in the named repo. The exact
texts live in the 2026-10-07 conversation and are summarized here.

| # | Session | Opens in | When |
|---|---|---|---|
| 1 | Portal, ship wave 1 (W1, header, contribute, W2) | rmdig-portal | Now |
| 2 | Portal, preview test pass (§9.2–9.3), fixes in the PR's own worktree | rmdig-portal | As each portal PR gets a preview |
| 3 | AvServ, ship and rebase (W4 → W3 → W5, drill kit, W8 doc) | AvServ | Now |
| 4 | Production drills (§9.1, §5c) | AvServ | Baseline now; again after W2 deploys and after the AvServ release |
| 5 | AvApp, ship W6 + device-link test (§9.4) | AvApp | Now; the device-link part after the AvServ release |
| 6 | Portal, W1b | rmdig-portal | After W1 merges |
| 7 | AvServ, W8 implementation | AvServ | After W3 merges and Telnyx credentials exist |

## 9. Manual test pass (reconciled 2026-10-07)

This reconciles the earlier hand-test list (after #137/#138) with waves 1–2. Run the
portal items on each PR's **Vercel preview**: it uses seeded personas and the
`rmdig-portal-preview` Neon project, never production. ✱ marks what changed.

### 9.1 Safety path (production, drill mode only)

- [ ] **Baseline now** (#137/#138 are live): run the SAR alert drill.
  - Drill alerts never email anyone (runbook "SAR alert intake"), so the email checks in this section can't be done with a drill. They're covered by unit and integration tests, and need a deliberately designed live check in §7.5.
  - Done 2026-10-06 (avserv-3 overdue drill, all-clears from both nodes); "Mark received", the red map and Open alerts were then checked on a preview's demo team (2026-10-08).
  - "Mark received" works.
  - The alert shows on the map: red dot, popup, listed under Open alerts.
  - Admin → AvServ checks are all Pass.
- [ ] ✱ **After W2 deploys:** rerun the drill. Each member would get **exactly one** email even though both nodes post (the new notification claim), but drills don't email, so that part needs a live check (§7.5). Sentry shows the `portal-*` cron monitors checking in.
- [ ] ✱ **After the AvServ release (W4 → W3 → W5):**
  - rerun the drill;
  - then run the §5c pre-beta drills (§7.5), including the B2 carrier-failure drill (re-send and page).

### 9.2 Roles on a preview (seeded personas)

**Signed out**
- [ ] Header shows Sign in and Create account. ✱ No Support tab in the bar; Support is in the footer and the mobile menu.
- [ ] `/status`, `/privacy`, `/support`, `/account/delete` load. ✱ `/contribute` loads and says contributions aren't open.
- [ ] ✱ `/sms` shows the narrowed consent line (no "automatic accident alerts"); the screenshot is retaken for that release.
- [ ] ✱ The response has the CSP header (`frame-ancestors 'none'`); check in devtools.

**Sign-up and sign-in (W1; W1b later)**
- [ ] ✱ Sign up, then click the verification link: it works. Links issued before the W1 deploy stop working, by design; "Send a new link" recovers.
- [ ] ✱ Google sign-in works for a new user, and lands verified with no second sign-in needed.
- [ ] ✱ The B1 attack is closed: sign up as X with password P without verifying, then sign in with Google as X. Signing in with P must now fail.
- [ ] ✱ Throttling: 5 bad passwords from one network lock only that email on that network. Another network can still sign in.
- [ ] ✱ After W1b: sign-up asks only for an email, and the password is chosen on the verify page. Forgot-password can set a password on a Google-only account.

**Plain user**
- [ ] Dashboard shows the AvAI account links. Research keeps the header tabs, with no Map tab.
- [ ] ✱ The dashboard has **no** "Create an advertiser account" card (flag off).
- [ ] ✱ Settings → Devices shows an 8-character device ID prefix, not the full ID.

**SAR admin**
- [ ] Team tabs work. Two-factor setup is required and returns you to where you were.
- [ ] ✱ Invite: accepting with a **different** signed-in email is refused. Accepting with the invited email works once; a second accept grants nothing.

**SAR dispatcher**
- [ ] The dashboard's Alerts button goes straight to alerts; the only team tab is Alerts.

**Staff (`rmdig_admin` + ✱ `rmdig_sar_approver`)**
- [ ] ✱ Header: Admin shows to the **right of the Settings gear**, staff only.
- [ ] Admin hub counts are right. A deletion request can be marked completed.
- [ ] Approving a ski patrol without a note is refused.
- [ ] ✱ D5 checks:
  - a Reviewer-only persona can't open the SAR approvals queue;
  - approving an org you created, or belong to, is refused;
  - an org edited while you're reviewing it can't be approved on the stale view; reload first;
  - the last SAR Approver can't be revoked.

**Advertiser** ✱ (behind `FEATURE_ADVERTISER_PORTAL`, off by default)
- [ ] Flag **off** (the default): `/advertiser/*` returns 404, the sign-up "Advertiser" option and the admin ad cards are hidden, and the actions refuse.
- [ ] Flag **on**, only if you want to keep testing it on a preview: write an ad and submit it; staff requests changes → email → edit → resubmit; staff approves (email says "published"), then suspends ("paused" email). Publishing to AvServ is expected to fail loud, because AvServ has no ad endpoint yet (H14).

### 9.3 Forms, maps and phone

- [ ] SAR application and advertiser forms submitted with a mistake keep what you typed.
- [ ] ✱ **Maps (W1 upgraded maplibre to v6, which first broke every map):** every map renders: the SAR red map, region draw and preview, and the layered map.
- [ ] On a real phone, one finger scrolls the map page and two fingers move the map. Recheck after W1: v6 can change gesture defaults.

### 9.4 Device link (portal + AvServ + AvApp)

- [ ] Run the device-link test from your list on the preview (mock AvServ). ✱ The device list shows the truncated ID.
- [ ] ✱ **After the AvServ release + W6 build:**
  - link a phone;
  - re-register (reinstall, or clear the app's tokens): it still works using proof;
  - force a "proof required" refusal on a test device: the app shows the red banner, and "Set up this phone again" re-links with a portal code;
  - check-in keeps working throughout.
