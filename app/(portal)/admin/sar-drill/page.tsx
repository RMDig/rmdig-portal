import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TestAlertPanel } from "@/components/sar/TestAlertPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { hasPlatformRole, isSarApprover } from "@/lib/auth/roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { orgMemberships, sarOrgs, sarOrgSync, users } from "@/lib/db/schema";
import { formatMountainDate } from "@/lib/format/time";
import { SKIP_LABEL, type SkipReason } from "@/lib/sar/sync-body";
import { latestTestAlerts } from "@/lib/sar/test-alert";

import { DrillDecisions } from "./DrillDecisions";
import { DrillLoginForm } from "./DrillLoginForm";
import { DrillUserForm } from "./DrillUserForm";

export const metadata = {
  title: "Drill teams — rmdig admin",
};

// RMDig's drill teams (plan 37), kept apart from the approvals queue: they
// are never reviewed or counted there. Drill logins (P4b), activation (P5)
// and the drill test alert (AvServ plan 66 R1) are managed from here.
export default async function DrillTeamsPage() {
  const session = await auth();
  if (!session?.user) return redirectToSignIn();
  if (!(await hasPlatformRole(session.user.id, "rmdig_admin"))) redirect("/admin");
  // Activating also takes the SAR approver role; the action checks both.
  const approver = await isSarApprover(session.user.id);

  const teams = await db
    .select({
      id: sarOrgs.id,
      name: sarOrgs.name,
      status: sarOrgs.status,
      regionName: sarOrgs.regionName,
      createdAt: sarOrgs.createdAt,
      reviewRevision: sarOrgs.reviewRevision,
    })
    .from(sarOrgs)
    .where(eq(sarOrgs.isDrill, true))
    .orderBy(asc(sarOrgs.createdAt));
  const logins = teams.length
    ? await db
        .select({ orgId: orgMemberships.orgId, email: users.email, role: orgMemberships.role, passwordSet: users.emailVerified })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(inArray(orgMemberships.orgId, teams.map((t) => t.id)))
        .orderBy(asc(users.email))
    : [];
  // Drill users (P7b): drill accounts with no team, for the AvApp drill build.
  const drillUsers = await db
    .select({ email: users.email, passwordSet: users.emailVerified, createdAt: users.createdAt })
    .from(users)
    .leftJoin(orgMemberships, eq(orgMemberships.userId, users.id))
    .where(and(eq(users.isDrill, true), isNull(orgMemberships.userId)))
    .orderBy(asc(users.email));
  const syncs = teams.length ? await db.select().from(sarOrgSync).where(inArray(sarOrgSync.orgId, teams.map((t) => t.id))) : [];
  const tests = await latestTestAlerts(teams.map((t) => t.id));
  const takesLogins = (status: string) => status !== "rejected" && status !== "withdrawn";
  const syncDetail = (s: (typeof syncs)[number]) =>
    s.outcome === "error"
      ? `failed (${s.errorCode})`
      : s.outcome === "skipped"
        ? (SKIP_LABEL[s.unusableReason as SkipReason] ?? s.unusableReason ?? "skipped")
        : s.usable
          ? "synced"
          : `synced, not usable (${s.unusableReason})`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drill teams</h1>
          <p className="text-muted-foreground mt-1">
            Test teams for exercising the SAR path live. Never offered to real users, never in the
            approvals queue.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/sar-drill/new">Register a drill team</Link>
        </Button>
      </div>

      {teams.length === 0 ? (
        <p className="text-muted-foreground text-sm">No drill teams yet.</p>
      ) : (
        <ul className="space-y-3">
          {teams.map((t) => (
            <li key={t.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription>
                    {t.status} · registered {formatMountainDate(t.createdAt)}
                    {t.regionName ? ` · ${t.regionName}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-muted-foreground text-sm">Team id {t.id}</p>
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Drill logins</h3>
                    {logins.some((l) => l.orgId === t.id) ? (
                      <ul className="space-y-1 text-sm">
                        {logins
                          .filter((l) => l.orgId === t.id)
                          .map((l) => (
                            <li key={l.email}>
                              {l.email} · {l.role}
                              {l.passwordSet ? "" : " · password not set yet"}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">None yet. Add an admin first.</p>
                    )}
                  </div>
                  {takesLogins(t.status) ? <DrillLoginForm orgId={t.id} /> : null}
                  {syncs.some((s) => s.orgId === t.id) ? (
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">AvServ</h3>
                      <ul className="space-y-1 text-sm">
                        {syncs
                          .filter((s) => s.orgId === t.id)
                          .map((s) => (
                            <li key={s.node}>
                              {s.node}: {syncDetail(s)}
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
                  <TestAlertPanel orgId={t.id} rows={tests.get(t.id) ?? []} canSend={takesLogins(t.status)} drill />
                  <DrillDecisions orgId={t.id} orgName={t.name} revision={t.reviewRevision} status={t.status} canActivate={approver} canSuspend={approver} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Drill users</CardTitle>
          <CardDescription>
            Drill accounts with no team, for linking the DRILL build of AvAI (plan 37 P7). Never erase a team&apos;s
            only drill login; use a drill user for the erasure drill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {drillUsers.length ? (
            <ul className="space-y-1 text-sm">
              {drillUsers.map((u) => (
                <li key={u.email}>
                  {u.email} · added {formatMountainDate(u.createdAt)}
                  {u.passwordSet ? "" : " · password not set yet"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">None yet.</p>
          )}
          <DrillUserForm />
        </CardContent>
      </Card>
    </div>
  );
}
