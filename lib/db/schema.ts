import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The first four tables (users, accounts, sessions, verificationTokens) match
// the shape Auth.js's Drizzle adapter expects. Column names within these tables
// use camelCase in BOTH TS and Postgres — this matches the adapter's default
// schema exactly so future @auth/drizzle-adapter upgrades land without surgery.
// Our additions (passwordHash, displayName, createdAt) and our own tables
// (rateLimits) use snake_case DB columns as is conventional Postgres style.

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
// rmdig_reviewer = SAR-org approval queue only. Modeled as a join table rather
// than a column so the set grows without a migration and a user can hold both.
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
]);

// SAR organizations. The service-area polygon lives in a separate `region_geom`
// PostGIS column (geography(Polygon,4326)) added by a raw-SQL migration and read/
// written via sql`` in lib/sar/geo.ts — Drizzle's pg-core has no geography type,
// so keeping it out of this schema is deliberate (rmdig-ai docs/plans/06), not an
// omission. Because the column is absent from both this schema and every drizzle
// snapshot, `drizzle-kit generate` never diffs or drops it. Stripe/donation
// columns are Phase 4 and intentionally excluded (bootstrap §1, no scope creep).
export const sarOrgs = pgTable("sar_orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  // The operator approvals queue lists pending orgs; index the status it filters on.
  (t) => [index("sar_orgs_status_idx").on(t.status)],
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
