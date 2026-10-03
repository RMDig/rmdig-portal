"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgTerms, userPlatformRoles, users } from "@/lib/db/schema";
import { sendSarTermsPendingReviewEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { capabilitySettings, termsDraftSchema, termsWordingProblems, type WordingProblem } from "@/lib/sar/terms-rules";

// A SAR team's admins write their terms and choose their services
// (docs/plans/33). Saving keeps one open draft per org; submitting sends it to
// rmdig staff, who publish or send it back (admin/sar-terms). Submitting is
// refused while the wording check finds anything.

export type TermsSaveResult =
  | { ok: true; submitted: boolean }
  | { ok: false; error: string; problems?: WordingProblem[]; fieldErrors?: Record<string, string[] | undefined> };

export async function saveTermsAction(
  orgId: string,
  _prev: TermsSaveResult | null,
  formData: FormData,
): Promise<TermsSaveResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (!(await canManageOrg(userId, orgId))) {
    return { ok: false, error: "Only your organization's admins can edit its terms." };
  }

  const [org] = await db.select({ name: sarOrgs.name, status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) return { ok: false, error: "That organization no longer exists." };
  if (org.status !== "pending" && org.status !== "approved") {
    return { ok: false, error: `Terms can't be changed while your organization is ${org.status}.` };
  }

  const submit = formData.get("intent") === "submit";
  const parsed = termsDraftSchema.safeParse({
    body: formData.get("body") ?? "",
    capabilities: formData.getAll("capabilities"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { body, capabilities } = parsed.data;

  if (submit) {
    const problems = termsWordingProblems(body);
    if (problems.length > 0) {
      return {
        ok: false,
        error: "Terms can't describe availability, hours, coverage, response times or monitoring. Reword the highlighted phrases.",
        problems,
      };
    }
  }

  const values = {
    body,
    capabilities: capabilitySettings(capabilities),
    status: submit ? ("submitted" as const) : ("draft" as const),
    submittedAt: submit ? new Date() : null,
    authorUserId: userId,
    updatedAt: new Date(),
  };
  try {
    await db.transaction(async (tx) => {
      const [open] = await tx
        .select({ id: sarOrgTerms.id })
        .from(sarOrgTerms)
        .where(and(eq(sarOrgTerms.orgId, orgId), inArray(sarOrgTerms.status, ["draft", "submitted"])))
        .for("update")
        .limit(1);
      if (open) {
        await tx.update(sarOrgTerms).set(values).where(eq(sarOrgTerms.id, open.id));
      } else {
        await tx.insert(sarOrgTerms).values({ orgId, ...values });
      }
    });
  } catch (err) {
    logger.error({ event: "sar.terms.save_failed", orgId, userId, err });
    return { ok: false, error: "Couldn't save the terms. Try again in a moment." };
  }

  logger.info({ event: submit ? "sar.terms.submitted" : "sar.terms.draft_saved", orgId, userId });
  if (submit) await notifyStaff(orgId, org.name);
  revalidatePath(`/sar/${orgId}/terms`);
  return { ok: true, submitted: submit };
}

async function notifyStaff(orgId: string, orgName: string): Promise<void> {
  const reviewUrl = `${env.NEXTAUTH_URL ?? "http://localhost:3000"}/admin/sar-terms`;
  let admins: { email: string }[];
  try {
    admins = await db
      .select({ email: users.email })
      .from(userPlatformRoles)
      .innerJoin(users, eq(users.id, userPlatformRoles.userId))
      .where(eq(userPlatformRoles.role, "rmdig_admin"));
  } catch (err) {
    logger.error({ event: "sar.terms.admin_lookup_failed", orgId, err });
    return;
  }
  for (const a of admins) {
    try {
      await sendSarTermsPendingReviewEmail(a.email, { orgName, reviewUrl });
    } catch (err) {
      logger.error({ event: "sar.terms.admin_email_failed", orgId, to: a.email, err });
    }
  }
}
