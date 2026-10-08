import { asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { getOrgMemberships } from "@/lib/auth/org-roles";
import { isSarApprover } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgSync, users } from "@/lib/db/schema";
import { SKIP_LABEL, type SkipReason } from "@/lib/sar/sync-body";
import { getRegionAsGeoJson } from "@/lib/sar/geo";
import { type PendingOrg, SarApprovalRow } from "./SarApprovalRow";

export const metadata = {
  title: "SAR approvals — rmdig",
};

// Reviewable lifecycle states, in display priority (pending first — those need
// action). Rejected orgs are terminal and omitted.
const STATUS_ORDER: Record<string, number> = { pending: 0, approved: 1, leaving: 2, suspended: 3 };

export default async function SarApprovalsPage() {
  // The /admin route is staff-gated; re-check here so a direct URL can't reach
  // the queue, and so a write can never trust the layout (docs/plans/06).
  const session = await auth();
  if (!session?.user) {
    return redirectToSignIn();
  }
  // The queue is the SAR approvers' alone (CLAUDE.md §0; lib/auth/roles.ts).
  if (!(await isSarApprover(session.user.id))) {
    redirect("/admin");
  }
  const myOrgs = new Set((await getOrgMemberships(session.user.id)).map((m) => m.orgId));

  const reviewable = await db
    .select({
      id: sarOrgs.id,
      name: sarOrgs.name,
      status: sarOrgs.status,
      orgType: sarOrgs.orgType,
      submitterEmail: users.email,
      submittedAt: sarOrgs.createdAt,
      operatingStatus: sarOrgs.operatingStatus,
      operatingStatusOther: sarOrgs.operatingStatusOther,
      regionName: sarOrgs.regionName,
      reverifyBy: sarOrgs.reverifyBy,
      reviewRevision: sarOrgs.reviewRevision,
      createdByUserId: sarOrgs.createdByUserId,
    })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, sarOrgs.createdByUserId))
    .where(inArray(sarOrgs.status, ["pending", "approved", "leaving", "suspended"]))
    .orderBy(asc(sarOrgs.createdAt));

  // The region lives in a raw PostGIS column read via lib/sar/geo. Few orgs are
  // in play at once, so a read per row is fine.
  const syncRows = reviewable.length
    ? await db.select().from(sarOrgSync).where(inArray(sarOrgSync.orgId, reviewable.map((o) => o.id)))
    : [];
  const rows: PendingOrg[] = await Promise.all(
    reviewable.map(async ({ createdByUserId, ...o }) => ({
      ...o,
      // The action refuses it too; this only explains the missing button.
      conflictOfInterest:
        createdByUserId === session.user.id ? ("submitted" as const) : myOrgs.has(o.id) ? ("member" as const) : null,
      submittedAt: o.submittedAt.toISOString(),
      reverifyBy: o.reverifyBy?.toISOString() ?? null,
      region: await getRegionAsGeoJson(o.id),
      sync: syncRows
        .filter((s) => s.orgId === o.id)
        .map((s) => ({
          node: s.node,
          revision: s.revision,
          outcome: s.outcome,
          detail:
            s.outcome === "error"
              ? `failed (${s.errorCode})`
              : s.outcome === "skipped"
                ? (SKIP_LABEL[s.unusableReason as SkipReason] ?? s.unusableReason ?? "skipped")
                : s.usable
                  ? "usable"
                  : `not usable${s.unusableReason ? ` (${s.unusableReason})` : ""}`,
          syncedAt: s.syncedAt?.toISOString() ?? null,
        })),
    })),
  );
  // Pending first (they need action), then approved, then suspended.
  rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SAR approvals</h1>
        <p className="text-muted-foreground mt-1">
          {pendingCount} application{pendingCount === 1 ? "" : "s"} awaiting review
          {rows.length > pendingCount ? ` · ${rows.length - pendingCount} active or suspended` : ""}.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border px-4 py-8 text-center text-sm">
          No teams to review right now.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((org) => (
            <SarApprovalRow key={org.id} org={org} />
          ))}
        </ul>
      )}
    </div>
  );
}
