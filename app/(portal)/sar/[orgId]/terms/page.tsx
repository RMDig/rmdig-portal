import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { TermsView } from "@/components/sar/TermsView";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { canManageOrg } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgTerms } from "@/lib/db/schema";
import type { CapabilityName } from "@/lib/sar/terms-rules";

import { TermsEditor } from "./TermsEditor";

export const metadata = { title: "Team terms — rmdig" };

// A SAR team's terms (docs/plans/33): what's published, what's waiting for
// review, and the editor. Org admins only.
export default async function TermsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !(await canManageOrg(session.user.id, orgId))) redirect("/dashboard");

  const [org] = await db.select({ name: sarOrgs.name, status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) redirect("/dashboard");

  const versions = await db.select().from(sarOrgTerms).where(eq(sarOrgTerms.orgId, orgId)).orderBy(desc(sarOrgTerms.createdAt));
  const published = versions.filter((v) => v.status === "published").sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  const current = published[0];
  const open = versions.find((v) => v.status === "draft" || v.status === "submitted");
  const lastRejected = versions.find((v) => v.status === "rejected");
  const start = open ?? (lastRejected && (!current || lastRejected.createdAt > (current.publishedAt ?? current.createdAt)) ? lastRejected : current);
  const editable = org.status === "pending" || org.status === "approved";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team terms</h1>
        <p className="text-muted-foreground mt-1">
          The terms users accept when they add your team, and the services you provide through AvAI. rmdig staff
          review every version before it&apos;s published.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Published</h2>
        {current ? (
          <>
            <p className="text-muted-foreground text-sm">
              Version {current.version}, published {current.publishedAt?.toLocaleDateString()}
              {current.requiresReacceptance === false ? " (only removed services; earlier acceptances carry forward)" : ""}.
            </p>
            <TermsView body={current.body} capabilities={current.capabilities} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No terms published yet.</p>
        )}
      </section>

      {open?.status === "submitted" ? (
        <p className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
          A new version is waiting for review. Saving changes below takes it back to a draft.
        </p>
      ) : null}
      {!open && start?.status === "rejected" && start.reviewNote ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Changes requested:</strong> {start.reviewNote}
        </p>
      ) : null}

      {editable ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{open ? "Your draft" : "Write a new version"}</h2>
          <TermsEditor
            orgId={orgId}
            initialBody={start?.body ?? ""}
            initialCapabilities={(start?.capabilities ?? []).map((c) => c.name as CapabilityName)}
          />
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">Terms can&apos;t be changed while your organization is {org.status}.</p>
      )}

      {published.length > 1 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Earlier versions</h2>
          <ul className="text-muted-foreground space-y-1 text-sm">
            {published.slice(1).map((v) => (
              <li key={v.id}>
                Version {v.version}, published {v.publishedAt?.toLocaleDateString()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
