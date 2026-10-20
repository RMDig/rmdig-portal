# 00 — Portal status and what's left

> **As of 2026-10-20**: §0, §3 row 36, §5 and §7 are current; rows
> not touched since **2026-10-02** say so. This is the one place to see where every
> portal plan stands. The plans themselves stay the specs; update this file when a
> milestone moves. Sources: [CLAUDE_BOOTSTRAP.md](../../CLAUDE_BOOTSTRAP.md) §4 (Phase 1),
> rmdig-ai `docs/plans/00–09`, this folder's plans 30–36, and the AvApp/AvServ plans
> that name portal work.

## 0. Waiting on others (as of 2026-10-20)

**Done 2026-10-20:** AvServ plan 52 B1/B2 live (rc74; doctor OK on rc79). The device-admin key
`svc-key-portal-device-admin-1` is installed on both nodes (`device_admin` only;
`svc-key-portal-1` doesn't hold it) and set in Vercel Production (the build check passed).
Phone sign-out and the App Lock reset code are live and proven on the owner's devices:
previews and limited revokes recorded by both nodes (first at 06:44Z, more 17:48–17:58Z);
reset codes redeemed in AvAI. Every check in AvApp's list passed.

**AvServ**
- **`+security_events` on `svc-key-portal-1` and plan 52 step 4** (the events feed, contract
  rev 1.1, no wire change): **built, ships in AvServ's next rc**; they send the rc number, then
  the owner adds the group on both nodes. Switches on phone-side rows in Settings → Security and their
  notices (#168). No portal change needed.
- Plan 52 PR C (link codes hashed, D14 yes): nothing needed from the portal.
- **Plan 39 restrictions**: unblocks plan 32 (restriction review, on the mock) and plan 57.
- **Plan 57 contracts**: `false_alarm_reports.md`, restrictions rev 2, the per-user block,
  the SAR disposition call; REPORT keyword in a later A2P filing.
- **Plan 47 erasure key** (`svc-key-portal-erasure`): unblocks plan 35 (automated deletion).

**Counsel**
- **Security change log**: retention (AvServ proposes 400 days, held while live) and what
  account erasure does to it (default: deleted). `/privacy` has the `[LAWYER]` slot.
- **Review the 2026-10-19 `/privacy` additions** (sign-in records, passkeys, security log,
  notices) and the volunteer sign-up section (2026-10-15).
- Already listed: plan 31 agreement text and assent; every `[LAWYER]` in `/privacy` and
  `/terms`; plan 34 team areas; plans 35/47 deletion and erasure; `/contribute` payment
  wording; plan 57 (defamation, rescue-billing discovery, retention, REPORT disclosure,
  SAR disposition terms) with a DV-advocate review shared with AvApp plan 55.

**Owner**
- **About 2026-10-26** (the passkey's 7th day): test a **full** phone sign-out on a stale
  test device, confirmed with the passkey; expect the "Unsynced observations and photos…
  will be erased" warning. AvApp then checks the phone's side.
- App Lock in tester store builds: whether v1 TestFlight / Play internal include
  `AVAPP_APP_LOCK=true` (AvApp doc 41 row 11). Device builds have it since 2026-10-20.
- Sentry: "Prevent storing IP addresses" and server-side scrubbing (plan 36 §11), if not done.
- HSTS preload: eligible, not submitted (a deliberate, near-permanent choice; plan 36 §11).

## 1. Production gaps (operator, do first; rows 1–3 last checked 2026-10-02)

| Gap | Effect today | Fix |
|---|---|---|
| AvServ link in production: `AVSERV_BASE_URL` (avserv-2) and failover (avserv-3) set; AvServ installed `svc-key-portal-1` | Configured, **not yet verified** | Sign in on production and open Settings → Devices; logs should show `avserv.map.linked` |
| SAR proof uploads: Blob store connected, OIDC auth (#90) | Configured, **not yet verified** | One test SAR application with a PDF, then reject it |
| Previews could not sign in (no Preview `NEXTAUTH_SECRET`) and forked production data | Fixed in code by the previews PR; needs the operator setup | runbook "Preview deployments" |
| ~~`MFA_ENFORCEMENT` unset in Production~~ | **Done 2026-10-19**: `all` in Production after passkeys shipped (plan 36 PR 12); Google-only accounts keep the P1.2 boundary (S-D6) | — |

**Incident record — 2026-10-01/02:** production server routes returned 500 for ~20 h
because the Production database variable was saved as `DATABSE_URL` during a password
rotation. Lesson in [runbook](../runbook.md) "Rotating the database password".

**Incident record — 2026-10-02 (~15:44–16:40 MDT):** setting the Neon integration to
Production-only (previews setup) re-created the Production `DATABASE_URL`. The new
value reached a database without the portal schema (`42P01 rate_limits does not
exist`), so sign-in and every signed-in page failed. A re-pin then ran
`vercel env add … production ""`, which added nothing, so the redeploy had no
database URL (`/healthz` 500). `/healthz` was green for the first part, as it was for
the 20 h outage. Lessons: runbook "Re-pin the production `DATABASE_URL`", and
`/readyz` with an external probe (runbook "Outages and rollback").

## 2. Phase 1 (bootstrap §4)

| Milestone | Status | Evidence |
|---|---|---|
| P1.0 Skeleton | ✅ Done | `/healthz`, Sentry, Neon; canonical host `rmdig.ai` (app./www 308) |
| P1.1 Auth | ✅ Done | sign-up/in, verification, Google, reset, rate limits |
| P1.2 Roles, shell, MFA, settings | ✅ Done | `/admin`, `/settings`, `/settings/mfa/enroll` |
| P1.3 Device linking | ✅ Done, **differently**: AvServ link codes (P-B1–B3, AvServ plan 05), not the claim-token/QR/`/api/device-link/consume` design | `/settings/devices` |
| P1.4 SAR onboarding | ✅ Built — **blocked in prod** on the Blob token (§1) | `/sar/new`, `/admin/sar-approvals`, invites, `ST_Covers` query |
| P1.5 Email QA, Sentry maps, runbook | ✅ Done | `docs/runbook.md` |
| P1.5 Marketing banner → portal | Superseded | the portal serves the apex itself |
| P1.5 Soft launch with 3–5 SAR admins | ⬜ Not started | needs §1 fixed first |
| P1.5 `MFA_ENFORCEMENT=all` | ✅ 2026-10-19 | plan 36 PR 12, after passkeys (#170) |

## 3. Portal plans

| Plan | Status | Waiting on |
|---|---|---|
| [30 Advertiser portal](30_advertiser_portal.md) | AD-P1–P7 ✅ merged (#24–#31), publish runs on the AvServ mock | AvServ publish contract (plan 30 §11); **O3 AdLedger ratification** (portal-owned, blocks Phase 3 billing) |
| [31 Agreement onboarding](31_account_agreement_onboarding.md) | ✅ merged (#77) | **Counsel**: agreement text, assent/attestation wording, minimum age, individuals-only, privacy acknowledgement, retention vs deletion, scroll-to-agree (D2). Then AvServ publishes v1 → `pnpm agreement:pin v1` within 30 days; capture on. Also §1 |
| [32 Restriction review](32_restriction_review.md) | ✅ merged (#83), runs on the mock | AvServ builds plan 39 (after v1.5) |
| [33 Map and SAR workspace](33_map_and_sar_workspace.md) | Phase 1 `/map` ✅ (own SAR areas, own ad targets, staff overview) | Phases 2–4 (own history; SAR teams as opt-in contacts with team terms; red/orange SAR layers): doc amendments, AvServ contracts, counsel addendum (§4) |
| [34 Team areas on the public map](34_public_team_area_map.md) | Planned (not re-checked this pass) | Counsel |
| [35 Automated deletion](35_automated_deletion.md) | Draft; deletions are by hand (runbook) | AvServ plan 47 erasure key; counsel |
| [36 Account security and hardening](36_account_security_and_hardening.md) | **Live:** hashed sessions + `auth_time` (#164), sessions page + re-auth + sign-out on credential changes (#165, #166), passkeys (#170), `MFA_ENFORCEMENT=all`, security activity + opt-in notices (#168). **On the mock:** phone sign-out, limited/full, due-back time (#167, #169); phone-side security events (#168). **Built and verified 2026-10-20:** PR 11 (App Lock reset code + link-code mint limit, #172);
a double-click guard on both code buttons (#173). The three codes minted at 17:57–17:58Z were
two phones' requests (8ddef600, then 4b93adf6 twice), not a double click: all on avserv-2,
two redeemed, one expired unused. **Not built:** hardening H1–H8 (PRs 4–6, 13), S6 / plan 57 | AvServ plan 52 (§0); counsel (security log retention); plan 57 gates |

## 4. Incident Detection re-filing (AvServ plans 38/38a/38b)

The corrected campaign was auto-rejected (30882 terms, 30908 privacy): vetters reject
visibly unfinished legal pages.

| PR | Contents | Waiting on |
|---|---|---|
| #79 (draft) | `/privacy` + `/terms` for the filing: per-profile Incident Detection data, every message type, carrier line, support contact | **Counsel** (banner + every `[LAWYER]`, terms §7, plan 39 §8 clause); AvApp privacy declarations (AvApp doc 43); buffer confirmation. Can ship before the cutover; tell AvServ when live |
| #85 (draft) | `/sms`: 319-char notice, all 12 messages word for word, STOP reply, trip notice | Campaign approved **and** number moved (AvServ); AvApp consent line naming accident alerts + new screenshot; check against plan 38a §0/§4 once AvServ #168 merges |
| #82 (draft) | `/alerts`: automatic accident alerts | Same release as #85 |

## 5. Other portal-owed work

| Item | Source | Status |
|---|---|---|
| `/contribute` (donations + dataset guidance) | AvApp doc 35 D1 | Minimal static page live (#141); payment link gated on the LLC's Stripe/bank + counsel |
| DonationLedger (D1+ migration) | AvApp doc 35 | ⬜ |
| SAR directory page | AvApp doc 35 | ⬜ |
| Org type "Ski-area patrol" + verification queue | AvApp doc 36 (resort onboarding) | ⬜ |
| Tokenised map link for partner alerts | AvApp doc 41 row 117 | Candidate only |
| Deletion requests fulfilled by hand | AvApp doc 41 §2.2 | Operator process (runbook "Data-deletion requests"); none pending on 2026-10-19 (both completed). Automation = plan 35 |

## 6. Later phases (rmdig-ai 00–05)

| Phase | Portal work | Status |
|---|---|---|
| 2 | Capture review queue, DataLedger views, dispute flags | Blocked — SnowDB doesn't exist |
| 3+ | Alert history, check-out/check-in history views | ⬜ |
| 4 | Stripe Connect, payouts, W-9, `/settings/tax`, period close; SAR donations page; "Download my data" | ⬜ Deliberately gated |

## 7. Done recently

**2026-10-15 → 10-19:** `/collection_signup` restored at its press-linked path, with
volunteer emails to staff (#160) · `/founder` (#160) · plan 36 written and decided
(#161, #162) · local dev and Vercel Development moved off production to `local-dev` ·
old Render site suspended (503) · Devices page refreshes itself after a link code is
used (#163) · hashed session tokens + `auth_time` (#164) · `/settings/sessions`,
`/settings/reauth`, other browsers signed out on credential changes, a password reset in
one transaction, `account_security_events` (#165) · re-auth password-only after the
Google test failed (#166) · phone sign-out on the mock: device-admin key role, every-node
list, `sessions.auth_method`, field-data warning only for full (#167) ·
`/settings/security` + opt-in notices + daily cron (#168) · due-back time in the revoke
warning (#169) · passkeys, password to turn two-factor off (#170) · `MFA_ENFORCEMENT=all`
· the PagerDuty "erasure" false pages traced to AvServ's `rules.yml` (fixed in AvServ rc72) ·
`/privacy` covers sign-in records, passkeys, the security log and notices.

**2026-09-30 → 10-02:**

`/sms` matches the July filing (#78, #80) · `/alerts` duplicates + "not a beacon / never
calls 911" (#81) · migration guard + required checks on `main` (#84) · nightly encrypted
R2 backups, restore-drilled (#86) · production outage fixed (§1 incident) · company-name
spacing on `/privacy`/`/terms` (#87, open).

## 8. Housekeeping

- Cross-repo docs out of date: AvApp doc 41 row 3f (`/sms` screenshot — done in #80);
  AvApp doc 40 Q9 (the portal page for `identity_locked` is `https://rmdig.ai/settings`).
- Maintenance: DMARC `p=quarantine` → `p=reject`; Sentry and Neon plan decisions
  ([infrastructure.md](../infrastructure.md) "Maintenance").
- Prune merged local branches.
