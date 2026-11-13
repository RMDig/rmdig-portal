import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/auth/org-roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { formatMountain } from "@/lib/format/time";
import { readApprovals } from "@/lib/sar/approvals";
import { decisionsFor, standingText } from "@/lib/sar/approvals-rules";

import { DecisionButtons } from "./DecisionButtons";

export const metadata = { title: "Approvals — rmdig" };

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3; the field list a team sees
// before any alert is AvServ sar_terms.md §6 O3), for counsel's review before
// the first real team. A change here goes to counsel too.
// A confirm-first team's admins approve or decline each person who accepted
// its terms (plan 33 D4, 9.8). The list is every AvAI server's, merged; a
// server that couldn't be read is named, and the list is never shown as empty
// unless every server said so. Each view is logged on each server as a
// disclosure to the admin reading it, so the page reads only when opened.
export default async function ApprovalsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !(await canManageOrg(session.user.id, orgId))) redirect("/dashboard");

  const [org] = await db.select({ status: sarOrgs.status, mode: sarOrgs.acceptanceMode }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) redirect("/dashboard");

  const intro = (
    <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
  );
  if (org.mode !== "confirm_first") {
    return (
      <div className="max-w-2xl space-y-4">
        {intro}
        <p className="text-muted-foreground">
          Anyone who accepts your team&apos;s terms can name it on a check-out, so there&apos;s nobody to approve. To
          approve each person first, change who can name your team on the{" "}
          <Link href={`/sar/${orgId}/checkouts`} className="underline">
            Check-outs
          </Link>{" "}
          tab.
        </p>
      </div>
    );
  }
  if (org.status === "pending") {
    return (
      <div className="max-w-2xl space-y-4">
        {intro}
        <p className="text-muted-foreground">Once your team is approved, people who accept its terms appear here for you to approve.</p>
      </div>
    );
  }

  const list = await readApprovals(orgId, session.user.id);
  const allFailed = list.nodes > 0 && list.failed.length === list.nodes;
  const pendingCount = list.items.filter((i) => i.standing === "pending").length;

  return (
    <div className="max-w-2xl space-y-6">
      {intro}
      <div className="text-muted-foreground space-y-2 text-sm">
        <p>
          Your team approves each person who accepts its terms before they can name your team on a check-out. You
          approve the person once for each version of your terms, never each check-out.
        </p>
        <p>
          Declining, or withdrawing an approval, applies to their next check-out. A check-out that already names your
          team keeps it.
        </p>
      </div>

      {list.failed.length ? (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          {allFailed ? "AvAI's servers couldn't be read, so this list can't be shown. It may not be empty: reload in a few minutes." : "Not every AvAI server could be read, so this list may be missing people. Reload in a few minutes."}{" "}
          ({list.failed.map((f) => `${f.node}: ${f.code}`).join("; ")})
        </div>
      ) : null}
      {list.truncated ? <p className="text-sm text-amber-800 dark:text-amber-200">This list is too long to show in full. rmdig staff have been told.</p> : null}

      {allFailed ? null : list.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody has accepted your terms since you turned on approvals.</p>
      ) : (
        <section className="space-y-2">
          <h2 className="font-medium">{pendingCount ? `${pendingCount} waiting for your team` : "Nobody waiting"}</h2>
          <ul className="divide-y rounded-md border">
            {list.items.map((i) => (
              <li key={i.acceptanceId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="text-sm">
                  <p className="font-medium">{i.userDisplayName ?? "Name not given"}</p>
                  <p className="text-muted-foreground">
                    Accepted terms version {i.termsVersion} on {formatMountain(new Date(i.acceptedAt))} · {standingText(i)}
                  </p>
                </div>
                <DecisionButtons orgId={orgId} acceptanceId={i.acceptanceId} decisions={decisionsFor(i.standing)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
