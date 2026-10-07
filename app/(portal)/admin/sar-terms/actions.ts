"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { orgMemberships, sarOrgs, sarOrgTerms, users } from "@/lib/db/schema";
import { portalUrl } from "@/lib/email/links";
import { sendSarTermsDecisionEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { syncSarOrg } from "@/lib/sar/sync";
import { requiresReacceptance, termsSha256 } from "@/lib/sar/terms";
import { termsWordingProblems } from "@/lib/sar/terms-rules";

// rmdig admins publish or send back a team's submitted terms (docs/plans/33).
// Publishing assigns the next version, the SHA-256 of the exact body bytes and
// whether users must accept again, all in one transaction that locks the
// org's terms rows. The published row is then immutable (DB trigger). The
// wording check runs again here: nothing that implies monitoring publishes.

const decisionSchema = z
  .object({
    termsId: z.string().uuid(),
    decision: z.enum(["publish", "reject"]),
    note: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.decision === "publish" || !!v.note, { message: "Say what to change.", path: ["note"] });

export type TermsDecisionResult =
  | { ok: true; decision: "publish" | "reject"; version?: number }
  | { ok: false; error: string };

class Refused extends Error {}

export async function decideTermsAction(_prev: TermsDecisionResult | null, formData: FormData): Promise<TermsDecisionResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const staffId = actor.userId;
  if (!(await hasPlatformRole(staffId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can publish team terms." };
  }
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision." };
  const { termsId, decision, note } = parsed.data;

  let outcome: { orgId: string; orgName: string; version?: number };
  try {
    outcome = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: sarOrgTerms.id, orgId: sarOrgTerms.orgId, status: sarOrgTerms.status, body: sarOrgTerms.body, capabilities: sarOrgTerms.capabilities, orgName: sarOrgs.name })
        .from(sarOrgTerms)
        .innerJoin(sarOrgs, eq(sarOrgs.id, sarOrgTerms.orgId))
        .where(eq(sarOrgTerms.id, termsId))
        .for("update", { of: sarOrgTerms })
        .limit(1);
      if (!row) throw new Refused("Those terms no longer exist.");
      if (row.status !== "submitted") throw new Refused(`These terms are ${row.status}, not waiting for review.`);

      const reviewed = { reviewedByUserId: staffId, reviewedAt: new Date(), updatedAt: new Date() };
      if (decision === "reject") {
        await tx.update(sarOrgTerms).set({ status: "rejected", reviewNote: note, ...reviewed }).where(eq(sarOrgTerms.id, termsId));
        return { orgId: row.orgId, orgName: row.orgName };
      }

      const problems = termsWordingProblems(row.body);
      if (problems.length > 0) {
        throw new Refused(`Can't publish: the wording check flags ${problems.map((p) => `"${p.match}"`).join(", ")}.`);
      }
      // Lock the org's published versions to number this one safely.
      const published = await tx
        .select({ version: sarOrgTerms.version, body: sarOrgTerms.body, capabilities: sarOrgTerms.capabilities })
        .from(sarOrgTerms)
        .where(and(eq(sarOrgTerms.orgId, row.orgId), eq(sarOrgTerms.status, "published")))
        .orderBy(desc(sarOrgTerms.version))
        .for("update");
      const previous = published[0] ?? null;
      const version = (previous?.version ?? 0) + 1;
      await tx
        .update(sarOrgTerms)
        .set({
          status: "published",
          version,
          sha256: termsSha256(row.body),
          publishedAt: new Date(),
          requiresReacceptance: requiresReacceptance(previous, { body: row.body, capabilities: row.capabilities }),
          reviewNote: null,
          ...reviewed,
        })
        .where(eq(sarOrgTerms.id, termsId));
      return { orgId: row.orgId, orgName: row.orgName, version };
    });
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message };
    logger.error({ event: "sar.terms.decide_failed", staffId, termsId, err });
    return { ok: false, error: "Couldn't record the decision. Try again in a moment." };
  }

  logger.info({ event: decision === "publish" ? "sar.terms.published" : "sar.terms.rejected", staffId, orgId: outcome.orgId, version: outcome.version });
  // A newly published version goes to AvServ (its services change what users
  // are offered). syncSarOrg skips orgs AvServ doesn't know yet (pending).
  if (decision === "publish") {
    try {
      await syncSarOrg(outcome.orgId);
    } catch (err) {
      logger.error({ event: "sar.sync.failed", orgId: outcome.orgId, after: "terms_publish", err });
    }
  }
  await notifyOrgAdmins(outcome.orgId, { orgName: outcome.orgName, decision: decision === "publish" ? "published" : "rejected", version: outcome.version, note });
  revalidatePath("/admin/sar-terms");
  return { ok: true, decision, version: outcome.version };
}

async function notifyOrgAdmins(
  orgId: string,
  params: { orgName: string; decision: "published" | "rejected"; version?: number; note?: string },
): Promise<void> {
  let admins: { email: string }[];
  try {
    admins = await db
      .select({ email: users.email })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "admin")));
  } catch (err) {
    logger.error({ event: "sar.terms.org_admin_lookup_failed", orgId, err });
    return;
  }
  for (const a of admins) {
    try {
      await sendSarTermsDecisionEmail(a.email, { ...params, termsUrl: portalUrl(`/sar/${orgId}/terms`) });
    } catch (err) {
      logger.error({ event: "sar.terms.decision_email_failed", orgId, to: a.email, err });
    }
  }
}
