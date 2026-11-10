# 00 — Portal status and what's left

> **As of 2026-11-02**: §0, §3 rows 35–36 (row 37: 2026-11-09), §4, §4a, §5 and §7 are current; rows
> not touched since **2026-10-02** say so. This is the one place to see where every
> portal plan stands. The plans themselves stay the specs; update this file when a
> milestone moves. Sources: [CLAUDE_BOOTSTRAP.md](../../CLAUDE_BOOTSTRAP.md) §4 (Phase 1),
> rmdig-ai `docs/plans/00–09`, this folder's plans 30–36, and the AvApp/AvServ plans
> that name portal work.

## 0. Waiting on others (as of 2026-11-02)

**Done 2026-10-20:** AvServ plan 52 B1/B2 live (rc74; doctor OK on rc79). The device-admin key
`svc-key-portal-device-admin-1` is installed on both nodes (`device_admin` only;
`svc-key-portal-1` doesn't hold it) and set in Vercel Production (the build check passed).
Phone sign-out and the App Lock reset code are live and proven on the owner's devices:
previews and limited revokes recorded by both nodes (first at 06:44Z, more 17:48–17:58Z);
reset codes redeemed in AvAI. Every check in AvApp's list passed. The security-events feed went
live the same day (rc80); actions before 18:25Z were never recorded.

**AvServ**
- **Plan 63 contact acceptance**: the gates and cutover are in §4a. The fixed drill device
  (AvServ #436) and the plan 64 notice are gates for `enforced`.
- **Six retention changes**, then `data_retention.md` rev 3 (§4a).
- Plan 52 PR C: live in rc106, along with the link-code 429 (#188). The code format stays
  8 characters of `[A-Z0-9]`.
- **Plan 39 restrictions**: unblocks plan 32 (restriction review, on the mock) and plan 57.
- **Plan 57 contracts**: `false_alarm_reports.md`, restrictions rev 2, the per-user block,
  the SAR disposition call; REPORT keyword in a later A2P filing.
- **Plan 47 4c**: unblocks plan 35 (automated deletion), with the owner's D1–D10 decisions. The
  erasure key itself is installed on AvServ and set in Vercel Production.

**Counsel**
- **v10.26.26 User Agreement, Terms and Privacy Policy**: our v4 markup and questions went to
  counsel 2026-11-02, after AvServ and AvApp checked them. Waiting on the reply (§4a).
- **Security change log**: retention (AvServ proposes 400 days, held while live) and what
  account erasure does to it (default: deleted). `/privacy` has the `[LAWYER]` slot.
- **Review the 2026-10-19 `/privacy` additions** (sign-in records, passkeys, security log,
  notices) and the volunteer sign-up section (2026-10-15).
- Already listed: plan 31 agreement text and assent; every `[LAWYER]` in `/privacy` and
  `/terms`; plan 34 team areas; plans 35/47 deletion and erasure; `/contribute` payment
  wording; plan 57 (defamation, rescue-billing discovery, retention, REPORT disclosure,
  SAR disposition terms) with a DV-advocate review shared with AvApp plan 55.

**Owner**
- **Due since about 2026-10-26** (the passkey's 7th day): test a **full** phone sign-out on a
  stale test device, confirmed with the passkey; expect the "Unsynced observations and photos…
  will be erased" warning. AvApp then checks the phone's side. A phone already signed out as
  limited (one was, 2026-11-05, signed in by code) can be made full with "Make this stronger".
- **Operator erasure drill** with a test account that has a check-out and a contact (#186, AvServ
  `docs/drills/cpa-deletion.md`). It also closes the 10-11 deletion follow-up.
- **After #188:** generate a link code on `/settings` and link a device by typing it with the dash.
- **Contacts page after #187:** check `/settings/contacts` on production against the app's list.
- **AvServ:** confirm the 30-day R2 lifecycle rule, merge #436, #437 and ops #9, and tag rc107.
- App Lock in tester store builds: whether v1 TestFlight / Play internal include
  `AVAPP_APP_LOCK=true` (AvApp doc 41 row 11). Device builds have it since 2026-10-20.
- Sentry: "Prevent storing IP addresses" and server-side scrubbing (plan 36 §11), if not done.
- HSTS preload: eligible, not submitted (a deliberate, near-permanent choice; plan 36 §11).
- **CSP enforced (#184):** sign in on production and open `/map` and `/settings/devices` with the
  console open, to confirm nothing is blocked, if not done.
- **SAR payload sealing:** confirm the next real or drill alert reads normally on the team's
  Alerts page (#179).
- **Key rotation table** (runbook): fill in "Last rotated" as keys are rotated.

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
| [33 Map and SAR workspace](33_map_and_sar_workspace.md) | Phase 1 `/map` ✅. Phases 3–4 portal half mostly ✅ (org type incl. patrol, resubmit, team terms, AvServ sync, intake + team email, RED layer, members, private proof; §4 "Built"). ORANGE, suspension email, Phase 2 (own history) ⬜. **Revision 2 (2026-11-04):** owner D1–D9 and the +9 PR sequence 9.0–9.14 (§6) | AvServ sync revision 2 on every node (`syncRevision ≥ 2`) for 9.7–9.9; AvServ team email (9.10) and ORANGE v1 (9.14); owner decided O1, O2, O7 and O8 2026-11-05 (§6.8); the Vercel Pro upgrade before 9.11; counsel (ORANGE, phone consent, field list); A2P 38a re-filing (D7) |
| [34 Team areas on the public map](34_public_team_area_map.md) | Planned, not built. Overlap display set 2026-11-04 (§3) | Counsel |
| [35 Automated deletion](35_automated_deletion.md) | Draft. An operator erases from the deletion queue (#186, runbook "Data-deletion requests"); no worker yet | AvServ plan 47 4c; owner's D1–D10; counsel |
| [36 Account security and hardening](36_account_security_and_hardening.md) | **Live:** hashed sessions + `auth_time` (#164), sessions page + re-auth + sign-out on credential changes (#165, #166), passkeys (#170), `MFA_ENFORCEMENT=all`, security activity + opt-in notices (#168, phone-side rows since AvServ rc80), phone sign-out limited/full + due-back time (#167, #169), App Lock reset code + link-code limit (#172, #173). **Hardening live 2026-10-20:** PR 4 DB TLS / https / no PII in logs / no OAuth tokens (#174); PR 5 TOTP key id + reused-code refusal (#175, 0034); PR 6 nonce CSP (#176, fixed on Vercel by #177; Zod jitless #178), **enforced 2026-10-27** (#184); PR 13 SAR alert details sealed + "Key rotation" table (#179). **Left:** S6 / plan 57 | Owner: full sign-out test (overdue); counsel (security log retention); plan 57 gates |
| [37 Drill teams and drill logins](37_drill_teams.md) | P1–P6 merged (#207–#213), 2026-11-10; drill team not yet registered. P7 (drill AvAI user) waits. Portal half of AvServ plan 66 | P7: Phase D's first pass, AvServ plan 66 §9 (#488), an AvApp drill build |

## 4. Incident Detection re-filing (AvServ plans 38/38a/38b)

The corrected campaign was auto-rejected (30882 terms, 30908 privacy): vetters reject
visibly unfinished legal pages.

| PR | Contents | Waiting on |
|---|---|---|
| #79 (draft) | `/privacy` + `/terms` for the filing: per-profile Incident Detection data, every message type, carrier line, support contact | **Counsel** (banner + every `[LAWYER]`, terms §7, plan 39 §8 clause); AvApp privacy declarations (AvApp doc 43); buffer confirmation. Counsel's v10.26.26 text describes contact acceptance, so it now ships with the §4a cutover, not ahead of it; tell AvServ when live |
| #85 (draft) | `/sms`: 319-char notice, all 12 messages word for word, STOP reply, trip notice | Campaign approved **and** number moved (AvServ); AvApp consent line naming accident alerts + new screenshot; check against plan 38a §0/§4 once AvServ #168 merges |
| #82 (draft) | `/alerts`: automatic accident alerts | Same release as #85 |

## 4a. Contact-acceptance cutover (counsel's v10.26.26 text + AvServ plan 63)

Counsel's User Agreement, Terms and Privacy Policy say a contact must accept before a user can
check out, and the Terms say SMS consent comes from that acceptance. Today the gate is off and the
approved A2P filing says YES is optional. So they go live in one cutover, not one at a time.

**Gates** (facts from AvServ, 2026-11-01)

| Gate | Owner | State |
|---|---|---|
| Final text of all three, the assent line and the tick boxes | Counsel | v4 markup sent 2026-11-02. It corrects STOP (ends texts, not alerts), Send Help under acceptance, how a SAR team is reached, and removes the planned route, which isn't built |
| User Agreement step (b) says "a text message and/or email" | Counsel | At launch a text reply is the only way to accept; email acceptance is plan 63 phase 2, with no route today. v4 suggests text only |
| Plan 64 notice to the account holder | AvServ, AvApp, counsel | **Gate for `enforced`.** Not live: AvServ steps 1–3 are merged and the sweep sends nothing; the email is being built (AvServ #437 merged the design). AvApp's in-app notice is merged (#430, #431) and ships in 1.0.0+8, but it can't fire until AvServ deploys contract rev 13. No SMS, so nothing joins the re-filing. Live means the email is on every node and the AvApp build with the notice is the minimum build. Counsel has the notice text; "no one will be alerted" goes out only when no contact can be reached by text or email and no SAR team is bound to the trip |
| Privacy Policy retention chart | AvServ, counsel | Rev 2 is on AvServ main; rev 3 isn't written. v4 carries the rows, including the portal's invitations row. Rows marked "Decided, being built" publish only once rev 3 marks them built. R2's 30-day rule is unverified |
| Email opt-out for contacts | AvServ, counsel | Moves with the contact email field: no real contact has an email stored on either node (AvServ, 2026-11-02). The field must not ship first, or a contact who replies STOP gets alert emails they can't stop. Both come before live alpha, and neither gates `enforced` |
| Contact email field | AvApp | Not built: Add Contact takes name and phone, and the portal's contacts page is read-only. Owner, 2026-11-02: it can be developed during the beta and ships before live alpha. v4 marks it "when that option is available" |
| Avalanche wording off the filing and `/sms` | AvServ, portal | Owner removed it 2026-11-01. It's out of plan 38a's description; drafts #85 and #79 still have it |
| Second SMS provider stays in brackets | AvServ | Telnyx carries no live traffic; both nodes send through Twilio only |
| Fixed drill device | AvServ, owner | **Gate for `enforced`.** Built and merged (AvServ #436, ops #9). Its credentials live in a private file on the operator's Mac, not in a repo. Kill-a-node, burst and clock skew all work under `enforced` |
| Drills that must run before `enforced` | Owner | Carrier failure, because its landline can't reply YES (only while the stage is `off` or `notice`); plan 63 production drill (refused before the YES, armed after); harness drill on the build being switched |
| Plan 38a A2P re-filing approved | AvServ, owner | Not approved yet; replying YES becomes required (plan 63 A6) |

**Ships together**, with the exact order agreed with AvServ once dates are known:

- AvServ moves plan 63 to `enforced`.
- `/sms` changes with the approved filing, because it quotes the filed text word for word (#85, with #82).
- `/privacy` and `/terms` carry counsel's final text (#79); effective dates set at publish.
- AvServ and AvApp publish the agreement, then `pnpm agreement:pin v1` within 30 days (plan 31).
- `/terms` loses "We don't yet notify you when this happens" once a user can get the notice: AvServ on contract
  rev 13 and AvApp 1.0.0+8 available. Word it for the app alone if AvServ's email isn't live yet.
- `/settings/contacts` changes from "moving to require" to "required". Decide then whether to also
  say only accepted contacts get alerts (plan 63 A12).

## 5. Other portal-owed work

| Item | Source | Status |
|---|---|---|
| `/contribute` (donations + dataset guidance) | AvApp doc 35 D1 | Minimal static page live (#141); payment link gated on the LLC's Stripe/bank + counsel |
| DonationLedger (D1+ migration) | AvApp doc 35 | ⬜ |
| SAR directory page | AvApp doc 35 | ⬜ |
| Org type "Ski-area patrol" + verification queue | AvApp doc 36 (resort onboarding) | ✅ `ski_patrol` org type, approvals queue, patrol re-verify cron (checked 2026-11-04) |
| Tokenised map link for partner alerts | AvApp doc 41 row 117 | Candidate only |
| Deletion requests fulfilled by an operator | AvApp doc 41 §2.2 | **Erase in AvServ** on the request's card (#186), the CLI as fallback (runbook "Data-deletion requests"); none pending on 2026-10-19 (both completed). Automation = plan 35 |

## 6. Later phases (rmdig-ai 00–05)

| Phase | Portal work | Status |
|---|---|---|
| 2 | Capture review queue, DataLedger views, dispute flags | Blocked — SnowDB doesn't exist |
| 3+ | Alert history, check-out/check-in history views | ⬜ |
| 4 | Stripe Connect, payouts, W-9, `/settings/tax`, period close; SAR donations page; "Download my data" | ⬜ Deliberately gated |

## 7. Done recently

**2026-11-01 → 11-05:** status and contact-acceptance cutover gates written, E2E runner
pinned (#189) · `/privacy` names Postmark (#190) · STOP and phone sign-out claims corrected on
public pages (#191) · `/privacy` states precise location, `/terms` the START exception (#192) ·
`/privacy` problem-reports section, matched to AvApp #436/#437/#442 for 1.0.0+8 (#193).

**2026-10-27 → 11-01:** AvAI account card hidden while setup is closed, portal data inventory
(#181) · expired sessions, tokens and rate-limit rows deleted daily (#182) · `/privacy` matches
the app's privacy manifest (#183) · CSP enforced (#184) · unaccepted invitations deleted 7 days
after they expire (#185) · Erase in AvServ from the deletion queue (#186) · `/settings/contacts`
shows who has accepted (#187) · AvServ's link-code 429 handled, codes shown as ABCD-EFGH (#188).

**2026-10-20:** plan 36 hardening live: DB TLS, https-only AvServ URLs, IP pseudonyms,
phone redaction, hashed rate-limit keys, OAuth tokens no longer stored (#174) · TOTP
secrets with a key id, `pnpm mfa:reencrypt`, a used code refused within its window
(#175, migration 0034) · nonce CSP Report-Only (#176); on Vercel any second CSP header
replaced the nonce one, so it's now the only one (#177) · Zod jitless in the browser
(#178) · SAR alert position, route and note sealed at rest, intake 503 and a failed
build without the key, runbook "Key rotation" (#179).

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
  AvApp doc 40 Q9 (the portal page for `identity_locked` is `https://rmdig.ai/settings`);
  AvApp plan 41 (says no drills have been run).
- Maintenance: DMARC `p=quarantine` → `p=reject`; Sentry and Neon plan decisions
  ([infrastructure.md](../infrastructure.md) "Maintenance").
