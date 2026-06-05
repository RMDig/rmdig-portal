import {
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
