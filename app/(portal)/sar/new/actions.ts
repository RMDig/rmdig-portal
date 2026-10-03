"use server";

import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { ProofDocError, uploadProofDoc } from "@/lib/blob/upload";
import { db } from "@/lib/db";
import {
  orgMemberships,
  sarOrgs,
  sarOrgStatusLog,
  userPlatformRoles,
  users,
} from "@/lib/db/schema";
import { sendSarOrgPendingReviewEmail, sendSarOrgSubmittedEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { isUniqueViolation } from "@/lib/db/errors";
import { requireVerifiedOrgPhone } from "@/lib/phone/org-phone";
import { setRegionGeom } from "@/lib/sar/geo";
import { createSarOrgSchema } from "@/lib/sar/schema";
import { logger } from "@/lib/logger";

// Server action behind /sar/new (rmdig-ai docs/plans/06 §"SAR org onboarding").
// A signed-in, email-verified user submits an org application: it persists as a
// `pending` sar_orgs row, makes the submitter the org `admin`, logs the
// `submitted` transition, and emails the submitter + every rmdig_admin. The
// (portal) layout already gates auth/MFA; this action re-checks auth and
// verification because a layout must never be trusted to gate a write
// (docs/plans/06 §Permissions).

export type CreateSarOrgResult =
  | { ok: true; orgId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function createSarOrgAction(
  _prev: CreateSarOrgResult | null,
  formData: FormData,
): Promise<CreateSarOrgResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to register an organization." };
  }
  const userId = session.user.id;

  // Email verification is required before any state-changing action (docs/plans/
  // 06 §Authentication). Read it fresh rather than trusting the session token.
  const [account] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) {
    return { ok: false, error: "Your account could not be found. Sign in again." };
  }
  if (!account.emailVerified) {
    return {
      ok: false,
      error: "Verify your email address before registering an organization.",
    };
  }

  const parsed = createSarOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Verified-phone gate (no-op when Twilio Verify is unconfigured). Runs
  // before the proof-doc upload so a bad code doesn't orphan a blob.
  const phoneGate = await requireVerifiedOrgPhone(data.contactPhone, data.phoneCode);
  if (!phoneGate.ok) {
    return { ok: false, error: phoneGate.error, fieldErrors: phoneGate.fieldErrors };
  }

  // Upload the proof doc after field validation (so a bad form doesn't upload)
  // but before the transaction (the row needs the URL). A failed transaction
  // orphans the blob — acceptable, and rarer than a failed upload blocking submit.
  const file = formData.get("proofDoc");
  let proofDocUrl: string;
  try {
    if (!(file instanceof File)) {
      throw new ProofDocError("Attach your proof-of-status document.");
    }
    ({ url: proofDocUrl } = await uploadProofDoc(file));
  } catch (err) {
    if (err instanceof ProofDocError) {
      return { ok: false, error: err.message, fieldErrors: { proofDoc: [err.message] } };
    }
    logger.error({ event: "sar.create.upload_failed", userId, err });
    return { ok: false, error: "Couldn't upload your document. Try again in a moment." };
  }

  // Persist atomically: the org, its PostGIS region, the submitter's admin
  // membership, and the `submitted` audit entry either all land or none do.
  let orgId: string;
  try {
    orgId = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(sarOrgs)
        .values({
          orgType: data.orgType,
          name: data.name,
          description: data.description,
          regionName: data.regionName,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          contactPhone: phoneGate.phone,
          operatingStatus: data.operatingStatus,
          operatingStatusOther: data.operatingStatusOther,
          proofDocUrl,
          createdByUserId: userId,
        })
        .returning({ id: sarOrgs.id });
      if (!org) {
        throw new Error("sar_orgs insert returned no row");
      }
      await setRegionGeom(org.id, data.region, tx);
      await tx.insert(orgMemberships).values({ orgId: org.id, userId, role: "admin" });
      await tx.insert(sarOrgStatusLog).values({
        orgId: org.id,
        action: "submitted",
        fromStatus: null,
        toStatus: "pending",
        actorUserId: userId,
      });
      return org.id;
    });
  } catch (err) {
    // The only unique index this insert can trip (besides the PK) is the
    // per-phone one — surface it as a field error, not a generic failure.
    if (isUniqueViolation(err)) {
      logger.warn({ event: "sar.create.phone_in_use", userId });
      return {
        ok: false,
        error: "Please fix the highlighted fields.",
        fieldErrors: {
          contactPhone: ["This phone number is already registered to another organization."],
        },
      };
    }
    logger.error({ event: "sar.create.tx_failed", userId, err });
    return { ok: false, error: "Couldn't submit your application. Try again in a moment." };
  }

  logger.info({ event: "sar.create.success", userId, orgId });

  // Notify outside the transaction: the queue is the source of truth, so an
  // email hiccup must not roll back a submitted org. Failures are logged loudly,
  // never swallowed, but don't fail the submission.
  await notifyOnSubmission(orgId, data.name, account.email);

  return { ok: true, orgId };
}

async function notifyOnSubmission(
  orgId: string,
  orgName: string,
  submitterEmail: string,
): Promise<void> {
  try {
    await sendSarOrgSubmittedEmail(submitterEmail, orgName);
  } catch (err) {
    logger.error({ event: "sar.create.submitter_email_failed", orgId, err });
  }

  const baseUrl = env.NEXTAUTH_URL ?? "http://localhost:3000";
  const reviewUrl = `${baseUrl}/admin/sar-approvals`;

  let admins: { email: string }[];
  try {
    admins = await db
      .select({ email: users.email })
      .from(userPlatformRoles)
      .innerJoin(users, eq(users.id, userPlatformRoles.userId))
      .where(eq(userPlatformRoles.role, "rmdig_admin"));
  } catch (err) {
    logger.error({ event: "sar.create.admin_lookup_failed", orgId, err });
    return;
  }

  for (const admin of admins) {
    try {
      await sendSarOrgPendingReviewEmail(admin.email, { orgName, submitterEmail, reviewUrl });
    } catch (err) {
      logger.error({ event: "sar.create.admin_email_failed", orgId, to: admin.email, err });
    }
  }
}
