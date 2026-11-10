import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/auth/org-roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { sarOrgAreaLog, sarOrgs, users } from "@/lib/db/schema";
import { formatMountainDate } from "@/lib/format/time";
import { TEAM_STATUS_LABEL } from "@/lib/labels";
import { getRegionAreaKm2, getRegionAsGeoJson } from "@/lib/sar/geo";

import { AreaForm } from "./AreaForm";

export const metadata = { title: "Service area — rmdig" };

const km2 = (v: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)} km²`;

// An approved team's admins change its service area here (plan 33 D3, step
// 9.4). Every change is logged, sent to AvAI and emailed to rmdig staff; the
// last few are listed so admins can see who changed what.
export default async function AreaPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !(await canManageOrg(session.user.id, orgId))) redirect("/dashboard");

  const [org] = await db.select({ status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) redirect("/dashboard");
  if (org.status === "pending") redirect(`/sar/${orgId}/edit`);

  if (org.status !== "approved") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Service area</h1>
        <p className="text-muted-foreground">
          The service area can&apos;t be changed while your team is {TEAM_STATUS_LABEL[org.status].toLowerCase()}.
        </p>
      </div>
    );
  }

  const [region, areaKm2, history] = await Promise.all([
    getRegionAsGeoJson(orgId),
    getRegionAreaKm2(orgId),
    db
      .select({ at: sarOrgAreaLog.createdAt, fromKm2: sarOrgAreaLog.fromAreaKm2, toKm2: sarOrgAreaLog.toAreaKm2, by: users.email })
      .from(sarOrgAreaLog)
      .leftJoin(users, eq(users.id, sarOrgAreaLog.actorUserId))
      .where(eq(sarOrgAreaLog.orgId, orgId))
      .orderBy(desc(sarOrgAreaLog.createdAt))
      .limit(10),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Service area</h1>
        <p className="text-muted-foreground mt-1">
          The area your team serves. AvAI uses it to offer your team to people checking out there. When you save a
          new area it replaces this one, it&apos;s sent to AvAI, and rmdig staff are told.
        </p>
        {areaKm2 !== null ? <p className="mt-2 text-sm">Current area: {km2(areaKm2)}.</p> : null}
      </div>

      <AreaForm orgId={orgId} region={region} />

      {history.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Recent changes</h2>
          <ul className="text-muted-foreground space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.at.toISOString()}>
                {formatMountainDate(h.at)}: {h.by ?? "a former member"} changed it
                {h.fromKm2 === null ? ` to ${km2(h.toKm2)}` : ` from ${km2(h.fromKm2)} to ${km2(h.toKm2)}`}.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
