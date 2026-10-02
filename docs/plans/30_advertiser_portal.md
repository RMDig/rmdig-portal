# 30 — Advertiser Portal (rmdig-portal side of AvApp doc 30)

> **Status (2026-10-02): AD-P1–AD-P7 BUILT and merged (#24–#31); publish runs against the AvServ
> mock only.** Open: the AvServ publish contract (§11) and O3 AdLedger ratification. See
> [00_status.md](00_status.md). Originally a design doc: it specified the rmdig-portal surface for
> self-served sponsor ads so the build could start without re-deciding architecture. **v2+ scope — off the v1 TestFlight / v1.5 AvAI critical path** (rmdig-ai
> `07_portal_bootstrap.md` §1.5; AvApp doc 24).
>
> **Numbering.** Mirrors AvApp `docs/plans/30_advertising_and_house_ad_distribution.md` so the two
> sides of the same capability share a number across repos. AvApp doc 30 is the **product +
> client + distribution** owner; this doc is the **advertiser-facing web surface** owner. Where
> they disagree, AvApp doc 30 wins — flag the drift, don't fork the decision.

---

## 0. Source of truth (do not re-decide these here)

The client/architecture decisions are already specced in AvApp. This doc consumes them; it does not
re-open them. (These were drafted on an AvApp feature branch; as of 2026-06-17 they are on the active
AvApp checkout — read AvApp `docs/plans/` directly.)

| Source | Owns |
|---|---|
| AvApp doc 30 — `30_advertising_and_house_ad_distribution.md` | House-ad model, slot set, §0 safety fences, impression policy, client behavior, phasing |
| **AvApp doc 31 — `31_ads_forecastzone_wire_contract.md`** | **The byte-level cross-repo wire contract** (manifest, impressions endpoint, zone snapshot, ledger/storage/principal resolutions). Created 2026-06-17 to close this doc's §11 G1–G8. **Authoritative for all wire shapes.** |
| AvApp doc 18 §8.0 — `18_external_data_and_weather.md` | **Canonical** `ForecastZone` taxonomy — now a versioned 3-level hierarchy: **Provider → ZoneSet (effective-dated) → ForecastZone** (provider-agnostic) |
| AvApp doc 21 §10.1 — `21_avai_viability_coherence_analysis.md` | NA-standard avalanche-problem grid (`problem_type × elevation_band × aspect_octant`) — the *vocabulary* axis, already provider-agnostic |
| AvApp doc 12 T22 — `12_structural_tensions.md` | The CAIC-coupling-vs-national-expansion decoupling decision; code-level abstraction is a v2+ follow-up across co-local repos |

> **Revision note (2026-06-17).** This doc was first written 2026-06-16 against the then-current AvApp
> drafts and flagged eight contract gaps (§11). AvApp answered by creating **doc 31**, which resolves
> most of them — and changed two things this doc now reflects: (a) the `ForecastZone` model gained
> versioned, effective-dated **zone sets**; (b) v1 creatives are **text-only** (headline/body), with
> image creatives deferred to a later manifest rev. Sections §5–§8 and §11 are updated accordingly.
>
> **Revision note (T23, 2026-06-23).** AvApp **decoupled ad targeting from `ForecastZone`** (doc 31 §3,
> doc 12 T23). Ads now target commerce geography — **national + radius + admin (state/county/place)**
> from off-the-shelf US Census data — not snowpack-shaped forecast polygons. Consequences folded in
> here: the `ad_creatives` region tuple became the `target_*` columns (§5, migrations 0009/0010); §7 is
> now the radius/admin **target picker** (AD-P7, no longer Phase-3-gated on the zone feed); the
> impression `regionBucket` is a coarse **admin** unit (state at launch, advertiser K=25 — §8); and
> the old O2/G5 zone-catalog dependency is **gone from ads** (now prediction-only). The forecast-zone
> *prediction* lens (doc 18 §8.0) is unchanged and still owned elsewhere.

**Carried-over non-negotiables (restated so the portal build can't lose them):**

1. **Ads never touch the safety spine.** Ad fetch is lowest-priority and fails silent (AvApp doc 30 §0).
   *Mostly an AvApp/AvServ concern, but the portal inherits one structural duty:* the portal may only
   ever let an advertiser bind a creative to the **closed set of approved slots** (§4). No free-form
   placement; no slot that renders before a safety action.
2. **Geo-targeting is CLIENT-SIDE only.** This server/portal **must never receive a user's location
   for ad selection.** AvServ distributes the *full* signed manifest; the device filters it on-device
   (AvApp doc 30 §4.2). The portal's "target" concept (§7) is the **advertiser's chosen audience
   geometry** tagged onto a creative — it is *not* user location and must never be conflated with one.
3. **Impressions are aggregate-only.** Zero per-user ad logs; k-anonymity floor by region
   (AvApp doc 30 §5.1). The portal **stores no per-user impression data** and only ever *displays*
   aggregate counts it reads back from AvServ.
4. **The ad-targeting lens is SEPARATE from avalanche prediction (T23, AvApp doc 31 §3).** Ads target
   where *commerce* happens — towns/counties/radii from off-the-shelf US Census data — **not**
   `ForecastZone` polygons (those are the snowpack-shaped *prediction* lens). The portal's target
   picker (§7) is national + radius + admin (state/county/place); it has **no** dependency on the
   `ForecastZone` catalog or its national feed (T22/O2 is now prediction-only).

---

## 1. Scope

| In scope (this doc / this repo) | Out of scope (owned elsewhere) |
|---|---|
| Advertiser **account type + role** (a new portal principal) | The signed **ad-manifest** build + distribution + signature — AvServ, shape per AvApp doc 31 §2 |
| **Creative authoring** (text headline/body + click-through; image asset deferred) | The **client ad-slot widget** + on-device geo-filter — AvApp (doc 30 §4, doc 31 §3) |
| **In-slot preview** (advertiser sees the render) | **Impression counting/aggregation + k-anon floor** — AvServ (doc 31 §4) |
| **Submit-for-approval** workflow | On-device geo-match against the signed manifest — AvApp (doc 31 §3) |
| **Operator approval queue** | US Census boundary data (TIGER/Gazetteer) sourcing — off-the-shelf, public domain |
| **Target picker** (national + radius + admin state/county/place — AvApp doc 31 §3) | Avalanche `ForecastZone` taxonomy + feed — **prediction-only**, no ad dependency (T22 / T23) |
| **AdLedger of record** (portal DB, keyed on `advertiser_id`) — resolved AvApp doc 31 §5 | Alert dispatch, capture review, anything on the safety spine |
| *(Phase 3)* **billing** (Stripe purchase) wired to the AdLedger | — |

**Hard repo constraints this design must honor** (rmdig-ai `07_portal_bootstrap.md` §1):
no cross-service DB access (the portal reads AvServ only through its API); no silent failures
(Sentry + structured log + user-visible error); migrations append-only; no Stripe until its phase;
no production secrets in code.

---

## 2. What we already have (the "how close are we" answer)

The advertiser surface is **the SAR-onboarding module with the nouns changed.** Almost every
mechanism exists and is battle-tested in this repo:

| Advertiser need | Existing precedent in this repo | File |
|---|---|---|
| A new principal with a lifecycle + manual operator approval | `sar_orgs` + `sarOrgStatus` state machine | `lib/db/schema.ts:166`, `:210` |
| Tie users to that principal with a role | `org_memberships` + `orgRole` enum | `lib/db/schema.ts:251`, `:188` |
| Operator approval queue (list pending, decide, audit) | `/admin/sar-approvals` page + `reviewSarOrgAction` | `app/(portal)/admin/sar-approvals/` |
| Append-only audit of every status transition | `sar_org_status_log` | `lib/db/schema.ts:309` |
| Platform-staff gate on the queue | `isPlatformStaff` / `userPlatformRoles` | `lib/auth/roles.ts`, `lib/db/schema.ts:126` |
| File upload (validate type/size → object store) | `uploadProofDoc` → Vercel Blob | `lib/blob/upload.ts` |
| Shared Zod schema (form ⇄ server action) | `createSarOrgSchema` | `lib/sar/schema.ts` |
| Transactional decision + email-after-commit | `reviewSarOrgAction` (tx, then notify) | `app/(portal)/admin/sar-approvals/actions.ts` |
| PostGIS polygon stored out-of-Drizzle via raw SQL | `region_geom` on `sar_orgs` + `lib/sar/geo.ts` | (SAR-only; the §7 ad target picker uses radius/admin FIPS, not PostGIS) |
| S2S to AvServ with a short-lived Ed25519 service JWT, mock-first | `lib/avserv/client.ts` (`mock://` scheme) | `lib/avserv/client.ts` |
| Transactional email via Resend + React Email | `lib/email/send.ts`, `lib/email/templates/` | (advertiser decision/submitted emails) |

**Genuinely new portal work** (none needs new infrastructure):
1. Advertiser principal: `advertiser_accounts` + `advertiser_memberships` (+ optional `ad_reviewer` role).
2. Inventory metadata: `ad_campaigns` → `ad_creatives` (slot binding, schedule, optional target tag).
3. Creative-approval state machine + audit log (mirrors `sar_org_status_log`).
4. Text-creative authoring + **in-slot preview** component (renders the slots faithfully from the
   doc 31 §2 `display` shape; image upload deferred to a later manifest rev).
5. The advertiser dashboard + operator approval queue pages.
6. The portal→AvServ **publish-approved-creative** S2S call (new client method; §6).
7. The AdLedger (portal DB, doc 31 §5) — Phase 1 hand-entered, Phase 3 Stripe-wired.
8. The radius/admin **target picker** (§7, AD-P7) + *(Phase 3)* Stripe purchase.

---

## 3. Principal & role model

Reuse the portal's **one unified login, behavioral profiles by role-held** pattern
(rmdig-ai `01_accounts_and_orgs.md`). An "advertiser" is just a user who is a member of an
`advertiser_account` — exactly how a "SAR responder" is a user with an `org_membership`.

- **`advertiser_accounts`** — the billable advertiser entity (a gear shop, guide service, regional
  safety org). Mirrors `sar_orgs`: name, contact, status, `createdByUserId`, audit timestamps.
- **`advertiser_memberships`** — `(advertiser_id, user_id, role)` with `advertiserRole ∈ {admin, editor}`.
  `admin` manages billing + members; `editor` uploads/edits creatives. Least-privilege at invite,
  mirroring `org_memberships`/`orgRole`. Device-linking / AvServ-account mapping is **not** required
  for advertisers (they never touch the safety domain) — leave `avservAccountId` untouched.
- **Operator side:** reuse `userPlatformRoles`. The approval queue gates on `isPlatformStaff`.
  - **Reviewer role (doc 31 §7 + O4 — portal-local operator decision):** today `rmdig_reviewer` is
    documented as "SAR-org approval queue only" (`lib/db/schema.ts:121`). Either (a) broaden
    `rmdig_reviewer` to cover creative approval too, or (b) add a dedicated `ad_reviewer` role. Doc 31
    confirms this is a **portal-local** call (not an AvApp contract concern) and the portal **leans (a)
    broaden for Phase 2**. Either is a one-line `pgEnum` add; revisit (b) if creative review is ever
    delegated separately.

**Advertiser principal — RESOLVED (AvApp doc 31 §7):** the advertiser is **not** a new browser-JWT
tier. Advertiser access is a **capability grant on the canonical account via portal-mediated S2S
(identity direction B)** — matching AvApp doc 15 §12 C3 and the SAR-org onboarding precedent this
module reuses. So advertisers authenticate only to the portal; all portal→AvServ traffic is the
existing **S2S service JWT** (`lib/avserv/service-jwt.ts`); AvServ sees only published approved
creative records, never advertiser PII. This is the boundary this doc originally recommended, now
ratified — advertiser PII stays in the portal.

---

## 4. Slots are a closed enum (the one safety duty the portal carries)

AvApp doc 30 §4 defines exactly three slots; the portal must treat them as a **closed set** an
advertiser selects from — never a free-form placement field:

| Slot id | Where (AvApp) | Phase |
|---|---|---|
| `loading_idle` | app loading screen, only when no check-out is active | 1 |
| `post_checkout` | check-out confirmation page (post-resolution) | 1 |
| `post_checkin` | check-in confirmation page (post-resolution) | 1 |

`post_checkout` and `post_checkin` are **two independently-buyable slots** with **per-slot creatives**:
an advertiser may reuse one asset for both, supply two distinct assets, or buy only one (AvApp doc 30
§4). The inventory model (§5) therefore binds a creative to **one** slot; "reuse" = two creative rows
with the same headline/body. (`loading_idle` is in the enum but **reserved** — the client isn't wired
for it yet per AvApp doc 31 §1; the portal can store it but it won't render until AvApp ships it.)

Because all three are post-resolution / idle, the §0 bright-line ("an ad may appear *after* a safety
action resolves, never *before* one") holds for any selection the portal can express. The portal
enforces this **structurally**: `slot` is a Postgres enum of exactly these values; there is no code
path to target anything else.

---

## 5. Data model (proposed — design only, no migration in this PR)

Drizzle style matches `lib/db/schema.ts` (camelCase TS ⇄ snake_case DB, `pgEnum`, status index,
append-only audit log). Sketched as SQL-ish for review; the real artifact is a Drizzle schema edit +
`drizzle-kit generate` later.

```
-- advertiser entity (mirrors sar_orgs)
advertiser_accounts (
  id              uuid pk default random,
  name            text not null,
  contact_name    text not null,
  contact_email   text not null,
  contact_phone   text,
  website_url     text,
  status          advertiser_status not null default 'active',   -- {active, suspended}
  created_by_user_id uuid not null -> users.id,
  created_at      timestamptz not null default now()
)
advertiser_status enum: active | suspended

-- membership (mirrors org_memberships)
advertiser_memberships (
  advertiser_id   uuid not null -> advertiser_accounts.id (cascade),
  user_id         uuid not null -> users.id (cascade),
  role            advertiser_role not null,                       -- {admin, editor}
  joined_at       timestamptz not null default now(),
  invited_by_user_id uuid -> users.id (set null),
  pk (advertiser_id, user_id),
  index (user_id)
)

-- a campaign groups creatives + (Phase 3) carries the buy/schedule
ad_campaigns (
  id              uuid pk default random,
  advertiser_id   uuid not null -> advertiser_accounts.id (cascade),
  name            text not null,
  starts_on       date,                       -- nullable until scheduled
  ends_on         date,
  created_at      timestamptz not null default now()
)

-- one creative = one display bound to one slot (the approval unit).
-- v1 manifest is TEXT-ONLY (AvApp doc 31 §2 `display`): headline + body. The
-- image asset path (image_ref/asset_*) is RESERVED for a later manifest rev.
ad_creatives (
  id              uuid pk default random,
  campaign_id     uuid not null -> ad_campaigns.id (cascade),
  slot            ad_slot not null,                               -- closed enum (§4)
  headline        text not null,             -- maps to manifest display.headline
  body            text not null,             -- maps to manifest display.body
  click_url       text,                      -- optional tap-through; validated, https-only
  alt_text        text not null,             -- accessibility; required
  image_ref       text,                      -- RESERVED (later rev): R2 object key, doc 19 §3
  -- advertiser's CHOSEN ad-targeting lens (NOT user location). doc 31 §3, T23.
  -- A CHECK binds each kind to exactly its columns (§7). national = all NULL below.
  target_kind          ad_target_kind not null default 'national',  -- national | radius | admin
  target_lat           numeric,              -- radius: advertiser's pin
  target_lon           numeric,
  target_radius_mi     integer,              -- radius: 5–250 mi (CHECK-bounded)
  target_admin_level   ad_admin_level,       -- admin: state | county | place
  target_admin_fips    text[],               -- admin: non-empty FIPS codes at that level
  status          ad_creative_status not null default 'draft',
  review_note     text,                      -- latest reject/changes note shown to advertiser
  submitted_at    timestamptz,
  approved_at     timestamptz,
  approved_by_user_id uuid -> users.id (set null),
  -- set once the portal has pushed an approved creative to AvServ (§6)
  published_at    timestamptz,
  avserv_creative_ref text,                  -- id AvServ returns for the published record
  created_at      timestamptz not null default now(),
  index (status)                             -- the operator queue filters on this
)
ad_slot enum: loading_idle | post_checkout | post_checkin
ad_creative_status enum: draft | pending | approved | rejected | suspended

-- append-only audit (mirrors sar_org_status_log)
ad_creative_status_log (
  id, creative_id -> ad_creatives.id (cascade),
  action          ad_creative_action,        -- submitted|approved|rejected|changes_requested|suspended|reactivated
  from_status ad_creative_status, to_status ad_creative_status not null,
  note text, actor_user_id uuid -> users.id (set null),
  created_at timestamptz not null default now(),
  index (creative_id)
)
```

**Creative-approval state machine** (mirrors the SAR `TRANSITIONS` table in
`app/(portal)/admin/sar-approvals/actions.ts`):

```
draft ──submit──▶ pending ──approve───▶ approved ──publish(S2S)──▶ (in manifest)
                    │                       │
                    │                       └─suspend─▶ suspended ─reactivate─▶ pending
                    ├─reject──────────▶ rejected ─(resubmit)─▶ pending
                    └─request_changes─▶ pending  (status unchanged; note carries the ask)
```

Only `approved` creatives are eligible for the signed manifest (AvApp doc 30 §6). `suspend` is the
operator's pull-it-now lever on an already-approved creative; it must also trigger an **unpublish**
S2S call so AvServ drops it from the next manifest (§6).

---

## 6. Creative storage & the portal→AvServ publish contract (resolved by AvApp doc 31)

The two items this doc originally flagged (old G2 storage path, G3/G4 publish + manifest shape) are
now answered in **AvApp doc 31**. The portal builds to those resolutions:

### 6.1 Where creative bytes live — **portal-staged, handoff-on-approval** (doc 31 §6)

Endorsed exactly as recommended: **unapproved creative bytes never reach AvServ.** For v1 (text-only
creatives) there are no bytes to stage — headline/body live as columns (§5). When **image creatives**
land (later manifest rev), the advertiser uploads to **portal-staged storage** (the existing
`uploadProofDoc` path generalized to `uploadCreativeAsset` → Vercel Blob); bytes sit in the portal
until the approval state machine reaches `approved`, then hand off to AvServ/R2 (doc 19 §3) for
distribution. This keeps the manual-approval gate (§5) the sole path to the distribution tier.

### 6.2 Publish == what ships (doc 31 §2)

The authoritative output shape is the **signed ad manifest** (`GET /v1/ads/manifest`, doc 31 §2):
each entry is `{ id, slotId, target, display: { headline, body, imageRef }, validFrom, validTo }`,
where `target` is `null`/`{kind:'national'}` (app-wide), `{kind:'radius', lat, lon, mi}`, or
`{kind:'admin', level, fips[]}` (doc 31 §3). Two consequences for the portal, both now contractually
pinned (no longer flags):

- **Preview renders from the same `display` shape that ships** (doc 31 §2). The portal's in-slot
  preview (§5 / AD-P4) reads the identical `{headline, body}` shape; **publish is the only writer**.
  This is how "what the advertiser previews == what ships" is guaranteed structurally.
- **Signing trust root is the existing C3 operator key** (doc 31 §2; AvApp doc 15 §12 C3) — the portal
  introduces **no** new signing tier. The portal's job ends at handing AvServ an approved creative;
  AvServ **recompiles + re-signs** the manifest on publish (doc 31 §2).

The portal→AvServ publish/unpublish call (on `approved→published` / `suspend`) remains a new
`lib/avserv/client.ts` method, **mock-first** like every existing AvServ call (`findOrCreateAccount`),
so AD-P1…AD-P6 build and test end-to-end against `mock://` before AvServ ships the real endpoint. The
*byte-level publish endpoint path* itself is the one residual not yet pinned in doc 31 (it specs the
manifest *output*, not the portal→AvServ *input*) — track as a small follow-up against doc 31 §2 / §6
rather than inventing it here.

---

## 7. The target picker (AD-P7 — radius + admin, off-the-shelf US data)

The picker lets an advertiser choose **where their creative is shown** (AvApp doc 31 §3, T23).
Critical framing unchanged: **this is advertiser intent, not user location.** The portal stores a
target tag on the creative; the *device* later matches its own coarse location against the full
manifest on-device. The portal has, and needs, **no user-location endpoint for ads — ever.**

The ad-targeting lens is **separate from avalanche prediction** (T23, decided 2026-06-17): ads
target commerce geography, not snowpack-shaped `ForecastZone` polygons. The target model
(`ad_creatives.target_*`, §5) is the manifest `creative.target` shape:

- **National** (`{kind:'national'}`) — app-wide; the default and today's only authored mode.
- **Radius** (`{kind:'radius', lat, lon, mi}`) — Tier 1, a local buy (gear shop, brewery). The
  advertiser drops a pin and sets a **5–250 mi** radius. On-device match is point-in-circle.
- **Admin** (`{kind:'admin', level, fips[]}`) — Tier 2, regional→national. One Census level
  (state | county | place) + a non-empty set of FIPS codes. On-device match is point-in-polygon
  against the signed `boundarySnapshot` embedded in the manifest (doc 31 §3).
- **Tier 3 (presets)** — curated recreation regions / public lands / optionally a forecast zone —
  is **deferred**, additive later; it would add a `target_kind` value without reshaping the above.

Implementation:
- **Data source: off-the-shelf US Census boundary data** (TIGER/Gazetteer, public domain) — works
  nationally on day one, **no avalanche-center dependency** (the old O2/T22 blocker is gone; that
  feed is now prediction-only). The portal bundles compact `{fips, name, usps, lat, lon}` reference
  sets (states/counties/places) and serves a server-side typeahead for the admin selector (AD-P7b).
- **UI:** radius reuses MapLibre GL (already a dep — `components/map/RegionDrawMap.tsx`) as a
  draggable pin + a slider-driven circle overlay (**not** free-draw; doc 30 §4.2 says don't build a
  free-draw geofence editor). Admin is a name→FIPS multi-select (county gated by state; place via
  typeahead).
- **Structural shape guard:** a Postgres CHECK on `ad_creatives` binds each `target_kind` to exactly
  its columns and bounds the radius to [5, 250] mi, so a malformed target can't persist (§5).
- **k-anonymity:** targeting granularity ≠ *reporting* granularity. An advertiser may target a tight
  radius, but impressions are reported only in a coarse admin bucket (`state` at launch, advertiser
  K=25 — doc 31 §4). The portal never displays a below-floor count; it shows AvServ's already-floored
  aggregates (§8).

---

## 8. AdLedger, billing, and impression display

- **AdLedger of record — RESOLVED (AvApp doc 31 §5): lives in the portal DB**, keyed on
  `advertiser_id`, co-located with Stripe/billing ("the money ledger lives with the money"). This is
  the recommendation this doc originally made, now ratified in doc 31. **AvServ owns only the
  aggregate impression store** and supplies aggregates to the portal. **Remaining action (doc 31 O3):**
  ratify in the portal's `05_ledgers.md` (it currently lives in rmdig-ai; a portal-side ledger doc or
  an rmdig-ai `05` amendment must record the AdLedger). Blocks Phase 3 billing.
- **Billing (Phase 3).** Stripe purchase flow wired to AdLedger (`invoiced → paid → settled`,
  AvApp doc 30 §5). Out of scope until then per repo constraint #5; Phase 2 handles money offline
  (AdLedger `invoiced` / zero-amount house placements).
- **Impression display (read-only).** The advertiser delivery view and any public revenue view
  (AvApp doc 30 §5.2, leaning public) **read aggregate buckets from AvServ**. The wire shape is now
  pinned (doc 31 §4): `{ creativeId, slotId, regionBucket, window, count }`, where `regionBucket` is a
  **coarse admin unit** — `"US-CO"`-style state FIPS/USPS (or null app-wide), **never finer than
  `state`** at launch (note: reporting granularity ≠ targeting granularity — an advertiser may target
  a tight radius but is reported only by state). The endpoint **rejects** any payload carrying a
  user/device id, coordinate, radius, or sub-state region (schema-level, not silently dropped). The
  portal **persists no per-user impression data**; it adds a read-only S2S method
  (`getCreativeImpressions`), mock-first.
  - **k-anonymity floor — RESOLVED (doc 31 §4.1):** advertiser **K = 25** (private view of their own
    campaign), public **K = 50** (may ratchet *up*, never down); region = `state`, window = weekly,
    with a roll-up ladder (state×week → state×month → national×week → national×month → suppress). The
    floor is applied **server-side on AvServ before the portal sees a bucket**; the portal must never
    display or back-compute a below-floor count.

---

## 9. Privacy & safety invariants the portal must structurally enforce

These are testable invariants, not aspirations:

1. **No user-location intake for ads.** There is no portal route, server action, or AvServ call that
   accepts an end-user's location for ad selection. (The §7 region tag is advertiser intent.)
2. **No per-user impression storage.** No portal table has a per-user ad-impression row; the portal
   only displays AvServ aggregates whose wire schema (doc 31 §4) *rejects* user/device ids and
   coordinates at the boundary — finer-than-`state` or per-user buckets cannot reach the portal.
3. **Closed slot set.** `slot` is a Postgres enum of exactly the doc-30 §4 / doc 31 §1 values; no code
   path targets anything else, so the portal cannot express a pre-safety-action placement.
4. **Approved-only publish.** Only `ad_creative_status = 'approved'` creatives are ever pushed to
   AvServ (§5/§6); `suspend` unpublishes.
5. **No silent failures.** S2S publish/unpublish/impression calls follow `lib/avserv/client.ts` —
   throw `AvServError`, log structured, surface a user-visible state (repo constraint #3). A failed
   publish leaves the creative `approved` but `published_at = null` (visibly "approved, not yet live"),
   never a false "live."
6. **Advertiser PII stays in the portal** (§3 boundary decision) — AvServ holds only approved creative
   records, never advertiser contact data.

---

## 10. Phasing (off the v1/v1.5 critical path)

Aligned to AvApp doc 30 §7. The portal's center of gravity is **Phase 2**.

- **Phase 1 — Manual house ads.** Almost entirely AvServ + AvApp (manifest, client widget, fences).
  Portal involvement: hand-entered AdLedger rows (the AdLedger lives here per doc 31 §5). No advertiser
  accounts.
- **Phase 2 — Advertiser self-serve (no billing). ← THIS REPO'S MAIN SCOPE.**
  Advertiser principal + memberships (§3); campaigns/creatives (§5); **text-creative authoring** +
  **in-slot preview** (§6); submit-for-approval + **operator approval queue** (reuse
  `/admin/sar-approvals` patterns); `approve→publish` S2S to AvServ (§6.2, mock-first); decision
  emails. Creatives are **app-wide** (`target_kind = 'national'`) until the target picker lands (AD-P7).
- **Phase 3 — Billing + impression display.** Stripe purchase → AdLedger (§8); aggregate impression
  display (§8). Folds advertiser revenue into AvApp doc 17 tax treatment. *(The radius/admin target
  picker (§7, AD-P7) no longer waits on Phase 3 — it has no zone-feed dependency, so it can ship as
  soon as the targeting UI is built.)*

### Proposed portal milestones (AD-P*)

1. **AD-P1.** Schema: `advertiser_accounts`, `advertiser_memberships`, `ad_campaigns`, `ad_creatives`,
   `ad_creative_status_log` + enums. Drizzle edit + generated migration. **Gate:** migrates clean on a
   Neon dev branch; `drizzle-kit generate` diff reviewed.
2. **AD-P2.** Advertiser account create + membership/invite flow (mirror `/sar/new` + `/sar/[id]/members`).
   **Gate:** a user can create an advertiser account and invite a co-editor.
3. **AD-P3.** Text-creative authoring form (headline/body/click-url/alt-text; shared Zod schema).
   **Gate:** validated draft persists. *(Image upload via `uploadCreativeAsset` is a later-rev add-on,
   not Phase 2.)*
4. **AD-P4.** **In-slot preview** component — renders the creative's `{headline, body}` (doc 31 §2
   `display`) inside faithful `post_checkout` / `post_checkin` mocks (`loading_idle` reserved). **Gate:**
   the preview reads the exact shape publish will ship.
5. **AD-P5.** Submit-for-approval + **operator approval queue** (`/admin/ad-approvals`) reusing the
   SAR `TRANSITIONS` + audit-log + email-after-commit pattern. **Gate:** full
   draft→pending→approved/rejected/changes loop with audit rows + advertiser email.
6. **AD-P6.** `approve→publish` / `suspend→unpublish` S2S methods on the AvServ client, **mock-first**.
   **Gate:** approve writes `avserv_creative_ref` against `mock://`; suspend unpublishes; failures
   surface (constraint #3), never a false "live."
7. **AD-P7.** The radius/admin **target picker** (§7) — **AD-P7a:** target data model + publish-contract
   change + migrations 0009/0010 (forecast_zone_* → target_*), mock-first; **AD-P7b:** the authoring UI
   (radius map + slider, admin state/county/place selector over bundled US Census FIPS data) + operator
   surfacing. **No zone-feed dependency** (T23) — not gated on the old O2. **Gate:** author a creative
   at each granularity; approve→publish passes the right `target` to AvServ. *(Stripe billing +
   impression display remain Phase 3, gated on doc 31 O3 AdLedger ratification.)*

AD-P1…AD-P6 can be built and tested entirely behind the `mock://` AvServ client before AvServ ships
the real ad endpoints — exactly how device-linking shipped (`lib/avserv/client.ts`).

---

## 11. Contract gaps — status after AvApp doc 31

This doc's original eight flags (G1–G8) were sent back to AvApp and answered by **doc 31**, which was
created expressly to close them ("close the contract gaps the AvServ and rmdig-portal planning
sessions flagged back ... portal §11 G1–G8"). Status:

| # | Original gap | Status | Where |
|---|---|---|---|
| G1 | Advertiser AvServ principal vs portal-only | ✅ **Resolved** — capability grant via portal-mediated S2S (identity direction B); no new JWT tier | doc 31 §7 (§3) |
| G2 | Creative storage path | ✅ **Resolved** — portal-staged, handoff-on-approval | doc 31 §6 (§6.1) |
| G3 | publish == what-ships / preview fidelity | ✅ **Resolved** — preview reads the same `display` shape; publish is sole writer | doc 31 §2 (§6.2) |
| G4 | Signed ad-manifest JSON schema | ✅ **Resolved** — schema + signing trust root (reuse C3 key) pinned | doc 31 §2 (§6.2) |
| G5 | `ForecastZone` catalog source | ✅ **Moot for ads (T23)** — ad targeting no longer uses `ForecastZone`; it uses radius/admin over off-the-shelf US Census data. The old zone-feed question (O2) is now prediction-only | doc 31 §3 (§7) |
| G6 | AdLedger ownership | ✅ **Resolved** — portal DB, keyed on `advertiser_id`; needs `05_ledgers.md` ratification | doc 31 §5 + **O3** (§8) |
| G7 | Impressions read endpoint + k-anon | 🟡 **Shape resolved, floor value open** — wire schema pinned + rejects PII; `K`/granularity is an operator privacy call | doc 31 §4 + **O1** (§8) |
| G8 | Reviewer role broaden vs dedicated | ✅ **Resolved as portal-local** — lean broaden for Phase 2 | doc 31 §7 + **O4** (§3) |

**Remaining open items that gate this repo (from doc 31 §8):**

- **O1 — k-anonymity floor — ✅ RESOLVED (doc 31 §4.1):** advertiser `K = 25` / public `K = 50`,
  region = `state`, weekly window, roll-up ladder, ratchet-up-only. No longer blocks the delivery view.
- **~~O2~~ — de-scoped from ads (T23).** Ad targeting uses radius/admin over off-the-shelf US Census
  data — **no `ForecastZone` feed dependency**. The national-feed question is now a prediction-only
  concern (doc 12 T22 / doc 18), not an ad blocker. The target picker (§7) can ship without it.
- **O3 — AdLedger ratification in `05_ledgers.md`** (rmdig-portal / rmdig-ai). Gates Phase 3 billing.
  *This one is ours to drive* — it's a planning-doc edit, not a cross-repo negotiation.
- **O4 — reviewer role** broaden vs dedicated (operator). Gates the Phase 2 approval queue; trivial.

**One residual worth pinning with AvServ:** doc 31 specs the manifest *output* shape but not the
portal→AvServ *publish input* endpoint (path/verb/body). Track as a small follow-up against doc 31
§2/§6; keep it behind the `mock://` client until pinned (§6.2).

---

## 12. Cross-references

- **AvApp doc 30** — house-ad model, slot set, §0 safety fences, impression policy, phasing
  (the product owner of this capability).
- **AvApp doc 31** — the byte-level wire contract (manifest, impressions endpoint, zone snapshot,
  ledger/storage/principal resolutions); **authoritative for all wire shapes**. Closes this doc's
  original §11 G1–G8; its open items O1–O4 are tracked in §11 above.
- **AvApp doc 18 §8.0** — canonical `ForecastZone` taxonomy (versioned Provider→ZoneSet→ForecastZone);
  the **prediction** lens. Ads use a *separate* radius/admin lens (§7, doc 31 §3, T23) and do **not**
  consume this catalog.
- **AvApp doc 21 §10.1** — NA-standard avalanche-problem grid (vocabulary axis; already provider-agnostic).
- **AvApp doc 12 T22 / T23** — T22 is the prediction-side CAIC-coupling-vs-national-expansion
  decoupling; **T23** is the decision that ad targeting uses its *own* lens (radius/admin), separate
  from the `ForecastZone` prediction lens — the basis for §7's target picker.
- **AvApp doc 15 §12 C3** — signed-manifest + S2S auth pattern the ad manifest reuses.
- **rmdig-ai `01_accounts_and_orgs.md`** — unified-login / behavioral-profile model the advertiser principal extends.
- **rmdig-ai `05_ledgers.md`** — ledger pattern + the AdLedger ownership question (G6).
- **rmdig-ai `07_portal_bootstrap.md` §1** — the architectural constraints this design honors.
- **This repo** — `lib/db/schema.ts` (SAR template), `app/(portal)/admin/sar-approvals/` (queue
  template), `lib/blob/upload.ts` (upload), `lib/avserv/client.ts` (mock-first S2S), `lib/sar/geo.ts`
  (PostGIS region).
```
