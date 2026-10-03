import { asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPlatformRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs, users } from "@/lib/db/schema";
import { getRegionAsGeoJson } from "@/lib/sar/geo";
import { type PendingOrg, SarApprovalRow } from "./SarApprovalRow";

export const metadata = {
  title: "SAR approvals — rmdig",
};

// Reviewable lifecycle states, in display priority (pending first — those need
// action). Rejected orgs are terminal and omitted.
const STATUS_ORDER: Record<string, number> = { pending: 0, approved: 1, suspended: 2 };

export default async function SarApprovalsPage() {
  // The /admin route is staff-gated; re-check here so a direct URL can't reach
  // the queue, and so a write can never trust the layout (docs/plans/06).
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }
  const roles = await getPlatformRoles(session.user.id);
  if (roles.length === 0) {
    redirect("/dashboard");
  }

  const reviewable = await db
    .select({
      id: sarOrgs.id,
      name: sarOrgs.name,
      status: sarOrgs.status,
      submitterEmail: users.email,
      submittedAt: sarOrgs.createdAt,
      operatingStatus: sarOrgs.operatingStatus,
      operatingStatusOther: sarOrgs.operatingStatusOther,
      regionName: sarOrgs.regionName,
    })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, sarOrgs.createdByUserId))
    .where(inArray(sarOrgs.status, ["pending", "approved", "suspended"]))
    .orderBy(asc(sarOrgs.createdAt));

  // The region lives in a raw PostGIS column read via lib/sar/geo. Few orgs are
  // in play at once, so a read per row is fine.
  const rows: PendingOrg[] = await Promise.all(
    reviewable.map(async (o) => ({
      ...o,
      submittedAt: o.submittedAt.toISOString(),
      region: await getRegionAsGeoJson(o.id),
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
          No organizations to review right now.
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
