// Preview-deployment safety rules (docs/runbook.md "Preview deployments").
// Previews run on a separate Neon project holding only test personas (Neon's
// Vercel integration can only fork preview branches from production, which
// would copy real users) and talk to a mock AvServ. These rules make a
// misconfiguration fail loud instead of quietly pointing a preview at
// production data or the live safety service. Pure and env-free, so lib/env,
// the build-time migrator and the seed script all share them, and tests cover
// every rule.

/** The production Neon endpoint (a hostname, not a secret). Previews, the
 *  preview migrator and the seed script must never connect to it. */
export const PRODUCTION_DB_ENDPOINT = "ep-crimson-thunder-aqloj3r3";

export type VercelEnv = "production" | "preview" | "development";

export function isProductionDatabaseUrl(url: string | undefined): boolean {
  return !!url && url.includes(PRODUCTION_DB_ENDPOINT);
}

/** Every reason a preview's configuration is unsafe; empty when it's fine. */
export function previewSafetyProblems(e: {
  DATABASE_URL?: string;
  AVSERV_BASE_URL?: string;
  AVSERV_FAILOVER_BASE_URL?: string;
  AVSERV_SERVICE_JWT_SIGNING_KEY_B64?: string;
  AVSERV_ERASURE_JWT_SIGNING_KEY_B64?: string;
}): string[] {
  const problems: string[] = [];
  if (isProductionDatabaseUrl(e.DATABASE_URL)) {
    problems.push(
      "DATABASE_URL points at the production Neon endpoint; previews must use the preview " +
        "Neon project (Vercel env: Preview-scoped DATABASE_URL).",
    );
  }
  if (e.AVSERV_BASE_URL && !e.AVSERV_BASE_URL.startsWith("mock://")) {
    problems.push(
      "AVSERV_BASE_URL is a real AvServ; previews must use mock://localhost so they never create " +
        "real AvServ accounts or touch the safety service.",
    );
  }
  // Every AvServ call tries the failover node when the primary doesn't answer
  // (lib/avserv/request.ts), so a mock primary alone doesn't keep a preview
  // off the live service.
  if (e.AVSERV_FAILOVER_BASE_URL && !e.AVSERV_FAILOVER_BASE_URL.startsWith("mock://")) {
    problems.push(
      "AVSERV_FAILOVER_BASE_URL is a real AvServ; previews call it when the primary fails, so it " +
        "must be unset or mock://.",
    );
  }
  // The service key is what AvServ trusts. A preview has no use for it (the
  // mock needs none), and holding it would let a misconfigured preview act on
  // production AvServ as the portal. Production-scoped only in Vercel.
  if (e.AVSERV_SERVICE_JWT_SIGNING_KEY_B64) {
    problems.push(
      "AVSERV_SERVICE_JWT_SIGNING_KEY_B64 is set; the portal's AvServ signing key must be " +
        "Production-scoped only in Vercel.",
    );
  }
  // The erasure key can delete accounts on production AvServ: never on a preview.
  if (e.AVSERV_ERASURE_JWT_SIGNING_KEY_B64) {
    problems.push(
      "AVSERV_ERASURE_JWT_SIGNING_KEY_B64 is set; the erasure key must be Production-scoped only in Vercel.",
    );
  }
  return problems;
}

/** The database a preview build should migrate, or null outside previews.
 *  Prefers the unpooled URL (migrations hold a session). Throws when a
 *  preview has no database, or the database is production's. */
export function previewMigrationUrl(e: {
  VERCEL_ENV?: string;
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
}): string | null {
  if (e.VERCEL_ENV !== "preview") return null;
  const url = e.DATABASE_URL_UNPOOLED || e.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Preview build has no DATABASE_URL: set the Preview-scoped one to the preview Neon project.",
    );
  }
  if (isProductionDatabaseUrl(url)) {
    throw new Error("Refusing to migrate: the preview's database URL is the production endpoint.");
  }
  return url;
}

/** On a preview, an email is sent only when every recipient is on the
 *  PREVIEW_EMAIL_RECIPIENTS allowlist; otherwise it is logged, not sent.
 *  Production and local development always send. */
export function shouldDeliverEmail(
  vercelEnv: string | undefined,
  allowlist: string | undefined,
  to: string | string[],
): boolean {
  if (vercelEnv !== "preview") return true;
  const allowed = new Set(
    (allowlist ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const recipients = (Array.isArray(to) ? to : [to]).map((s) => s.trim().toLowerCase());
  return recipients.length > 0 && recipients.every((r) => allowed.has(r));
}
