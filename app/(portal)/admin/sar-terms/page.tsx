import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import { redirect } from "next/navigation";

import { TermsView } from "@/components/sar/TermsView";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgTerms } from "@/lib/db/schema";
import { termsWordingProblems } from "@/lib/sar/terms-rules";

import { TermsDecisionForm } from "./TermsDecisionForm";

export const metadata = { title: "Team terms review — rmdig admin" };

// rmdig admins review SAR teams' submitted terms (docs/plans/33). Publishing is
// blocked while the wording check flags anything.
// Submitted versions, plus those decided in the last day: decided items stay
// on the page with their outcome, so a card (and its form) stays mounted
// across the refresh after a decision.
async function loadQueue() {
  const since = new Date(Date.now() - 86_400_000);
  return db
    .select({
      id: sarOrgTerms.id,
      orgId: sarOrgTerms.orgId,
      orgName: sarOrgs.name,
      orgStatus: sarOrgs.status,
      body: sarOrgTerms.body,
      capabilities: sarOrgTerms.capabilities,
      submittedAt: sarOrgTerms.submittedAt,
      status: sarOrgTerms.status,
      version: sarOrgTerms.version,
    })
    .from(sarOrgTerms)
    .innerJoin(sarOrgs, eq(sarOrgs.id, sarOrgTerms.orgId))
    .where(
      or(
        eq(sarOrgTerms.status, "submitted"),
        and(inArray(sarOrgTerms.status, ["published", "rejected"]), gt(sarOrgTerms.reviewedAt, since)),
      ),
    )
    .orderBy(asc(sarOrgTerms.submittedAt));
}

export default async function SarTermsReviewPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!(await hasPlatformRole(session.user.id, "rmdig_admin"))) redirect("/admin");

  const submitted = await loadQueue();

  const orgIds = submitted.map((s) => s.orgId);
  const published = orgIds.length
    ? await db
        .select({ orgId: sarOrgTerms.orgId, version: sarOrgTerms.version })
        .from(sarOrgTerms)
        .where(and(inArray(sarOrgTerms.orgId, orgIds), eq(sarOrgTerms.status, "published")))
        .orderBy(desc(sarOrgTerms.version))
    : [];
  const latest = new Map<string, number>();
  for (const p of published) if (!latest.has(p.orgId) && p.version) latest.set(p.orgId, p.version);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team terms review</h1>
        <p className="text-muted-foreground mt-1">
          Publish only terms that describe what the team does and doesn&apos;t do: no availability, hours,
          coverage, response times or monitoring. Publishing is final; changes are a new version.
        </p>
      </div>
      {submitted.every((s) => s.status !== "submitted") ? (
        <p className="text-muted-foreground text-sm">Nothing is waiting for review.</p>
      ) : null}
      {submitted.length === 0 ? null : (
        submitted.map((s) => {
          const problems = termsWordingProblems(s.body);
          const prev = latest.get(s.orgId);
          return (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle>{s.orgName}</CardTitle>
                <CardDescription>
                  Organization {s.orgStatus} · submitted {s.submittedAt?.toLocaleString()} ·{" "}
                  {s.status === "submitted"
                    ? `would publish as version ${(prev ?? 0) + 1}`
                    : s.status === "published"
                      ? `published as version ${s.version}`
                      : "sent back"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <TermsView body={s.body} capabilities={s.capabilities} />
                {s.status === "submitted" && problems.length > 0 ? (
                  <p className="text-sm text-red-600">
                    Wording check flags {problems.map((p) => `"${p.match}"`).join(", ")}. Send it back.
                  </p>
                ) : null}
                <TermsDecisionForm termsId={s.id} blocked={problems.length > 0} open={s.status === "submitted"} />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
