import { z } from "zod";

import { previewSafetyProblems } from "./preview-guard";

// Single source of truth for env access across the app. Imported by lib/db,
// lib/logger, lib/auth, sentry.*.config — anywhere else that touches env, route
// it through here instead of reading process.env directly. That way the schema
// catches typos and missing values at server boot, not at first user request.
//
// Strict at runtime, lenient during builds (CI typecheck/lint/build and Next's
// static analysis don't have the full secret set). Production deploys validate
// because Vercel injects the full env before the server starts.

export const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Postgres (Neon, pooled). lib/db/index.ts is tuned for the -pooler suffix.
  DATABASE_URL: z.string().url(),

  // Auth.js v5. NEXTAUTH_SECRET must be at least 32 hex chars. NEXTAUTH_URL
  // is also the base of every emailed link (lib/email/links.ts), so production
  // requires it (refined below): unset, links would point at localhost.
  // Previews leave it unset and Auth.js auto-detects via VERCEL_URL.
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(32),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Apple Sign-In. APPLE_PRIVATE_KEY arrives PEM-formatted with \n escapes
  // (Option A from the Apple walkthrough); Auth.js's Apple provider parses
  // either PEM or base64. Optional: the Apple provider is not wired into
  // lib/auth yet, and requiring operator-held creds the deploy doesn't use
  // took down every route in prod (2026-07-22). Make them required again in
  // the same PR that actually adds the provider.
  APPLE_ID: z.string().min(1).optional(),
  APPLE_TEAM_ID: z.string().length(10).optional(),
  APPLE_KEY_ID: z.string().length(10).optional(),
  APPLE_PRIVATE_KEY: z.string().min(1).optional(),

  // Resend transactional email. Optional in the schema so a deploy without the
  // key still serves pages (same pattern as MFA_ENCRYPTION_KEY below);
  // lib/email/send fails loud at send time if it's actually exercised unset.
  RESEND_API_KEY: z.string().startsWith("re_").optional(),
  RESEND_FROM_EMAIL: z.string().email().default("noreply@rmdig.ai"),

  // Twilio Verify (org-creation phone OTP). All three optional as a set: when
  // any is missing, phone verification is DISABLED and org creation proceeds
  // without it (CI/local/preview) — SAR approval (§0) and per-creative ad
  // approval remain the true gates. Set all three in prod to enforce.
  // Verify OTPs use Twilio's own numbers, not our A2P campaign.
  TWILIO_ACCOUNT_SID: z.string().startsWith("AC").optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().startsWith("VA").optional(),

  // Sentry. DSN is optional locally (errors then just log); ORG/PROJECT/AUTH
  // are build-time only for source-map upload.
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  // MapTiler key for the portal basemap (components/map/basemap.ts). Public by
  // design, restricted to our origins in the MapTiler dashboard; unset means
  // the free OpenStreetMap tiles. Read in the browser (inlined at build).
  NEXT_PUBLIC_MAPTILER_KEY: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),

  // Phase-1.4+ — optional until those milestones land.
  // Vercel Blob (SAR proof docs). On Vercel, connecting a Blob store sets
  // BLOB_STORE_ID and uploads authenticate with the function's OIDC token;
  // BLOB_READ_WRITE_TOKEN is the local-development fallback.
  BLOB_STORE_ID: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // AvServ S2S identity integration (direction B — see rmdig-ai docs/plans/
  // 05_portal_identity_integration.md). Optional until AvServ ships the
  // /v1/internal/accounts endpoints; `mock://localhost` exercises the portal
  // half without a live AvServ.
  AVSERV_BASE_URL: z.string().optional(),
  // The Ed25519 private key that signs the short-lived service JWT for
  // /v1/internal/*: ONE base64 line, the base64 of the PKCS#8 PEM file
  // (lib/avserv/service-key.ts). Held only in Vercel env, never committed.
  // AvServ verifies the public half. The build checks it (scripts/
  // check-service-key.ts) against AVSERV_SERVICE_JWT_KEY_SHA256, the public
  // fingerprint AvServ holds for AVSERV_SERVICE_JWT_KID; changing the kid is
  // how a key is rotated with overlap (runbook "Rotating the AvServ service key").
  // Shapes are validated by the build check, not here: a bad value fails the
  // deploy rather than every route at runtime.
  AVSERV_SERVICE_JWT_SIGNING_KEY_B64: z.string().optional(),
  AVSERV_SERVICE_JWT_KID: z.string().optional(),
  AVSERV_SERVICE_JWT_KEY_SHA256: z.string().optional(),
  // The second AvServ node, used only to retry an agreement acceptance with the
  // same Idempotency-Key when the primary is unreachable or answers 5xx/503
  // (AvServ contract account_agreement.md §4, failover). Optional: unset means
  // acceptances go to AVSERV_BASE_URL alone, and a failure there is shown.
  AVSERV_FAILOVER_BASE_URL: z.string().optional(),
  // E2E-only seam (docs/plans/31 §4): with AVSERV_BASE_URL=mock://* it lets the
  // agreement page present a labelled test fixture while no version is pinned.
  // Production never sets it, and it is ignored against a real AvServ.
  E2E_AGREEMENT_FIXTURE: z.string().optional(),
  // SAR intake (AvServ sar_portal_intake.md §2): the HMAC secret each AvServ
  // node signs its alert POSTs with, packed "keyId:secret,keyId:secret". One
  // per node, never shared. During rotation both ids are listed. Optional:
  // unset, /api/sar/intake answers 503 (AvServ retries) and logs loudly.
  AVSERV_SAR_INTAKE_KEYS: z.string().optional(),
  // Vercel sends it as "Authorization: Bearer <CRON_SECRET>" on scheduled
  // calls (vercel.json crons). Unset: the cron routes answer 503 and log.
  CRON_SECRET: z.string().min(32).optional(),

  // Surfaces that are built but wait on AvServ endpoints that don't exist yet
  // (lib/features.ts). "off" (the default) hides them: their pages 404 and
  // their actions refuse. Turn one on only once AvServ ships its routes.
  // ADVERTISER_PORTAL: /advertiser/*, /advertiser-invite, admin ad approvals.
  // RESTRICTION_REVIEW: /account/review and admin restriction reviews.
  FEATURE_ADVERTISER_PORTAL: z.enum(["on", "off"]).default("off"),
  FEATURE_RESTRICTION_REVIEW: z.enum(["on", "off"]).default("off"),

  // Runtime knob for the MFA enforcement gate (lib/auth middleware uses this).
  MFA_ENFORCEMENT: z.enum(["optional", "admin_only", "all"]).default("admin_only"),

  // AES-256 key (32 bytes, hex) encrypting stored TOTP secrets. Optional in the
  // schema so builds/CI without MFA configured still boot; lib/auth/mfa fails
  // loud if MFA is exercised without it. Generate with: openssl rand -hex 32
  MFA_ENCRYPTION_KEY: z.string().optional(),

  // Commit SHA surfaced by /healthz. Vercel sets VERCEL_GIT_COMMIT_SHA;
  // GIT_COMMIT_SHA is the local-dev fallback.
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  GIT_COMMIT_SHA: z.string().optional(),

  // Set by Vercel. On "preview" the safety rules in lib/preview-guard apply:
  // no production database, a mock AvServ, and email logged instead of sent.
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  // Set by Vercel: this deployment's own host, without a scheme. The base of a
  // preview's emailed links (lib/email/links.ts), since previews have no
  // NEXTAUTH_URL.
  VERCEL_URL: z.string().optional(),
  // Preview only: comma-separated addresses that still receive real email, for
  // testing a template end to end. Unset means previews send nothing.
  PREVIEW_EMAIL_RECIPIENTS: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.VERCEL_ENV === "production" && !v.NEXTAUTH_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["NEXTAUTH_URL"],
      message: "required in production: emailed links are built from it",
    });
  }
});

export type Env = z.infer<typeof Env>;

const parsed = Env.safeParse(process.env);

// Skip strict validation during Next.js build phase and in CI. Next's static
// analysis imports all module-level code without the full env, and CI runs
// `pnpm build` without secrets. Production deploys hit the strict path because
// Vercel injects env before the server boots.
const isBuildOrCI =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.CI === "true" ||
  process.env.NODE_ENV === "test";

if (!parsed.success && !isBuildOrCI) {
  const flat = parsed.error.flatten().fieldErrors;
  const summary = Object.entries(flat)
    .map(([k, v]) => `  ${k}: ${v?.join(", ")}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${summary}\n\nCheck .env.local against .env.example.`);
}

// A preview must never reach production data or the live safety service.
// Checked at runtime only: the build has its own check in
// scripts/migrate-preview.ts, and CI has no preview env.
if (parsed.success && !isBuildOrCI && parsed.data.VERCEL_ENV === "preview") {
  const problems = previewSafetyProblems(parsed.data);
  if (problems.length > 0) {
    throw new Error(`Unsafe preview configuration:\n  ${problems.join("\n  ")}`);
  }
}

// At build/CI, expose process.env as-is (typed) so static analysis doesn't
// trip on missing values. At runtime, expose the validated and defaulted set.
export const env = (parsed.success ? parsed.data : (process.env as unknown)) as Env;
