import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// The first four tables (users, accounts, sessions, verificationTokens) match
// the shape Auth.js's Drizzle adapter expects. Column names within these tables
// use camelCase in BOTH TS and Postgres — this matches the adapter's default
// schema exactly so future @auth/drizzle-adapter upgrades land without surgery.
// Our additions (passwordHash, displayName, createdAt) and our own tables
// (rateLimits) use snake_case DB columns as is conventional Postgres style.

// Why the signer said they're here (sign-up dropdown): routes SAR teams and
// advertisers to their onboarding forms after first sign-in. Purely a UX
// routing hint — it grants nothing; org/advertiser capability still comes only
// from the entities themselves (and SAR approval stays manual per §0).
export const signupIntent = pgEnum("signup_intent", ["explorer", "sar", "advertiser"]);

export const users = pgTable("users", {
  // Auth.js standard
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", {
    mode: "date",
    withTimezone: true,
  }),
  image: text("image"),
  // Custom — null passwordHash means OAuth-only account (no credentials login)
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  // Direction-B identity link: the canonical AvServ account this portal user
  // maps to (rmdig-ai docs/plans/05). Nullable until the post-login map runs;
  // unique so two portal users can't claim the same AvServ account. Distinct
  // from users.id ON PURPOSE — users.id is referenced by Auth.js accounts/
  // sessions, so it must stay the portal's own identifier.
  avservAccountId: uuid("avserv_account_id").unique(),
  // MFA (TOTP). The secret is stored AES-256-GCM-encrypted (see lib/auth/mfa),
  // never plaintext — a DB read alone can't reconstruct anyone's second factor.
  // A non-null secret with a null mfaEnabledAt is a *pending* enrollment (QR
  // shown, code not yet verified); mfaEnabledAt being set means MFA is active.
  totpSecretEncrypted: text("totp_secret_encrypted"),
  mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
  // Nullable: pre-dropdown accounts (and OAuth sign-ups, which skip the form)
  // have no recorded intent and get the default explorer experience.
  signupIntent: signupIntent("signup_intent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// One-time MFA recovery codes. Stored as SHA-256 hashes (high-entropy random,
// so a fast hash is right — same reasoning as reset tokens); the plaintext is
// shown to the user exactly once at generation. usedAt marks a code as spent so
// each works only once.
export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // Composite natural key: a user can't hold the same code hash twice, and we
  // look codes up by (user_id, code_hash) — no surrogate id needed.
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// Sign-in rate limiting. Key is typically "signin:<email>". Window starts at
// the first failed attempt; each subsequent failure increments attempts. After
// 15 minutes the window resets. Bootstrap section §P1.1: 5 fails / 15 min / email.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Platform-level roles, distinct from per-SAR-org roles (those come in P1.4 via
// org_memberships). A user has zero or more platform roles; most users have
// none (they're SAR-org members, not rmdig staff). rmdig_admin = full operator;
// rmdig_reviewer = approval-queue access — the SAR-org queue and (P2, operator
// decision 2026-06-16) the advertiser creative-approval queue (docs/plans/30 §3).
// Modeled as a join table rather than a column so the set grows without a
// migration and a user can hold both.
export const platformRole = pgEnum("platform_role", ["rmdig_admin", "rmdig_reviewer"]);

export const userPlatformRoles = pgTable(
  "user_platform_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: platformRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

// Pending platform-role (staff) invitations — the /admin/team path for seeding
// new admins/reviewers. Mirrors org_invitations (SHA-256 token hash, 14-day
// TTL, acceptedAt marks spent) with two deliberate tightenings for the
// privilege level: the accepter's session email must MATCH the invited email,
// and creating one requires the inviting admin to re-enter their password.
export const platformRoleInvitations = pgTable("platform_role_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  role: platformRole("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Append-only audit of platform-role grants/revocations (mirrors the ledger
// pattern of sar_org_status_log: never updated, never deleted). targetEmail is
// denormalized so history survives target-account deletion.
export const platformRoleAction = pgEnum("platform_role_action", [
  "invite_created",
  "invite_cancelled",
  "granted",
  "revoked",
]);

export const platformRoleLog = pgTable("platform_role_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: platformRoleAction("action").notNull(),
  role: platformRole("role").notNull(),
  targetEmail: text("target_email").notNull(),
  targetUserId: uuid("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Password-reset tokens. Distinct from verification_tokens on purpose: a
// different lifecycle (single-use, 1-hour TTL) and a different threat model —
// we store only a SHA-256 hash of the token, never the plaintext, so a DB read
// can't be turned into an account takeover. The plaintext lives only in the
// emailed link. Keyed by user_id (FK, cascade) so a deleted user drops their
// tokens; token_hash is unique so a hash collision can't shadow another row.
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── SAR org onboarding (P1.4) ────────────────────────────────────────────────
// A SAR org's lifecycle. The state machine (rmdig-ai docs/plans/06) is:
//   submitted → pending → approved → suspended → (reactivate) → pending
//                  └─ rejected → (appeal) → pending
// Manual approval is non-negotiable: SAR orgs receive safety-of-life alerts, so
// an unverified org reaching `approved` is a critical failure mode (doc 01).
export const sarOrgStatus = pgEnum("sar_org_status", [
  "pending",
  "approved",
  "rejected",
  "suspended",
]);

// What kind of organization is applying. Drives the operator's verification
// (a county SAR registration vs a 501(c)(3) letter prove different things).
// `other` pairs with sar_orgs.operating_status_other free text.
export const operatingStatus = pgEnum("operating_status", [
  "county_sar",
  "state_sar",
  "501c3",
  "nonprofit",
  "volunteer_group",
  "other",
]);

// Per-org membership roles, distinct from platform roles (userPlatformRoles).
// Additive in practice (an admin can also respond); least-privilege at invite —
// invitations default to `responder` and admins promote explicitly (doc 01).
export const orgRole = pgEnum("org_role", ["admin", "dispatcher", "responder"]);

// Audit actions recorded in sar_org_status_log. `changes_requested` is a
// transition that leaves status at `pending` but is still logged (the operator
// asked the submitter for more), which is why the log keys on an action rather
// than only a status delta.
export const sarOrgAction = pgEnum("sar_org_action", [
  "submitted",
  "approved",
  "rejected",
  "changes_requested",
  "suspended",
  "reactivated",
  // The org's admin edited a pending application (after changes were
  // requested, or before review) and sent it back to the queue.
  "resubmitted",
]);

// What kind of organization this is (AvApp doc 36 §9.3). Both go through the
// same manual approval (CLAUDE.md §0); ski patrols also need a call back to the
// resort's published number before approval (runbook "Review a SAR org
// application").
export const orgType = pgEnum("org_type", ["sar_team", "ski_patrol"]);

// SAR organizations. The service-area polygon lives in a separate `region_geom`
// PostGIS column (geography(Polygon,4326)) added by a raw-SQL migration and read/
// written via sql`` in lib/sar/geo.ts — Drizzle's pg-core has no geography type,
// so keeping it out of this schema is deliberate (rmdig-ai docs/plans/06), not an
// omission. Because the column is absent from both this schema and every drizzle
// snapshot, `drizzle-kit generate` never diffs or drops it. Stripe/donation
// columns are Phase 4 and intentionally excluded (bootstrap §1, no scope creep).
export const sarOrgs = pgTable("sar_orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgType: orgType("org_type").default("sar_team").notNull(),
  name: text("name").notNull(),
  // Public-facing blurb shown on the (future) org page; optional at submit.
  description: text("description"),
  // Human-readable region label ("San Juan County, CO"). The authoritative
  // service area is region_geom; this is for display and operator scanning.
  regionName: text("region_name"),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  operatingStatus: operatingStatus("operating_status").notNull(),
  operatingStatusOther: text("operating_status_other"),
  // Proof of operating status (county registration, 501(c)(3) letter, …) in
  // Vercel Blob. notNull: an org only ever enters the DB at submit time, and a
  // submission without proof can't be reviewed.
  proofDocUrl: text("proof_doc_url").notNull(),
  status: sarOrgStatus("status").default("pending").notNull(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  // set null on actor deletion so the org row (and its approved state) survives
  // an operator account being removed — the audit log keeps the full history.
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // Most recent reject reason / change-request note shown to the submitter. The
  // append-only sar_org_status_log keeps the full per-transition history.
  reviewNote: text("review_note"),
},
  (t) => [
    // The operator approvals queue lists pending orgs; index the status it filters on.
    index("sar_orgs_status_idx").on(t.status),
    // One verified phone → one SAR org (anti-abuse + a unique callback number
    // for vetting). Partial: legacy/unverified rows may hold NULL.
    uniqueIndex("sar_orgs_contact_phone_unique")
      .on(t.contactPhone)
      .where(sql`contact_phone IS NOT NULL`),
  ],
);

// Org membership with role. Composite PK (org_id, user_id): a user holds at most
// one role row per org; promotion updates the role in place. Both FKs cascade —
// deleting an org or a user removes their membership rows.
export const orgMemberships = pgTable(
  "org_memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => sarOrgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    // "Which orgs does this user belong to?" (nav, permission checks) filters on
    // user_id alone, which the (org_id, user_id) PK can't serve — index it.
    index("org_memberships_user_id_idx").on(t.userId),
  ],
);

// Pending member invitations. We store only a SHA-256 hash of the token (the
// plaintext lives solely in the emailed link), mirroring password_reset_tokens
// and mfa_recovery_codes — a DB read can't be turned into an org takeover. TTL
// 14 days (doc 06); acceptedAt marks it spent so a token works once.
export const orgInvitations = pgTable("org_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => sarOrgs.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: orgRole("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
},
  // The members page lists an org's invitations; index the org_id it filters on.
  (t) => [index("org_invitations_org_id_idx").on(t.orgId)],
);

// Append-only audit of every SAR org status transition (submit/approve/reject/
// request-changes/suspend/reactivate). Mirrors the ledger audit pattern (doc 05):
// rows are never updated or deleted. fromStatus is null for the initial submit;
// note carries the operator's reject reason / change request. actorUserId set
// null on deletion so history outlives the operator account that made the call.
export const sarOrgStatusLog = pgTable("sar_org_status_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => sarOrgs.id, { onDelete: "cascade" }),
  action: sarOrgAction("action").notNull(),
  fromStatus: sarOrgStatus("from_status"),
  toStatus: sarOrgStatus("to_status").notNull(),
  note: text("note"),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
},
  // History is always read per-org, newest first; index org_id for that lookup.
  (t) => [index("sar_org_status_log_org_id_idx").on(t.orgId)],
);

// Append-only audit of SAR org membership changes (docs/plans/33 §4 portal 7):
// who joined (by invitation), whose role changed, who was removed or left,
// and which invitations were revoked. The subject's email is snapshotted so
// the history reads correctly after an account is deleted.
export const orgMembershipAction = pgEnum("org_membership_action", [
  "joined",
  "role_changed",
  "removed",
  "left",
  "invite_revoked",
]);

export const orgMembershipLog = pgTable(
  "org_membership_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => sarOrgs.id, { onDelete: "cascade" }),
    action: orgMembershipAction("action").notNull(),
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    subjectEmail: text("subject_email").notNull(),
    fromRole: orgRole("from_role"),
    toRole: orgRole("to_role"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("org_membership_log_org_id_idx").on(t.orgId)],
);

// Team terms (docs/plans/33; AvServ plan 41, contract sar_terms.md; AvApp plan
// 47 §2.13). A SAR org writes the terms for being an emergency contact and
// chooses which services it provides through AvAI (capabilities, each with the
// channels it accepts). An rmdig operator reviews every version; publishing
// fixes the version number and the SHA-256 of the exact body bytes, which the
// app sends back on acceptance. A published version is immutable (a trigger in
// migration 0019 enforces it); changes are a new version.
export const sarTermsStatus = pgEnum("sar_terms_status", ["draft", "submitted", "published", "rejected"]);

export interface SarCapabilitySetting {
  name: "checkout_alerts" | "send_help_added" | "send_help_area" | "named_to_contacts" | "area_map" | "incident_alerts";
  channels: Array<"portal" | "email" | "webhook" | "sms">;
}

export const sarOrgTerms = pgTable(
  "sar_org_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => sarOrgs.id, { onDelete: "cascade" }),
    // Assigned at publish: 1, 2, 3… per org. Null while draft/submitted/rejected.
    version: integer("version"),
    body: text("body").notNull(),
    capabilities: jsonb("capabilities").$type<SarCapabilitySetting[]>().notNull(),
    // Hex SHA-256 of the UTF-8 bytes of `body`, set at publish.
    sha256: text("sha256"),
    status: sarTermsStatus("status").notNull().default("draft"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Staff note on a rejection, shown to the org's admins.
    reviewNote: text("review_note"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Set at publish (AvServ sar_terms.md): false only when the body is
    // byte-identical to the previous version and capabilities were only
    // removed, so earlier acceptances carry forward. Any added capability or
    // changed text means users accept again.
    requiresReacceptance: boolean("requires_reacceptance"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sar_org_terms_org_version").on(t.orgId, t.version).where(sql`version IS NOT NULL`),
    // One open draft or submission per org at a time.
    uniqueIndex("sar_org_terms_one_open")
      .on(t.orgId)
      .where(sql`status IN ('draft', 'submitted')`),
    index("sar_org_terms_status_idx").on(t.status),
  ],
);

// ── Data / account-deletion requests (Colorado Privacy Act) ──────────────────
// The portal owns the user account, so the CPA deletion-on-request path lives
// here (AvApp doc 24 §1.4; doc 12 T20 — precise geolocation is SENSITIVE data
// under the CPA, so this path is a store-submission gate, not a nicety).
//
// Deliberately keyed by EMAIL with NO users FK: a request may come from an
// AvAI app user or an emergency contact who has no portal account at all, and
// the row must survive the very account deletion it asks for (it's the audit
// trail that the request was received and honored). Lifecycle:
//   pending_confirmation → confirmed → completed
// pending_confirmation = form submitted, confirmation email sent (unverified
// requests are never surfaced to the operator — anyone can type any address).
// confirmed = the emailed link was clicked, proving control of the address;
// operator + requester both notified; the CPA 45-day response clock is running.
// completed = operator finished erasure per docs/runbook.md and recorded it.
export const deletionRequestStatus = pgEnum("deletion_request_status", [
  "pending_confirmation",
  "confirmed",
  "completed",
]);

export const deletionRequests = pgTable(
  "deletion_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // SHA-256 of the confirmation token (plaintext lives only in the emailed
    // link), mirroring password_reset_tokens — a DB read can't forge a
    // confirmed CPA request.
    tokenHash: text("token_hash").notNull().unique(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
    status: deletionRequestStatus("status").default("pending_confirmation").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Operator's fulfillment note (what was erased, where). Audit, not user-facing.
    note: text("note"),
  },
  // The operator works the queue by status; requests are looked up per email
  // when fulfilling. Index both.
  (t) => [
    index("deletion_requests_status_idx").on(t.status),
    index("deletion_requests_email_idx").on(t.email),
  ],
);

// ── Advertiser portal (P2 / v2+, docs/plans/30_advertiser_portal.md) ─────────
// Self-served sponsor ads that fund AvServ. The advertiser surface is the SAR-
// onboarding module with the nouns changed: a new principal (advertiser_accounts)
// reached through membership (advertiser_memberships), creatives that move through
// a manual operator-approval state machine (ad_creatives + ad_creative_status_log),
// grouped under campaigns. v2+ scope, off the v1/v1.5 critical path.
//
// Safety/privacy invariants baked into these types (AvApp doc 30 §0, doc 31 §0):
//   - `slot` is a CLOSED enum — there is no value that expresses a pre-safety-action
//     placement, so the schema cannot represent an ad in front of a safety tap.
//   - the region tuple is the ADVERTISER's chosen target zone, never user location.
//   - no per-user impression data lives here; impressions are aggregate-only and
//     owned by AvServ (the portal only ever displays them).

// An advertiser account's lifecycle. Far simpler than sar_orgs' submit→approve
// machine: an advertiser is vetted by the operator out of band before it transacts,
// so the account itself is just active/suspended — the *approval* gate that matters
// for a safety app lives on each creative (ad_creatives.status), not the account.
export const advertiserStatus = pgEnum("advertiser_status", ["active", "suspended"]);

// Per-advertiser membership roles, distinct from platform roles (userPlatformRoles)
// and from SAR org roles (orgRole). `admin` manages billing + members; `editor`
// authors creatives. Least-privilege at invite, mirroring orgRole.
export const advertiserRole = pgEnum("advertiser_role", ["admin", "editor"]);

// The closed set of ad placements (AvApp doc 30 §4 / doc 31 §1). post_checkin and
// post_checkout are independently buyable post-resolution slots; loading_idle is
// reserved (the client isn't wired for it yet, doc 31 §1) but modeled now so it
// needs no migration later. Every value is post-resolution or idle by construction
// — the §0 bright-line ("an ad may appear after a safety action resolves, never
// before one") holds for anything this enum can express.
export const adSlot = pgEnum("ad_slot", ["post_checkin", "post_checkout", "loading_idle"]);

// The advertiser's chosen ad-targeting lens (AvApp doc 31 §3). Deliberately SEPARATE
// from avalanche prediction's ForecastZone lens (T23, decided 2026-06-17): ads target
// where commerce happens (towns/counties/radii from off-the-shelf US Census data), not
// snowpack-shaped forecast polygons. `national` = app-wide (today's only authored mode);
// `radius` = a point + mileage; `admin` = one or more Census admin units at one level.
// Tier 3 (curated recreation presets) is deferred and would add a value here later.
export const adTargetKind = pgEnum("ad_target_kind", ["national", "radius", "admin"]);

// The Census administrative granularity for an `admin` target (doc 31 §3). FIPS codes
// in ad_creatives.target_admin_fips are all at this single level (state | county | place).
export const adAdminLevel = pgEnum("ad_admin_level", ["state", "county", "place"]);

// Creative approval state machine (docs/plans/30 §5):
//   draft → pending → approved → (suspended) → (reactivate) → pending
//              └─ rejected → (resubmit) → pending
// request_changes leaves status at `pending` (the note carries the ask), mirroring
// sarOrgStatus' changes_requested. Only `approved` creatives are eligible for the
// signed ad manifest (AvApp doc 30 §6) — manual approval is non-negotiable for a
// safety app.
export const adCreativeStatus = pgEnum("ad_creative_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
  "suspended",
]);

// Audit actions recorded in ad_creative_status_log. Mirrors sarOrgAction: a
// transition keyed on action (not just a status delta) so `changes_requested`
// (which leaves status at pending) is still logged.
export const adCreativeAction = pgEnum("ad_creative_action", [
  "submitted",
  "approved",
  "rejected",
  "changes_requested",
  "suspended",
  "reactivated",
]);

// The billable advertiser entity (a gear shop, guide service, regional safety org).
// Mirrors sar_orgs in shape but without the proof-doc / region_geom apparatus — an
// advertiser's audience is per-creative targeting (the target_* columns on
// ad_creatives), not an org-level polygon. Stripe/billing columns are Phase 3 and
// intentionally excluded (no scope creep). PII (contact_*) lives here and never
// leaves the portal (doc 31 §7).
export const advertiserAccounts = pgTable("advertiser_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  websiteUrl: text("website_url"),
  status: advertiserStatus("status").default("active").notNull(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
},
  // One verified phone → one advertiser account (mirrors sar_orgs; a number
  // may back one org of EACH type, uniqueness is per-table by design).
  (t) => [
    uniqueIndex("advertiser_accounts_contact_phone_unique")
      .on(t.contactPhone)
      .where(sql`contact_phone IS NOT NULL`),
  ],
);

// Advertiser membership with role. Composite PK (advertiser_id, user_id): a user
// holds at most one role row per advertiser; promotion updates in place. Both FKs
// cascade. Mirrors org_memberships exactly (including the user_id index for "which
// advertisers does this user belong to?").
export const advertiserMemberships = pgTable(
  "advertiser_memberships",
  {
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertiserAccounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: advertiserRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.advertiserId, t.userId] }),
    index("advertiser_memberships_user_id_idx").on(t.userId),
  ],
);

// A campaign groups creatives under an advertiser and (Phase 3) carries the buy /
// schedule. starts_on/ends_on are nullable until a buy is scheduled.
export const adCampaigns = pgTable(
  "ad_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertiserAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startsOn: timestamp("starts_on", { withTimezone: true }),
    endsOn: timestamp("ends_on", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // The advertiser dashboard lists a campaign's creatives; campaigns list per
  // advertiser. Index advertiser_id for that lookup.
  (t) => [index("ad_campaigns_advertiser_id_idx").on(t.advertiserId)],
);

// One creative = one display bound to one slot — the unit the operator approves and
// the unit that lands in the signed manifest. v1 manifest is TEXT-ONLY (AvApp doc 31
// §2 `display`): headline + body. The image path (imageRef → R2 object key, doc 19
// §3) is RESERVED for a later manifest rev; the column exists now so adding image
// creatives needs no migration.
//
// The target_* columns are the advertiser's chosen ad-targeting lens (AvApp doc 31 §3,
// T23): `target_kind` discriminates national | radius | admin, and the remaining columns
// carry the kind-specific payload. This is the ADVERTISER'S chosen audience geometry,
// NEVER a user location — resolution happens on-device against the signed manifest
// (doc 31 §0.1/§3), never here. A CHECK enforces the per-kind shape structurally so a
// malformed target (e.g. a radius without a center, or an out-of-range mileage) can't
// persist. radius targets store lat/lon (the advertiser's pin) + a 5–250 mi radius;
// admin targets store one Census level + a non-empty array of FIPS codes at that level.
export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    slot: adSlot("slot").notNull(),
    // The manifest `display` shape (doc 31 §2).
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    altText: text("alt_text").notNull(),
    // Optional tap-through; validated https-only at the form/action layer.
    clickUrl: text("click_url"),
    // RESERVED (later manifest rev): R2 object key for an image creative.
    imageRef: text("image_ref"),
    // Ad-targeting lens (doc 31 §3). `national` (the default) = app-wide; the other
    // columns are NULL. `radius` = target_lat/lon (advertiser's pin) + target_radius_mi.
    // `admin` = target_admin_level + a non-empty target_admin_fips[]. The CHECK below
    // binds each kind to exactly its columns.
    targetKind: adTargetKind("target_kind").default("national").notNull(),
    targetLat: numeric("target_lat"),
    targetLon: numeric("target_lon"),
    targetRadiusMi: integer("target_radius_mi"),
    targetAdminLevel: adAdminLevel("target_admin_level"),
    targetAdminFips: text("target_admin_fips").array(),
    status: adCreativeStatus("status").default("draft").notNull(),
    // Latest reject/changes note shown to the advertiser; full history in the log.
    reviewNote: text("review_note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Set once the portal has pushed an approved creative to AvServ (doc 31 §6).
    // approved but published_at null = "approved, not yet live" (never a false live).
    publishedAt: timestamp("published_at", { withTimezone: true }),
    avservCreativeRef: text("avserv_creative_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // The operator approval queue filters on status; the advertiser dashboard lists a
  // campaign's creatives. Index both.
  (t) => [
    index("ad_creatives_status_idx").on(t.status),
    index("ad_creatives_campaign_id_idx").on(t.campaignId),
    // Structurally bind each target_kind to exactly its columns (doc 31 §3) so a
    // malformed target can't persist: national → all target payload NULL; radius →
    // lat/lon/radius_mi present, mileage in [5,250], admin columns NULL; admin →
    // level + a non-empty fips[] present, radius columns NULL.
    check(
      "ad_creatives_target_shape",
      sql`
        (
          ${t.targetKind} = 'national'
          AND ${t.targetLat} IS NULL AND ${t.targetLon} IS NULL AND ${t.targetRadiusMi} IS NULL
          AND ${t.targetAdminLevel} IS NULL AND ${t.targetAdminFips} IS NULL
        ) OR (
          ${t.targetKind} = 'radius'
          AND ${t.targetLat} IS NOT NULL AND ${t.targetLon} IS NOT NULL
          AND ${t.targetRadiusMi} IS NOT NULL AND ${t.targetRadiusMi} BETWEEN 5 AND 250
          AND ${t.targetAdminLevel} IS NULL AND ${t.targetAdminFips} IS NULL
        ) OR (
          ${t.targetKind} = 'admin'
          AND ${t.targetAdminLevel} IS NOT NULL
          AND ${t.targetAdminFips} IS NOT NULL AND array_length(${t.targetAdminFips}, 1) >= 1
          AND ${t.targetLat} IS NULL AND ${t.targetLon} IS NULL AND ${t.targetRadiusMi} IS NULL
        )
      `,
    ),
  ],
);

// Append-only audit of every creative status transition. Mirrors
// sar_org_status_log: rows are never updated or deleted; fromStatus is null for the
// initial submit; note carries the operator's reject reason / change request;
// actorUserId set null on deletion so history outlives the operator account.
export const adCreativeStatusLog = pgTable(
  "ad_creative_status_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => adCreatives.id, { onDelete: "cascade" }),
    action: adCreativeAction("action").notNull(),
    fromStatus: adCreativeStatus("from_status"),
    toStatus: adCreativeStatus("to_status").notNull(),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // History is always read per-creative, newest first; index creative_id.
  (t) => [index("ad_creative_status_log_creative_id_idx").on(t.creativeId)],
);

// Pending advertiser-team invitations. Mirrors org_invitations exactly: we store
// only a SHA-256 hash of the token (plaintext lives solely in the emailed link),
// TTL 14 days, acceptedAt marks it spent. A DB read can't be replayed into an
// advertiser-team membership.
export const advertiserInvitations = pgTable(
  "advertiser_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertiserAccounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: advertiserRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // The members page lists an advertiser's invitations; index advertiser_id.
  (t) => [index("advertiser_invitations_advertiser_id_idx").on(t.advertiserId)],
);

// ---------------------------------------------------------------------------
// Restriction review requests (docs/plans/32; AvServ contract restrictions.md).
// AvServ is the system of record for the restriction itself; the portal keeps
// only the user's review request (free text that stays off the safety nodes)
// and an append-only log of every action on it.

export const restrictionReviewStatus = pgEnum("restriction_review_status", [
  "open",
  "upheld",
  "lifted",
  // The restriction was already lifted elsewhere (the AvServ CLI) when staff
  // reached the request.
  "closed",
]);

export const restrictionReviewAction = pgEnum("restriction_review_action", [
  "submitted",
  "upheld",
  "lifted",
  "closed",
]);

export const restrictionReviewRequests = pgTable(
  "restriction_review_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The AvServ account and restriction as they were when the user asked. Not
    // foreign keys: both live in AvServ (contract §1), never in this DB.
    avservAccountId: uuid("avserv_account_id").notNull(),
    restrictionId: uuid("restriction_id").notNull(),
    // Minted by the page per render, so a double submit is one request.
    submissionKey: uuid("submission_key").notNull().unique(),
    message: text("message").notNull(),
    status: restrictionReviewStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Staff-only, like AvServ's liftNote: never shown to the user.
    decisionNote: text("decision_note"),
  },
  (t) => [
    // One open request per restriction: a second ask while one is pending is
    // "already under review", not a new row.
    uniqueIndex("restriction_review_requests_one_open")
      .on(t.restrictionId)
      .where(sql`status = 'open'`),
    // The staff queue lists by status, oldest first.
    index("restriction_review_requests_status_created_idx").on(t.status, t.createdAt),
    index("restriction_review_requests_user_id_idx").on(t.userId),
  ],
);

export const restrictionReviewLog = pgTable(
  "restriction_review_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => restrictionReviewRequests.id, { onDelete: "cascade" }),
    action: restrictionReviewAction("action").notNull(),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // History is read per request, newest first.
  (t) => [index("restriction_review_log_request_id_idx").on(t.requestId)],
);

// ---------------------------------------------------------------------------
// Portal announcements (docs/runbook.md "Announcements"): staff-written notices
// shown as a banner on signed-in portal pages, optionally scheduled and
// targeted by audience. Planned maintenance of the whole portal uses the Global
// Config switch instead (lib/maintenance/portal-switch.ts), since this table is
// unreachable when the database is down.

export const announcementSeverity = pgEnum("announcement_severity", [
  "info",
  "maintenance",
  "incident",
]);

// Audiences overlap: a SAR member is also "everyone", and a SAR org admin is
// also a SAR member. "explorer" is a signed-in user with no SAR, advertiser or
// staff role (lib/announcements/announcements.ts).
export const announcementAudience = pgEnum("announcement_audience", [
  "everyone",
  "explorer",
  "sar",
  "sar_admin",
  "advertiser",
  "staff",
]);

export const announcementAction = pgEnum("announcement_action", ["created", "ended"]);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    message: text("message").notNull(),
    severity: announcementSeverity("severity").notNull(),
    audiences: announcementAudience("audiences").array().notNull(),
    // Null start = from creation; null end = until ended by hand.
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // Set when staff end it early; the scheduled endsAt is kept as written.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // Every portal page asks "what's live now": only rows not ended by hand.
  (t) => [index("announcements_live_idx").on(t.endsAt).where(sql`ended_at IS NULL`)],
);

export const announcementLog = pgTable(
  "announcement_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    action: announcementAction("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("announcement_log_announcement_id_idx").on(t.announcementId)],
);
