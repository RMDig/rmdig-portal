import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { hasPlatformRole } from "@/lib/auth/roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { orgMemberships, sarOrgs, users } from "@/lib/db/schema";
import { formatMountainDate } from "@/lib/format/time";

import { DrillLoginForm } from "./DrillLoginForm";

export const metadata = {
  title: "Drill teams — rmdig admin",
};

// RMDig's drill teams (plan 37), kept apart from the approvals queue: they
// are never reviewed or counted there. Drill logins (P4b) and activation (P5)
// are managed from here.
export default async function DrillTeamsPage() {
  const session = await auth();
  if (!session?.user) return redirectToSignIn();
  if (!(await hasPlatformRole(session.user.id, "rmdig_admin"))) redirect("/admin");

  const teams = await db
    .select({ id: sarOrgs.id, name: sarOrgs.name, status: sarOrgs.status, regionName: sarOrgs.regionName, createdAt: sarOrgs.createdAt })
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
  const takesLogins = (status: string) => status !== "rejected" && status !== "withdrawn";

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
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
