import { asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { hasPlatformRole, PLATFORM_ROLE_LABEL } from "@/lib/auth/roles";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import {
  platformRoleInvitations,
  platformRoleLog,
  userPlatformRoles,
  users,
} from "@/lib/db/schema";
import { CancelInviteButton, InviteStaffForm, RevokeRoleForm } from "./TeamForms";

export const metadata = {
  title: "Team — rmdig admin",
};

export default async function AdminTeamPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !(await hasPlatformRole(userId, "rmdig_admin"))) {
    redirect("/dashboard");
  }

  const members = await db
    .select({
      userId: userPlatformRoles.userId,
      role: userPlatformRoles.role,
      email: users.email,
      displayName: users.displayName,
      since: userPlatformRoles.createdAt,
    })
    .from(userPlatformRoles)
    .innerJoin(users, eq(users.id, userPlatformRoles.userId))
    .orderBy(asc(users.email));

  const invites = await db
    .select()
    .from(platformRoleInvitations)
    .orderBy(desc(platformRoleInvitations.createdAt));
  const now = new Date();

  const log = await db
    .select({
      action: platformRoleLog.action,
      role: platformRoleLog.role,
      targetEmail: platformRoleLog.targetEmail,
      createdAt: platformRoleLog.createdAt,
    })
    .from(platformRoleLog)
    .orderBy(desc(platformRoleLog.createdAt))
    .limit(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-muted-foreground mt-1">
          Platform staff — administrators and reviewers.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Staff</h2>
        <ul className="divide-y rounded-md border">
          {members.map((m) => (
            <li
              key={`${m.userId}:${m.role}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="font-medium">{m.displayName ?? m.email}</p>
                <p className="text-muted-foreground text-sm">
                  {m.email} · {PLATFORM_ROLE_LABEL[m.role]} · since{" "}
                  {m.since.toLocaleDateString()}
                </p>
              </div>
              <RevokeRoleForm targetUserId={m.userId} role={m.role} />
            </li>
          ))}
        </ul>
      </section>

      {invites.filter((i) => !i.acceptedAt).length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Pending invitations</h2>
          <ul className="divide-y rounded-md border">
            {invites
              .filter((i) => !i.acceptedAt)
              .map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{i.email}</p>
                    <p className="text-muted-foreground text-sm">
                      {PLATFORM_ROLE_LABEL[i.role]} ·{" "}
                      {i.expiresAt < now
                        ? "expired"
                        : `expires ${i.expiresAt.toLocaleDateString()}`}
                    </p>
                  </div>
                  <CancelInviteButton inviteId={i.id} />
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite staff</CardTitle>
          <CardDescription>
            The invitee signs in (or creates an account) with the invited email and
            accepts by link. Staff accounts require two-factor authentication; the role
            takes effect on acceptance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteStaffForm />
        </CardContent>
      </Card>

      {log.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Recent changes</h2>
          <ul className="divide-y rounded-md border text-sm">
            {log.map((entry, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>
                  {entry.action.replace("_", " ")} · {PLATFORM_ROLE_LABEL[entry.role]} ·{" "}
                  {entry.targetEmail}
                </span>
                <span className="text-muted-foreground">
                  {entry.createdAt.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
