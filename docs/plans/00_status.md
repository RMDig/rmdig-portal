# 00 — Portal status and what's left

> **As of 2026-10-02** (main `02d0a5b`). This is the one place to see where every
> portal plan stands. The plans themselves stay the specs; update this file when a
> milestone moves. Sources: [CLAUDE_BOOTSTRAP.md](../../CLAUDE_BOOTSTRAP.md) §4 (Phase 1),
> rmdig-ai `docs/plans/00–09`, this folder's plans 30–32, and the AvApp/AvServ plans
> that name portal work.

## 1. Production gaps (operator, do first)

| Gap | Effect today | Fix |
|---|---|---|
| AvServ link in production: `AVSERV_BASE_URL` (avserv-2) and failover (avserv-3) set; AvServ installed `svc-key-portal-1` | Configured, **not yet verified** | Sign in on production and open Settings → Devices; logs should show `avserv.map.linked` |
| SAR proof uploads: Blob store connected, OIDC auth (#90) | Configured, **not yet verified** | One test SAR application with a PDF, then reject it |
| Previews could not sign in (no Preview `NEXTAUTH_SECRET`) and forked production data | Fixed in code by the previews PR; needs the operator setup | runbook "Preview deployments" |
| `MFA_ENFORCEMENT` unset in Production (defaults to `admin_only`) | Intended until public launch | Flip to `all` at public launch (P1.5) |

**Incident record — 2026-10-01/02:** production server routes returned 500 for ~20 h
because the Production database variable was saved as `DATABSE_URL` during a password
rotation. Lesson in [runbook](../runbook.md) "Rotating the database password".

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
| P1.5 `MFA_ENFORCEMENT=all` | ⬜ At public launch | |

## 3. Portal plans

| Plan | Status | Waiting on |
|---|---|---|
| [30 Advertiser portal](30_advertiser_portal.md) | AD-P1–P7 ✅ merged (#24–#31), publish runs on the AvServ mock | AvServ publish contract (plan 30 §11); **O3 AdLedger ratification** (portal-owned, blocks Phase 3 billing) |
| [31 Agreement onboarding](31_account_agreement_onboarding.md) | ✅ merged (#77) | **Counsel**: agreement text, assent/attestation wording, minimum age, individuals-only, privacy acknowledgement, retention vs deletion, scroll-to-agree (D2). Then AvServ publishes v1 → `pnpm agreement:pin v1` within 30 days; capture on. Also §1 |
| [32 Restriction review](32_restriction_review.md) | ✅ merged (#83), runs on the mock | AvServ builds plan 39 (after v1.5) |

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
| `/contribute` (donations + dataset guidance) | AvApp doc 35 D1 | Local branch `feat/35-d1-contribute-page`, never pushed; payment link gated on the LLC's Stripe/bank + counsel |
| DonationLedger (D1+ migration) | AvApp doc 35 | ⬜ |
| SAR directory page | AvApp doc 35 | ⬜ |
| Org type "Ski-area patrol" + verification queue | AvApp doc 36 (resort onboarding) | ⬜ |
| Tokenised map link for partner alerts | AvApp doc 41 row 117 | Candidate only |
| Deletion requests fulfilled by hand (AvServ has no purge endpoint) | AvApp doc 41 §2.2 | Operator process until AvServ v1.5+ |

## 6. Later phases (rmdig-ai 00–05)

| Phase | Portal work | Status |
|---|---|---|
| 2 | Capture review queue, DataLedger views, dispute flags | Blocked — SnowDB doesn't exist |
| 3+ | Alert history, check-out/check-in history views | ⬜ |
| 4 | Stripe Connect, payouts, W-9, `/settings/tax`, period close; SAR donations page; "Download my data" | ⬜ Deliberately gated |

## 7. Done recently (2026-09-30 → 10-02)

`/sms` matches the July filing (#78, #80) · `/alerts` duplicates + "not a beacon / never
calls 911" (#81) · migration guard + required checks on `main` (#84) · nightly encrypted
R2 backups, restore-drilled (#86) · production outage fixed (§1 incident) · company-name
spacing on `/privacy`/`/terms` (#87, open).

## 8. Housekeeping

- Cross-repo docs out of date: AvApp doc 41 row 3f (`/sms` screenshot — done in #80);
  AvApp doc 40 Q9 (the portal page for `identity_locked` is `https://rmdig.ai/settings`).
- Maintenance: DMARC `p=quarantine` → `p=reject`; Sentry and Neon plan decisions
  ([infrastructure.md](../infrastructure.md) "Maintenance").
- Move local development off the production database (`.env.local` points at the
  production endpoint).
- Prune merged local branches.
